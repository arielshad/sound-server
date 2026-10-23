/**
 * Optional persistent store (SQLite) for what is expensive to recompute:
 * audio analyses, CLAP embeddings, and the samples those embeddings belong to
 * (so "find similar" can return them without asking the source again).
 *
 * Off unless SOUND_SERVER_DATA_DIR is set; without it everything stays
 * in-memory, as before. Uses Node's built-in `node:sqlite` (Node ≥ 22.13, no
 * flag, no native dependency to build); on older Node the store reports itself
 * unavailable and the server carries on without it.
 *
 * One file, `<dataDir>/sound-server.db`, in WAL mode. Single writer (one pod):
 * the Deployment uses `strategy: Recreate` so two pods never share it.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { AudioAnalysis } from "./analyze.js";
import type { CommercialVerdict, Sample } from "./types.js";

/** One stored embedding. Vectors are L2-normalised Float32 (cosine = dot product). */
export interface StoredEmbedding {
  sampleId: string;
  provider: string;
  /** Embedding model id, e.g. Xenova/clap-htsat-unfused. Vectors from different models never mix. */
  model: string;
  vector: Float32Array;
  previewUrl?: string;
  title?: string;
  category?: string;
  verdict?: CommercialVerdict;
  durationSec?: number;
  /** Other ids of the same sound (Sample.sameAs), for de-duplicating similar results. */
  sameAs?: string[];
  updatedAt: number;
}

export interface StoreStats {
  path: string;
  analyses: number;
  samples: number;
  embeddings: Record<string, number>;
}

