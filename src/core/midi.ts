/**
 * Melodic loop → MIDI. A lightweight, dependency-free transcriber: pitch
 * tracking with pitchy (McLeod, as in analyze.ts) plus energy onsets and
 * pitch-change points → notes (start, end, MIDI pitch, velocity from level),
 * quantised to the loop's BPM grid when the tempo is known; and a tiny
 * Standard MIDI File writer/reader (format 0, PPQ 480, tempo and time
 * signature meta events).
 *
 * MONOPHONIC ONLY: one note at a time (bass lines, leads, vocal lines,
 * arpeggios). Chords, pads and drums are not transcribed; the result then
 * carries a warning. Polyphonic transcription (Spotify basic-pitch) would
 * need TensorFlow.js (@tensorflow/tfjs 3.x, ~150 MB unpacked, slow on the CPU
 * backend; tfjs-node has no musl/Alpine build), so it is not used here.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PitchDetector } from "pitchy";
import { countOnsets, estimateTempo, ToolMissingError } from "./analyze.js";
import { hzToMidi, noteName } from "./notes.js";

// ---------------------------------------------------------------------------
// Types

export interface TranscribedNote {
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  /** MIDI note number (60 = C4). */
  pitch: number;
  name: string;
  /** 1–127, from the note's level relative to the loudest note. */
  velocity: number;
  /** 0–1: voiced share of the note's frames × pitch clarity. */
  confidence: number;
}

export interface TranscribeOptions {
  /** Lowest/highest MIDI note to accept (defaults 28 = E1, 96 = C7). */
  minPitch?: number;
  maxPitch?: number;
  /** Shortest note kept, seconds (default 0.06). */
  minNoteSec?: number;
  /** pitchy clarity needed for a frame to count as pitched (default 0.8). */
  minClarity?: number;
}

export interface Transcription {
  notes: TranscribedNote[];
  /** Share of audible pitch frames with a clear single pitch. */
  pitchedRatio: number;
  warnings: string[];
}

export interface MidiNote {
  tick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
  /** 0–15 (default 0). */
  channel?: number;
}

export interface MidiWriteOptions {
  /** Ticks per quarter note (default 480). */
  ppq?: number;
  /** Tempo meta event (default 120). */
  bpm?: number;
  /** Track name meta event. */
  name?: string;
  /** Default [4, 4]. */
  timeSignature?: [number, number];
  /** Put the end-of-track at least here (e.g. the loop length) so DAWs loop it correctly. */
  endTick?: number;
}

export interface ParsedMidi {
  format: number;
  tracks: number;
  ppq: number;
  bpm?: number;
  name?: string;
  timeSignature?: [number, number];
  /** Ticks of the last end-of-track. */
  endTick: number;
  notes: Required<MidiNote>[];
}

// ---------------------------------------------------------------------------
// Transcription (pure)

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

interface PitchTrack {
  hop: number;
  win: number;
  /** Fractional MIDI note per frame, NaN when unpitched. Frame k is centred on k * hop. */
  midi: Float64Array;
  clarity: Float64Array;
}

function pitchTrack(pcm: Float32Array, sr: number, win: number, minClarity: number, minPitch: number, maxPitch: number): PitchTrack {
  const hop = Math.round(sr * 0.01);
  const n = Math.max(0, Math.floor(pcm.length / hop) + 1);
  const midi = new Float64Array(n).fill(NaN);
  const clarity = new Float64Array(n);
  const detector = PitchDetector.forFloat32Array(win);
  detector.minVolumeDecibels = -50;
  const frame = new Float32Array(win);
  for (let k = 0; k < n; k++) {
    const start = k * hop - win / 2;
    if (start < 0 || start + win > pcm.length) {
      // Edges: zero-pad so the first/last notes still get frames.
      frame.fill(0);
      for (let i = 0; i < win; i++) {
        const j = start + i;
        if (j >= 0 && j < pcm.length) frame[i] = pcm[j]!;
      }
    } else frame.set(pcm.subarray(start, start + win));
    const [hz, c] = detector.findPitch(frame, sr);
    clarity[k] = c;
    if (c >= minClarity && hz > 0) {
      const m = hzToMidi(hz);
      if (m >= minPitch - 0.5 && m <= maxPitch + 0.5) midi[k] = m;
    }
  }
  return { hop, win, midi, clarity };
}

