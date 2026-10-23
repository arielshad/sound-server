/**
 * Test helper: write WAV/AIFF files with ACID, smpl, LIST/INFO and bext chunks,
 * and synthesise small test signals. Used by the wavchunks/analyze tests and by
 * generate.ts (which writes the committed fixtures in this folder).
 */

export interface Chunk {
  id: string;
  body: Uint8Array;
}

function bytes(n: number): { b: Uint8Array; dv: DataView } {
  const b = new Uint8Array(n);
  return { b, dv: new DataView(b.buffer) };
}

function writeAscii(b: Uint8Array, at: number, s: string, max = s.length): void {
  const enc = new TextEncoder().encode(s);
  b.set(enc.subarray(0, max), at);
}

export function acidChunk(o: { oneShot?: boolean; rootNote?: number; beats?: number; meter?: [number, number]; tempo?: number }): Chunk {
  const { b, dv } = bytes(24);
  const flags = (o.oneShot ? 1 : 0) | (o.rootNote !== undefined ? 2 : 0) | 4;
  dv.setUint32(0, flags, true);
  dv.setUint16(4, o.rootNote ?? 60, true);
  dv.setUint16(6, 0x8000, true);
  dv.setFloat32(8, 0, true);
  dv.setUint32(12, o.beats ?? 0, true);
  dv.setUint16(16, o.meter?.[1] ?? 4, true);
  dv.setUint16(18, o.meter?.[0] ?? 4, true);
  dv.setFloat32(20, o.tempo ?? 0, true);
  return { id: "acid", body: b };
}

export function smplChunk(o: { unityNote: number; pitchFraction?: number; sampleRate?: number; loops?: { start: number; end: number; type?: number }[] }): Chunk {
  const loops = o.loops ?? [];
  const { b, dv } = bytes(36 + loops.length * 24);
  dv.setUint32(8, Math.round(1e9 / (o.sampleRate ?? 44100)), true);
  dv.setUint32(12, o.unityNote, true);
  dv.setUint32(16, Math.round((o.pitchFraction ?? 0) * 2 ** 32) >>> 0, true);
  dv.setUint32(28, loops.length, true);
  loops.forEach((l, i) => {
    const at = 36 + i * 24;
    dv.setUint32(at, i, true);
    dv.setUint32(at + 4, l.type ?? 0, true);
    dv.setUint32(at + 8, l.start, true);
    dv.setUint32(at + 12, l.end, true);
  });
  return { id: "smpl", body: b };
}

export function infoChunk(tags: Record<string, string>): Chunk {
  const parts: Uint8Array[] = [new TextEncoder().encode("INFO")];
  for (const [id, value] of Object.entries(tags)) {
    const v = new TextEncoder().encode(value);
    const size = v.length + 1;
    const { b, dv } = bytes(8 + size + (size & 1));
    writeAscii(b, 0, id, 4);
    dv.setUint32(4, size, true);
    b.set(v, 8);
    parts.push(b);
  }
  return { id: "LIST", body: concat(parts) };
}

