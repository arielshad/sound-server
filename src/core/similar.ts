/**
 * Search-quality features built on CLAP embeddings (src/core/embeddings.ts):
 *
 * - an in-memory vector index (brute-force cosine over L2-normalised
 *   Float32 vectors; ~5 ms per query at 10k × 512, fine up to ~100k), loaded
 *   from the SQLite store at start and kept in sync with it;
 * - a polite background indexer: previews of samples seen in search results
 *   and sample lookups are embedded a few per minute, one fetch per host at a
 *   time, never longer than 30 s;
 * - find-similar for any sample id, falling back to Freesound's own
 *   similarity for freesound ids when there is nothing to compare against;
 * - text→audio scores for re-ranking search results that already have a
 *   stored vector (never fetches audio during a search);
 * - a zero-shot CLAP classifier for samples whose rule-based category is
 *   unsure.
 */
import { LRUCache } from "lru-cache";
import { decodeAudio } from "./analyze.js";
import { CLAP_SAMPLE_RATE, dot, l2normalize, withTimeout, type Embedder, type EmbedderStatus } from "./embeddings.js";
import type { SampleService } from "./service.js";
import type { SampleStore, StoreStats } from "./store.js";
import { layoutMapAsync } from "./soundmap.js";
import type { CommercialVerdict, HttpClient, Sample, SampleDetails } from "./types.js";
import { CATEGORY_DEFS, categoryMatches, type Category } from "./vocab.js";

// ---------------------------------------------------------------------------
// Vector index

export interface IndexedMeta {
  provider: string;
  title?: string;
  category?: string;
  previewUrl?: string;
  sameAs?: string[];
  durationSec?: number;
  verdict?: CommercialVerdict;
}

export interface Neighbour {
  id: string;
  score: number;
  meta: IndexedMeta;
}

/** Brute-force cosine search over normalised vectors in one growable Float32Array. */
export class VectorIndex {
  private dim = 0;
  private data = new Float32Array(0);
  private ids: string[] = [];
  private metas: IndexedMeta[] = [];
  private readonly pos = new Map<string, number>();
  private changes = 0;

  get size(): number {
    return this.ids.length;
  }

  /** Bumped on every upsert, for caching anything derived from the whole index. */
  get version(): number {
    return this.changes;
  }

  /** Every id with its metadata, in insertion order. */
  *entries(): IterableIterator<[string, IndexedMeta]> {
    for (let i = 0; i < this.ids.length; i++) yield [this.ids[i]!, this.metas[i]!];
  }

  /** Cosine of two stored vectors (undefined if either is missing). */
  cosine(a: string, b: string): number | undefined {
    const i = this.pos.get(a);
    const j = this.pos.get(b);
    if (i === undefined || j === undefined) return undefined;
    let s = 0;
    const d = this.dim;
    for (let t = 0; t < d; t++) s += this.data[i * d + t]! * this.data[j * d + t]!;
    return s;
  }

  get dimensions(): number {
    return this.dim;
  }

  has(id: string): boolean {
    return this.pos.has(id);
  }

  get(id: string): Float32Array | undefined {
    const i = this.pos.get(id);
    return i === undefined ? undefined : this.data.slice(i * this.dim, (i + 1) * this.dim);
  }

  meta(id: string): IndexedMeta | undefined {
    const i = this.pos.get(id);
    return i === undefined ? undefined : this.metas[i];
  }

  /** Add or replace a vector (normalised here). Vectors of another size are rejected. */
  upsert(id: string, vector: Float32Array, meta: IndexedMeta): void {
    if (!this.dim) this.dim = vector.length;
    if (vector.length !== this.dim) throw new Error(`vector has ${vector.length} dimensions, index has ${this.dim}`);
    const v = l2normalize(vector);
    let i = this.pos.get(id);
    if (i === undefined) {
      i = this.ids.length;
      if ((i + 1) * this.dim > this.data.length) {
        const grown = new Float32Array(Math.max(this.dim * 64, this.data.length * 2));
        grown.set(this.data);
        this.data = grown;
      }
      this.ids.push(id);
      this.metas.push(meta);
      this.pos.set(id, i);
    } else this.metas[i] = meta;
    this.data.set(v, i * this.dim);
    this.changes++;
  }

  /** The `k` most similar vectors to `query` (cosine), best first, skipping `exclude`d ones. */
  nearest(query: Float32Array, k: number, exclude?: (id: string, meta: IndexedMeta) => boolean): Neighbour[] {
    if (!this.dim || query.length !== this.dim || k <= 0) return [];
    const q = l2normalize(query);
    const top: { i: number; s: number }[] = [];
    const d = this.dim;
    const data = this.data;
    for (let i = 0; i < this.ids.length; i++) {
      let s = 0;
      const o = i * d;
      for (let j = 0; j < d; j++) s += q[j]! * data[o + j]!;
      if (top.length >= k && s <= top[top.length - 1]!.s) continue;
      if (exclude?.(this.ids[i]!, this.metas[i]!)) continue;
      let at = top.length;
      while (at > 0 && top[at - 1]!.s < s) at--;
      top.splice(at, 0, { i, s });
      if (top.length > k) top.pop();
    }
    return top.map(({ i, s }) => ({ id: this.ids[i]!, score: s, meta: this.metas[i]! }));
  }
}