/**
 * Monophonic transcription of decoded mono PCM. Notes start at energy onsets
 * or where the pitch moves by a semitone or more for 30 ms (legato), end at
 * silence or the next note, and take the median pitch of their pitched frames.
 */
export function transcribeMonophonic(pcm: Float32Array, sr: number, opts: TranscribeOptions = {}): Transcription {
  const minPitch = opts.minPitch ?? 28;
  const maxPitch = opts.maxPitch ?? 96;
  const minNote = opts.minNoteSec ?? 0.06;
  const minClarity = opts.minClarity ?? 0.8;
  const warnings: string[] = [];

  // Energy envelope: 5 ms hop, 20 ms RMS window.
  const eh = Math.max(1, Math.round(sr * 0.005));
  const ew = eh * 4;
  const env: number[] = [];
  for (let i = 0; i < pcm.length; i += eh) {
    let e = 0;
    const end = Math.min(pcm.length, i + ew);
    for (let j = i; j < end; j++) e += pcm[j]! * pcm[j]!;
    env.push(10 * Math.log10(e / Math.max(1, end - i) + 1e-12));
  }
  const peak = Math.max(-120, ...env);
  if (peak < -70) return { notes: [], pitchedRatio: 0, warnings: ["the audio is silent"] };
  const silentAt = (j: number) => env[j]! < Math.max(peak - 35, -65);

  // Window: 2048 @ 22.05 kHz for low lines (≤ C3), else 1024 for timing.
  const pow2 = (sec: number) => 2 ** Math.round(Math.log2(sr * sec));
  let track = pitchTrack(pcm, sr, pow2(0.046), minClarity, minPitch, maxPitch);
  const voiced = [...track.midi].filter((m) => !Number.isNaN(m));
  const lowLine = voiced.length > 0 && median(voiced) < 48;
  if (lowLine || voiced.length < 3) track = pitchTrack(pcm, sr, pow2(0.093), minClarity, minPitch, maxPitch);
  const ph = track.hop;
  const envAt = (sec: number) => Math.min(env.length - 1, Math.max(0, Math.round((sec * sr) / eh)));

  // Energy onsets (and the start of every sounding region).
  const onsets: number[] = [];
  let last = -Infinity;
  for (let j = 0; j < env.length; j++) {
    if (silentAt(j)) continue;
    const startsRegion = j === 0 || silentAt(j - 1);
    const prevMin = Math.min(...env.slice(Math.max(0, j - 4), j));
    const rise = j >= 1 && env[j]! - prevMin > 6 && env[j]! > peak - 30;
    if ((startsRegion || rise) && (j - last) * eh > sr * 0.05) {
      // Step back to where the rise begins.
      let k = j;
      while (k > 0 && !startsRegion && env[k - 1]! < env[k]! - 1 && j - k < 4) k--;
      // The 20 ms window looks ahead: the attack sits near its end.
      onsets.push(j === 0 ? 0 : round((k * eh + 0.75 * ew) / sr, 4));
      last = j;
    }
  }

  // Pitch-change points: rounded pitch held for 3 frames (30 ms) at a new value.
  const rounded = [...track.midi].map((m) => (Number.isNaN(m) ? NaN : Math.round(m)));
  const changes: number[] = [];
  let current = NaN;
  for (let k = 0; k < rounded.length; k++) {
    const v = rounded[k]!;
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(current)) {
      current = v;
      continue;
    }
    if (v !== current && rounded[k + 1] === v && rounded[k + 2] === v) {
      changes.push((k * ph) / sr);
      current = v;
    }
  }

  // Boundaries: onsets, plus pitch changes not near an onset.
  const bounds = [...onsets];
  for (const c of changes) if (!onsets.some((o) => Math.abs(o - c) < 0.06)) bounds.push(c);
  bounds.sort((a, b) => a - b);
  const totalSec = pcm.length / sr;

  const raw: (TranscribedNote & { level: number; hasOnset: boolean })[] = [];
  bounds.forEach((start, i) => {
    const next = bounds[i + 1] ?? totalSec;
    // End at the first silent envelope frame after the start, or the next boundary.
    let end = next;
    for (let j = envAt(start) + 2; j < env.length && (j * eh) / sr < next; j++) {
      if (silentAt(j)) {
        end = (j * eh) / sr;
        break;
      }
    }
    if (end - start < minNote) return;
    // Pitch frames inside the note, trimming the edges where windows straddle neighbours.
    const k0 = Math.ceil((start * sr) / ph);
    const k1 = Math.floor((end * sr) / ph);
    const span = k1 - k0 + 1;
    const trim = span >= 8 ? Math.floor(span * 0.2) : 0;
    const frames: number[] = [];
    const clar: number[] = [];
    for (let k = k0 + trim; k <= k1 - trim && k < track.midi.length; k++) {
      const m = track.midi[k]!;
      if (!Number.isNaN(m)) {
        frames.push(m);
        clar.push(track.clarity[k]!);
      }
    }
    const considered = Math.max(1, span - 2 * trim);
    if (frames.length < 2 || frames.length < considered * 0.4) return;
    const pitch = Math.round(median(frames));
    let level = -120;
    for (let j = envAt(start); j <= envAt(Math.min(end, start + 0.1)); j++) level = Math.max(level, env[j]!);
    raw.push({
      start,
      end,
      pitch,
      name: noteName(pitch),
      velocity: 0,
      confidence: Math.round((frames.length / considered) * (clar.reduce((s, c) => s + c, 0) / clar.length) * 100) / 100,
      level,
      hasOnset: onsets.includes(start),
    });
  });

  // Merge repeats split by a spurious pitch change (same pitch, no new attack, touching).
  const merged: typeof raw = [];
  for (const n of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.pitch === n.pitch && !n.hasOnset && n.start - prev.end < 0.02) {
      prev.end = n.end;
      prev.level = Math.max(prev.level, n.level);
    } else merged.push({ ...n });
  }

  const loudest = Math.max(-120, ...merged.map((n) => n.level));
  const notes: TranscribedNote[] = merged.map(({ level, hasOnset: _h, ...n }) => ({
    ...n,
    start: round(n.start, 4),
    end: round(n.end, 4),
    velocity: Math.max(1, Math.min(127, Math.round(127 + (level - loudest) * (97 / 30)))),
  }));

  // How much of the audible audio had one clear pitch.
  let audible = 0;
  let pitched = 0;
  for (let k = 0; k < track.midi.length; k++) {
    if (silentAt(envAt((k * ph) / sr))) continue;
    audible++;
    if (!Number.isNaN(track.midi[k]!)) pitched++;
  }
  const pitchedRatio = audible ? round(pitched / audible, 2) : 0;
  if (!notes.length) warnings.push("no clear monophonic notes found (chords, drums or noise?)");
  else if (pitchedRatio < 0.6) {
    warnings.push(`only ${Math.round(pitchedRatio * 100)}% of the audible audio has one clear pitch: this transcriber is monophonic, so chords, pads and drums are missed or simplified`);
  }
  return { notes, pitchedRatio, warnings };
}

