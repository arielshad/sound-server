/**
 * Audio analysis for samples: exact facts from the file header first, then
 * ffprobe, then (with `deep`) signal analysis of a decoded mono 22.05 kHz
 * excerpt: EBU R128 loudness, leading/trailing silence, BPM (loops only),
 * key (chroma + Krumhansl-Schmuckler) and root note (pitched one-shots).
 *
 * Every field records where it came from (`source`): "chunk" (WAV/AIFF
 * header, exact), "ffprobe" (container/tags) or "analysis" (estimated, with
 * a confidence). Agents should trust them in that order.
 *
 * ffmpeg/ffprobe are spawned directly (argument arrays, no shell). Paths come
 * from FFMPEG_PATH / FFPROBE_PATH. Without them, analysis returns what the
 * header parser found plus a warning. Licences: music-tempo (MIT), pitchy
 * (MIT), fft.js (MIT); no GPL/AGPL code.
 */
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import FFT from "fft.js";
import { LRUCache } from "lru-cache";
import { PitchDetector } from "pitchy";
import { createHttpClient } from "./http.js";
import { bpmFromText, keyFromText } from "./query.js";
import type { HttpClient, MusicalKey, SampleDetails, SampleFile } from "./types.js";
import { AUDIO_FORMATS, PITCH_CLASSES, type SampleForm } from "./vocab.js";
import { parseWavChunks, type AcidChunk, type InfoTags, type SmplChunk, type WavChunks } from "./wavchunks.js";

export type AnalysisSource = "chunk" | "ffprobe" | "analysis";

export interface AudioInput {
  path?: string;
  buffer?: Uint8Array;
  url?: string;
  /** Request headers for `url` (e.g. Referer). */
  headers?: Record<string, string>;
}

export interface AnalyzeOptions {
  http?: HttpClient;
  /** Cap on bytes downloaded from `url` (default 25 MB). */
  maxBytes?: number;
  /** Decode and analyse the signal (loudness, silence, BPM, key, root note). Default false: headers + ffprobe only. */
  deep?: boolean;
  signal?: AbortSignal;
  /** Seconds of audio decoded for deep analysis (default 30). */
  maxSeconds?: number;
  /** Per-process timeout for ffmpeg/ffprobe (default 30 s). */
  timeoutMs?: number;
  /** Use the in-process cache for url/path inputs (default true). */
  cache?: boolean;
}

export interface LoopPoint {
  startFrame: number;
  endFrame: number;
  startSec?: number;
  endSec?: number;
  type: string;
}

export interface AudioAnalysis {
  durationSec?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  /** Codec as ffprobe names it (pcm_s16le, mp3, vorbis, flac…) or the WAV format (pcm, float). */
  codec?: string;
  /** Container: wav, aiff, mp3, ogg, flac… */
  format?: string;
  bitRate?: number;
  /** EBU R128 integrated loudness of the first `maxSeconds`. Undefined for clips too short to gate (< 0.4 s). */
  loudnessLufs?: number;
  loudnessRangeLu?: number;
  /** True peak (dBTP) from ebur128, else the decoded sample peak. */
  peakDb?: number;
  /** Seconds of silence (< −48 dB below peak, at most −60 dBFS) at the start: the trim-in point. */
  silenceStartSec?: number;
  /** Seconds of silence at the end (only when the whole file was decoded). */
  silenceEndSec?: number;
  bpm?: number;
  bpmConfidence?: number;
  /** Beats/bars in the file, from ACID or from BPM × duration. */
  beats?: number;
  bars?: number;
  key?: MusicalKey;
  keyConfidence?: number;
  /** MIDI note (60 = C4). */
  rootNote?: number;
  rootNoteName?: string;
  rootNoteHz?: number;
  rootNoteConfidence?: number;
  form?: Extract<SampleForm, "one-shot" | "loop">;
  formConfidence?: number;
  /** Onsets detected in the decoded excerpt. */
  onsets?: number;
  loopPoints?: LoopPoint[];
  acid?: AcidChunk;
  smpl?: SmplChunk;
  info?: InfoTags;
  /** Container tags as ffprobe reports them (lowercased keys). */
  tags?: Record<string, string>;
  /** Where each field came from. */
  source: Partial<Record<AnalysisField, AnalysisSource>>;
  warnings: string[];
  /** True when only part of the file was read (header-only fetch or the byte cap). */
  partial?: boolean;
  deep: boolean;
  cached?: boolean;
  tookMs: number;
}

export type AnalysisField =
  | "durationSec" | "sampleRate" | "bitDepth" | "channels" | "codec" | "format" | "bitRate"
  | "loudnessLufs" | "loudnessRangeLu" | "peakDb" | "silenceStartSec" | "silenceEndSec"
  | "bpm" | "beats" | "bars" | "key" | "rootNote" | "form" | "loopPoints" | "info";

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const HEAD_BYTES = 512 * 1024;
const LOCAL_FULL_READ = 32 * 1024 * 1024;
const SR = 22050;

// ---------------------------------------------------------------------------
// Process helpers

export class ToolMissingError extends Error {
  constructor(readonly tool: string) {
    super(`${tool} not found (install ffmpeg or set ${tool === "ffprobe" ? "FFPROBE_PATH" : "FFMPEG_PATH"})`);
    this.name = "ToolMissingError";
  }
}

const ffmpegPath = () => process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = () => process.env.FFPROBE_PATH || "ffprobe";