/** Minimal sync SQLite surface we use (node:sqlite DatabaseSync). */
interface Db {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  close(): void;
}
interface Stmt {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
  iterate?(...params: unknown[]): IterableIterator<Record<string, unknown>>;
}

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS analysis_expires ON analysis (expires_at);
CREATE TABLE IF NOT EXISTS samples (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS samples_updated ON samples (updated_at);
CREATE TABLE IF NOT EXISTS embeddings (
  sample_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  preview_url TEXT,
  title TEXT,
  category TEXT,
  verdict TEXT,
  duration_sec REAL,
  same_as TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sample_id, model)
);
CREATE TABLE IF NOT EXISTS embed_failures (
  sample_id TEXT NOT NULL,
  model TEXT NOT NULL,
  reason TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sample_id, model)
);
`;

let sqliteModule: { DatabaseSync: new (path: string) => Db } | null | undefined;

/** Load node:sqlite without its one-time ExperimentalWarning on stderr. Null when this Node has none. */
function loadSqlite(): { DatabaseSync: new (path: string) => Db } | null {
  if (sqliteModule !== undefined) return sqliteModule;
  const require = createRequire(import.meta.url);
  const orig = process.emitWarning;
  process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
    const text = typeof warning === "string" ? warning : warning?.message;
    if (/SQLite/i.test(String(text))) return;
    return (orig as (...a: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    sqliteModule = require("node:sqlite") as { DatabaseSync: new (path: string) => Db };
  } catch {
    sqliteModule = null;
  } finally {
    process.emitWarning = orig;
  }
  return sqliteModule;
}

export class StoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreUnavailableError";
  }
}

export interface StoreOptions {
  /** Default TTL for analysis rows (ms). */
  analysisTtlMs?: number;
  /** Keep at most this many seen samples (oldest pruned). */
  maxSamples?: number;
}

export class SampleStore {
  private readonly db: Db;
  private readonly analysisTtlMs: number;
  private readonly maxSamples: number;
  private writesSincePrune = 0;
  private readonly stmts: Record<string, Stmt> = {};

  /** `path` is a database file, or ":memory:" (tests). */
  constructor(
    readonly path: string,
    opts: StoreOptions = {},
  ) {
    const sqlite = loadSqlite();
    if (!sqlite) throw new StoreUnavailableError("node:sqlite is not available in this Node version (needs Node 22.13 or newer)");
    this.db = new sqlite.DatabaseSync(path);
    this.analysisTtlMs = opts.analysisTtlMs ?? 30 * 24 * 3600_000;
    this.maxSamples = opts.maxSamples ?? 200_000;
    if (path !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
    }
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(SCHEMA);
    this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));
    this.prune();
  }

  private stmt(sql: string): Stmt {
    return (this.stmts[sql] ??= this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }

  // -------------------------------------------------------------------------
  // Analysis cache

  getAnalysis(key: string, now = Date.now()): AudioAnalysis | undefined {
    const row = this.stmt("SELECT json, expires_at FROM analysis WHERE key = ?").get(key);
    if (!row || Number(row.expires_at) <= now) return undefined;
    try {
      return JSON.parse(String(row.json)) as AudioAnalysis;
    } catch {
      return undefined;
    }
  }

  setAnalysis(key: string, analysis: AudioAnalysis, ttlMs = this.analysisTtlMs, now = Date.now()): void {
    const { cached: _c, ...rest } = analysis;
    this.stmt("INSERT OR REPLACE INTO analysis (key, json, expires_at, updated_at) VALUES (?, ?, ?, ?)").run(key, JSON.stringify(rest), now + ttlMs, now);
    this.wrote();
  }

  // -------------------------------------------------------------------------
  // Seen samples

  putSample(sample: Sample, now = Date.now()): void {
    this.stmt("INSERT OR REPLACE INTO samples (id, provider, json, updated_at) VALUES (?, ?, ?, ?)").run(sample.id, sample.provider, JSON.stringify(minimalSample(sample)), now);
    this.wrote();
  }

  getSample(id: string): Sample | undefined {
    const row = this.stmt("SELECT json FROM samples WHERE id = ?").get(id);
    if (!row) return undefined;
    try {
      return JSON.parse(String(row.json)) as Sample;
    } catch {
      return undefined;
    }
  }

  getSamples(ids: string[]): Map<string, Sample> {
    const out = new Map<string, Sample>();
    for (const id of ids) {
      const s = this.getSample(id);
      if (s) out.set(id, s);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Embeddings

  putEmbedding(e: StoredEmbedding): void {
    const v = e.vector;
    this.stmt(
      `INSERT OR REPLACE INTO embeddings (sample_id, model, provider, dim, vector, preview_url, title, category, verdict, duration_sec, same_as, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      e.sampleId,
      e.model,
      e.provider,
      v.length,
      new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
      e.previewUrl ?? null,
      e.title ?? null,
      e.category ?? null,
      e.verdict ?? null,
      e.durationSec ?? null,
      e.sameAs?.length ? JSON.stringify(e.sameAs) : null,
      e.updatedAt,
    );
    this.stmt("DELETE FROM embed_failures WHERE sample_id = ? AND model = ?").run(e.sampleId, e.model);
  }

  getEmbedding(sampleId: string, model: string): StoredEmbedding | undefined {
    const row = this.stmt("SELECT * FROM embeddings WHERE sample_id = ? AND model = ?").get(sampleId, model);
    return row ? rowToEmbedding(row) : undefined;
  }

  /** Every embedding of one model (for loading the in-memory index). */
  *embeddings(model: string): IterableIterator<StoredEmbedding> {
    const st = this.stmt("SELECT * FROM embeddings WHERE model = ?");
    const rows = st.iterate ? st.iterate(model) : st.all(model)[Symbol.iterator]();
    for (const row of rows) yield rowToEmbedding(row);
  }

  countEmbeddings(model?: string): number {
    const row = model
      ? this.stmt("SELECT COUNT(*) AS n FROM embeddings WHERE model = ?").get(model)
      : this.stmt("SELECT COUNT(*) AS n FROM embeddings").get();
    return Number(row?.n ?? 0);
  }

  /** Remember that a sample could not be embedded, so the indexer doesn't retry it for a while. */
  markFailed(sampleId: string, model: string, reason: string, now = Date.now()): void {
    this.stmt("INSERT OR REPLACE INTO embed_failures (sample_id, model, reason, updated_at) VALUES (?, ?, ?, ?)").run(sampleId, model, reason.slice(0, 300), now);
  }

  /** When the sample last failed to embed (ms since epoch), if it did. */
  failedAt(sampleId: string, model: string): number | undefined {
    const row = this.stmt("SELECT updated_at FROM embed_failures WHERE sample_id = ? AND model = ?").get(sampleId, model);
    return row ? Number(row.updated_at) : undefined;
  }

  stats(): StoreStats {
    const n = (sql: string) => Number(this.stmt(sql).get()?.n ?? 0);
    const embeddings: Record<string, number> = {};
    for (const row of this.stmt("SELECT model, COUNT(*) AS n FROM embeddings GROUP BY model").all()) embeddings[String(row.model)] = Number(row.n);
    return { path: this.path, analyses: n("SELECT COUNT(*) AS n FROM analysis"), samples: n("SELECT COUNT(*) AS n FROM samples"), embeddings };
  }

  /** Drop expired analyses and the oldest seen samples beyond the cap (samples with embeddings are kept). */
  prune(now = Date.now()): void {
    this.stmt("DELETE FROM analysis WHERE expires_at <= ?").run(now);
    const total = Number(this.stmt("SELECT COUNT(*) AS n FROM samples").get()?.n ?? 0);
    const extra = total - this.maxSamples;
    if (extra > 0) {
      this.stmt(
        `DELETE FROM samples WHERE id IN (
           SELECT id FROM samples WHERE id NOT IN (SELECT sample_id FROM embeddings) ORDER BY updated_at ASC LIMIT ?
         )`,
      ).run(extra);
    }
    this.stmt("DELETE FROM embed_failures WHERE updated_at <= ?").run(now - 7 * 24 * 3600_000);
  }

  private wrote(): void {
    if (++this.writesSincePrune >= 1000) {
      this.writesSincePrune = 0;
      this.prune();
    }
  }
}

