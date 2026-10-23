import { createHttpClient } from "./http.js";
import { COMMERCIAL_SAFE } from "./licence.js";
import { bpmMatches, keyMatches, parseQuery } from "./query.js";
import type {
  HttpClient,
  NativeFilter,
  Provider,
  ProviderContext,
  ProviderInfo,
  Sample,
  SampleDetails,
  SampleFilters,
  SampleQuery,
} from "./types.js";
import type { EmbeddingIndex } from "./similar.js";
import { matchScore, parseSampleId } from "./util.js";
import { categoryMatches, type Category } from "./vocab.js";

export interface SearchRequest extends SampleFilters {
  query: string;
  /** Restrict to these provider ids. */
  providers?: string[];
  /** Only return samples this server can download directly. */
  downloadableOnly?: boolean;
  /**
   * Drop samples whose BPM/key/form is unknown when that filter is set.
   * Default false: unknown values stay in the list, ranked below known matches.
   */
  strict?: boolean;
  /** Parse "140 bpm", "F minor", "one shot" out of `query` into filters (default true). */
  parse?: boolean;
  /** Total results to return across providers. */
  limit?: number;
  /** Per-provider result offset (for paging deeper into every source). */
  offset?: number;
  /** Per-provider timeout. */
  timeoutMs?: number;
  /** Per-request credentials (e.g. a user's Freesound token), passed to providers only. */
  credentials?: Record<string, string>;
}

export type ProviderStatus = "ok" | "error" | "timeout" | "skipped" | "link";

export interface ProviderSearchReport {
  provider: string;
  name: string;
  status: ProviderStatus;
  count: number;
  total?: number;
  searchUrl?: string;
  error?: string;
  /** Filters this source could not apply itself (we applied them to what it returned). */
  filteredLocally?: NativeFilter[];
  tookMs: number;
}

export interface SearchResponse {
  query: string;
  /** The filters in force after parsing the query. */
  filters: SampleFilters;
  results: Sample[];
  providers: ProviderSearchReport[];
}

export interface SampleServiceOptions {
  providers: Provider[];
  http?: HttpClient;
  defaultTimeoutMs?: number;
  /**
   * CLAP embedding features (src/core/similar.ts), when on: background
   * indexing of previews seen here, text→audio re-ranking of results that
   * already have a vector, and the zero-shot category fallback.
   */
  embeddings?: EmbeddingIndex;
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/** Small boost for sources whose metadata and downloads we trust most. */
const ACCESS_WEIGHT = { api: 1, static: 0.9, scrape: 0.8, link: 0 } as const;

export class SampleService {
  readonly http: HttpClient;
  private readonly providers = new Map<string, Provider>();
  private readonly defaultTimeoutMs: number;
  readonly embeddings?: EmbeddingIndex;

  constructor(opts: SampleServiceOptions) {
    this.http = opts.http ?? createHttpClient();
    this.embeddings = opts.embeddings;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? Number(process.env.SOUND_SERVER_PROVIDER_TIMEOUT_MS ?? 12_000);
    for (const p of opts.providers) this.providers.set(p.id, p);
  }

