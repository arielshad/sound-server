/**
 * A small RIFF/WAVE (and basic AIFF) header reader for the metadata that
 * sample packs embed and generic tag readers skip: the ACID chunk (one-shot
 * flag, root note, beats, tempo), the `smpl` chunk (MIDI unity note, loop
 * points), LIST/INFO tags and the Broadcast Wave `bext` description.
 *
 * Works on the first bytes of a file: the data size comes from the chunk
 * header, so a 64 KB prefix is enough for the duration. Pure TS, no deps.
 * Layouts: docs/research/audio-tech.md §2.
 */

export interface WavFormat {
  /** WAVE format tag (1 PCM, 3 float, 6 A-law, 7 µ-law, 0xFFFE extensible → its sub-format). */
  formatTag: number;
  format: "pcm" | "float" | "alaw" | "mulaw" | "adpcm" | "other";
  channels: number;
  sampleRate: number;
  bitDepth: number;
  blockAlign: number;
}

export interface AcidChunk {
  flags: number;
  oneShot: boolean;
  rootNoteSet: boolean;
  stretch: boolean;
  diskBased: boolean;
  /** MIDI note (60 = C4), only meaningful when `rootNoteSet`. */
  rootNote: number;
  beats: number;
  meterNumerator: number;
  meterDenominator: number;
  tempo: number;
}

export interface SampleLoop {
  cueId: number;
  type: "forward" | "pingpong" | "reverse" | "other";
  /** Sample frames, inclusive. */
  start: number;
  end: number;
  playCount: number;
}

export interface SmplChunk {
  manufacturer: number;
  product: number;
  /** Nanoseconds per sample. */
  samplePeriod: number;
  midiUnityNote: number;
  /** Fraction of a semitone above the unity note, 0..1. */
  pitchFraction: number;
  loops: SampleLoop[];
}

export interface InfoTags {
  title?: string;
  artist?: string;
  comment?: string;
  genre?: string;
  keywords?: string;
  software?: string;
  date?: string;
  copyright?: string;
  /** Broadcast Wave description and originator (bext). */
  description?: string;
  originator?: string;
  /** Every INFO sub-chunk by its four-letter id. */
  raw: Record<string, string>;
}

export interface WavChunks {
  container: "wav" | "rf64" | "aiff" | "aifc";
  format?: WavFormat;
  /** Bytes of audio data per the header (may exceed the buffer when given a prefix). */
  dataBytes?: number;
  frames?: number;
  durationSec?: number;
  acid?: AcidChunk;
  smpl?: SmplChunk;
  info?: InfoTags;
  /** AIFF INST base note. */
  baseNote?: number;
  /** Chunk ids in file order. */
  chunks: string[];
  /** True when the buffer ended before the chunk list did (fine for headers). */
  truncated: boolean;
}

const INFO_KEYS: Record<string, keyof Omit<InfoTags, "raw">> = {
  INAM: "title", IART: "artist", ICMT: "comment", IGNR: "genre", IKEY: "keywords", ISFT: "software", ICRD: "date", ICOP: "copyright",
};
const FORMAT_NAMES: Record<number, WavFormat["format"]> = { 1: "pcm", 3: "float", 6: "alaw", 7: "mulaw", 2: "adpcm", 0x11: "adpcm" };
const LOOP_TYPES = ["forward", "pingpong", "reverse"] as const;

const ascii = (b: Uint8Array, at: number, n: number): string => {
  let s = "";
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
};
/** Zero-terminated, trimmed text (INFO/bext are nominally ASCII; decode as UTF-8, which is a superset). */
const text = (b: Uint8Array, at: number, n: number): string => {
  const end = Math.min(at + n, b.length);
  let stop = at;
  while (stop < end && b[stop] !== 0) stop++;
  return new TextDecoder().decode(b.subarray(at, stop)).trim();
};

/** Parse the header chunks of a WAV/RF64/AIFF file. Returns undefined for anything else. */
export function parseWavChunks(input: Uint8Array): WavChunks | undefined {
  if (input.length < 12) return undefined;
  const id = ascii(input, 0, 4);
  const kind = ascii(input, 8, 4);
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if ((id === "RIFF" || id === "RF64" || id === "BW64") && kind === "WAVE") return parseRiff(input, dv, id === "RIFF" ? "wav" : "rf64");
  if (id === "FORM" && (kind === "AIFF" || kind === "AIFC")) return parseAiff(input, dv, kind === "AIFF" ? "aiff" : "aifc");
  return undefined;
}

