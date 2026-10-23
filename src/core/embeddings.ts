/**
 * CLAP audio/text embeddings (LAION CLAP via transformers.js, Apache-2.0).
 *
 * Off unless SOUND_SERVER_EMBEDDINGS=1. The model (SOUND_SERVER_CLAP_MODEL,
 * default Xenova/clap-htsat-unfused, q8) is downloaded on first use into
 * <SOUND_SERVER_DATA_DIR>/models (or SOUND_SERVER_MODEL_DIR), never baked into
 * the image. The audio and text halves load separately and only when needed:
 * about 130 MB RSS for the audio model and 180 MB for the text model.
 *
 * `@huggingface/transformers` is an optional peer dependency: when it is not
 * installed (or onnxruntime-node can't load, e.g. on Alpine/musl) the embedder
 * reports status "failed" and every feature that uses it is skipped.
 *
 * Inference runs one job at a time by default (SOUND_SERVER_EMBEDDINGS_CONCURRENCY)
 * with few ONNX threads (SOUND_SERVER_EMBEDDINGS_THREADS) so it never starves
 * request handling, and every call has a timeout.
 */
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { decodeAudio, type AudioInput } from "./analyze.js";
import type { HttpClient } from "./types.js";

export const CLAP_SAMPLE_RATE = 48_000;
export const DEFAULT_CLAP_MODEL = "Xenova/clap-htsat-unfused";

export type EmbedderState = "idle" | "loading" | "ready" | "failed";

export interface EmbedderStatus {
  model: string;
  audio: EmbedderState;
  text: EmbedderState;
  error?: string;
  /** Embeddings computed by this process. */
  audioEmbeds: number;
  textEmbeds: number;
  loadMs?: { audio?: number; text?: number };
}

/** Anything that turns audio and text into vectors in one shared space. */
export interface Embedder {
  readonly model: string;
  /** Mono PCM at 48 kHz → an L2-normalised vector. Loads the audio model on first use. */
  embedAudio(pcm: Float32Array): Promise<Float32Array>;
  /** Texts → L2-normalised vectors. Loads the text model on first use. */
  embedText(texts: string[]): Promise<Float32Array[]>;
  /** True when embedText would answer without loading a model first (search-time use). */
  textReady(): boolean;
  audioReady(): boolean;
  /** Start loading a half in the background (no-op when loaded, loading or recently failed). */
  warm(kind: "audio" | "text"): void;
  status(): EmbedderStatus;
}

export function embeddingsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "yes", "on"].includes((env.SOUND_SERVER_EMBEDDINGS ?? "").trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Vector maths

export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s);
  if (!n) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

/** Cosine similarity (any vectors; for normalised vectors this is the dot product). */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

// ---------------------------------------------------------------------------
// Small helpers