  listProviders(): (ProviderInfo & { enabled: boolean })[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      homepage: p.homepage,
      description: p.description,
      categories: p.categories,
      forms: p.forms,
      access: p.access,
      pricing: p.pricing,
      license: p.license,
      apiKeyEnv: p.apiKeyEnv,
      supportsDownload: p.supportsDownload,
      nativeFilters: p.nativeFilters,
      enabled: p.isEnabled?.() ?? true,
    }));
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  async search(req: SearchRequest): Promise<SearchResponse> {
    const limit = Math.min(Math.max(req.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const wanted = req.providers?.length ? new Set(req.providers) : undefined;
    const unknown = req.providers?.filter((p) => !this.providers.has(p)) ?? [];
    if (unknown.length) throw new UnknownProviderError(unknown);

    const parsed = req.parse === false ? { query: req.query.trim(), hints: [] as Category[] } : parseQuery(req.query);
    // Explicit filters win over words parsed from the query.
    const filters: SampleFilters = dropUndefined({
      categories: req.categories?.length ? req.categories : undefined,
      forms: req.forms?.length ? req.forms : "forms" in parsed ? parsed.forms : undefined,
      bpm: req.bpm ?? ("bpm" in parsed ? parsed.bpm : undefined),
      key: req.key ?? ("key" in parsed ? parsed.key : undefined),
      maxDurationSec: req.maxDurationSec,
      minDurationSec: req.minDurationSec,
      commercialOnly: req.commercialOnly || undefined,
      freeOnly: req.freeOnly || undefined,
    });

    // Ask each source for a full page so the merged ranking has enough to choose from.
    const perProvider = Math.min(limit, 50);
    const q: SampleQuery = { ...filters, query: parsed.query, hints: parsed.hints, limit: perProvider, offset: req.offset };

    const reports: ProviderSearchReport[] = [];
    const ranked: { sample: Sample; rank: number; provider: Provider }[] = [];

    await Promise.all(
      [...this.providers.values()].map(async (p) => {
        const started = Date.now();
        const base = { provider: p.id, name: p.name, count: 0 };
        const skip = (reason: string): void => {
          reports.push({ ...base, status: "skipped", error: reason, tookMs: 0 });
        };
        if (wanted && !wanted.has(p.id)) return;
        if (p.isEnabled && !p.isEnabled()) return skip(`disabled (set ${p.apiKeyEnv ?? "its API key"})`);
        if (filters.categories && !filters.categories.some((c) => p.categories.some((pc) => categoryMatches(c, [pc]) || categoryMatches(pc, [c]))))
          return skip("does not carry the requested categories");
        if (filters.forms && p.forms && !filters.forms.some((f) => p.forms!.includes(f))) return skip("does not carry the requested forms");
        if (req.downloadableOnly && !p.supportsDownload) return skip("no direct downloads");
        if (filters.freeOnly && p.pricing === "paid") return skip("paid only");
        if (filters.commercialOnly && p.license && !COMMERCIAL_SAFE.has(p.license.verdict))
          return skip(`licence is ${p.license.verdict === "no" ? "non-commercial" : p.license.verdict}`);

        const searchUrl = p.buildSearchUrl(q);
        const signal = AbortSignal.timeout(timeoutMs);
        const ctx: ProviderContext = { fetch: this.http, signal, credentials: req.credentials };
        try {
          const res = await withTimeout(p.search(q, ctx), timeoutMs, signal);
          const local = localFilters(filters, p.nativeFilters);
          const index = this.embeddings;
          let samples = (index ? res.samples.map((s) => index.refine(s)) : res.samples).filter((s) => passes(s, filters, req));
          if (req.downloadableOnly) samples = samples.filter((s) => s.downloadable);
          samples.forEach((sample, rank) => ranked.push({ sample, rank, provider: p }));
          reports.push({
            ...base,
            status: p.access === "link" ? "link" : "ok",
            count: samples.length,
            total: res.total,
            searchUrl: res.searchUrl ?? searchUrl,
            ...(local.length && p.access !== "link" ? { filteredLocally: local } : {}),
            tookMs: Date.now() - started,
          });
        } catch (e) {
          const timedOut = signal.aborted || e instanceof TimeoutError;
          reports.push({
            ...base,
            status: timedOut ? "timeout" : "error",
            error: timedOut ? `timed out after ${timeoutMs}ms` : errorMessage(e),
            searchUrl,
            tookMs: Date.now() - started,
          });
        }
      }),
    );

    const order = [...this.providers.keys()];
    const byUrl = dedupe(ranked, order);
    // The same recording on two sources (e.g. a Freesound sound re-uploaded to Wikimedia), by stored audio vector.
    const unique = this.embeddings ? this.embeddings.mergeDuplicates(byUrl, order) : byUrl;
    // Text→audio similarity for results that already have a stored vector. Never fetches audio.
    const semantic = this.embeddings && q.query.trim() ? await this.embeddings.semanticScores(q.query, unique.map((u) => u.sample.id)).catch(() => undefined) : undefined;
    const results = rankResults(unique, q, semantic ? { semantic, weight: this.embeddings!.rerankWeight } : undefined).slice(0, limit);
    reports.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
    this.embeddings?.observe(results);
    return { query: q.query, filters, results, providers: reports };
  }

  async getSample(id: string, credentials?: Record<string, string>): Promise<SampleDetails | null> {
    const parsed = parseSampleId(id);
    if (!parsed) throw new InvalidSampleIdError(id);
    const p = this.providers.get(parsed.provider);
    if (!p) throw new UnknownProviderError([parsed.provider]);
    if (!p.getSample) throw new UnsupportedError(`${p.name} does not support sample details; open the source site instead.`);
    const signal = AbortSignal.timeout(this.defaultTimeoutMs * 2);
    const sample = await p.getSample(parsed.nativeId, { fetch: this.http, signal, credentials });
    if (!sample || !this.embeddings) return sample;
    this.embeddings.observeDetails(sample);
    return this.embeddings.refine(sample);
  }
}

function dropUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const FILTER_KEYS: [NativeFilter, (f: SampleFilters) => boolean][] = [
  ["categories", (f) => !!f.categories],
  ["forms", (f) => !!f.forms],
  ["bpm", (f) => !!f.bpm],
  ["key", (f) => !!f.key],
  ["duration", (f) => f.maxDurationSec !== undefined || f.minDurationSec !== undefined],
  ["commercialOnly", (f) => !!f.commercialOnly],
  ["freeOnly", (f) => !!f.freeOnly],
];

function localFilters(f: SampleFilters, native: NativeFilter[] = []): NativeFilter[] {
  return FILTER_KEYS.filter(([k, active]) => active(f) && !native.includes(k)).map(([k]) => k);
}

/**
 * Apply the filters to one sample. Known mismatches always go; unknown BPM,
 * key, form or duration only go in strict mode. Category and licence are
 * always known (the classifier fills category; no licence fails commercialOnly).
 */
export function passes(s: Sample, f: SampleFilters, opts: { strict?: boolean } = {}): boolean {
  const strict = !!opts.strict;
  if (f.categories && !categoryMatches(s.category, f.categories)) return false;
  if (f.forms) {
    if (s.form ? !f.forms.includes(s.form) : strict) return false;
  }
  if (f.bpm) {
    if (s.bpm !== undefined ? !bpmMatches(s.bpm, f.bpm) : strict) return false;
  }
  if (f.key) {
    if (s.key ? !keyMatches(s.key, f.key, true) : strict) return false;
  }
  if (f.maxDurationSec !== undefined || f.minDurationSec !== undefined) {
    const d = s.durationSec;
    if (d === undefined) {
      if (strict) return false;
    } else if ((f.maxDurationSec !== undefined && d > f.maxDurationSec) || (f.minDurationSec !== undefined && d < f.minDurationSec)) {
      return false;
    }
  }
  if (f.commercialOnly && !(s.license && COMMERCIAL_SAFE.has(s.license.verdict))) return false;
  if (f.freeOnly && s.price?.free === false) return false;
  return true;
}

/**
 * The same sound reached through two sources (Openverse mirrors Freesound and
 * Wikimedia): keep the copy from the source listed first, which is the
 * original. Matching is by `sameAs` ids and by identical file/page URLs.
 */
export function dedupe<T extends { sample: Sample; provider: Pick<Provider, "id"> }>(items: T[], order: string[]): T[] {
  const byPriority = [...items].sort((a, b) => order.indexOf(a.provider.id) - order.indexOf(b.provider.id));
  const seen = new Set<string>();
  const keep = new Set<T>();
  for (const it of byPriority) {
    const keys = [it.sample.id, ...(it.sample.sameAs ?? []), `url:${normUrl(it.sample.url)}`];
    if (it.sample.previewUrl) keys.push(`url:${normUrl(it.sample.previewUrl)}`);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    keep.add(it);
  }
  return items.filter((it) => keep.has(it));
}

function normUrl(u: string): string {
  return u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
}

/**
 * Merge per-provider results into one list.
 * Score = text relevance (dominant) + the source's own ranking + musical fit
 * (category hint, BPM, key, form known and matching) + small boosts for
 * commercial-safe, free and directly downloadable samples, then a diversity
 * penalty so one large catalogue can't fill the whole first page.
 */
export function rankResults(
  items: { sample: Sample; rank: number; provider: Pick<Provider, "id" | "access"> }[],
  q: Pick<SampleQuery, "query" | "hints" | "bpm" | "key" | "forms" | "categories">,
  opts?: RankOptions,
): Sample[] {
  const semantic = semanticTerm(opts);
  const scored = items.map(({ sample, rank, provider }) => {
    const relevance = matchScore({ ...sample, tags: [...sample.tags, sample.category.replace(/\./g, " ")] }, q.query);
    const sourceRank = 1 / (1 + rank * 0.15);
    const score =
      0.5 * relevance +
      0.15 * sourceRank +
      0.1 * ACCESS_WEIGHT[provider.access] +
      0.15 * musicalFit(sample, q) +
      0.04 * (sample.license && COMMERCIAL_SAFE.has(sample.license.verdict) ? 1 : 0) +
      0.03 * (sample.price?.free !== false ? 1 : 0) +
      0.03 * (sample.downloadable ? 1 : 0) +
      semantic(sample.id);
    return { sample, provider: provider.id, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const seenPerProvider = new Map<string, number>();
  const diversified = scored.map((s) => {
    const n = seenPerProvider.get(s.provider) ?? 0;
    seenPerProvider.set(s.provider, n + 1);
    return { ...s, score: s.score * Math.pow(0.93, n) };
  });
  diversified.sort((a, b) => b.score - a.score);
  return diversified.map((s) => ({ ...s.sample, score: round(s.score) }));
}

export interface RankOptions {
  /** Raw text→audio cosine per sample id (only samples with a stored vector). */
  semantic?: Map<string, number>;
  /** Weight of the semantic term (default 0.15). */
  weight?: number;
}

/**
 * The semantic term: cosines min-max scaled across this result set, centred
 * so a sample without a vector scores 0 (unchanged) and ones with vectors move
 * by at most ±weight/2. Fewer than two vectors: no term at all.
 */
function semanticTerm(opts?: RankOptions): (id: string) => number {
  const sem = opts?.semantic;
  if (!sem || sem.size < 2) return () => 0;
  const w = opts?.weight ?? 0.15;
  const values = [...sem.values()];
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  if (span < 1e-6) return () => 0;
  return (id) => {
    const v = sem.get(id);
    return v === undefined ? 0 : w * ((v - min) / span - 0.5);
  };
}

/** 0..1: how well the known musical facts fit what was asked. Unknowns score half. */
function musicalFit(s: Sample, q: Pick<SampleQuery, "hints" | "bpm" | "key" | "forms" | "categories">): number {
  const parts: number[] = [];
  const hints = q.categories?.length ? q.categories : q.hints;
  if (hints?.length) {
    const exact = hints.some((h) => s.category === h || s.category.startsWith(`${h}.`));
    const conf = s.categoryEvidence?.confidence ?? 0.5;
    parts.push(exact ? 0.5 + 0.5 * conf : 0);
  }
  if (q.bpm) parts.push(s.bpm === undefined ? 0.4 : bpmMatches(s.bpm, q.bpm, 0) ? 1 : 0.7);
  if (q.key) parts.push(s.key === undefined ? 0.4 : keyMatches(s.key, q.key) ? 1 : 0.7);
  if (q.forms) parts.push(s.form === undefined ? 0.4 : 1);
  if (!parts.length) return 0.5;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TimeoutError(`timed out after ${ms}ms`));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class UnknownProviderError extends Error {
  constructor(readonly ids: string[]) {
    super(`Unknown provider(s): ${ids.join(", ")}`);
    this.name = "UnknownProviderError";
  }
}

export class InvalidSampleIdError extends Error {
  constructor(id: string) {
    super(`Invalid sample id "${id}". Expected "<provider>:<id>", e.g. "freesound:2086".`);
    this.name = "InvalidSampleIdError";
  }
}

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedError";
  }
}