let active = 0;
const waiting: (() => void)[] = [];
const MAX_PROCS = Number(process.env.SOUND_SERVER_ANALYSIS_CONCURRENCY ?? Math.max(2, Math.min(8, availableParallelism())));

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PROCS) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

function run(cmd: string, tool: string, args: string[], opts: { timeoutMs: number; signal?: AbortSignal; maxStdout?: number }): Promise<RunResult> {
  return withSlot(
    () =>
      new Promise<RunResult>((resolve, reject) => {
        if (opts.signal?.aborted) return reject(opts.signal.reason ?? new Error("aborted"));
        const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        const out: Buffer[] = [];
        let outBytes = 0;
        let err = "";
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
          fn();
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(() => reject(new Error(`${tool} timed out after ${opts.timeoutMs}ms`)));
        }, opts.timeoutMs);
        const onAbort = () => {
          child.kill("SIGKILL");
          finish(() => reject(opts.signal?.reason ?? new Error("aborted")));
        };
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (d: Buffer) => {
          if (opts.maxStdout && outBytes + d.length > opts.maxStdout) {
            out.push(d.subarray(0, opts.maxStdout - outBytes));
            outBytes = opts.maxStdout;
            child.kill("SIGKILL");
            return;
          }
          out.push(d);
          outBytes += d.length;
        });
        child.stderr.on("data", (d: Buffer) => {
          err += d.toString("utf8");
          if (err.length > 256_000) err = err.slice(-128_000);
        });
        child.on("error", (e: NodeJS.ErrnoException) => finish(() => reject(e.code === "ENOENT" ? new ToolMissingError(tool) : e)));
        child.on("close", (code) => finish(() => resolve({ stdout: Buffer.concat(out), stderr: err, code })));
      }),
  );
}

// ---------------------------------------------------------------------------
// Input acquisition

interface Acquired {
  /** Bytes for the header parser (the whole file when small enough). */
  head: Uint8Array;
  partial: boolean;
  totalBytes?: number;
  /** A file ffmpeg can read. */
  file(): Promise<string>;
  cleanup(): Promise<void>;
}