/** At most `n` jobs at once; the rest wait in order. */
export class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly n: number) {}
  get pending(): number {
    return this.queue.length + this.active;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.n) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export class EmbeddingTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms}ms`);
    this.name = "EmbeddingTimeoutError";
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new EmbeddingTimeoutError(what, ms)), ms);
    t.unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// CLAP via transformers.js

/** The slice of the transformers.js API we use (kept local so the package stays optional). */
interface TensorLike {
  dims: number[];
  data: Float32Array;
}
interface Transformers {
  env: { cacheDir: string | null; allowLocalModels: boolean; allowRemoteModels: boolean };
  AutoProcessor: { from_pretrained(model: string, opts?: object): Promise<(audio: Float32Array) => Promise<object>> };
  AutoTokenizer: { from_pretrained(model: string, opts?: object): Promise<(texts: string[], opts: object) => object> };
  ClapAudioModelWithProjection: { from_pretrained(model: string, opts?: object): Promise<(inputs: object) => Promise<{ audio_embeds: TensorLike }>> };
  ClapTextModelWithProjection: { from_pretrained(model: string, opts?: object): Promise<(inputs: object) => Promise<{ text_embeds: TensorLike }>> };
}

export interface ClapOptions {
  model?: string;
  /** Where downloaded model files are cached. */
  cacheDir?: string;
  /** ONNX intra-op threads per inference (default min(2, CPUs)). */
  threads?: number;
  /** Inference jobs at once (default 1). */
  concurrency?: number;
  /** Per-inference timeout (default 20 s). */
  timeoutMs?: number;
  /** Model load timeout, including the first download (default 10 min). */
  loadTimeoutMs?: number;
  /** Override how transformers.js is imported (tests). */
  importer?: () => Promise<unknown>;
}

const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

function rows(t: TensorLike): Float32Array[] {
  const [n, d] = t.dims.length === 2 ? (t.dims as [number, number]) : [1, t.dims[t.dims.length - 1]!];
  const out: Float32Array[] = [];
  for (let i = 0; i < n; i++) out.push(l2normalize(Float32Array.from(t.data.subarray(i * d, (i + 1) * d))));
  return out;
}

export class ClapEmbedder implements Embedder {
  readonly model: string;
  private readonly cacheDir: string;
  private readonly threads: number;
  private readonly timeoutMs: number;
  private readonly loadTimeoutMs: number;
  private readonly limiter: Limiter;
  private readonly importer: () => Promise<unknown>;
  private lib?: Promise<Transformers>;
  private audio?: Promise<{ processor: (a: Float32Array) => Promise<object>; model: (i: object) => Promise<{ audio_embeds: TensorLike }> }>;
  private text?: Promise<{ tokenizer: (t: string[], o: object) => object; model: (i: object) => Promise<{ text_embeds: TensorLike }> }>;
  private readonly state = { audio: "idle" as EmbedderState, text: "idle" as EmbedderState };
  private failedAt: { audio?: number; text?: number } = {};
  private error?: string;
  private counts = { audio: 0, text: 0 };
  private loadMs: { audio?: number; text?: number } = {};

  constructor(opts: ClapOptions = {}) {
    this.model = opts.model ?? DEFAULT_CLAP_MODEL;
    this.cacheDir = opts.cacheDir ?? join(tmpdir(), "sound-server-models");
    this.threads = Math.max(1, opts.threads ?? Math.min(2, availableParallelism()));
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 10 * 60_000;
    this.limiter = new Limiter(Math.max(1, opts.concurrency ?? 1));
    // A variable specifier keeps the optional package out of the type check and the bundle graph.
    const spec = "@huggingface/transformers";
    this.importer = opts.importer ?? (() => import(spec));
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, cacheDir?: string): ClapEmbedder {
    const n = (v: string | undefined) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
    return new ClapEmbedder({
      model: env.SOUND_SERVER_CLAP_MODEL?.trim() || DEFAULT_CLAP_MODEL,
      cacheDir,
      threads: n(env.SOUND_SERVER_EMBEDDINGS_THREADS),
      concurrency: n(env.SOUND_SERVER_EMBEDDINGS_CONCURRENCY),
      timeoutMs: n(env.SOUND_SERVER_EMBEDDINGS_TIMEOUT_MS),
    });
  }

  status(): EmbedderStatus {
    return {
      model: this.model,
      audio: this.state.audio,
      text: this.state.text,
      ...(this.error ? { error: this.error } : {}),
      audioEmbeds: this.counts.audio,
      textEmbeds: this.counts.text,
      ...(this.loadMs.audio || this.loadMs.text ? { loadMs: { ...this.loadMs } } : {}),
    };
  }

  audioReady(): boolean {
    return this.state.audio === "ready";
  }

  textReady(): boolean {
    return this.state.text === "ready";
  }

  warm(kind: "audio" | "text"): void {
    if (this.state[kind] === "ready" || this.state[kind] === "loading") return;
    const failed = this.failedAt[kind];
    if (failed && Date.now() - failed < RETRY_AFTER_FAILURE_MS) return;
    (kind === "audio" ? this.loadAudio() : this.loadText()).catch(() => undefined);
  }

  private transformers(): Promise<Transformers> {
    this.lib ??= this.importer().then((m) => {
      const t = ((m as { default?: unknown }).default && !(m as { env?: unknown }).env ? (m as { default: unknown }).default : m) as Transformers;
      t.env.cacheDir = this.cacheDir;
      t.env.allowLocalModels = false;
      t.env.allowRemoteModels = true;
      return t;
    });
    this.lib.catch(() => (this.lib = undefined));
    return this.lib;
  }

  private modelOpts() {
    return { dtype: "q8", session_options: { intraOpNumThreads: this.threads, interOpNumThreads: 1 } };
  }

  private track<T>(kind: "audio" | "text", p: Promise<T>, reset: () => void): Promise<T> {
    const started = Date.now();
    this.state[kind] = "loading";
    p.then(
      () => {
        this.state[kind] = "ready";
        this.loadMs[kind] = Date.now() - started;
        this.failedAt[kind] = undefined;
      },
      (e: unknown) => {
        this.state[kind] = "failed";
        this.failedAt[kind] = Date.now();
        this.error = describeLoadError(e);
        console.error(`sound-server: CLAP ${kind} model unavailable: ${this.error}`);
        reset();
      },
    );
    return p;
  }

  private loadAudio() {
    if (this.audio) return this.audio;
    const p = withTimeout(
      (async () => {
        const t = await this.transformers();
        const [processor, model] = await Promise.all([t.AutoProcessor.from_pretrained(this.model), t.ClapAudioModelWithProjection.from_pretrained(this.model, this.modelOpts())]);
        return { processor, model };
      })(),
      this.loadTimeoutMs,
      "loading the CLAP audio model",
    );
    this.audio = p;
    return this.track("audio", p, () => (this.audio = undefined));
  }

  private loadText() {
    if (this.text) return this.text;
    const p = withTimeout(
      (async () => {
        const t = await this.transformers();
        const [tokenizer, model] = await Promise.all([t.AutoTokenizer.from_pretrained(this.model), t.ClapTextModelWithProjection.from_pretrained(this.model, this.modelOpts())]);
        return { tokenizer, model };
      })(),
      this.loadTimeoutMs,
      "loading the CLAP text model",
    );
    this.text = p;
    return this.track("text", p, () => (this.text = undefined));
  }

  async embedAudio(pcm: Float32Array): Promise<Float32Array> {
    const failed = this.failedAt.audio;
    if (failed && Date.now() - failed < RETRY_AFTER_FAILURE_MS) throw new Error(`CLAP audio model unavailable: ${this.error ?? "load failed"}`);
    const m = await this.loadAudio();
    return this.limiter.run(() =>
      withTimeout(
        (async () => {
          const inputs = await m.processor(pcm);
          const { audio_embeds } = await m.model(inputs);
          this.counts.audio++;
          return rows(audio_embeds)[0]!;
        })(),
        this.timeoutMs,
        "audio embedding",
      ),
    );
  }

  async embedText(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const failed = this.failedAt.text;
    if (failed && Date.now() - failed < RETRY_AFTER_FAILURE_MS) throw new Error(`CLAP text model unavailable: ${this.error ?? "load failed"}`);
    const m = await this.loadText();
    return this.limiter.run(() =>
      withTimeout(
        (async () => {
          const inputs = m.tokenizer(texts, { padding: true, truncation: true });
          const { text_embeds } = await m.model(inputs);
          this.counts.text += texts.length;
          return rows(text_embeds);
        })(),
        this.timeoutMs,
        "text embedding",
      ),
    );
  }
}

function describeLoadError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Cannot find (package|module) '@huggingface\/transformers'|ERR_MODULE_NOT_FOUND/.test(m) && m.includes("transformers")) {
    return "@huggingface/transformers is not installed (npm i @huggingface/transformers@4.3.1)";
  }
  if (/ld-linux|fcntl64|GLIBC|Error relocating/.test(m)) return `onnxruntime-node needs glibc (not Alpine/musl): ${m.slice(0, 200)}`;
  return m.slice(0, 300);
}

// ---------------------------------------------------------------------------
// Audio input

export interface EmbedInputOptions {
  http?: HttpClient;
  signal?: AbortSignal;
  /** Seconds from the start to embed (default SOUND_SERVER_EMBED_SECONDS or 10; CLAP sees 10 s windows). */
  maxSeconds?: number;
  /** Cap on bytes fetched for a URL (default 4 MB: plenty for 10 s of MP3/OGG/WAV). */
  maxBytes?: number;
  timeoutMs?: number;
}

/** Decode a file/URL/buffer to 48 kHz mono and embed it. */
export async function embedAudioInput(embedder: Embedder, input: AudioInput, opts: EmbedInputOptions = {}): Promise<Float32Array> {
  const maxSeconds = opts.maxSeconds ?? (Number(process.env.SOUND_SERVER_EMBED_SECONDS) || 10);
  const pcm = await decodeAudio(input, {
    http: opts.http,
    signal: opts.signal,
    maxBytes: opts.maxBytes ?? 4 * 1024 * 1024,
    timeoutMs: opts.timeoutMs ?? 20_000,
    sampleRate: CLAP_SAMPLE_RATE,
    maxSeconds,
  });
  if (pcm.length < CLAP_SAMPLE_RATE * 0.02) throw new Error("decoded audio is empty");
  return embedder.embedAudio(pcm);
}
