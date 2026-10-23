/**
 * Catalog census: how many samples every source holds, by category, licence,
 * category and price, plus a daily history. Providers count themselves
 * (`Provider.census`); this module has their shared helpers and the
 * aggregate that scripts/census.mjs writes to web/src/data/catalog.json.
 */

import type { Category, HttpClient, Provider, ProviderContext, Sample, SourceCensus } from "./types.js";
import { topCategory } from "./vocab.js";

const DAY = 24 * 60 * 60 * 1000;

/** Map with at most `limit` calls in flight (be gentle with one host). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Count values; undefined keys are skipped. */
export function countBy<T>(items: T[], key: (item: T) => string | string[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    for (const v of Array.isArray(k) ? k : k === undefined ? [] : [k]) out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

/** The `n` largest entries, largest first. */
export function top(record: Record<string, number> | undefined, n: number): Record<string, number> | undefined {
  if (!record) return undefined;
  const entries = Object.entries(record)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Listings released in the 30 days before `now`. */
export function addedSince(dates: (string | number | undefined)[], now = Date.now(), days = 30): number {
  const from = now - days * DAY;
  let n = 0;
  for (const d of dates) {
    if (d === undefined) continue;
    const t = typeof d === "number" ? (d < 1e12 ? d * 1000 : d) : Date.parse(d);
    if (Number.isFinite(t) && t >= from && t <= now + DAY) n++;
  }
  return n;
}

/** Census of a source whose whole catalogue is in hand (`search` with an empty query returns everything). */
export function tallySamples(assets: Sample[], method: string, opts: { unit?: "samples" | "packs"; now?: number } = {}): SourceCensus {
  const licenses = countBy(assets, (a) => a.license?.id);
  const free = assets.filter((a) => a.price?.free).length;
  const dated = assets.some((a) => a.createdAt);
  return {
    total: assets.length,
    free: assets.some((a) => a.price) ? free : undefined,
    byCategory: countBy(assets, (a) => topCategory(a.category)) as Partial<Record<Category, number>>,
    byLicense: Object.keys(licenses).length > 1 ? licenses : undefined,
    categories: top(countBy(assets, (a) => a.category), 12),
    unit: opts.unit,
    addedLast30Days: dated ? addedSince(assets.map((a) => a.createdAt), opts.now) : undefined,
    method,
  };
}

/** Whole catalogue through the provider's own browse (for catalogue-based sources). */
export async function catalogueCensus(p: Provider, ctx: ProviderContext, unit?: "samples" | "packs"): Promise<SourceCensus> {
  const res = await p.search({ query: "", limit: 100_000 }, ctx);
  return tallySamples(res.samples, "Every listing in the source's catalogue", { unit });
}

/** WordPress/WooCommerce REST collections report their size in `X-WP-Total`. */
export async function wpTotal(http: HttpClient, url: string, signal?: AbortSignal): Promise<number> {
  const res = await http.raw(url, { signal, headers: { accept: "application/json" } });
  const header = res.headers.get("x-wp-total");
  const n = header === null || header.trim() === "" ? NaN : Number(header);
  await res.body?.cancel().catch(() => undefined);
  if (!res.ok || !Number.isFinite(n)) throw new Error(`no X-WP-Total from ${url} (HTTP ${res.status})`);
  return n;
}

/** "118,384 results" -> 118384 */
export function parseCount(text: string, re: RegExp): number | undefined {
  const m = re.exec(text);
  if (!m?.[1]) return undefined;
  const n = Number(m[1].replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Aggregate

export interface CatalogSource extends SourceCensus {
  id: string;
  name: string;
  homepage: string;
  license?: string;
  pricing: Provider["pricing"];
  supportsDownload: boolean;
  /** When this source was last counted successfully. */
  countedAt: string;
  /** Set when today's count failed and an older count is shown. */
  stale?: { since: string; error: string };
}

export interface CountWithBound {
  count: number;
  atLeast?: boolean;
}

export interface Catalog {
  countedAt: string;
  totals: {
    /** Listings across all counted sources (samples and packs). */
    listings: CountWithBound;
    free: CountWithBound;
    /** Listings on CC0-only sources plus CC0 listings on mixed sources. */
    cc0: CountWithBound;
    /** Free listings on sources the server downloads from directly. */
    directDownload: CountWithBound;
    addedLast30Days: number;
    sourcesCounted: number;
    sourcesLinked: number;
  };
  byCategory: Partial<Record<Category, CountWithBound>>;
  byLicense: Record<string, number>;
  sources: CatalogSource[];
  /** Sources that are deep links only (not counted). */
  linked: { id: string; name: string; homepage: string }[];
}

export interface CatalogHistoryPoint {
  date: string;
  listings: number;
  free: number;
  byCategory: Partial<Record<Category, number>>;
  sources: Record<string, number>;
}

function add(target: CountWithBound, n: number | undefined, atLeast?: boolean): void {
  if (n === undefined) {
    target.atLeast = true;
    return;
  }
  target.count += n;
  if (atLeast) target.atLeast = true;
}

/**
 * Count every source (in parallel, each with its own timeout). A source that
 * fails keeps its last good count from `previous`, marked stale.
 */
export async function runCensus(
  providers: Provider[],
  ctx: Omit<ProviderContext, "signal">,
  opts: { previous?: Catalog; now?: Date; timeoutMs?: number; log?: (line: string) => void } = {},
): Promise<Catalog> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => undefined);
  const counted = providers.filter((p) => p.census);
  const results = await Promise.all(
    counted.map(async (p): Promise<CatalogSource | undefined> => {
      const meta = { id: p.id, name: p.name, homepage: p.homepage, license: p.license?.id, pricing: p.pricing, supportsDownload: p.supportsDownload };
      const started = Date.now();
      try {
        const c = await p.census!({ ...ctx, signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000) });
        log(`${p.id}: ${c.total}${c.atLeast ? "+" : ""} in ${Date.now() - started} ms`);
        return { ...meta, ...c, countedAt: now.toISOString() };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        log(`${p.id}: FAILED (${error.slice(0, 160)})`);
        const old = opts.previous?.sources.find((s) => s.id === p.id);
        return old ? { ...old, ...meta, stale: { since: old.stale?.since ?? old.countedAt, error: error.slice(0, 200) } } : undefined;
      }
    }),
  );
  const sources = results.filter((s): s is CatalogSource => !!s).sort((a, b) => b.total - a.total);

  const listings: CountWithBound = { count: 0 };
  const free: CountWithBound = { count: 0 };
  const cc0: CountWithBound = { count: 0 };
  const direct: CountWithBound = { count: 0 };
  const byCategory: Partial<Record<Category, CountWithBound>> = {};
  const byLicense: Record<string, number> = {};
  let added = 0;
  for (const s of sources) {
    add(listings, s.total, s.atLeast);
    const sourceFree = s.free ?? (s.pricing === "free" ? s.total : undefined);
    add(free, sourceFree, s.atLeast);
    if (s.license === "CC0-1.0") add(cc0, s.total, s.atLeast);
    else if (s.byLicense?.["CC0-1.0"]) add(cc0, s.byLicense["CC0-1.0"], s.atLeast);
    if (s.supportsDownload) add(direct, sourceFree, s.atLeast);
    for (const [t, n] of Object.entries(s.byCategory) as [Category, number][]) {
      const slot = (byCategory[t] ??= { count: 0 });
      add(slot, n, s.atLeast);
    }
    const licenses = s.byLicense ?? (s.license ? { [s.license]: s.total } : {});
    for (const [l, n] of Object.entries(licenses)) byLicense[l] = (byLicense[l] ?? 0) + n;
    added += s.addedLast30Days ?? 0;
  }
  return {
    countedAt: now.toISOString(),
    totals: {
      listings,
      free,
      cc0,
      directDownload: direct,
      addedLast30Days: added,
      sourcesCounted: sources.length,
      sourcesLinked: providers.length - counted.length,
    },
    byCategory,
    byLicense: top(byLicense, 20) ?? {},
    sources,
    linked: providers.filter((p) => !p.census).map((p) => ({ id: p.id, name: p.name, homepage: p.homepage })),
  };
}

/** Append today's totals to the history (one point per UTC day, newest last). */
export function appendHistory(history: CatalogHistoryPoint[], catalog: Catalog, max = 730): CatalogHistoryPoint[] {
  const date = catalog.countedAt.slice(0, 10);
  const point: CatalogHistoryPoint = {
    date,
    listings: catalog.totals.listings.count,
    free: catalog.totals.free.count,
    byCategory: Object.fromEntries(Object.entries(catalog.byCategory).map(([t, v]) => [t, v!.count])),
    sources: Object.fromEntries(catalog.sources.map((s) => [s.id, s.total])),
  };
  return [...history.filter((h) => h.date !== date), point].sort((a, b) => a.date.localeCompare(b.date)).slice(-max);
}