function parseRiff(b: Uint8Array, dv: DataView, container: "wav" | "rf64"): WavChunks {
  const out: WavChunks = { container, chunks: [], truncated: false };
  let ds64Data: number | undefined;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const cid = ascii(b, pos, 4);
    const size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    const avail = Math.min(size, b.length - body);
    out.chunks.push(cid);
    const u16 = (o: number) => (o + 2 <= avail ? dv.getUint16(body + o, true) : 0);
    const u32 = (o: number) => (o + 4 <= avail ? dv.getUint32(body + o, true) : 0);
    const f32 = (o: number) => (o + 4 <= avail ? dv.getFloat32(body + o, true) : 0);
    if (cid === "ds64" && avail >= 16) {
      ds64Data = Number(dv.getBigUint64(body + 8, true));
    } else if (cid === "fmt " && avail >= 16) {
      let tag = u16(0);
      if (tag === 0xfffe && avail >= 26) tag = u16(24); // WAVE_FORMAT_EXTENSIBLE: first two bytes of the sub-format GUID
      out.format = { formatTag: tag, format: FORMAT_NAMES[tag] ?? "other", channels: u16(2), sampleRate: u32(4), blockAlign: u16(12), bitDepth: u16(14) };
    } else if (cid === "data") {
      out.dataBytes = size === 0xffffffff && ds64Data !== undefined ? ds64Data : size;
    } else if (cid === "acid" && avail >= 24) {
      const flags = u32(0);
      out.acid = {
        flags, oneShot: !!(flags & 1), rootNoteSet: !!(flags & 2), stretch: !!(flags & 4), diskBased: !!(flags & 8),
        rootNote: u16(4), beats: u32(12), meterDenominator: u16(16), meterNumerator: u16(18), tempo: round(f32(20), 3),
      };
    } else if (cid === "smpl" && avail >= 36) {
      const n = u32(28);
      const loops: SampleLoop[] = [];
      for (let i = 0; i < n && 36 + i * 24 + 24 <= avail; i++) {
        const o = 36 + i * 24;
        const t = u32(o + 4);
        loops.push({ cueId: u32(o), type: LOOP_TYPES[t] ?? "other", start: u32(o + 8), end: u32(o + 12), playCount: u32(o + 20) });
      }
      out.smpl = { manufacturer: u32(0), product: u32(4), samplePeriod: u32(8), midiUnityNote: u32(12), pitchFraction: round(u32(16) / 2 ** 32, 4), loops };
    } else if (cid === "LIST" && ascii(b, body, 4) === "INFO") {
      const info: InfoTags = out.info ?? { raw: {} };
      for (let p = body + 4; p + 8 <= body + avail; ) {
        const sid = ascii(b, p, 4);
        const ssz = dv.getUint32(p + 4, true);
        const v = text(b, p + 8, ssz);
        if (v) {
          info.raw[sid] = v;
          const key = INFO_KEYS[sid];
          if (key) info[key] = v;
        }
        p += 8 + ssz + (ssz & 1);
      }
      out.info = info;
    } else if (cid === "bext" && avail >= 256) {
      const info: InfoTags = out.info ?? { raw: {} };
      const description = text(b, body, 256);
      const originator = text(b, body + 256, 32);
      if (description) info.description = description;
      if (originator) info.originator = originator;
      out.info = info;
    }
    if (size > b.length - body) {
      // The chunk runs past the buffer: fine for `data` (we only need its size); chunks after it are out of reach.
      out.truncated = true;
      break;
    }
    pos = body + size + (size & 1);
  }
  const f = out.format;
  if (f && out.dataBytes !== undefined && f.blockAlign > 0 && f.sampleRate > 0 && f.format !== "adpcm") {
    out.frames = Math.floor(out.dataBytes / f.blockAlign);
    out.durationSec = round(out.frames / f.sampleRate, 4);
  }
  return out;
}

function parseAiff(b: Uint8Array, dv: DataView, container: "aiff" | "aifc"): WavChunks {
  const out: WavChunks = { container, chunks: [], truncated: false };
  let pos = 12;
  while (pos + 8 <= b.length) {
    const cid = ascii(b, pos, 4);
    const size = dv.getUint32(pos + 4, false);
    const body = pos + 8;
    out.chunks.push(cid);
    if (cid === "COMM" && body + 18 <= b.length) {
      const channels = dv.getUint16(body, false);
      const frames = dv.getUint32(body + 2, false);
      const bitDepth = dv.getUint16(body + 6, false);
      const sampleRate = Math.round(extended80(dv, body + 8));
      const comp = container === "aifc" && body + 22 <= b.length ? ascii(b, body + 18, 4) : "NONE";
      const fmt: WavFormat["format"] = comp === "NONE" || comp === "twos" || comp === "sowt" ? "pcm" : comp === "fl32" || comp === "fl64" ? "float" : comp === "alaw" ? "alaw" : comp === "ulaw" ? "mulaw" : "other";
      out.format = { formatTag: 0, format: fmt, channels, sampleRate, bitDepth, blockAlign: channels * Math.ceil(bitDepth / 8) };
      out.frames = frames;
      if (sampleRate > 0) out.durationSec = round(frames / sampleRate, 4);
    } else if (cid === "SSND") {
      out.dataBytes = Math.max(0, size - 8);
    } else if (cid === "INST" && body + 1 <= b.length) {
      out.baseNote = dv.getInt8(body);
    } else if ((cid === "NAME" || cid === "AUTH" || cid === "ANNO" || cid === "(c) ") && body < b.length) {
      const info: InfoTags = out.info ?? { raw: {} };
      const v = text(b, body, size);
      if (v) {
        info.raw[cid] = v;
        if (cid === "NAME") info.title = v;
        else if (cid === "AUTH") info.artist = v;
        else if (cid === "ANNO") info.comment = v;
        else info.copyright = v;
      }
      out.info = info;
    }
    if (size > b.length - body && cid !== "SSND") {
      out.truncated = true;
      break;
    }
    pos = body + size + (size & 1);
  }
  return out;
}

/** IEEE 754 80-bit extended (AIFF sample rate), big-endian. */
function extended80(dv: DataView, at: number): number {
  const exp = dv.getUint16(at, false);
  const hi = dv.getUint32(at + 2, false);
  const lo = dv.getUint32(at + 6, false);
  const sign = exp & 0x8000 ? -1 : 1;
  const e = (exp & 0x7fff) - 16383;
  return sign * (hi * 2 ** (e - 31) + lo * 2 ** (e - 63));
}

function round(n: number, d: number): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}