// ---------------------------------------------------------------------------
// Standard MIDI File writer / reader (pure)

function vlq(n: number): number[] {
  let v = Math.max(0, Math.floor(n));
  const out = [v & 0x7f];
  v = Math.floor(v / 128);
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return out;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

/** A format-0 Standard MIDI File: track name, tempo, time signature, then the notes. */
export function writeMidi(notes: MidiNote[], opts: MidiWriteOptions = {}): Uint8Array {
  const ppq = opts.ppq ?? 480;
  const bpm = opts.bpm ?? 120;
  const [num, den] = opts.timeSignature ?? [4, 4];
  type Ev = { tick: number; order: number; bytes: number[] };
  const evs: Ev[] = [];
  if (opts.name) {
    const name = [...new TextEncoder().encode(opts.name.slice(0, 120))];
    evs.push({ tick: 0, order: -3, bytes: [0xff, 0x03, ...vlq(name.length), ...name] });
  }
  const usPerQuarter = Math.max(1, Math.min(0xffffff, Math.round(60_000_000 / bpm)));
  evs.push({ tick: 0, order: -2, bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff] });
  evs.push({ tick: 0, order: -1, bytes: [0xff, 0x58, 0x04, num & 0xff, Math.max(0, Math.round(Math.log2(den))), 24, 8] });
  let endTick = 0;
  for (const n of notes) {
    const ch = (n.channel ?? 0) & 0x0f;
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity)));
    const on = Math.max(0, Math.round(n.tick));
    const off = on + Math.max(1, Math.round(n.durationTicks));
    evs.push({ tick: on, order: 1, bytes: [0x90 | ch, pitch, vel] });
    evs.push({ tick: off, order: 0, bytes: [0x80 | ch, pitch, 0x40] });
    endTick = Math.max(endTick, off);
  }
  // Note-offs before note-ons at the same tick, so repeated notes re-trigger.
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order || (a.bytes[1] ?? 0) - (b.bytes[1] ?? 0));
  const track: number[] = [];
  let t = 0;
  for (const e of evs) {
    track.push(...vlq(e.tick - t), ...e.bytes);
    t = e.tick;
  }
  track.push(...vlq(Math.max(endTick, opts.endTick ?? 0) - t), 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(ppq & 0x7fff)];
  return Uint8Array.from([...header, 0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track]);
}