export function bextChunk(o: { description: string; originator?: string }): Chunk {
  const { b } = bytes(602);
  writeAscii(b, 0, o.description, 256);
  writeAscii(b, 256, o.originator ?? "", 32);
  return { id: "bext", body: b };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function riffChunk(c: Chunk): Uint8Array {
  const pad = c.body.length & 1;
  const { b, dv } = bytes(8 + c.body.length + pad);
  writeAscii(b, 0, c.id, 4);
  dv.setUint32(4, c.body.length, true);
  b.set(c.body, 8);
  return b;
}

/** 16/24-bit PCM or 32-bit float WAV from interleaved samples in -1..1. Extra chunks go before `data` unless `after`. */
export function wavFile(o: {
  pcm: Float32Array;
  sampleRate?: number;
  channels?: number;
  bitDepth?: 16 | 24 | 32;
  float?: boolean;
  chunks?: Chunk[];
  after?: Chunk[];
}): Uint8Array {
  const sampleRate = o.sampleRate ?? 44100;
  const channels = o.channels ?? 1;
  const bitDepth = o.float ? 32 : (o.bitDepth ?? 16);
  const bps = bitDepth / 8;
  const fmt = bytes(16);
  fmt.dv.setUint16(0, o.float ? 3 : 1, true);
  fmt.dv.setUint16(2, channels, true);
  fmt.dv.setUint32(4, sampleRate, true);
  fmt.dv.setUint32(8, sampleRate * channels * bps, true);
  fmt.dv.setUint16(12, channels * bps, true);
  fmt.dv.setUint16(14, bitDepth, true);
  const data = bytes(o.pcm.length * bps);
  o.pcm.forEach((x, i) => {
    const v = Math.max(-1, Math.min(1, x));
    if (o.float) data.dv.setFloat32(i * 4, v, true);
    else if (bitDepth === 16) data.dv.setInt16(i * 2, Math.round(v * 32767), true);
    else if (bitDepth === 24) {
      const n = Math.round(v * 8388607);
      data.dv.setUint8(i * 3, n & 0xff);
      data.dv.setUint8(i * 3 + 1, (n >> 8) & 0xff);
      data.dv.setInt8(i * 3 + 2, n >> 16);
    } else data.dv.setInt32(i * 4, Math.round(v * 2147483647), true);
  });
  const body = concat([
    riffChunk({ id: "fmt ", body: fmt.b }),
    ...(o.chunks ?? []).map(riffChunk),
    riffChunk({ id: "data", body: data.b }),
    ...(o.after ?? []).map(riffChunk),
  ]);
  const head = bytes(12);
  writeAscii(head.b, 0, "RIFF");
  head.dv.setUint32(4, 4 + body.length, true);
  writeAscii(head.b, 8, "WAVE");
  return concat([head.b, body]);
}

/** Minimal 16-bit AIFF with COMM, optional NAME and INST base note. */
export function aiffFile(o: { pcm: Float32Array; sampleRate?: number; channels?: number; name?: string; baseNote?: number }): Uint8Array {
  const sampleRate = o.sampleRate ?? 44100;
  const channels = o.channels ?? 1;
  const frames = o.pcm.length / channels;
  const chunk = (id: string, body: Uint8Array): Uint8Array => {
    const pad = body.length & 1;
    const { b, dv } = bytes(8 + body.length + pad);
    writeAscii(b, 0, id, 4);
    dv.setUint32(4, body.length, false);
    b.set(body, 8);
    return b;
  };
  const comm = bytes(18);
  comm.dv.setUint16(0, channels, false);
  comm.dv.setUint32(2, frames, false);
  comm.dv.setUint16(6, 16, false);
  // 80-bit extended sample rate
  const e = Math.floor(Math.log2(sampleRate));
  comm.dv.setUint16(8, e + 16383, false);
  const mant = sampleRate / 2 ** e; // 1.x
  comm.dv.setUint32(10, Math.floor(mant * 2 ** 31) >>> 0, false);
  comm.dv.setUint32(14, 0, false);
  const ssnd = bytes(8 + o.pcm.length * 2);
  o.pcm.forEach((x, i) => ssnd.dv.setInt16(8 + i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), false));
  const parts = [chunk("COMM", comm.b)];
  if (o.name) parts.push(chunk("NAME", new TextEncoder().encode(o.name)));
  if (o.baseNote !== undefined) {
    const inst = bytes(20);
    inst.dv.setInt8(0, o.baseNote);
    parts.push(chunk("INST", inst.b));
  }
  parts.push(chunk("SSND", ssnd.b));
  const body = concat(parts);
  const head = bytes(12);
  writeAscii(head.b, 0, "FORM");
  head.dv.setUint32(4, 4 + body.length, false);
  writeAscii(head.b, 8, "AIFF");
  return concat([head.b, body]);
}

/** Deterministic pseudo-random noise in -1..1. */
function noise(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

/** A drum loop: kick on every beat, closed-hat noise on the off-beats, snare on 2 and 4. */
export function clickLoop(bpm: number, bars: number, sampleRate = 22050): Float32Array {
  const beat = 60 / bpm;
  const n = Math.round(bars * 4 * beat * sampleRate);
  const out = new Float32Array(n);
  const rnd = noise(7);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const k = t % beat;
    const beatIdx = Math.floor(t / beat);
    let v = Math.sin(2 * Math.PI * 60 * k) * Math.exp(-k * 25) * 0.8;
    const h = (t + beat / 2) % beat;
    v += rnd() * Math.exp(-h * 90) * 0.25;
    if (beatIdx % 2 === 1) v += rnd() * Math.exp(-k * 30) * 0.4;
    out[i] = v;
  }
  return out;
}

export function sine(freq: number, durSec: number, sampleRate = 22050, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(durSec * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}
