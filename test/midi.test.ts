import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { extractMidi, notesToMidi, parseMidi, transcribeMonophonic, writeMidi } from "../src/core/midi.js";
import { CEGC, hasFfmpeg, melody, SR, writeMelodyWithFfmpeg } from "./fixtures/instrument/make.js";

const tmp = mkdtempSync(join(tmpdir(), "midi-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const audioFixture = (name: string) => fileURLToPath(new URL(`./fixtures/audio/${name}`, import.meta.url));

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("writeMidi", () => {
  it("writes a format-0 file with PPQ 480, tempo, time signature and note events", () => {
    const bytes = writeMidi(
      [
        { tick: 0, durationTicks: 480, pitch: 60, velocity: 100 },
        { tick: 480, durationTicks: 240, pitch: 64, velocity: 80 },
      ],
      { bpm: 120, name: "riff" },
    );
    // MThd, length 6, format 0, 1 track, 480 ticks per quarter.
    expect(hex(bytes.subarray(0, 14))).toBe("4d 54 68 64 00 00 00 06 00 00 00 01 01 e0");
    expect(hex(bytes.subarray(14, 18))).toBe("4d 54 72 6b");
    const trackLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(18);
    expect(bytes.length).toBe(22 + trackLen);
    const track = hex(bytes.subarray(22));
    expect(track.startsWith("00 ff 03 04 72 69 66 66")).toBe(true); // track name "riff"
    expect(track).toContain("00 ff 51 03 07 a1 20"); // 500 000 µs per quarter = 120 BPM
    expect(track).toContain("00 ff 58 04 04 02 18 08"); // 4/4
    expect(track).toContain("00 90 3c 64"); // note on C4 vel 100 at 0
    expect(track).toContain("83 60 80 3c 40 00 90 40 50"); // delta 480 (VLQ 83 60): C4 off, then E4 on in the same tick
    expect(track.endsWith("ff 2f 00")).toBe(true);
  });

  it("round-trips through parseMidi, and pads the end of track", () => {
    const notes = [
      { tick: 0, durationTicks: 120, pitch: 36, velocity: 127 },
      { tick: 120, durationTicks: 120, pitch: 36, velocity: 64 },
      { tick: 960, durationTicks: 480, pitch: 43, velocity: 90, channel: 1 },
    ];
    const p = parseMidi(writeMidi(notes, { bpm: 93.5, ppq: 96, endTick: 3840, timeSignature: [3, 4] }));
    expect(p).toMatchObject({ format: 0, tracks: 1, ppq: 96, bpm: 93.5, timeSignature: [3, 4], endTick: 3840 });
    expect(p.notes).toEqual(notes.map((n) => ({ channel: 0, ...n })));
  });

  it("parseMidi handles running status, note-on velocity 0 and format 1", () => {
    // Format 1, two tracks; the second uses running status and note-on vel 0 as note-off.
    const bytes = Uint8Array.from([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0, 96,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 11, 0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0, 0, 0xff, 0x2f, 0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 17, 0, 0x91, 67, 90, 48, 67, 0, 0, 69, 70, 48, 69, 0, 0, 0xff, 0x2f, 0,
    ]);
    const p = parseMidi(bytes);
    expect(p).toMatchObject({ format: 1, tracks: 2, ppq: 96, bpm: 100, endTick: 96 });
    expect(p.notes).toEqual([
      { tick: 0, durationTicks: 48, pitch: 67, velocity: 90, channel: 1 },
      { tick: 48, durationTicks: 48, pitch: 69, velocity: 70, channel: 1 },
    ]);
    expect(() => parseMidi(Uint8Array.from([1, 2, 3]))).toThrow(/not a MIDI file/);
  });
});

describe("notesToMidi", () => {
  it("quantises seconds to the 16th grid at the given tempo and keeps monophonic notes apart", () => {
    const { notes, midi } = notesToMidi(
      [
        { start: 0.01, end: 0.4, pitch: 60, velocity: 100 }, // runs into the next note: cut at 0.25 s
        { start: 0.24, end: 0.52, pitch: 62, velocity: 90 },
        { start: 0.74, end: 0.8, pitch: 64, velocity: 80 }, // shorter than a step: one 16th
      ],
      { bpm: 120, durationSec: 2 },
    );
    expect(notes.map((n) => [n.tick, n.durationTicks, n.pitch])).toEqual([
      [0, 240, 60],
      [240, 240, 62],
      [720, 120, 64],
    ]);
    expect(parseMidi(midi).endTick).toBe(1920); // one 4/4 bar at 120 BPM
  });

  it("keeps the played timing without quantisation", () => {
    const { notes } = notesToMidi([{ start: 0.1, end: 0.35, pitch: 60, velocity: 100 }], { bpm: 120, quantize: false });
    expect(notes[0]).toMatchObject({ tick: 96, durationTicks: 240 });
  });
});

describe("transcribeMonophonic", () => {
  it("finds C4–E4–G4–C5 with onsets, ends and relative velocities", () => {
    const t = transcribeMonophonic(melody(CEGC, 2), SR);
    expect(t.notes.map((n) => n.pitch)).toEqual([60, 64, 67, 72]);
    expect(t.notes.map((n) => n.name)).toEqual(["C4", "E4", "G4", "C5"]);
    t.notes.forEach((n, i) => {
      expect(Math.abs(n.start - CEGC[i]!.start)).toBeLessThan(0.02);
      expect(Math.abs(n.end - (CEGC[i]!.start + CEGC[i]!.dur))).toBeLessThan(0.03);
      expect(n.confidence).toBeGreaterThan(0.8);
    });
    const [c4, e4, g4, c5] = t.notes.map((n) => n.velocity);
    expect(c4).toBe(127);
    expect(c5).toBe(127);
    expect(e4!).toBeLessThan(g4!);
    expect(g4!).toBeLessThan(c4!);
    expect(t.warnings).toEqual([]);
  });

  it("splits legato notes at pitch changes", () => {
    const line = [48, 50, 52, 55].map((midi, i) => ({ midi, start: i * 0.25, dur: 0.25, amp: 0.6 }));
    const t = transcribeMonophonic(melody(line, 1.1, true), SR);
    expect(t.notes.map((n) => n.pitch)).toEqual([48, 50, 52, 55]);
    t.notes.forEach((n, i) => expect(Math.abs(n.start - i * 0.25)).toBeLessThan(0.04));
  });

  it("follows a low bass line (A1–C2–E2–G1)", () => {
    const line = [33, 36, 40, 31].map((midi, i) => ({ midi, start: i * 0.5, dur: 0.4, amp: 0.7 }));
    const t = transcribeMonophonic(melody(line, 2), SR);
    expect(t.notes.map((n) => n.name)).toEqual(["A1", "C2", "E2", "G1"]);
  });

  it("returns nothing for silence", () => {
    const t = transcribeMonophonic(new Float32Array(SR), SR);
    expect(t.notes).toEqual([]);
    expect(t.warnings).toEqual(["the audio is silent"]);
  });
});

describe.skipIf(!hasFfmpeg)("extractMidi (ffmpeg)", () => {
  const mel = join(tmp, "cegc.ogg");

  it("audio → notes → .mid on the 120 BPM grid", async () => {
    writeMelodyWithFfmpeg(mel);
    const r = await extractMidi({ path: mel }, { bpm: 120, name: "cegc" });
    expect(r).toMatchObject({ bpm: 120, bpmSource: "given", quantized: true, mode: "monophonic", warnings: [] });
    expect(r.durationSec).toBeCloseTo(2, 1);
    expect(r.notes.map((n) => [n.name, n.tick, n.durationTicks])).toEqual([
      ["C4", 0, 480],
      ["E4", 480, 480],
      ["G4", 960, 480],
      ["C5", 1440, 480],
    ]);
    const p = parseMidi(r.midi);
    expect(p).toMatchObject({ format: 0, tracks: 1, ppq: 480, bpm: 120, name: "cegc", endTick: 1920 });
    expect(p.notes.map((n) => [n.tick, n.durationTicks, n.pitch])).toEqual([
      [0, 480, 60],
      [480, 480, 64],
      [960, 480, 67],
      [1440, 480, 72],
    ]);
    expect(p.notes[1]!.velocity).toBeLessThan(p.notes[2]!.velocity);
  });

  it("keeps the played timing when the tempo is unknown, from a buffer", async () => {
    const { readFileSync } = await import("node:fs");
    const r = await extractMidi({ buffer: readFileSync(audioFixture("tone-a4.mp3")) });
    expect(r.notes.map((n) => n.name)).toEqual(["A4"]);
    expect(r.quantized).toBe(false);
    expect(r.bpm).toBe(120);
    expect(r.warnings.join("\n")).toMatch(/tempo unknown/);
  });

  it("warns that chords are beyond a monophonic transcriber", async () => {
    const r = await extractMidi({ path: audioFixture("chord-fminor.ogg") });
    expect(r.pitchedRatio).toBeLessThan(0.6);
    expect(r.warnings.join("\n")).toMatch(/monophonic/);
  });
});