/** Read a Standard MIDI File (format 0/1, PPQ timing): notes, tempo, name. Throws on malformed input. */
export function parseMidi(bytes: Uint8Array): ParsedMidi {
  const ascii = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const be32 = (at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
  const be16 = (at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
  if (bytes.length < 14 || ascii(0) !== "MThd") throw new Error("not a MIDI file (no MThd)");
  const hlen = be32(4);
  const format = be16(8);
  const ntracks = be16(10);
  const division = be16(12);
  if (division & 0x8000) throw new Error("SMPTE time division is not supported");
  const out: ParsedMidi = { format, tracks: ntracks, ppq: division, endTick: 0, notes: [] };
  let pos = 8 + hlen;
  for (let tr = 0; tr < ntracks; tr++) {
    if (pos + 8 > bytes.length || ascii(pos) !== "MTrk") throw new Error(`track ${tr}: missing MTrk`);
    const len = be32(pos + 4);
    let p = pos + 8;
    const end = p + len;
    if (end > bytes.length) throw new Error(`track ${tr}: truncated`);
    const readVlq = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        const b = bytes[p++]!;
        v = v * 128 + (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
      throw new Error("bad variable-length quantity");
    };
    let tick = 0;
    let status = 0;
    const open = new Map<number, { tick: number; velocity: number }[]>();
    while (p < end) {
      tick += readVlq();
      let b = bytes[p]!;
      if (b & 0x80) {
        p++;
        if (b < 0xf0) status = b;
      } else {
        if (!status) throw new Error("running status without a status byte");
        b = status;
      }
      if (b === 0xff) {
        const type = bytes[p++]!;
        const l = readVlq();
        const data = bytes.subarray(p, p + l);
        p += l;
        if (type === 0x51 && l === 3 && out.bpm === undefined) out.bpm = Math.round((60_000_000 / ((data[0]! << 16) | (data[1]! << 8) | data[2]!)) * 1000) / 1000;
        else if (type === 0x03 && out.name === undefined) out.name = new TextDecoder().decode(data);
        else if (type === 0x58 && l >= 2 && !out.timeSignature) out.timeSignature = [data[0]!, 2 ** data[1]!];
        else if (type === 0x2f) {
          out.endTick = Math.max(out.endTick, tick);
          p = end;
        }
      } else if (b === 0xf0 || b === 0xf7) {
        p += readVlq();
      } else {
        const kind = b & 0xf0;
        const ch = b & 0x0f;
        const d1 = bytes[p++]!;
        const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[p++]!;
        const key = ch * 128 + d1;
        if (kind === 0x90 && d2 > 0) {
          const list = open.get(key) ?? [];
          list.push({ tick, velocity: d2 });
          open.set(key, list);
        } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
          const on = open.get(key)?.shift();
          if (on) out.notes.push({ tick: on.tick, durationTicks: tick - on.tick, pitch: d1, velocity: on.velocity, channel: ch });
        }
      }
    }
    pos = end;
  }
  out.notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  return out;
}

export interface NotesToMidiOptions extends MidiWriteOptions {
  /** Snap to this many steps per beat (4 = 16ths); false for none. Default 4 when `quantize` is not false. */
  quantize?: number | false;
  /** Length of the audio in seconds: the end-of-track goes at the end of its last bar. */
  durationSec?: number;
}

/** Seconds → ticks at `bpm`, optionally quantised; monophonic notes are kept from overlapping. */
export function notesToMidi(notes: Pick<TranscribedNote, "start" | "end" | "pitch" | "velocity">[], opts: NotesToMidiOptions = {}): { midi: Uint8Array; notes: MidiNote[] } {
  const ppq = opts.ppq ?? 480;
  const bpm = opts.bpm ?? 120;
  const tps = (bpm / 60) * ppq;
  const steps = opts.quantize === false ? 0 : (opts.quantize ?? 4);
  const grid = steps > 0 ? ppq / steps : 1;
  const snap = (sec: number) => Math.round((sec * tps) / grid) * grid;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const out: MidiNote[] = [];
  for (const n of sorted) {
    const tick = snap(n.start);
    let endTick = Math.max(tick + grid, snap(n.end));
    const prev = out[out.length - 1];
    if (prev && prev.tick === tick) continue; // two notes collapsed onto one step: keep the first
    if (prev && prev.tick + prev.durationTicks > tick) prev.durationTicks = Math.max(grid, tick - prev.tick);
    endTick = Math.max(endTick, tick + 1);
    out.push({ tick, durationTicks: endTick - tick, pitch: n.pitch, velocity: n.velocity });
  }
  let endTick = opts.endTick;
  if (endTick === undefined && opts.durationSec) {
    const bar = ppq * 4 * ((opts.timeSignature?.[0] ?? 4) / (opts.timeSignature?.[1] ?? 4));
    const t = opts.durationSec * tps;
    endTick = Math.abs(t / bar - Math.round(t / bar)) < 0.05 ? Math.round(t / bar) * bar : Math.round(t);
  }
  return { midi: writeMidi(out, { ...opts, ppq, bpm, endTick }), notes: out };
}

// ---------------------------------------------------------------------------
// Decoding + the one-call extraction

const ffmpegPath = () => process.env.FFMPEG_PATH || "ffmpeg";

/** Decode any audio file to mono float PCM with ffmpeg. */
export async function decodeMono(
  input: { path?: string; buffer?: Uint8Array },
  opts: { sampleRate?: number; maxSeconds?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const sr = opts.sampleRate ?? 22050;
  const maxSeconds = opts.maxSeconds ?? 120;
  let dir: string | undefined;
  let file = input.path;
  try {
    if (!file) {
      if (!input.buffer) throw new Error("decodeMono needs a path or a buffer");
      dir = await mkdtemp(join(tmpdir(), "sound-midi-"));
      file = join(dir, "input");
      await writeFile(file, input.buffer);
    }
    const args = ["-nostdin", "-hide_banner", "-nostats", "-v", "error", "-t", String(maxSeconds), "-i", file, "-vn", "-map", "0:a:0", "-af", `aresample=${sr},aformat=sample_fmts=flt:channel_layouts=mono`, "-f", "f32le", "pipe:1"];
    const stdout = await new Promise<Buffer>((resolve, reject) => {
      if (opts.signal?.aborted) return reject(opts.signal.reason ?? new Error("aborted"));
      const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const chunks: Buffer[] = [];
      let size = 0;
      const cap = Math.ceil(maxSeconds + 1) * sr * 4;
      let err = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
      const onAbort = () => child.kill("SIGKILL");
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (d: Buffer) => {
        if (size + d.length > cap) return void child.kill("SIGKILL");
        chunks.push(d);
        size += d.length;
      });
      child.stderr.on("data", (d: Buffer) => {
        if (err.length < 8000) err += d.toString("utf8");
      });
      child.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(e.code === "ENOENT" ? new ToolMissingError("ffmpeg") : e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        if (code !== 0 && size === 0) reject(new Error(`ffmpeg failed: ${err.trim().split("\n").pop() ?? code}`));
        else resolve(Buffer.concat(chunks));
      });
    });
    const usable = stdout.byteLength & ~3;
    return { pcm: new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + usable)), sampleRate: sr };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface ExtractMidiOptions extends TranscribeOptions {
  /** The loop's tempo when known (sample metadata). Otherwise estimated; quantisation needs a confident tempo. */
  bpm?: number;
  /** Steps per beat for quantisation (default 4 = 16ths); false to keep the played timing. */
  quantize?: number | false;
  ppq?: number;
  name?: string;
  timeSignature?: [number, number];
  /** Seconds decoded (default 120). */
  maxSeconds?: number;
  signal?: AbortSignal;
}