// ---------------------------------------------------------------------------
// Zero-shot prompts

/** Wording CLAP understands better than our short labels. */
const PROMPTS: Partial<Record<Category, string>> = {
  "drums.kick": "a kick drum one-shot",
  "drums.snare": "a snare drum hit",
  "drums.clap": "a hand clap",
  "drums.hat": "a hi-hat cymbal",
  "drums.cymbal.crash": "a crash cymbal",
  "drums.cymbal.ride": "a ride cymbal",
  "drums.tom": "a tom drum hit",
  "drums.perc": "a percussion hit like a shaker or conga",
  "drums.fill": "a drum fill",
  "drums.break": "a breakbeat drum loop",
  bass: "a bass line",
  "bass.808": "an 808 bass",
  "bass.sub": "a deep sub bass",
  vocals: "a person singing",
  "vocals.acapella": "an a cappella vocal",
  "vocals.chop": "a chopped vocal sample",
  "vocals.shout": "a vocal shout",
  "vocals.spoken": "a person speaking",
  "vocals.choir": "a choir singing",
  "fx.riser": "a rising riser sweep",
  "fx.downlifter": "a falling downlifter",
  "fx.impact": "a cinematic impact boom",
  "fx.sweep": "a whoosh",
  "fx.zap": "a laser zap sound effect",
  "fx.noise": "white noise",
  "fx.glitch": "a glitchy stutter effect",
  "fx.transition": "a reversed transition effect",
  foley: "a foley sound effect",
  ambience: "an ambient field recording",
  keys: "a piano",
  guitar: "a guitar",
  synth: "a synthesizer",
  "synth.pad": "a synth pad",
  "synth.lead": "a synth lead melody",
  "synth.pluck": "a synth pluck",
  "synth.stab": "a synth chord stab",
  strings: "a string section",
  brass: "a brass instrument",
  woodwind: "a woodwind instrument",
  mallets: "a marimba or bells",
};

/** Too broad, or too fine for CLAP to tell apart (open vs closed hat). */
const NO_PROMPT = new Set<string>(["other", "drums", "fx", "drums.hat.closed", "drums.hat.open", "drums.cymbal"]);

/** One prompt per category we let the model choose, built from vocab CATEGORY_DEFS. */
export function categoryPrompts(): { category: Category; prompt: string }[] {
  return CATEGORY_DEFS.filter((d) => !NO_PROMPT.has(d.id)).map((d) => ({
    category: d.id as Category,
    prompt: `This is a sound of ${PROMPTS[d.id as Category] ?? d.label.toLowerCase()}.`,
  }));
}

export interface ZeroShot {
  category: Category;
  /** Softmax probability of the winner. */
  confidence: number;
  /** Winner's probability minus the best unrelated category's (parents/children don't count). */
  margin: number;
}

const related = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

/**
 * Rank categories for an audio vector against prompt vectors (softmax over
 * cosines × `temperature`). 10 is calibrated on 400 Strudel drum-machine
 * hits: with confidence ≥ 0.5 and margin ≥ 0.3 the label agreed with the
 * bank's own category 90% of the time (higher temperatures saturate at 1.0).
 */