function extOf(name: string): string {
  const clean = name.split(/[?#]/)[0] ?? "";
  const m = /\.([a-z0-9]{2,5})$/i.exec(clean);
  return m ? m[1]!.toLowerCase() : "bin";
}

async function acquire(input: AudioInput, opts: AnalyzeOptions, mode: "head" | "full"): Promise<Acquired> {
  let dir: string | undefined;
  const tempFile = async (bytes: Uint8Array, ext: string) => {
    dir ??= await mkdtemp(join(tmpdir(), "sound-analyze-"));
    const p = join(dir, `input.${ext}`);
    await writeFile(p, bytes);
    return p;
  };
  const cleanup = async () => {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };

  if (input.path) {
    const path = input.path;
    const st = await stat(path);
    let head: Uint8Array;
    if (st.size <= LOCAL_FULL_READ) head = await readFile(path);
    else {
      const fh = await open(path, "r");
      try {
        const buf = Buffer.alloc(HEAD_BYTES);
        const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
        head = buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    }
    return { head, partial: false, totalBytes: st.size, file: async () => path, cleanup };
  }

  if (input.buffer) {
    const buf = input.buffer;
    let p: string | undefined;
    return { head: buf, partial: false, totalBytes: buf.length, file: async () => (p ??= await tempFile(buf, "bin")), cleanup };
  }

  if (!input.url) throw new Error("analyzeAudio needs a path, buffer or url");
  const http = opts.http ?? defaultHttp();
  const cap = mode === "head" ? HEAD_BYTES : (opts.maxBytes ?? DEFAULT_MAX_BYTES);
  const headers: Record<string, string> = { accept: "audio/*, */*;q=0.8", ...input.headers };
  if (mode === "head") headers.range = `bytes=0-${HEAD_BYTES - 1}`;
  const res = await http.raw(input.url, { headers, signal: opts.signal, idleTimeoutMs: 20_000 });
  const range = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
  const length = Number(res.headers.get("content-length") ?? NaN);
  const totalBytes = range ? Number(range[1]) : res.status === 200 && Number.isFinite(length) ? length : undefined;
  const chunks: Uint8Array[] = [];
  let got = 0;
  let capped = false;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length >= cap) {
        chunks.push(value.subarray(0, cap - got));
        got = cap;
        capped = got < (totalBytes ?? Infinity);
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      got += value.length;
    }
  }
  const head = Buffer.concat(chunks);
  const partial = capped || (totalBytes !== undefined && got < totalBytes);
  let p: string | undefined;
  const ext = extOf(input.url);
  return { head, partial, totalBytes, file: async () => (p ??= await tempFile(head, ext)), cleanup };
}

let sharedHttp: HttpClient | undefined;
function defaultHttp(): HttpClient {
  return (sharedHttp ??= createHttpClient());
}

// ---------------------------------------------------------------------------
// Cache

const cache = new LRUCache<string, AudioAnalysis>({ max: Number(process.env.SOUND_SERVER_ANALYSIS_CACHE ?? 1000) });
const inflight = new Map<string, Promise<AudioAnalysis>>();

export function clearAnalysisCache(): void {
  cache.clear();
  peaksCache.clear();
}

async function cacheKey(input: AudioInput): Promise<string | undefined> {
  if (input.url) return `url:${input.url}`;
  if (input.path) {
    const st = await stat(input.path).catch(() => undefined);
    return st ? `path:${input.path}:${st.size}:${st.mtimeMs}` : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main entry

/**
 * Analyse one audio file. Cheap by default (header chunks + ffprobe, and for
 * URLs only the first 512 KB is fetched); `deep` decodes up to 30 s and runs
 * the signal analysis (~50–300 ms per sample). Results for URLs and paths are
 * cached in-process; a cached deep result also answers shallow requests.
 */
export async function analyzeAudio(input: AudioInput, opts: AnalyzeOptions = {}): Promise<AudioAnalysis> {
  const key = opts.cache === false ? undefined : await cacheKey(input);
  const deep = !!opts.deep;
  if (key) {
    for (const k of deep ? [`${key}|deep`] : [`${key}|deep`, `${key}|head`]) {
      const hit = cache.get(k);
      if (hit) return { ...hit, cached: true };
    }
    const fullKey = `${key}|${deep ? "deep" : "head"}`;
    const pending = inflight.get(fullKey);
    if (pending) return pending;
    const p = analyzeUncached(input, opts).then((a) => {
      cache.set(fullKey, a);
      return a;
    });
    inflight.set(fullKey, p);
    p.finally(() => inflight.delete(fullKey)).catch(() => undefined);
    return p;
  }
  return analyzeUncached(input, opts);
}

async function analyzeUncached(input: AudioInput, opts: AnalyzeOptions): Promise<AudioAnalysis> {
  const started = performance.now();
  const deep = !!opts.deep;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const a: AudioAnalysis = { source: {}, warnings: [], deep, tookMs: 0 };
  const set = <K extends AnalysisField>(field: K, value: AudioAnalysis[K] | undefined, src: AnalysisSource) => {
    if (value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value))) return;
    if (a[field] !== undefined) return;
    (a as unknown as Record<string, unknown>)[field] = value;
    a.source[field] = src;
  };

  const acq = await acquire(input, opts, deep ? "full" : "head");
  try {
    if (acq.partial) a.partial = true;

    // 1. Header chunks: exact.
    const chunks = parseWavChunks(acq.head);
    if (chunks) applyChunks(a, chunks, set);

    // 2. ffprobe: any container.
    let probeOk = false;
    try {
      const file = await acq.file();
      const r = await run(ffprobePath(), "ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { timeoutMs: Math.min(timeoutMs, 15_000), signal: opts.signal });
      if (r.code === 0) {
        applyProbe(a, JSON.parse(r.stdout.toString("utf8")) as FfprobeJson, set, acq, !!chunks?.durationSec);
        probeOk = true;
      } else a.warnings.push(`ffprobe failed: ${lastLine(r.stderr)}`);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      a.warnings.push(e instanceof ToolMissingError ? `${e.message}; only header chunks were read` : `ffprobe failed: ${msg(e)}`);
    }

    // 3. Signal analysis.
    if (deep && (probeOk || chunks?.format)) {
      try {
        await deepAnalysis(a, await acq.file(), set, { timeoutMs, signal: opts.signal, maxSeconds: opts.maxSeconds ?? 30 });
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        a.warnings.push(e instanceof ToolMissingError ? `${e.message}; skipped loudness/BPM/key analysis` : `analysis failed: ${msg(e)}`);
      }
    } else if (deep) a.warnings.push("not a readable audio file; skipped signal analysis");

    finishForm(a, set);
  } finally {
    await acq.cleanup();
  }
  a.tookMs = Math.round(performance.now() - started);
  return a;
}

type Setter = <K extends AnalysisField>(field: K, value: AudioAnalysis[K] | undefined, src: AnalysisSource) => void;

function applyChunks(a: AudioAnalysis, c: WavChunks, set: Setter): void {
  const f = c.format;
  set("format", c.container === "rf64" ? "wav" : c.container === "aifc" ? "aiff" : c.container, "chunk");
  if (f) {
    set("sampleRate", f.sampleRate || undefined, "chunk");
    set("channels", f.channels || undefined, "chunk");
    if (f.format === "pcm" || f.format === "float") set("bitDepth", f.bitDepth || undefined, "chunk");
    set("codec", f.format, "chunk");
  }
  set("durationSec", c.durationSec, "chunk");
  if (c.info) {
    a.info = c.info;
    a.source.info = "chunk";
  }
  if (c.acid) {
    a.acid = c.acid;
    if (c.acid.oneShot) set("form", "one-shot", "chunk");
    else if (c.acid.beats > 0 || c.acid.tempo > 0) set("form", "loop", "chunk");
    if (!c.acid.oneShot && c.acid.tempo >= 30 && c.acid.tempo <= 400) {
      set("bpm", round(c.acid.tempo, 2), "chunk");
      a.bpmConfidence = 1;
    }
    if (!c.acid.oneShot && c.acid.beats > 0) {
      set("beats", c.acid.beats, "chunk");
      set("bars", round(c.acid.beats / (c.acid.meterNumerator || 4), 2), "chunk");
    }
    if (c.acid.rootNoteSet) setRoot(a, c.acid.rootNote, set, "chunk", 1);
  }
  if (c.smpl) {
    a.smpl = c.smpl;
    if (c.smpl.midiUnityNote > 0 && c.smpl.midiUnityNote < 128) setRoot(a, c.smpl.midiUnityNote, set, "chunk", 1);
    const sr = f?.sampleRate;
    if (c.smpl.loops.length) {
      set(
        "loopPoints",
        c.smpl.loops.map((l) => ({
          startFrame: l.start,
          endFrame: l.end,
          ...(sr ? { startSec: round(l.start / sr, 4), endSec: round(l.end / sr, 4) } : {}),
          type: l.type,
        })),
        "chunk",
      );
    }
  }
  if (c.baseNote !== undefined && c.baseNote > 0) setRoot(a, c.baseNote, set, "chunk", 1);
}

function setRoot(a: AudioAnalysis, note: number, set: Setter, src: AnalysisSource, confidence: number, hz?: number): void {
  if (a.rootNote !== undefined || note < 0 || note > 127) return;
  set("rootNote", note, src);
  a.rootNoteName = midiName(note);
  a.rootNoteHz = round(hz ?? 440 * 2 ** ((note - 69) / 12), 2);
  a.rootNoteConfidence = confidence;
}

/** 60 → "C4", 69 → "A4". */
export function midiName(note: number): string {
  return `${PITCH_CLASSES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

interface FfprobeJson {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    sample_rate?: string;
    channels?: number;
    bits_per_sample?: number;
    bits_per_raw_sample?: string;
    sample_fmt?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  }[];
  format?: { format_name?: string; duration?: string; bit_rate?: string; tags?: Record<string, string> };
}

const SAMPLE_FMT_BITS: Record<string, number> = { u8: 8, u8p: 8, s16: 16, s16p: 16, s32: 32, s32p: 32, flt: 32, fltp: 32, dbl: 64, dblp: 64 };
const LOSSY = new Set(["mp3", "aac", "vorbis", "opus", "wmav2", "ac3", "mp2"]);

function applyProbe(a: AudioAnalysis, j: FfprobeJson, set: Setter, acq: Acquired, chunkDuration: boolean): void {
  const s = j.streams?.find((x) => x.codec_type === "audio");
  if (!s) {
    a.warnings.push("ffprobe found no audio stream");
    return;
  }
  const fmt = j.format?.format_name?.split(",")[0];
  set("format", fmt ? ({ wav: "wav", aiff: "aiff", ogg: "ogg", flac: "flac", mp3: "mp3", mov: "m4a" } as Record<string, string>)[fmt] ?? fmt : undefined, "ffprobe");
  set("codec", s.codec_name, "ffprobe");
  if (a.source.codec === "chunk" && s.codec_name) a.codec = s.codec_name; // ffprobe's name is more specific (pcm_s24le)
  set("sampleRate", num(s.sample_rate), "ffprobe");
  set("channels", s.channels || undefined, "ffprobe");
  if (!LOSSY.has(s.codec_name ?? "")) {
    const bits = s.bits_per_sample || num(s.bits_per_raw_sample) || (s.sample_fmt ? SAMPLE_FMT_BITS[s.sample_fmt] : undefined);
    set("bitDepth", bits || undefined, "ffprobe");
  }
  const bitRate = num(s.bit_rate) ?? num(j.format?.bit_rate);
  set("bitRate", bitRate, "ffprobe");
  if (!chunkDuration) {
    if (acq.partial) {
      // A prefix: ffprobe's duration is the prefix's. Estimate from the full size and bitrate.
      if (acq.totalBytes && bitRate) {
        set("durationSec", round((acq.totalBytes * 8) / bitRate, 3), "ffprobe");
        a.warnings.push("duration estimated from file size and bitrate");
      }
    } else set("durationSec", round(num(s.duration) ?? num(j.format?.duration) ?? NaN, 4), "ffprobe");
  }
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...j.format?.tags, ...s.tags })) tags[k.toLowerCase()] = v;
  if (Object.keys(tags).length) {
    a.tags = tags;
    if (!a.info) {
      const info: InfoTags = { raw: {} };
      if (tags.title) info.title = tags.title;
      if (tags.artist) info.artist = tags.artist;
      if (tags.genre) info.genre = tags.genre;
      if (tags.comment) info.comment = tags.comment;
      if (info.title || info.artist || info.genre || info.comment) {
        a.info = info;
        a.source.info = "ffprobe";
      }
    }
    const tbpm = num(tags.tbpm ?? tags.bpm) ?? (tags.comment ? bpmFromText(tags.comment) : undefined);
    if (tbpm && tbpm >= 40 && tbpm <= 300 && a.form !== "one-shot") {
      set("bpm", round(tbpm, 2), "ffprobe");
      a.bpmConfidence ??= 0.9;
    }
    const k = tags.tkey ?? tags.initialkey ?? tags.key;
    const parsed = k ? keyFromText(` ${k} `) : undefined;
    if (parsed?.mode && !a.key) {
      a.key = { tonic: parsed.tonic, mode: parsed.mode };
      a.source.key = "ffprobe";
      a.keyConfidence = 0.9;
    }
  }
}

// ---------------------------------------------------------------------------
// Deep analysis

async function decode(file: string, opts: { timeoutMs: number; signal?: AbortSignal; maxSeconds: number; sampleRate: number; loudness: boolean }): Promise<{ pcm: Float32Array; stderr: string }> {
  const chain = [
    ...(opts.loudness ? ["ebur128=peak=true:framelog=quiet"] : []),
    `aresample=${opts.sampleRate}`,
    "aformat=sample_fmts=flt:channel_layouts=mono",
  ].join(",");
  const args = ["-nostdin", "-hide_banner", "-nostats", "-t", String(opts.maxSeconds), "-i", file, "-vn", "-map", "0:a:0", "-af", chain, "-f", "f32le", "pipe:1"];
  const r = await run(ffmpegPath(), "ffmpeg", args, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    maxStdout: Math.ceil(opts.maxSeconds + 1) * opts.sampleRate * 4,
  });
  if (r.code !== 0 && r.stdout.length === 0) throw new Error(`ffmpeg failed: ${lastLine(r.stderr)}`);
  const usable = r.stdout.byteLength & ~3;
  const pcm = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + usable));
  return { pcm, stderr: r.stderr };
}

/** Parse the ebur128 filter's summary from ffmpeg's stderr. */
export function parseEbur128(stderr: string): { integrated?: number; lra?: number; truePeak?: number } {
  const i = stderr.lastIndexOf("Summary:");
  if (i < 0) return {};
  const s = stderr.slice(i);
  const n = (re: RegExp) => {
    const m = re.exec(s);
    if (!m) return undefined;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : undefined;
  };
  return {
    integrated: n(/I:\s*(-?[\d.]+|-inf|nan)\s*LUFS/),
    lra: n(/LRA:\s*(-?[\d.]+)\s*LU\b/),
    truePeak: n(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/),
  };
}

async function deepAnalysis(a: AudioAnalysis, file: string, set: Setter, opts: { timeoutMs: number; signal?: AbortSignal; maxSeconds: number }): Promise<void> {
  const { pcm, stderr } = await decode(file, { ...opts, sampleRate: SR, loudness: true });
  if (pcm.length < SR * 0.02) {
    a.warnings.push("decoded audio is empty");
    return;
  }
  const decodedSec = pcm.length / SR;
  set("durationSec", round(decodedSec, 4), "analysis");
  const wholeFile = a.durationSec === undefined || a.durationSec <= decodedSec + 0.05;

  const loud = parseEbur128(stderr);
  // ebur128 reports −70 LUFS (the absolute gate) when nothing passed the gate: clips under 400 ms or silence.
  if (loud.integrated !== undefined && loud.integrated > -69.95) set("loudnessLufs", round(loud.integrated, 1), "analysis");
  if (loud.lra !== undefined && a.loudnessLufs !== undefined) set("loudnessRangeLu", round(loud.lra, 1), "analysis");
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]!));
  const samplePeakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  set("peakDb", round(loud.truePeak ?? samplePeakDb, 1), "analysis");
  if (peak === 0) {
    a.warnings.push("the audio is silent");
    return;
  }

  // Leading/trailing silence, sample-accurate.
  const thr = Math.max(10 ** (-60 / 20), peak * 10 ** (-48 / 20));
  let first = 0;
  while (first < pcm.length && Math.abs(pcm[first]!) < thr) first++;
  let last = pcm.length - 1;
  while (last > first && Math.abs(pcm[last]!) < thr) last--;
  set("silenceStartSec", round(first / SR, 3), "analysis");
  if (wholeFile) set("silenceEndSec", round((pcm.length - 1 - last) / SR, 3), "analysis");

  const onsets = countOnsets(pcm, SR);
  a.onsets = onsets;
  const audibleSec = (last - first + 1) / SR;
  const fileSec = a.durationSec ?? decodedSec;

  // BPM: loops only (music-tempo throws or returns garbage on one-shots).
  const loopLike = a.form !== "one-shot" && decodedSec >= 1.5 && onsets >= 4;
  if (a.bpm === undefined && loopLike) {
    const t = estimateTempo(pcm, SR, fileSec);
    if (t) {
      set("bpm", t.bpm, "analysis");
      a.bpmConfidence = t.confidence;
    }
  }
  if (a.bpm !== undefined && a.beats === undefined && a.form !== "one-shot") {
    const beats = (fileSec * a.bpm) / 60;
    if (Math.abs(beats - Math.round(beats)) < 0.08 * Math.max(1, beats / 16)) {
      set("beats", Math.round(beats), "analysis");
      set("bars", round(Math.round(beats) / 4, 2), "analysis");
    }
  }

  // Root note for short, monophonic pitched sounds; key for longer tonal material.
  if (a.rootNote === undefined && onsets <= 3 && audibleSec <= 6) {
    const p = detectPitch(pcm.subarray(first, last + 1), SR);
    if (p) setRoot(a, p.note, set, "analysis", p.confidence, p.hz);
  }
  if (!a.key && decodedSec >= 1.5 && (a.source.rootNote !== "analysis" || (a.rootNoteConfidence ?? 0) < 0.6)) {
    const k = detectKey(pcm, SR);
    if (k) {
      a.key = k.key;
      a.source.key = "analysis";
      a.keyConfidence = k.confidence;
    }
  }

  // Form, when the header did not say.
  if (a.form === undefined) {
    if (fileSec < 1.5 || (onsets <= 1 && fileSec < 4)) {
      set("form", "one-shot", "analysis");
      a.formConfidence = fileSec < 1.5 ? 0.75 : 0.6;
    } else if (a.bpm !== undefined && a.beats !== undefined && onsets >= 4) {
      set("form", "loop", "analysis");
      a.formConfidence = 0.75;
    }
  }
}

function finishForm(a: AudioAnalysis, set: Setter): void {
  if (a.form !== undefined) {
    a.formConfidence ??= a.source.form === "chunk" ? 1 : 0.6;
    return;
  }
  // Header-only: a smpl loop over (nearly) the whole file means a loop.
  const lp = a.loopPoints?.[0];
  const frames = a.durationSec && a.sampleRate ? a.durationSec * a.sampleRate : undefined;
  if (lp && frames && lp.startFrame <= frames * 0.02 && lp.endFrame >= frames * 0.95) {
    set("form", "loop", "chunk");
    a.formConfidence = 0.7;
  }
}

/** Energy-rise onset count (rough; separates one-shots from loops). */
export function countOnsets(pcm: Float32Array, sr: number): number {
  const hop = Math.round(sr * 0.01);
  const win = hop * 2;
  const env: number[] = [];
  for (let i = 0; i + win <= pcm.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += pcm[j]! * pcm[j]!;
    env.push(10 * Math.log10(e / win + 1e-12));
  }
  const max = Math.max(...env, -120);
  let count = 0;
  let lastOnset = -Infinity;
  for (let i = 3; i < env.length; i++) {
    const prevMin = Math.min(env[i - 3]!, env[i - 2]!, env[i - 1]!);
    if (env[i]! - prevMin > 9 && env[i]! > max - 30 && i - lastOnset > 6) {
      count++;
      lastOnset = i;
    }
  }
  // A sound that starts at sample 0 has no rise; count its start.
  if (env.length && env[0]! > max - 30 && (lastOnset === -Infinity || lastOnset > 6)) count++;
  return count;
}

type MusicTempoCtor = new (data: Float32Array | number[], params?: Record<string, number>) => { tempo: string | number; beats: number[] };
let musicTempo: MusicTempoCtor | undefined;
function loadMusicTempo(): MusicTempoCtor {
  if (!musicTempo) {
    const mod = createRequire(import.meta.url)("music-tempo") as MusicTempoCtor | { default: MusicTempoCtor };
    musicTempo = "default" in mod ? mod.default : mod;
  }
  return musicTempo;
}

/**
 * music-tempo (Dixon beat induction), then: fold into 60–200 BPM, prefer the
 * half/double that makes the file a whole number of bars, and snap to the
 * exact bar-length tempo when it is within 1.5 % (well-cut loops).
 */
export function estimateTempo(pcm: Float32Array, sr: number, durationSec: number): { bpm: number; confidence: number } | undefined {
  let raw: number;
  try {
    const hop = Math.round(sr / 100);
    const mt = new (loadMusicTempo())(pcm, { bufferSize: sr > 30000 ? 2048 : 1024, hopSize: hop, timeStep: hop / sr });
    raw = Number(mt.tempo);
  } catch {
    return undefined;
  }
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  const fit = (bpm: number) => {
    const bars = (durationSec * bpm) / 240;
    const n = Math.round(bars);
    return n >= 1 ? Math.abs(bars - n) / n : 1;
  };
  const candidates = [raw, raw * 2, raw / 2].filter((b) => b >= 60 && b <= 200);
  if (!candidates.length) return undefined;
  candidates.sort((x, y) => {
    const fx = fit(x) < 0.015 ? 0 : 1;
    const fy = fit(y) < 0.015 ? 0 : 1;
    if (fx !== fy) return fx - fy;
    const rx = x >= 70 && x <= 180 ? 0 : 1;
    const ry = y >= 70 && y <= 180 ? 0 : 1;
    if (rx !== ry) return rx - ry;
    return Math.abs(Math.log2(x / raw)) - Math.abs(Math.log2(y / raw));
  });
  let bpm = candidates[0]!;
  let confidence = 0.45;
  if (fit(bpm) < 0.015) {
    const bars = Math.round((durationSec * bpm) / 240);
    bpm = (bars * 240) / durationSec;
    confidence = 0.85;
  }
  return { bpm: round(bpm, 2), confidence };
}

/** pitchy (McLeod) per frame, median of confident frames → MIDI note. */
export function detectPitch(pcm: Float32Array, sr: number): { note: number; hz: number; confidence: number } | undefined {
  const size = 2048;
  if (pcm.length < size) return undefined;
  const detector = PitchDetector.forFloat32Array(size);
  detector.minVolumeDecibels = -45;
  const midis: number[] = [];
  const clarities: number[] = [];
  let frames = 0;
  for (let i = 0; i + size <= pcm.length; i += size / 4) {
    frames++;
    const [hz, clarity] = detector.findPitch(pcm.subarray(i, i + size), sr);
    if (clarity >= 0.9 && hz >= 25 && hz <= 4200) {
      midis.push(69 + 12 * Math.log2(hz / 440));
      clarities.push(clarity);
    }
  }
  if (midis.length < 2 || midis.length < frames * 0.3) return undefined;
  const sorted = [...midis].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const stable = midis.filter((m) => Math.abs(m - med) <= 0.5).length / midis.length;
  if (stable < 0.6) return undefined;
  const clarity = clarities.reduce((s, c) => s + c, 0) / clarities.length;
  return { note: Math.round(med), hz: round(440 * 2 ** ((med - 69) / 12), 2), confidence: round(stable * clarity * Math.min(1, midis.length / frames + 0.3), 2) };
}

// Krumhansl-Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Average chroma (12 pitch classes, C first) of the tonal frames, from spectral peaks between 80 Hz and 5 kHz. */
export function chroma(pcm: Float32Array, sr: number): { chroma: number[]; tonalFrames: number; frames: number } {
  const n = 4096;
  const fft = new FFT(n);
  const win = new Float32Array(n).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const input = new Array<number>(n).fill(0);
  const out = fft.createComplexArray() as number[];
  const mag = new Float64Array(n / 2);
  const kMin = Math.ceil((80 * n) / sr);
  const kMax = Math.min(n / 2 - 2, Math.floor((5000 * n) / sr));
  const acc = new Array<number>(12).fill(0);
  let frames = 0;
  let tonal = 0;
  for (let start = 0; start + n <= pcm.length; start += n / 2) {
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const v = pcm[start + i]! * win[i]!;
      input[i] = v;
      energy += v * v;
    }
    if (10 * Math.log10(energy / n + 1e-12) < -60) continue;
    frames++;
    fft.realTransform(out, input);
    let logSum = 0;
    let linSum = 0;
    for (let k = kMin; k <= kMax; k++) {
      const m = Math.hypot(out[2 * k]!, out[2 * k + 1]!);
      mag[k] = m;
      logSum += Math.log(m + 1e-12);
      linSum += m;
    }
    const count = kMax - kMin + 1;
    const flatness = Math.exp(logSum / count) / (linSum / count + 1e-12);
    if (flatness > 0.2) continue;
    let frameMax = 0;
    for (let k = kMin; k <= kMax; k++) frameMax = Math.max(frameMax, mag[k]!);
    const c = new Array<number>(12).fill(0);
    for (let k = kMin + 1; k < kMax; k++) {
      const m = mag[k]!;
      if (m < frameMax * 0.05 || m <= mag[k - 1]! || m < mag[k + 1]!) continue;
      // Parabolic interpolation of the peak frequency.
      const l = mag[k - 1]!;
      const r = mag[k + 1]!;
      const d = (0.5 * (l - r)) / (l - 2 * m + r || 1);
      const hz = ((k + d) * sr) / n;
      const pc = ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12; // MIDI % 12: 0 = C
      c[pc]! += m;
    }
    const sum = c.reduce((s, x) => s + x, 0);
    if (sum <= 0) continue;
    tonal++;
    for (let i = 0; i < 12; i++) acc[i]! += c[i]! / sum;
  }
  const total = acc.reduce((s, x) => s + x, 0) || 1;
  return { chroma: acc.map((x) => x / total), tonalFrames: tonal, frames };
}

/** Pearson correlation of a chroma vector with the 24 rotated K-K profiles. */
export function keyFromChroma(c: number[]): { key: MusicalKey; r: number; second: number }[] {
  const out: { key: MusicalKey; r: number; second: number }[] = [];
  for (const [mode, prof] of [["major", MAJOR], ["minor", MINOR]] as const) {
    for (let t = 0; t < 12; t++) {
      const rotated = c.map((_, i) => prof[(i - t + 12) % 12]!);
      out.push({ key: { tonic: PITCH_CLASSES[t]!, mode }, r: pearson(c, rotated), second: 0 });
    }
  }
  out.sort((x, y) => y.r - x.r);
  for (const o of out) o.second = out[1]!.r;
  return out;
}

export function detectKey(pcm: Float32Array, sr: number): { key: MusicalKey; confidence: number; r: number } | undefined {
  const c = chroma(pcm, sr);
  if (c.frames === 0 || c.tonalFrames < Math.max(2, c.frames * 0.25)) return undefined;
  const ranked = keyFromChroma(c.chroma);
  const best = ranked[0]!;
  if (best.r < 0.5) return undefined;
  const margin = best.r - ranked[1]!.r;
  const confidence = round(Math.min(1, best.r) * Math.min(1, 0.55 + margin * 4), 2);
  return { key: best.key, confidence, r: round(best.r, 3) };
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i]! - mx) * (y[i]! - my);
    dx += (x[i]! - mx) ** 2;
    dy += (y[i]! - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

// ---------------------------------------------------------------------------
// Waveform peaks

export interface WaveformPeaks {
  /** Interleaved min/max pairs per bucket, −1..1 (2 decimals): [min0, max0, min1, max1, …]. */
  peaks: number[];
  /** Buckets (peaks.length / 2). */
  points: number;
  durationSec: number;
}

const peaksCache = new LRUCache<string, WaveformPeaks>({ max: 500 });

/**
 * Min/max peaks for a waveform display (wavesurfer.js `peaks` + `duration`),
 * from a mono 8 kHz decode of up to `maxSeconds` (default 600).
 */
export async function waveformPeaks(
  input: AudioInput,
  opts: { points?: number; normalize?: boolean; maxSeconds?: number } & Omit<AnalyzeOptions, "deep" | "maxSeconds"> = {},
): Promise<WaveformPeaks> {
  const points = Math.max(1, Math.min(10_000, Math.floor(opts.points ?? 800)));
  const normalize = opts.normalize ?? true;
  const base = opts.cache === false ? undefined : await cacheKey(input);
  const key = base && `${base}|${points}|${normalize}`;
  const hit = key ? peaksCache.get(key) : undefined;
  if (hit) return hit;
  const acq = await acquire(input, opts, "full");
  try {
    const sr = 8000;
    const { pcm } = await decode(await acq.file(), { timeoutMs: opts.timeoutMs ?? 30_000, signal: opts.signal, maxSeconds: opts.maxSeconds ?? 600, sampleRate: sr, loudness: false });
    const result = computePeaks(pcm, sr, points, normalize);
    if (key) peaksCache.set(key, result);
    return result;
  } finally {
    await acq.cleanup();
  }
}

export function computePeaks(pcm: Float32Array, sampleRate: number, points: number, normalize = true): WaveformPeaks {
  const n = Math.max(1, Math.min(points, pcm.length));
  const peaks = new Array<number>(n * 2).fill(0);
  let absMax = 0;
  for (let b = 0; b < n; b++) {
    const s = Math.floor((b * pcm.length) / n);
    const e = Math.max(s + 1, Math.floor(((b + 1) * pcm.length) / n));
    let lo = 0;
    let hi = 0;
    for (let i = s; i < e && i < pcm.length; i++) {
      const v = pcm[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    peaks[2 * b] = lo;
    peaks[2 * b + 1] = hi;
    absMax = Math.max(absMax, -lo, hi);
  }
  const scale = normalize && absMax > 0 ? 1 / absMax : 1;
  return {
    peaks: peaks.map((v) => Math.max(-1, Math.min(1, Math.round(v * scale * 100) / 100)) + 0),
    points: n,
    durationSec: round(pcm.length / sampleRate, 3),
  };
}

// ---------------------------------------------------------------------------
// Samples

export type AnalysisEvidence = Partial<Record<"bpm" | "key" | "durationSec" | "sampleRate" | "bitDepth" | "channels" | "loudnessLufs" | "rootNote" | "form", { by: AnalysisSource; confidence?: number }>>;

export type EnrichedSample = SampleDetails & { analysisEvidence?: AnalysisEvidence };

/**
 * Fill a sample's missing musical/technical fields from an analysis. Values the
 * source already gave are never overwritten. Estimated BPM/key/root/form need
 * confidence ≥ 0.5. `fileUrl` names the file that was analysed so its
 * sampleRate/bitDepth/channels can be filled too.
 */
export function enrichSample(sample: SampleDetails, analysis: AudioAnalysis, opts: { fileUrl?: string } = {}): EnrichedSample {
  const out: EnrichedSample = { ...sample };
  const evidence: AnalysisEvidence = { ...(sample as EnrichedSample).analysisEvidence };
  const ok = (field: AnalysisField, conf?: number) => {
    const src = analysis.source[field];
    return !!src && (src !== "analysis" || (conf ?? 1) >= 0.5);
  };
  const fill = <K extends keyof AnalysisEvidence & keyof SampleDetails>(field: K, value: SampleDetails[K] | undefined, src: AnalysisField, conf?: number) => {
    if (value === undefined || out[field] !== undefined || !ok(src, conf)) return;
    out[field] = value;
    evidence[field] = { by: analysis.source[src]!, ...(conf !== undefined ? { confidence: conf } : {}) };
  };
  fill("durationSec", analysis.durationSec !== undefined ? round(analysis.durationSec, 3) : undefined, "durationSec");
  fill("sampleRate", analysis.sampleRate, "sampleRate");
  fill("bitDepth", analysis.bitDepth, "bitDepth");
  fill("channels", analysis.channels, "channels");
  fill("loudnessLufs", analysis.loudnessLufs, "loudnessLufs");
  const oneShot = (out.form ?? analysis.form) === "one-shot";
  if (!oneShot) fill("bpm", analysis.bpm, "bpm", analysis.bpmConfidence);
  fill("key", analysis.key, "key", analysis.keyConfidence);
  fill("rootNote", analysis.rootNote, "rootNote", analysis.rootNoteConfidence);
  fill("form", analysis.form, "form", analysis.formConfidence);

  if (opts.fileUrl && sample.files?.length) {
    out.files = sample.files.map((f) =>
      f.url !== opts.fileUrl
        ? f
        : {
            ...f,
            sampleRate: f.sampleRate ?? analysis.sampleRate,
            bitDepth: f.bitDepth ?? analysis.bitDepth,
            channels: f.channels ?? analysis.channels,
          },
    );
  }
  if (Object.keys(evidence).length) out.analysisEvidence = evidence;
  return out;
}

/**
 * The file to analyse for a sample: the original audio when it is reachable
 * and under the byte cap, else a preview.
 */
export function pickAnalysisFile(sample: SampleDetails, opts: { maxBytes?: number } = {}): SampleFile | { url: string; headers?: undefined; role: "preview" } | undefined {
  const cap = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const audio = sample.files.filter((f) => !f.requiresAuth && (AUDIO_FORMATS as readonly string[]).includes(f.format));
  const rank = (f: SampleFile) => (AUDIO_FORMATS as readonly string[]).indexOf(f.format);
  const originals = audio.filter((f) => (f.role === "original" || f.role === "stem") && (f.sizeBytes === undefined || f.sizeBytes <= cap)).sort((x, y) => rank(x) - rank(y));
  if (originals[0]) return originals[0];
  const previews = audio.filter((f) => f.role === "preview").sort((x, y) => rank(x) - rank(y));
  if (previews[0]) return previews[0];
  return sample.previewUrl ? { url: sample.previewUrl, role: "preview" } : undefined;
}

/** Analyse the best file of a sample and return the enriched sample. Never throws: failures become warnings. */
export async function analyzeSample(
  sample: SampleDetails,
  opts: AnalyzeOptions = {},
): Promise<{ sample: EnrichedSample; analysis?: AudioAnalysis; fileUrl?: string; warnings: string[] }> {
  const file = pickAnalysisFile(sample, opts);
  if (!file) return { sample, warnings: ["no audio file to analyse"] };
  try {
    const analysis = await analyzeAudio({ url: file.url, headers: file.headers }, opts);
    return { sample: enrichSample(sample, analysis, { fileUrl: file.url }), analysis, fileUrl: file.url, warnings: analysis.warnings };
  } catch (e) {
    return { sample, fileUrl: file.url, warnings: [`analysis failed: ${msg(e)}`] };
  }
}

function num(v: string | number | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function round(n: number, d: number): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function lastLine(s: string): string {
  return s.trim().split("\n").pop()?.slice(0, 300) ?? "";
}
