import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWavChunks } from "../src/core/wavchunks.js";
import { acidChunk, aiffFile, bextChunk, clickLoop, infoChunk, sine, smplChunk, wavFile } from "./fixtures/audio/riff.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/audio/${name}`, import.meta.url));

describe("parseWavChunks", () => {
  it("reads fmt and data → duration from an ffmpeg-written WAV (with its LIST/INFO)", () => {
    const c = parseWavChunks(fixture("kick.wav"))!;
    expect(c.container).toBe("wav");
    expect(c.format).toMatchObject({ format: "pcm", formatTag: 1, channels: 1, sampleRate: 44100, bitDepth: 16, blockAlign: 2 });
    expect(c.frames).toBe(13230);
    expect(c.durationSec).toBeCloseTo(0.3, 4);
    expect(c.info?.software).toMatch(/^Lavf/);
    expect(c.chunks).toEqual(expect.arrayContaining(["fmt ", "LIST", "data"]));
    expect(c.truncated).toBe(false);
  });

  it("reads the ACID chunk of a loop: tempo, beats, meter, no one-shot bit", () => {
    const wav = wavFile({ pcm: clickLoop(120, 2), sampleRate: 22050, chunks: [acidChunk({ beats: 8, tempo: 120, meter: [4, 4] })] });
    const c = parseWavChunks(wav)!;
    expect(c.acid).toMatchObject({ oneShot: false, rootNoteSet: false, stretch: true, beats: 8, meterNumerator: 4, meterDenominator: 4, tempo: 120 });
    expect(c.durationSec).toBeCloseTo(4, 3);
  });

  it("reads the ACID one-shot flag and root note", () => {
    const c = parseWavChunks(wavFile({ pcm: sine(110, 0.2), chunks: [acidChunk({ oneShot: true, rootNote: 45, tempo: 0 })] }))!;
    expect(c.acid).toMatchObject({ oneShot: true, rootNoteSet: true, rootNote: 45, beats: 0 });
    expect(c.acid!.flags & 1).toBe(1);
  });

  it("reads the smpl chunk: unity note, pitch fraction, loops", () => {
    const c = parseWavChunks(fixture("smpl-c4.wav"))!;
    expect(c.smpl).toMatchObject({ midiUnityNote: 60, pitchFraction: 0, samplePeriod: Math.round(1e9 / 22050) });
    expect(c.smpl!.loops).toEqual([{ cueId: 0, type: "forward", start: 1000, end: 5000, playCount: 0 }]);

    const pp = parseWavChunks(wavFile({ pcm: sine(440, 0.1), chunks: [smplChunk({ unityNote: 69, pitchFraction: 0.5, loops: [{ start: 1, end: 9, type: 1 }, { start: 2, end: 3, type: 2 }] })] }))!;
    expect(pp.smpl!.midiUnityNote).toBe(69);
    expect(pp.smpl!.pitchFraction).toBeCloseTo(0.5, 3);
    expect(pp.smpl!.loops.map((l) => l.type)).toEqual(["pingpong", "reverse"]);
  });

  it("reads LIST/INFO tags and the bext description, also when they come after the data", () => {
    const wav = wavFile({
      pcm: sine(440, 0.05),
      chunks: [bextChunk({ description: "Snare 04 tight", originator: "PackMaker" })],
      after: [infoChunk({ INAM: "Dusty Snare", IART: "Jane Doe", ICMT: "92 bpm, made in 2026", IGNR: "Lo-fi", IKEY: "snare; dusty" })],
    });
    const c = parseWavChunks(wav)!;
    expect(c.info).toMatchObject({
      title: "Dusty Snare",
      artist: "Jane Doe",
      comment: "92 bpm, made in 2026",
      genre: "Lo-fi",
      keywords: "snare; dusty",
      description: "Snare 04 tight",
      originator: "PackMaker",
    });
    expect(c.info!.raw.INAM).toBe("Dusty Snare");
  });

  it("works on a header-only prefix: the data size comes from the chunk header", () => {
    const wav = wavFile({ pcm: sine(440, 2, 44100), sampleRate: 44100, bitDepth: 24, chunks: [acidChunk({ beats: 4, tempo: 120 })] });
    const c = parseWavChunks(wav.subarray(0, 200))!;
    expect(c.format).toMatchObject({ bitDepth: 24, sampleRate: 44100, blockAlign: 3 });
    expect(c.durationSec).toBeCloseTo(2, 3);
    expect(c.acid?.tempo).toBe(120);
    expect(c.truncated).toBe(true);
  });

  it("handles 32-bit float, stereo and WAVE_FORMAT_EXTENSIBLE", () => {
    const f = parseWavChunks(wavFile({ pcm: new Float32Array(200), channels: 2, float: true, sampleRate: 48000 }))!;
    expect(f.format).toMatchObject({ format: "float", channels: 2, bitDepth: 32, sampleRate: 48000 });
    expect(f.frames).toBe(100);

    const ext = wavFile({ pcm: new Float32Array(100), sampleRate: 48000, bitDepth: 24 });
    // Rewrite the fmt chunk as WAVE_FORMAT_EXTENSIBLE (tag 0xFFFE, sub-format PCM) by hand.
    const fmt = new Uint8Array(40);
    const dv = new DataView(fmt.buffer);
    dv.setUint16(0, 0xfffe, true);
    dv.setUint16(2, 1, true);
    dv.setUint32(4, 48000, true);
    dv.setUint32(8, 144000, true);
    dv.setUint16(12, 3, true);
    dv.setUint16(14, 24, true);
    dv.setUint16(16, 22, true);
    dv.setUint16(24, 1, true);
    const head = ext.subarray(0, 12);
    const data = ext.subarray(12 + 8 + 16);
    const chunk = new Uint8Array(8 + 40);
    chunk.set(new TextEncoder().encode("fmt "), 0);
    new DataView(chunk.buffer).setUint32(4, 40, true);
    chunk.set(fmt, 8);
    const rebuilt = new Uint8Array([...head, ...chunk, ...data]);
    const e = parseWavChunks(rebuilt)!;
    expect(e.format).toMatchObject({ formatTag: 1, format: "pcm", bitDepth: 24, sampleRate: 48000 });
    expect(e.frames).toBe(100);
    expect(e.durationSec).toBeCloseTo(100 / 48000, 4);
  });

  it("reads AIFF COMM (80-bit sample rate), NAME and INST base note", () => {
    const c = parseWavChunks(aiffFile({ pcm: sine(440, 0.5, 44100), sampleRate: 44100, name: "Pluck C3", baseNote: 48 }))!;
    expect(c.container).toBe("aiff");
    expect(c.format).toMatchObject({ channels: 1, sampleRate: 44100, bitDepth: 16, format: "pcm" });
    expect(c.frames).toBe(22050);
    expect(c.durationSec).toBeCloseTo(0.5, 4);
    expect(c.info?.title).toBe("Pluck C3");
    expect(c.baseNote).toBe(48);
    const hi = parseWavChunks(aiffFile({ pcm: new Float32Array(96), sampleRate: 96000 }))!;
    expect(hi.format?.sampleRate).toBe(96000);
  });

  it("returns undefined for non-RIFF data and short buffers", () => {
    expect(parseWavChunks(new Uint8Array(4))).toBeUndefined();
    expect(parseWavChunks(fixture("tone-a4.mp3"))).toBeUndefined();
    expect(parseWavChunks(new TextEncoder().encode("RIFF\0\0\0\0AVI LIST"))).toBeUndefined();
  });

  it("does not throw on corrupt chunk sizes", () => {
    const wav = wavFile({ pcm: sine(440, 0.01), chunks: [acidChunk({ tempo: 100 })] });
    const bad = wav.slice();
    new DataView(bad.buffer).setUint32(12 + 4, 0xfffffff0, true); // fmt size way too large
    expect(() => parseWavChunks(bad)).not.toThrow();
    expect(parseWavChunks(bad)!.truncated).toBe(true);
  });
});