export function zeroShotRank(vector: Float32Array, prompts: { category: Category; vector: Float32Array }[], temperature = 10): ZeroShot | undefined {
  if (!prompts.length) return undefined;
  const v = l2normalize(vector);
  const logits = prompts.map((p) => temperature * dot(v, p.vector));
  const max = Math.max(...logits);
  const exp = logits.map((l) => Math.exp(l - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  const probs = prompts.map((p, i) => ({ category: p.category, p: exp[i]! / sum })).sort((a, b) => b.p - a.p);
  const best = probs[0]!;
  const rival = probs.find((x) => !related(x.category, best.category));
  return { category: best.category, confidence: best.p, margin: best.p - (rival?.p ?? 0) };
}

// ---------------------------------------------------------------------------
// The index service

export interface PreviewFile {
  url: string;
  headers?: Record<string, string>;
}

export interface EmbeddingIndexOptions {
  embedder: Embedder;
  store?: SampleStore;
  http?: HttpClient;
  /** Fetch and decode a preview to 48 kHz mono PCM (tests inject a fake). */
  loadPcm?: (file: PreviewFile, signal?: AbortSignal) => Promise<Float32Array>;
  /** Background embeddings per minute (default 20; 0 turns the background indexer off). */
  perMinute?: number;
  /** Skip samples longer than this (default 30 s). */
  maxDurationSec?: number;
  /** Background queue cap (default 500; the oldest are dropped). */
  queueMax?: number;
  /** Re-try a failed sample after this long (default 1 day). */
  retryFailedMs?: number;
  /** Zero-shot: only relabel samples whose category confidence is below this (default 0.4). */
  zeroShotBelow?: number;
  /** Zero-shot: minimum winner probability and margin (defaults 0.5 and 0.3). */
  zeroShotMinConfidence?: number;
  zeroShotMinMargin?: number;
  /** Weight of the text→audio term in search ranking (default 0.15). */
  rerankWeight?: number;
  /**
   * Two samples from different sources whose vectors are at least this similar
   * (cosine), with durations that agree, are the same sound (default 0.985).
   * Without both durations the bar is raised to halfway between this and 1.
   */
  duplicateCosine?: number;
  now?: () => number;
}

export interface IndexStatus {
  enabled: true;
  model: string;
  vectors: number;
  queued: number;
  indexed: number;
  failed: number;
  embedder: EmbedderStatus;
  store?: Omit<StoreStats, "path">;
}

interface QueueItem {
  sample: Sample;
  file: PreviewFile;
}

export class EmbeddingIndex {
  readonly vectors = new VectorIndex();
  readonly embedder: Embedder;
  readonly rerankWeight: number;
  readonly duplicateCosine: number;
  private readonly store?: SampleStore;
  private readonly http?: HttpClient;
  private readonly loadPcm: (file: PreviewFile, signal?: AbortSignal) => Promise<Float32Array>;
  private readonly perMinute: number;
  private readonly maxDurationSec: number;
  private readonly queueMax: number;
  private readonly retryFailedMs: number;
  private readonly zeroShotBelow: number;
  private readonly zeroShotMinConfidence: number;
  private readonly zeroShotMinMargin: number;
  private readonly now: () => number;
  /** Samples with vectors when there is no store (bounded). */
  private readonly memSamples = new LRUCache<string, Sample>({ max: 20_000 });
  private readonly memFailed = new LRUCache<string, number>({ max: 20_000 });
  private readonly queue = new Map<string, QueueItem>();
  private readonly inflight = new Map<string, Promise<Float32Array | undefined>>();
  private readonly hostBusy = new Map<string, Promise<unknown>>();
  private readonly queryCache = new LRUCache<string, Float32Array>({ max: 500 });
  private prompts?: { category: Category; vector: Float32Array }[];
  private promptsLoading = false;
  private tokens: number;
  private lastRefill: number;
  private working = 0;
  private timer?: NodeJS.Timeout;
  private counts = { indexed: 0, failed: 0 };

  constructor(opts: EmbeddingIndexOptions) {
    this.embedder = opts.embedder;
    this.store = opts.store;
    this.http = opts.http;
    this.loadPcm = opts.loadPcm ?? ((file, signal) => this.decodePreview(file, signal));
    this.perMinute = opts.perMinute ?? 20;
    this.maxDurationSec = opts.maxDurationSec ?? 30;
    this.queueMax = opts.queueMax ?? 500;
    this.retryFailedMs = opts.retryFailedMs ?? 24 * 3600_000;
    this.zeroShotBelow = opts.zeroShotBelow ?? 0.4;
    this.zeroShotMinConfidence = opts.zeroShotMinConfidence ?? 0.5;
    this.zeroShotMinMargin = opts.zeroShotMinMargin ?? 0.3;
    this.rerankWeight = opts.rerankWeight ?? 0.15;
    this.duplicateCosine = opts.duplicateCosine ?? 0.985;
    this.now = opts.now ?? Date.now;
    this.tokens = Math.min(this.perMinute, 5);
    this.lastRefill = this.now();
    if (this.store) {
      for (const e of this.store.embeddings(this.embedder.model)) {
        try {
          this.vectors.upsert(e.sampleId, e.vector, {
            provider: e.provider,
            title: e.title,
            category: e.category,
            previewUrl: e.previewUrl,
            sameAs: e.sameAs,
            durationSec: e.durationSec,
            verdict: e.verdict,
          });
        } catch {
          // A vector of another size (model files changed): skip it, it is re-embedded when seen again.
        }
      }
    }
  }

  get size(): number {
    return this.vectors.size;
  }

  status(): IndexStatus {
    return {
      enabled: true,
      model: this.embedder.model,
      vectors: this.vectors.size,
      queued: this.queue.size,
      indexed: this.counts.indexed,
      failed: this.counts.failed,
      embedder: this.embedder.status(),
      ...(this.store ? { store: (({ path: _p, ...rest }) => rest)(this.store.stats()) } : {}),
    };
  }

  vectorFor(id: string): Float32Array | undefined {
    return this.vectors.get(id);
  }

  /** The stored copy of a sample that has a vector. */
  storedSample(id: string): Sample | undefined {
    return this.memSamples.get(id) ?? this.store?.getSample(id);
  }

  // -------------------------------------------------------------------------
  // What to embed

  /** The audio to embed for a sample: its preview (with request headers when we have them). */
  previewFile(s: Sample | SampleDetails): PreviewFile | undefined {
    const files = "files" in s ? s.files : undefined;
    if (files) {
      const previews = files.filter((f) => f.role === "preview" && !f.requiresAuth);
      const f = previews.find((x) => x.url === s.previewUrl) ?? previews[0];
      if (f) return { url: f.url, headers: f.headers };
      const small = files.find((x) => (x.role === "original" || x.role === "stem") && !x.requiresAuth && !x.headers && x.sizeBytes !== undefined && x.sizeBytes <= 4 * 1024 * 1024 && x.format !== "zip");
      if (small) return { url: small.url };
    }
    if (!s.previewUrl || s.previewNeedsReferer) return undefined;
    return { url: s.previewUrl };
  }

  /** Why a sample can't go into the index, or undefined when it can. */
  skipReason(s: Sample | SampleDetails): string | undefined {
    if (s.unit !== "sample") return `a ${s.unit}, not a single sound`;
    if (s.durationSec !== undefined && s.durationSec > this.maxDurationSec) return `longer than ${this.maxDurationSec}s`;
    if (!this.previewFile(s)) return "no preview this server can fetch";
    return undefined;
  }

  private recentlyFailed(id: string): boolean {
    const at = this.memFailed.get(id) ?? this.store?.failedAt(id, this.embedder.model);
    return at !== undefined && this.now() - at < this.retryFailedMs;
  }

  // -------------------------------------------------------------------------
  // Background indexer

  /** Queue samples seen in search results (cheap; never waits). */
  observe(samples: Sample[]): void {
    if (this.perMinute <= 0) return;
    for (const s of samples) this.enqueue(s, false);
    this.pump();
  }

  /** Queue a sample someone opened (ahead of search hits: it is more likely to be wanted). */
  observeDetails(sample: SampleDetails): void {
    if (this.perMinute <= 0) return;
    this.enqueue(sample, true);
    this.pump();
  }

  private enqueue(s: Sample | SampleDetails, front: boolean): void {
    if (this.vectors.has(s.id) || this.inflight.has(s.id) || this.skipReason(s) || this.recentlyFailed(s.id)) return;
    const item = { sample: s, file: this.previewFile(s)! };
    if (front) {
      const rest = [...this.queue.entries()].filter(([id]) => id !== s.id);
      this.queue.clear();
      this.queue.set(s.id, item);
      for (const [id, it] of rest) this.queue.set(id, it);
    } else if (!this.queue.has(s.id)) this.queue.set(s.id, item);
    while (this.queue.size > this.queueMax) this.queue.delete(this.queue.keys().next().value!);
  }

  private refill(): void {
    const now = this.now();
    this.tokens = Math.min(Math.max(1, this.perMinute), this.tokens + ((now - this.lastRefill) / 60_000) * this.perMinute);
    this.lastRefill = now;
  }

  /** Start background jobs while budget, hosts and the one-at-a-time limit allow. */
  private pump(): void {
    if (this.perMinute <= 0 || !this.queue.size) return;
    this.refill();
    // While the model can't load, keep the queue but don't fetch anything.
    const down = this.embedder.unavailable?.("audio") !== undefined;
    while (!down && this.working < 1 && this.tokens >= 1 && this.queue.size) {
      const next = [...this.queue.values()].find((it) => !this.hostBusy.has(hostOf(it.file.url)));
      if (!next) break;
      this.queue.delete(next.sample.id);
      this.tokens -= 1;
      this.working++;
      this.index(next.sample, { file: next.file, signal: AbortSignal.timeout(60_000) })
        .catch(() => undefined)
        .finally(() => {
          this.working--;
          this.pump();
        });
    }
    if (this.queue.size && !this.timer) {
      const wait = down ? 60_000 : this.tokens >= 1 ? 1000 : Math.ceil(((1 - this.tokens) * 60_000) / this.perMinute);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      this.timer.unref?.();
    }
  }

  /** Stop the background timer (tests, shutdown). */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue.clear();
  }

  // -------------------------------------------------------------------------
  // Embedding one sample

  /** One fetch per host at a time: wait for the host's previous job, then run. */
  private async onHost<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const host = hostOf(url);
    for (;;) {
      const busy = this.hostBusy.get(host);
      if (!busy) break;
      await busy.catch(() => undefined);
    }
    const p = fn();
    this.hostBusy.set(host, p);
    try {
      return await p;
    } finally {
      if (this.hostBusy.get(host) === p) this.hostBusy.delete(host);
    }
  }

  private decodePreview(file: PreviewFile, signal?: AbortSignal): Promise<Float32Array> {
    return decodeAudio(
      { url: file.url, headers: file.headers },
      {
        http: this.http,
        signal,
        maxBytes: 4 * 1024 * 1024,
        timeoutMs: 20_000,
        sampleRate: CLAP_SAMPLE_RATE,
        maxSeconds: Number(process.env.SOUND_SERVER_EMBED_SECONDS) || 10,
      },
    );
  }

  /**
   * Embed a sample's preview now and store it. Returns the vector, the stored
   * one when it already has one (unless `force`), or undefined when it can't
   * be embedded (the reason is remembered so the background indexer skips it).
   */
  async index(s: Sample | SampleDetails, opts: { file?: PreviewFile; signal?: AbortSignal; force?: boolean } = {}): Promise<Float32Array | undefined> {
    if (!opts.force) {
      const have = this.vectors.get(s.id);
      if (have) return have;
    }
    const pending = this.inflight.get(s.id);
    if (pending) return pending;
    const reason = opts.file ? undefined : this.skipReason(s);
    if (reason) throw new Error(`can't embed ${s.id}: ${reason}`);
    const down = this.embedder.unavailable?.("audio");
    if (down) throw new Error(down);
    const file = opts.file ?? this.previewFile(s)!;
    const p = (async () => {
      try {
        const pcm = await this.onHost(file.url, () => this.loadPcm(file, opts.signal));
        if (pcm.length < 960) throw new Error("decoded audio is empty");
        const vector = await this.embedder.embedAudio(pcm);
        this.remember(s, vector, file.url);
        this.counts.indexed++;
        return vector;
      } catch (e) {
        this.counts.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        // Only remember failures that are about the sample, not about us (model not loaded, timeouts).
        if (!/model unavailable|timed out|aborted/i.test(msg)) {
          this.memFailed.set(s.id, this.now());
          try {
            this.store?.markFailed(s.id, this.embedder.model, msg);
          } catch {
            // ignore
          }
        }
        throw e;
      }
    })();
    this.inflight.set(s.id, p);
    p.finally(() => this.inflight.delete(s.id)).catch(() => undefined);
    return p;
  }

  /** Add a vector we already have (tests, imports). */
  remember(s: Sample, vector: Float32Array, previewUrl = s.previewUrl): void {
    const v = l2normalize(vector);
    this.vectors.upsert(s.id, v, {
      provider: s.provider,
      title: s.title,
      category: s.category,
      previewUrl,
      sameAs: s.sameAs,
      durationSec: s.durationSec,
      verdict: s.license?.verdict,
    });
    const { files: _files, ...plain } = s as SampleDetails;
    const sample: Sample = plain;
    if (this.store) {
      try {
        this.store.putSample(sample);
        this.store.putEmbedding({
          sampleId: s.id,
          provider: s.provider,
          model: this.embedder.model,
          vector: v,
          previewUrl,
          title: s.title,
          category: s.category,
          verdict: s.license?.verdict,
          durationSec: s.durationSec,
          sameAs: s.sameAs,
          updatedAt: this.now(),
        });
      } catch (e) {
        console.error(`sound-server: could not store the embedding of ${s.id}: ${e instanceof Error ? e.message : String(e)}`);
        this.memSamples.set(s.id, sample);
      }
    } else this.memSamples.set(s.id, sample);
  }

  // -------------------------------------------------------------------------
  // Similar

  /**
   * Stored samples nearest to `vector`, best first, without `excludeIds` and
   * with one copy per sound (sameAs, identical preview URL, or a near-identical
   * vector with the same duration on another source). Neighbours that are the
   * query sound itself on another source (`provider` is the query's) come back
   * in `sameSound` instead.
   */
  similar(
    vector: Float32Array,
    opts: { limit: number; excludeIds?: string[]; excludeUrls?: string[]; durationSec?: number; provider?: string },
  ): { sample: Sample; score: number }[] & { sameSound?: string[] } {
    const excluded = new Set(opts.excludeIds ?? []);
    const urls = new Set((opts.excludeUrls ?? []).map(normUrl));
    const isExcluded = (id: string, m: IndexedMeta) =>
      excluded.has(id) || (m.sameAs ?? []).some((x) => excluded.has(x)) || (m.previewUrl !== undefined && urls.has(normUrl(m.previewUrl)));
    const out: { sample: Sample; score: number }[] & { sameSound?: string[] } = [];
    const sameSound: string[] = [];
    const seen = new Set<string>();
    const kept: { id: string; provider: string; durationSec?: number }[] = [];
    for (const n of this.vectors.nearest(vector, opts.limit * 3 + 5, isExcluded)) {
      const keys = [n.id, ...(n.meta.sameAs ?? []), ...(n.meta.previewUrl ? [`url:${normUrl(n.meta.previewUrl)}`] : [])];
      if (keys.some((k) => seen.has(k))) continue;
      if (opts.provider && n.meta.provider !== opts.provider && this.isSameSound(n.score, opts.durationSec, n.meta.durationSec)) {
        sameSound.push(n.id);
        keys.forEach((k) => seen.add(k));
        continue;
      }
      if (kept.some((k) => k.provider !== n.meta.provider && this.isSameSound(this.vectors.cosine(k.id, n.id) ?? 0, k.durationSec, n.meta.durationSec))) continue;
      const sample = this.storedSample(n.id);
      if (!sample) continue;
      keys.forEach((k) => seen.add(k));
      kept.push({ id: n.id, provider: n.meta.provider, durationSec: n.meta.durationSec });
      out.push({ sample: this.refine(sample), score: Math.round(n.score * 1000) / 1000 });
      if (out.length >= opts.limit) break;
    }
    if (sameSound.length) out.sameSound = sameSound;
    return out;
  }

  /** Whether a cosine and two durations say "the same recording". */
  isSameSound(cosine: number, aSec?: number, bSec?: number): boolean {
    if (aSec !== undefined && bSec !== undefined && aSec > 0 && bSec > 0) {
      if (Math.abs(aSec - bSec) > Math.max(0.15, 0.04 * Math.max(aSec, bSec))) return false;
      return cosine >= this.duplicateCosine;
    }
    return cosine >= (this.duplicateCosine + 1) / 2;
  }

  /**
   * Search results that are the same sound on two sources (by stored vector,
   * see isSameSound) collapse into the copy from the earlier source in
   * `order`; the dropped copy's id joins the kept one's sameAs. Results without
   * a stored vector are untouched; nothing is fetched.
   */
  mergeDuplicates<T extends { sample: Sample; provider: { id: string } }>(items: T[], order: string[]): T[] {
    const withVec = items.filter((it) => this.vectors.has(it.sample.id));
    if (withVec.length < 2) return items;
    const byPriority = [...withVec].sort((a, b) => order.indexOf(a.provider.id) - order.indexOf(b.provider.id));
    const keepers: T[] = [];
    const dropped = new Set<T>();
    const extra = new Map<T, string[]>();
    for (const it of byPriority) {
      const twin = keepers.find(
        (k) =>
          k.provider.id !== it.provider.id &&
          this.isSameSound(this.vectors.cosine(k.sample.id, it.sample.id) ?? 0, k.sample.durationSec, it.sample.durationSec),
      );
      if (!twin) {
        keepers.push(it);
        continue;
      }
      dropped.add(it);
      extra.set(twin, [...(extra.get(twin) ?? []), it.sample.id, ...(it.sample.sameAs ?? [])]);
    }
    if (!dropped.size) return items;
    return items
      .filter((it) => !dropped.has(it))
      .map((it) => {
        const ids = extra.get(it);
        if (!ids) return it;
        const sameAs = [...new Set([...(it.sample.sameAs ?? []), ...ids])].filter((x) => x !== it.sample.id);
        return { ...it, sample: { ...it.sample, sameAs } };
      });
  }

  // -------------------------------------------------------------------------
  // Sound map

  private readonly mapCache = new LRUCache<string, Promise<SoundMap>>({ max: 20 });

  /**
   * Stored samples laid out in 2-D so that sounds that sound alike sit close
   * together (see soundmap.ts). Filtered by category (and its children) and
   * provider; one point per sound; at most `limit` points, spread evenly over
   * the index when there are more. Cached (and shared between concurrent
   * callers) until the index changes; the layout yields to the event loop.
   */
  map(opts: { category?: string; provider?: string; limit?: number } = {}): Promise<SoundMap> {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? 1500), 1), MAP_MAX_POINTS);
    const key = `${this.vectors.version}|${opts.category ?? ""}|${opts.provider ?? ""}|${limit}`;
    const hit = this.mapCache.get(key);
    if (hit) return hit;
    const pending = this.buildMap(opts, limit);
    this.mapCache.set(key, pending);
    pending.catch(() => this.mapCache.delete(key));
    return pending;
  }

  private async buildMap(opts: { category?: string; provider?: string }, limit: number): Promise<SoundMap> {
    const seen = new Set<string>();
    const matching: [string, IndexedMeta][] = [];
    for (const [id, meta] of this.vectors.entries()) {
      if (opts.provider && meta.provider !== opts.provider) continue;
      if (opts.category && !categoryMatches(meta.category, [opts.category])) continue;
      const keys = [id, ...(meta.sameAs ?? []), ...(meta.previewUrl ? [`url:${normUrl(meta.previewUrl)}`] : [])];
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      matching.push([id, meta]);
    }
    const picked = matching.length <= limit ? matching : Array.from({ length: limit }, (_, i) => matching[Math.floor((i * matching.length) / limit)]!);
    const coords = await layoutMapAsync(picked.map(([id]) => this.vectors.get(id)!));
    const points: SoundMapPoint[] = picked.map(([id, m], i) => ({
      id,
      x: Math.round(coords[i * 2]! * 10000) / 10000,
      y: Math.round(coords[i * 2 + 1]! * 10000) / 10000,
      provider: m.provider,
      ...(m.title ? { title: m.title } : {}),
      ...(m.category ? { category: m.category } : {}),
      ...(m.durationSec !== undefined ? { durationSec: Math.round(m.durationSec * 100) / 100 } : {}),
      ...(m.verdict ? { verdict: m.verdict } : {}),
    }));
    return { enabled: true, model: this.embedder.model, indexed: this.vectors.size, matching: matching.length, points, generatedAt: new Date(this.now()).toISOString() };
  }

  // -------------------------------------------------------------------------
  // Text → audio re-ranking

  /**
   * Cosine between the query's text embedding and each stored vector among
   * `ids`. Undefined (and the search ranks as before) when fewer than two of
   * them have vectors, the text model is not loaded yet (it starts loading),
   * or the query embedding takes longer than `budgetMs`.
   */
  async semanticScores(query: string, ids: string[], budgetMs = 250): Promise<Map<string, number> | undefined> {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const have = ids.filter((id) => this.vectors.has(id));
    if (have.length < 2) return undefined;
    if (!this.embedder.textReady()) {
      this.embedder.warm("text");
      return undefined;
    }
    let qv = this.queryCache.get(q);
    if (!qv) {
      // Cache the embedding even when it arrives after the budget, so the next page/retry gets it.
      const p = this.embedder.embedText([`This is a sound of ${q}.`]).then((vs) => {
        if (vs[0]) this.queryCache.set(q, vs[0]);
        return vs[0];
      });
      p.catch(() => undefined);
      try {
        qv = await withTimeout(p, budgetMs, "query embedding");
      } catch {
        return undefined;
      }
      if (!qv) return undefined;
    }
    const out = new Map<string, number>();
    for (const id of have) out.set(id, dot(qv, this.vectors.get(id)!));
    return out;
  }

  // -------------------------------------------------------------------------
  // Zero-shot category fallback

  private ensurePrompts(): void {
    if (this.prompts || this.promptsLoading) return;
    if (!this.embedder.textReady()) {
      this.embedder.warm("text");
      return;
    }
    this.promptsLoading = true;
    const list = categoryPrompts();
    this.embedder
      .embedText(list.map((p) => p.prompt))
      .then((vs) => (this.prompts = list.map((p, i) => ({ category: p.category, vector: vs[i]! }))))
      .catch(() => undefined)
      .finally(() => (this.promptsLoading = false));
  }

  /** Prompt vectors are ready (tests: await this before calling refine). */
  async promptsReady(): Promise<boolean> {
    if (this.prompts) return true;
    const list = categoryPrompts();
    const vs = await this.embedder.embedText(list.map((p) => p.prompt));
    this.prompts = list.map((p, i) => ({ category: p.category, vector: vs[i]! }));
    return true;
  }

  /** Zero-shot category for a stored vector (sync; undefined when prompts aren't ready yet). */
  zeroShot(id: string): ZeroShot | undefined {
    const v = this.vectors.get(id);
    if (!v) return undefined;
    if (!this.prompts) {
      this.ensurePrompts();
      return undefined;
    }
    return zeroShotRank(v, this.prompts);
  }

  /**
   * When the rule classifier was unsure (< 0.4) and the sample has a vector,
   * let CLAP pick the category if it is clearly sure. Cheap and synchronous:
   * only stored vectors and cached prompt vectors are used.
   */
  refine<T extends Sample>(s: T): T {
    const ev = s.categoryEvidence;
    if (ev && (ev.by === "source" || ev.by === "file" || ev.by === "model" || ev.confidence >= this.zeroShotBelow)) return s;
    if (!this.vectors.has(s.id)) return s;
    const z = this.zeroShot(s.id);
    if (!z || z.confidence < this.zeroShotMinConfidence || z.margin < this.zeroShotMinMargin) return s;
    const confidence = Math.round(Math.min(0.85, z.confidence) * 100) / 100;
    return { ...s, category: z.category, categoryEvidence: { by: "model", confidence } };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
}

