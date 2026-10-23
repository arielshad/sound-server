/**
 * Test helper: write a tiny multisample pack (short harmonic tones at known
 * pitches) into a folder, plus a melody for MIDI extraction. Generated at test
 * time so no binaries are committed. WAVs are written in TS (riff.ts); OGGs
 * need ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { smplChunk, wavFile, type Chunk } from "../audio/riff.js";

export const SR = 22050;
export const hasFfmpeg = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"]).status === 0;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A short decaying harmonic tone (fundamental dominant). */
export function tone(midi: number, sec = 0.4, amp = 0.5): Float32Array {
  const f = hz(midi);
  const out = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 2);
    out[i] = amp * env * (0.75 * Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(4 * Math.PI * f * t) + 0.05 * Math.sin(6 * Math.PI * f * t));
  }
  return out;
}

export function writeTone(path: string, midi: number, opts: { chunks?: Chunk[]; after?: Chunk[]; sec?: number } = {}): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, wavFile({ pcm: tone(midi, opts.sec), sampleRate: SR, chunks: opts.chunks, after: opts.after }));
}

/** Encode a tone with ffmpeg (format from the extension). */
export function writeEncodedTone(path: string, midi: number, sec = 0.6): void {
  mkdirSync(dirname(path), { recursive: true });
  const r = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", `sine=f=${hz(midi)}:d=${sec}:r=${SR}`, "-af", "volume=0.5", "-ac", "1", path]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

/**
 * The "Keys" pack:
 * - pp and ff layers on C3, E3, G3, C4 (C3 pp has two round robins, rr1/rr2)
 * - Keys_loop_ff.wav: no note in the name, smpl unity E5 (76) with a loop 1000–5000, chunk after `data`
 * - Keys_mystery_ff.ogg: no note anywhere; A4 tone for pitch detection (only with ffmpeg)
 * - Keys_C4B4_ff.wav: an Iowa-style run of notes (skipped)
 * - notes.txt: not audio
 */
export function writeKeysPack(dir: string, opts: { withOgg?: boolean } = {}): void {
  for (const [name, midi] of [["C3", 48], ["E3", 52], ["G3", 55], ["C4", 60]] as const) {
    for (const layer of ["pp", "ff"]) {
      if (name === "C3" && layer === "pp") {
        writeTone(join(dir, `Keys_${name}_${layer}_rr1.wav`), midi);
        writeTone(join(dir, `Keys_${name}_${layer}_rr2.wav`), midi);
      } else writeTone(join(dir, `Keys_${name}_${layer}.wav`), midi);
    }
  }
  writeTone(join(dir, "Keys_loop_ff.wav"), 76, { after: [smplChunk({ unityNote: 76, sampleRate: SR, loops: [{ start: 1000, end: 5000 }] })] });
  writeTone(join(dir, "Keys_C4B4_ff.wav"), 60);
  writeFileSync(join(dir, "notes.txt"), "not audio");
  if (opts.withOgg) writeEncodedTone(join(dir, "Keys_mystery_ff.ogg"), 69);
}

/** Notes for a melody: start/duration in seconds, MIDI pitch, amplitude. */
export interface MelodyNote {
  midi: number;
  start: number;
  dur: number;
  amp: number;
}

/** Render a melody (harmonic tones; `legato` keeps the phase and skips gaps). */
export function melody(notes: MelodyNote[], totalSec: number, legato = false): Float32Array {
  const out = new Float32Array(Math.round(totalSec * SR));
  let phase = 0;
  for (const n of notes) {
    const f = hz(n.midi);
    const a = Math.round(n.start * SR);
    const b = Math.round((n.start + n.dur) * SR);
    if (!legato) phase = 0;
    for (let i = a; i < b && i < out.length; i++) {
      const env = Math.min(1, (i - a) / SR / 0.005, legato ? 1 : (b - i) / SR / 0.01);
      phase += (2 * Math.PI * f) / SR;
      out[i] = n.amp * env * (0.7 * Math.sin(phase) + 0.2 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase));
    }
  }
  return out;
}

/** C4–E4–G4–C5 quarter notes at 120 BPM (0.45 s each, 0.05 s gaps), velocities loud–soft–mid–loud. */
export const CEGC: MelodyNote[] = [60, 64, 67, 72].map((midi, i) => ({ midi, start: i * 0.5, dur: 0.45, amp: [0.8, 0.4, 0.6, 0.8][i]! }));

/** Write the CEGC melody with ffmpeg's aevalsrc (sine tones), encoded by extension. */
export function writeMelodyWithFfmpeg(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const expr = CEGC.map((n) => `${n.amp}*between(t,${n.start},${n.start + n.dur})*sin(2*PI*${hz(n.midi).toFixed(3)}*(t-${n.start}))`).join("+");
  const r = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${expr}':s=${SR}:d=2`, "-ac", "1", path]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}