function rowToEmbedding(row: Record<string, unknown>): StoredEmbedding {
  const blob = row.vector as Uint8Array;
  // Copy into an aligned buffer: SQLite blobs carry no alignment guarantee.
  const vector = new Float32Array(Number(row.dim));
  new Uint8Array(vector.buffer).set(blob.subarray(0, vector.byteLength));
  return {
    sampleId: String(row.sample_id),
    model: String(row.model),
    provider: String(row.provider),
    vector,
    previewUrl: (row.preview_url as string | null) ?? undefined,
    title: (row.title as string | null) ?? undefined,
    category: (row.category as string | null) ?? undefined,
    verdict: ((row.verdict as string | null) ?? undefined) as CommercialVerdict | undefined,
    durationSec: row.duration_sec === null || row.duration_sec === undefined ? undefined : Number(row.duration_sec),
    sameAs: row.same_as ? (JSON.parse(String(row.same_as)) as string[]) : undefined,
    updatedAt: Number(row.updated_at),
  };
}

/** What a search result needs, without the per-search score or long text. */
export function minimalSample(s: Sample): Sample {
  const { score: _score, description, ...rest } = s;
  return { ...rest, ...(description ? { description: description.slice(0, 500) } : {}) };
}

// ---------------------------------------------------------------------------
// From the environment

let shared: SampleStore | null | undefined;

/**
 * The process-wide store from SOUND_SERVER_DATA_DIR, or undefined when that is
 * unset or the store can't be opened (logged once; the server runs without it).
 */
export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): SampleStore | undefined {
  if (shared !== undefined) return shared ?? undefined;
  const dir = env.SOUND_SERVER_DATA_DIR?.trim();
  if (!dir) {
    shared = null;
    return undefined;
  }
  try {
    mkdirSync(dir, { recursive: true });
    const ttlDays = Number(env.SOUND_SERVER_ANALYSIS_TTL_DAYS ?? 30);
    shared = new SampleStore(join(dir, "sound-server.db"), {
      analysisTtlMs: (Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 30) * 24 * 3600_000,
      maxSamples: Number(env.SOUND_SERVER_STORE_MAX_SAMPLES ?? 200_000) || 200_000,
    });
  } catch (e) {
    console.error(`sound-server: persistent store disabled (${e instanceof Error ? e.message : String(e)})`);
    shared = null;
  }
  return shared ?? undefined;
}

/** The directory for downloaded models: SOUND_SERVER_MODEL_DIR, else <data dir>/models. */
export function modelDirFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.SOUND_SERVER_MODEL_DIR?.trim()) return env.SOUND_SERVER_MODEL_DIR.trim();
  const dir = env.SOUND_SERVER_DATA_DIR?.trim();
  return dir ? join(dir, "models") : undefined;
}

/** Tests only: forget the shared store. */
export function resetStoreFromEnv(): void {
  shared = undefined;
}