export interface MidiExtraction {
  /** Standard MIDI File bytes (format 0). */
  midi: Uint8Array;
  notes: (TranscribedNote & { tick: number; durationTicks: number })[];
  bpm: number;
  bpmSource: "given" | "analysis" | "default";
  quantized: boolean;
  durationSec: number;
  /** Always "monophonic": one note at a time. */
  mode: "monophonic";
  pitchedRatio: number;
  warnings: string[];
}

/** Audio file → monophonic notes → .mid bytes. Needs ffmpeg. */
export async function extractMidi(input: { path?: string; buffer?: Uint8Array }, opts: ExtractMidiOptions = {}): Promise<MidiExtraction> {
  const { pcm, sampleRate: sr } = await decodeMono(input, { maxSeconds: opts.maxSeconds, signal: opts.signal });
  const durationSec = pcm.length / sr;
  const t = transcribeMonophonic(pcm, sr, opts);
  const warnings = [...t.warnings];
  let bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : undefined;
  let bpmSource: MidiExtraction["bpmSource"] = bpm ? "given" : "default";
  let confident = !!bpm;
  let unsure: number | undefined;
  if (!bpm && durationSec >= 1.5 && countOnsets(pcm, sr) >= 4) {
    const est = estimateTempo(pcm, sr, durationSec);
    if (est && est.confidence >= 0.8) {
      bpm = est.bpm;
      bpmSource = "analysis";
      confident = true;
    } else if (est) unsure = est.bpm;
  }
  if (!bpm) bpm = 120;
  const quantized = opts.quantize !== false && confident;
  if (!confident) {
    warnings.push(`tempo ${unsure ? `estimate (${unsure} BPM) is unsure` : "unknown"}: written at 120 BPM with the played timing${opts.quantize !== false ? "; pass bpm to quantise" : ""}`);
  }
  const m = notesToMidi(t.notes, {
    bpm,
    ppq: opts.ppq,
    name: opts.name,
    timeSignature: opts.timeSignature,
    quantize: quantized ? (opts.quantize === undefined ? 4 : opts.quantize) : false,
    durationSec,
  });
  // Pair written notes back to the transcribed ones (collapsed duplicates are dropped).
  const notes: MidiExtraction["notes"] = [];
  const ppq = opts.ppq ?? 480;
  for (const n of t.notes) {
    const w = m.notes.find((x) => x.pitch === n.pitch && Math.abs(x.tick - (n.start * bpm * ppq) / 60) <= ppq / 2 && !notes.some((y) => y.tick === x.tick));
    if (w) notes.push({ ...n, tick: w.tick, durationTicks: w.durationTicks });
  }
  return { midi: m.midi, notes, bpm, bpmSource, quantized, durationSec: round(durationSec, 3), mode: "monophonic", pitchedRatio: t.pitchedRatio, warnings };
}

function round(n: number, d: number): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}