function normUrl(u: string): string {
  return u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Sound map

/** Most points one map holds (layout time grows with the square of this). */
export const MAP_MAX_POINTS = 2500;

export interface SoundMapPoint {
  id: string;
  /** 0..1, left to right. */
  x: number;
  /** 0..1, top to bottom. */
  y: number;
  provider: string;
  title?: string;
  category?: string;
  durationSec?: number;
  verdict?: CommercialVerdict;
}

export interface SoundMap {
  enabled: true;
  model: string;
  /** Samples in the index. */
  indexed: number;
  /** Samples that matched the filters (before thinning to the limit). */
  matching: number;
  points: SoundMapPoint[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// find_similar

export interface SimilarResult {
  id: string;
  /** clap: nearest stored samples by CLAP audio embedding; freesound: Freesound's own similarity. */
  method: "clap" | "freesound";
  results: Sample[];
  /** How many samples the CLAP index holds (when embeddings are on). */
  indexed?: number;
  /** Ids of this same recording on other sources (near-identical audio and duration), left out of results. */
  sameSound?: string[];
  note?: string;
}

export class SimilarUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimilarUnavailableError";
  }
}

export class SampleNotFoundError extends Error {
  constructor(id: string) {
    super(`Sample not found: ${id}`);
    this.name = "SampleNotFoundError";
  }
}

/**
 * Sounds like `id`: with embeddings on, its vector (stored, or embedded from
 * its preview now) against every stored sample; for freesound ids, Freesound's
 * similarity when the index has nothing to offer.
 */
export async function findSimilar(
  service: SampleService,
  id: string,
  opts: { limit?: number; credentials?: Record<string, string>; timeoutMs?: number } = {},
): Promise<SimilarResult> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const index = service.embeddings;
  const provider = id.includes(":") ? id.slice(0, id.indexOf(":")) : "";
  const notes: string[] = [];

  if (index) {
    let vector = index.vectorFor(id);
    let self: Sample | SampleDetails | undefined = index.storedSample(id);
    if (!vector) {
      const details = await service.getSample(id, opts.credentials);
      if (!details) throw new SampleNotFoundError(id);
      self = details;
      const skip = index.skipReason(details);
      if (skip) notes.push(`Not embedded: ${skip}.`);
      else if (!index.size) index.observeDetails(details);
      else {
        try {
          vector = await index.index(details, { signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000) });
        } catch (e) {
          notes.push(`Could not embed its preview: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    if (vector && index.size > 1) {
      const results = index.similar(vector, {
        limit,
        excludeIds: [id, ...(self?.sameAs ?? [])],
        excludeUrls: self?.previewUrl ? [self.previewUrl] : [],
        durationSec: self?.durationSec,
        provider,
      });
      const sameSound = results.sameSound ? { sameSound: results.sameSound } : {};
      if (results.length) return { id, method: "clap", results: results.map((r) => ({ ...r.sample, score: r.score })), indexed: index.size, ...sameSound };
    }
    if (!index.size) notes.push("The sound index is empty so far.");
    const down = index.embedder.unavailable?.("audio");
    if (down) notes.push(down);
  }

  if (provider === "freesound") {
    const p = service.getProvider("freesound");
    if (p && (!p.isEnabled || p.isEnabled())) {
      const { freesoundSimilar } = await import("../providers/freesound.js");
      const similar = await freesoundSimilar(id.slice(id.indexOf(":") + 1), { fetch: service.http, signal: AbortSignal.timeout(20_000), credentials: opts.credentials }, limit);
      return { id, method: "freesound", results: similar, ...(index ? { indexed: index.size } : {}) };
    }
    notes.push("Freesound is not configured on this server (FREESOUND_API_KEY).");
  }

  if (!index) {
    throw new SimilarUnavailableError(
      provider === "freesound"
        ? notes.join(" ")
        : "find_similar needs audio embeddings for non-Freesound samples, and they are off on this server (SOUND_SERVER_EMBEDDINGS=1). Freesound ids work through Freesound's own similarity.",
    );
  }
  return { id, method: "clap", results: [], indexed: index.size, note: notes.join(" ") || "No similar sounds in the index yet." };
}

// ---------------------------------------------------------------------------
// Pre-indexing static catalogues (the `index` CLI command)

export interface CatalogueIndexReport {
  provider: string;
  seen: number;
  indexed: number;
  already: number;
  skipped: Record<string, number>;
  failed: number;
  errors: string[];
}

/**
 * Page through providers' catalogues (an empty query browses static ones) and
 * embed up to `limit` samples per provider. Fetches stay one per host; the
 * embedder runs one job at a time, so `concurrency` only overlaps a download
 * with an inference.
 */
export async function indexCatalogue(
  service: SampleService,
  index: EmbeddingIndex,
  opts: { providers: string[]; limit: number; query?: string; concurrency?: number; onProgress?: (r: CatalogueIndexReport, s: Sample) => void },
): Promise<CatalogueIndexReport[]> {
  const reports: CatalogueIndexReport[] = [];
  for (const id of opts.providers) {
    const p = service.getProvider(id);
    const r: CatalogueIndexReport = { provider: id, seen: 0, indexed: 0, already: 0, skipped: {}, failed: 0, errors: [] };
    reports.push(r);
    if (!p) {
      r.errors.push("unknown provider");
      continue;
    }
    const samples: Sample[] = [];
    const ids = new Set<string>();
    for (let offset = 0; samples.length < opts.limit; ) {
      let page: Sample[];
      try {
        page = (await p.search({ query: opts.query ?? "", limit: 50, offset }, { fetch: service.http, signal: AbortSignal.timeout(60_000) })).samples;
      } catch (e) {
        r.errors.push(`search failed at offset ${offset}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      const fresh = page.filter((s) => !ids.has(s.id));
      if (!fresh.length) break;
      for (const s of fresh) {
        ids.add(s.id);
        if (samples.length < opts.limit) samples.push(s);
      }
      offset += page.length;
    }
    r.seen = samples.length;
    let next = 0;
    const worker = async () => {
      while (next < samples.length) {
        const s = samples[next++]!;
        if (index.vectorFor(s.id)) r.already++;
        else {
          const why = index.skipReason(s);
          if (why) r.skipped[why] = (r.skipped[why] ?? 0) + 1;
          else {
            try {
              await index.index(s, { signal: AbortSignal.timeout(120_000) });
              r.indexed++;
            } catch (e) {
              r.failed++;
              if (r.errors.length < 10) r.errors.push(`${s.id}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        opts.onProgress?.(r, s);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, worker));
  }
  return reports;
}

// ---------------------------------------------------------------------------
// From the environment

/**
 * Embedding features from the environment: undefined unless
 * SOUND_SERVER_EMBEDDINGS=1. The model loads lazily on first use.
 */
export async function embeddingIndexFromEnv(opts: { http?: HttpClient; store?: SampleStore; env?: NodeJS.ProcessEnv; perMinute?: number } = {}): Promise<EmbeddingIndex | undefined> {
  const env = opts.env ?? process.env;
  const { ClapEmbedder, embeddingsEnabled } = await import("./embeddings.js");
  if (!embeddingsEnabled(env)) return undefined;
  const { modelDirFromEnv } = await import("./store.js");
  const embedder = ClapEmbedder.fromEnv(env, modelDirFromEnv(env));
  const perMinute = opts.perMinute ?? Number(env.SOUND_SERVER_INDEX_PER_MINUTE ?? 20);
  const dup = Number(env.SOUND_SERVER_DUPLICATE_COSINE ?? "");
  const index = new EmbeddingIndex({
    embedder,
    store: opts.store,
    http: opts.http,
    perMinute: Number.isFinite(perMinute) ? perMinute : 20,
    ...(dup > 0.5 && dup <= 1 ? { duplicateCosine: dup } : {}),
  });
  if (!opts.store) console.error("sound-server: embeddings are on without SOUND_SERVER_DATA_DIR; vectors are kept in memory only");
  return index;
}
