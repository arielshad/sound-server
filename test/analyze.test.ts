import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analyzeAudio,
  analyzeSample,
  clearAnalysisCache,
  computePeaks,
  countOnsets,
  enrichSample,
  keyFromChroma,
  midiName,
  parseEbur128,
  pickAnalysisFile,
  waveformPeaks,
  type AudioAnalysis,
} from "../src/core/analyze.js";
import type { HttpClient, HttpRequestInit, SampleDetails } from "../src/core/types.js";
import { acidChunk, clickLoop, infoChunk, sine, wavFile } from "./fixtures/audio/riff.js";

const path = (name: string) => fileURLToPath(new URL(`./fixtures/audio/${name}`, import.meta.url));
const hasFfmpeg = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"]).status === 0;
const ff = describe.skipIf(!hasFfmpeg);

/** ffmpeg's own EBU R128 integrated loudness, for comparison. */
function referenceLufs(file: string): number {
  const r = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/I:\s*(-?[\d.]+) LUFS/.exec(r.stderr.slice(r.stderr.lastIndexOf("Summary:")))![1]);
}

/** A fake HttpClient serving bytes, honouring Range, and counting calls. */
function fakeHttp(files: Record<string, Uint8Array>): HttpClient & { calls: { url: string; init?: HttpRequestInit }[] } {
  const calls: { url: string; init?: HttpRequestInit }[] = [];
  return {
    calls,
    async raw(url, init) {
      calls.push({ url, init });
      const body = files[url];
      if (!body) throw new Error(`HTTP 404 for ${url}`);
      const m = /bytes=(\d+)-(\d+)/.exec(init?.headers?.range ?? "");
      if (m) {
        const end = Math.min(Number(m[2]), body.length - 1);
        return new Response(body.slice(Number(m[1]), end + 1), {
          status: 206,
          headers: { "content-range": `bytes ${m[1]}-${end}/${body.length}`, "content-length": String(end + 1 - Number(m[1])) },
        });
      }
      return new Response(body.slice(), { status: 200, headers: { "content-length": String(body.length) } });
    },
    async json() {
      throw new Error("not used");
    },
    async text() {
      throw new Error("not used");
    },
  };
}

beforeEach(() => clearAnalysisCache());

ff("analyzeAudio (deep) on fixtures", () => {
  it("kick.wav: header facts, one-shot, sample-accurate silence, tuned root, no BPM", async () => {
    const a = await analyzeAudio({ path: path("kick.wav") }, { deep: true });
    expect(a).toMatchObject({ format: "wav", codec: "pcm_s16le", sampleRate: 44100, bitDepth: 16, channels: 1, durationSec: 0.3, form: "one-shot" });
    expect(a.source).toMatchObject({ durationSec: "chunk", sampleRate: "chunk", bitDepth: "chunk", peakDb: "analysis", form: "analysis" });
    expect(a.silenceStartSec).toBeCloseTo(0.03, 2);
    expect(a.silenceEndSec).toBeGreaterThanOrEqual(0.045);
    expect(a.silenceEndSec).toBeLessThan(0.08);
    expect(a.bpm).toBeUndefined();
    expect(a.loudnessLufs).toBeUndefined(); // < 0.4 s: ebur128 cannot gate it
    expect(a.peakDb).toBeGreaterThan(-3);
    expect(a.peakDb).toBeLessThan(0.5);
    expect(a.rootNote).toBe(33); // 55 Hz = A1
    expect(a.rootNoteName).toBe("A1");
    expect(a.onsets).toBe(1);
    expect(a.warnings).toEqual([]);
  });

  it("tone-a4.mp3: root note 69 (A4) via pitchy, ffprobe facts, loudness = ffmpeg ebur128", async () => {
    const a = await analyzeAudio({ path: path("tone-a4.mp3") }, { deep: true });
    expect(a.rootNote).toBe(69);
    expect(a.rootNoteName).toBe("A4");
    expect(a.rootNoteHz).toBeCloseTo(440, 0);
    expect(a.rootNoteConfidence).toBeGreaterThan(0.8);
    expect(a.source.rootNote).toBe("analysis");
    expect(a).toMatchObject({ format: "mp3", codec: "mp3", sampleRate: 22050, channels: 1, form: "one-shot" });
    expect(a.source.codec).toBe("ffprobe");
    expect(a.bitDepth).toBeUndefined(); // lossy
    expect(Math.abs(a.loudnessLufs! - referenceLufs(path("tone-a4.mp3")))).toBeLessThanOrEqual(1);
    expect(a.key).toBeUndefined();
  });

  it("loop120.ogg: 120 BPM ±1, 2 bars, loop form, loudness = ffmpeg ebur128", async () => {
    const a = await analyzeAudio({ path: path("loop120.ogg") }, { deep: true });
    expect(Math.abs(a.bpm! - 120)).toBeLessThanOrEqual(1);
    expect(a.bpmConfidence).toBeGreaterThanOrEqual(0.8);
    expect(a.source.bpm).toBe("analysis");
    expect(a.bars).toBe(2);
    expect(a.beats).toBe(8);
    expect(a.form).toBe("loop");
    expect(a.onsets).toBeGreaterThanOrEqual(8);
    expect(a.durationSec).toBeCloseTo(4, 2);
    expect(Math.abs(a.loudnessLufs! - referenceLufs(path("loop120.ogg")))).toBeLessThanOrEqual(1);
  });

  it("chord-fminor.ogg: key F minor from chroma + Krumhansl-Schmuckler", async () => {
    const a = await analyzeAudio({ path: path("chord-fminor.ogg") }, { deep: true });
    expect(a.key).toEqual({ tonic: "F", mode: "minor" });
    expect(a.keyConfidence).toBeGreaterThan(0.5);
    expect(a.source.key).toBe("analysis");
    expect(Math.abs(a.loudnessLufs! - referenceLufs(path("chord-fminor.ogg")))).toBeLessThanOrEqual(1);
  });

  it("smpl-c4.wav: root note 60 and loop points from the smpl chunk", async () => {
    const a = await analyzeAudio({ path: path("smpl-c4.wav") }, { deep: true });
    expect(a.rootNote).toBe(60);
    expect(a.rootNoteName).toBe("C4");
    expect(a.source.rootNote).toBe("chunk");
    expect(a.loopPoints).toEqual([{ startFrame: 1000, endFrame: 5000, startSec: 0.0454, endSec: 0.2268, type: "forward" }]);
    expect(a.smpl?.midiUnityNote).toBe(60);
  });

  it("ACID loop in a buffer: tempo, beats and loop form come from the chunk", async () => {
    const wav = wavFile({
      pcm: clickLoop(120, 2),
      sampleRate: 22050,
      chunks: [acidChunk({ beats: 8, tempo: 120 }), infoChunk({ INAM: "Trap Loop 120", IGNR: "Trap" })],
    });
    const a = await analyzeAudio({ buffer: wav }, { deep: true });
    expect(a).toMatchObject({ bpm: 120, bpmConfidence: 1, beats: 8, bars: 2, form: "loop", formConfidence: 1 });
    expect(a.source).toMatchObject({ bpm: "chunk", beats: "chunk", form: "chunk", info: "chunk" });
    expect(a.info).toMatchObject({ title: "Trap Loop 120", genre: "Trap" });
    expect(a.acid?.oneShot).toBe(false);
  });

  it("respects the ACID one-shot flag even on a loop-like signal: no BPM", async () => {
    const wav = wavFile({ pcm: clickLoop(120, 2), sampleRate: 22050, chunks: [acidChunk({ oneShot: true, tempo: 120, beats: 8 })] });
    const a = await analyzeAudio({ buffer: wav }, { deep: true });
    expect(a.form).toBe("one-shot");
    expect(a.source.form).toBe("chunk");
    expect(a.bpm).toBeUndefined();
    expect(a.beats).toBeUndefined();
    expect(a.onsets).toBeGreaterThanOrEqual(8);
  });

  it("without deep: header + ffprobe only, no signal analysis", async () => {
    const a = await analyzeAudio({ path: path("loop120.ogg") });
    expect(a.deep).toBe(false);
    expect(a).toMatchObject({ format: "ogg", codec: "vorbis", sampleRate: 22050, channels: 1 });
    expect(a.durationSec).toBeCloseTo(4, 2);
    expect(a.bpm).toBeUndefined();
    expect(a.loudnessLufs).toBeUndefined();
    expect(a.onsets).toBeUndefined();
  });

  it("reads BPM and key tags through ffprobe", async () => {
    const out = `${tmpdir()}/tagged-${process.pid}.mp3`;
    spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", path("tone-a4.mp3"), "-c", "copy", "-metadata", "TBPM=128", "-metadata", "TKEY=Am", out]);
    const a = await analyzeAudio({ path: out }, { cache: false }).finally(() => rmSync(out, { force: true }));
    expect(a.bpm).toBe(128);
    expect(a.source.bpm).toBe("ffprobe");
    expect(a.key).toEqual({ tonic: "A", mode: "minor" });
    expect(a.tags?.tbpm).toBe("128");
  });

  it("analyses a 3 s sample in well under a second", async () => {
    const t0 = performance.now();
    const a = await analyzeAudio({ path: path("chord-fminor.ogg") }, { deep: true, cache: false });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(a.tookMs).toBeGreaterThan(0);
  });
});

ff("analyzeAudio with URLs", () => {
  const wav = wavFile({ pcm: clickLoop(120, 2), sampleRate: 22050, chunks: [acidChunk({ beats: 8, tempo: 120 })] });
  const big = wavFile({ pcm: sine(220, 20, 22050), sampleRate: 22050 }); // ~880 KB

  it("fetches only the head (Range) when not deep and still gets the exact duration", async () => {
    const http = fakeHttp({ "https://cdn.example/big.wav": big });
    const a = await analyzeAudio({ url: "https://cdn.example/big.wav", headers: { referer: "https://example.com/" } }, { http });
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]!.init?.headers).toMatchObject({ range: "bytes=0-524287", referer: "https://example.com/" });
    expect(http.calls[0]!.init?.idleTimeoutMs).toBeGreaterThan(0);
    expect(a.partial).toBe(true);
    expect(a.durationSec).toBeCloseTo(20, 2);
    expect(a.source.durationSec).toBe("chunk");
  });

  it("downloads the whole file for deep analysis, caps it at maxBytes and cleans up temp files", async () => {
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith("sound-analyze-")).length;
    const http = fakeHttp({ "https://cdn.example/loop.wav": wav, "https://cdn.example/big.wav": big });
    const a = await analyzeAudio({ url: "https://cdn.example/loop.wav" }, { http, deep: true });
    expect(http.calls[0]!.init?.headers?.range).toBeUndefined();
    expect(a.bpm).toBe(120);
    expect(a.partial).toBeUndefined();
    const capped = await analyzeAudio({ url: "https://cdn.example/big.wav" }, { http, deep: true, maxBytes: 100_000 });
    expect(capped.partial).toBe(true);
    expect(capped.durationSec).toBeCloseTo(20, 2); // from the header
    expect(capped.rootNote).toBe(57); // the ~2 s that were decoded are a steady 220 Hz tone (A3)
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith("sound-analyze-")).length).toBe(before);
  });

  it("caches by URL: a repeated call does not fetch or analyse again; deep results answer shallow calls", async () => {
    const http = fakeHttp({ "https://cdn.example/loop.wav": wav });
    const first = await analyzeAudio({ url: "https://cdn.example/loop.wav" }, { http, deep: true });
    const again = await analyzeAudio({ url: "https://cdn.example/loop.wav" }, { http, deep: true });
    const shallow = await analyzeAudio({ url: "https://cdn.example/loop.wav" }, { http });
    expect(http.calls).toHaveLength(1);
    expect(first.cached).toBeUndefined();
    expect(again.cached).toBe(true);
    expect(shallow).toMatchObject({ cached: true, deep: true, bpm: 120 });
    const [x, y] = await Promise.all([
      analyzeAudio({ url: "https://cdn.example/loop.wav" }, { http, cache: false }),
      analyzeAudio({ url: "https://cdn.example/loop.wav" }, { http, cache: false }),
    ]);
    expect(x.durationSec).toBe(y.durationSec);
  });

  it("propagates HTTP errors and honours an aborted signal", async () => {
    const http = fakeHttp({});
    await expect(analyzeAudio({ url: "https://cdn.example/missing.wav" }, { http })).rejects.toThrow(/404/);
    const ctrl = new AbortController();
    ctrl.abort(new Error("stop"));
    await expect(analyzeAudio({ path: path("loop120.ogg") }, { deep: true, signal: ctrl.signal, cache: false })).rejects.toThrow(/stop/);
  });
});

describe("analyzeAudio without ffmpeg", () => {
  const saved = { ffmpeg: process.env.FFMPEG_PATH, ffprobe: process.env.FFPROBE_PATH };
  beforeEach(() => {
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
    process.env.FFPROBE_PATH = "/nonexistent/ffprobe";
  });
  afterEach(() => {
    if (saved.ffmpeg === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = saved.ffmpeg;
    if (saved.ffprobe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = saved.ffprobe;
  });

  it("returns what the chunk parser found, with warnings", async () => {
    const wav = wavFile({ pcm: clickLoop(100, 1), sampleRate: 22050, chunks: [acidChunk({ beats: 4, tempo: 100 })] });
    const a = await analyzeAudio({ buffer: wav }, { deep: true });
    expect(a).toMatchObject({ format: "wav", sampleRate: 22050, bitDepth: 16, bpm: 100, form: "loop" });
    expect(a.durationSec).toBeCloseTo(2.4, 2);
    expect(a.warnings.join(" ")).toMatch(/ffprobe not found/);
    expect(a.warnings.join(" ")).toMatch(/ffmpeg not found/);
    expect(a.loudnessLufs).toBeUndefined();
  });

  it("an mp3 without ffprobe yields only warnings", async () => {
    const a = await analyzeAudio({ buffer: readFileSync(path("tone-a4.mp3")) });
    expect(a.durationSec).toBeUndefined();
    expect(a.warnings.length).toBeGreaterThan(0);
  });
});

ff("waveformPeaks", () => {
  it("returns normalised min/max pairs and the duration", async () => {
    const w = await waveformPeaks({ path: path("kick.wav") }, { points: 100 });
    expect(w.points).toBe(100);
    expect(w.peaks).toHaveLength(200);
    expect(w.durationSec).toBeCloseTo(0.3, 2);
    expect(Math.max(...w.peaks.map(Math.abs))).toBe(1);
    expect(w.peaks.every((v) => v >= -1 && v <= 1)).toBe(true);
    // First 30 ms are silent: the first bucket (3 ms) is flat.
    expect(w.peaks[0]).toBe(0);
    expect(w.peaks[1]).toBe(0);
    // min ≤ max in every pair
    for (let i = 0; i < w.peaks.length; i += 2) expect(w.peaks[i]!).toBeLessThanOrEqual(w.peaks[i + 1]!);
    const again = await waveformPeaks({ path: path("kick.wav") }, { points: 100 });
    expect(again).toBe(w); // cached
  });

  it("works from a URL", async () => {
    const http = fakeHttp({ "https://cdn.example/loop.ogg": readFileSync(path("loop120.ogg")) });
    const w = await waveformPeaks({ url: "https://cdn.example/loop.ogg" }, { http, points: 800 });
    expect(w.peaks).toHaveLength(1600);
    expect(w.durationSec).toBeCloseTo(4, 1);
  });
});

describe("pure helpers", () => {
  it("computePeaks: buckets, normalisation, short input", () => {
    const pcm = new Float32Array([0, 0.5, -0.25, 0.1, 0, 0, -0.5, 0.25]);
    expect(computePeaks(pcm, 8, 4, false)).toEqual({ peaks: [0, 0.5, -0.25, 0.1, 0, 0, -0.5, 0.25], points: 4, durationSec: 1 });
    expect(computePeaks(pcm, 8, 2).peaks).toEqual([-0.5, 1, -1, 0.5]);
    expect(computePeaks(new Float32Array(3), 8, 800).points).toBe(3);
  });

  it("parseEbur128 reads the summary", () => {
    const stderr = `[Parsed_ebur128_0 @ 0x1] t: 1.0 M: -20 S: -20 I: -19 LUFS\n[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.3 LUFS\n    Threshold: -24.5 LUFS\n\n  Loudness range:\n    LRA:         5.2 LU\n\n  True peak:\n    Peak:       -0.8 dBFS\n`;
    expect(parseEbur128(stderr)).toEqual({ integrated: -14.3, lra: 5.2, truePeak: -0.8 });
    expect(parseEbur128("no summary")).toEqual({});
  });

  it("keyFromChroma ranks the scale's tonic first", () => {
    // C major scale tones, tonic and dominant emphasised.
    const c = [3, 0, 1, 0, 1.5, 1, 0, 2, 0, 1, 0, 0.8];
    expect(keyFromChroma(c)[0]!.key).toEqual({ tonic: "C", mode: "major" });
    const a = [1, 0, 0.8, 0, 1.2, 0, 0, 0.8, 0, 3, 0, 1]; // A minor: A C E
    a[0] = 1.6;
    expect(keyFromChroma(a)[0]!.key).toEqual({ tonic: "A", mode: "minor" });
  });

  it("countOnsets separates one hit from a loop", () => {
    expect(countOnsets(sine(55, 0.5, 22050).map((v, i) => v * Math.exp(-i / 2000)), 22050)).toBe(1);
    expect(countOnsets(clickLoop(120, 1), 22050)).toBeGreaterThanOrEqual(8);
  });

  it("midiName", () => {
    expect([midiName(60), midiName(69), midiName(33), midiName(0)]).toEqual(["C4", "A4", "A1", "C-1"]);
  });
});

const SAMPLE: SampleDetails = {
  id: "fake:1",
  provider: "fake",
  nativeId: "1",
  title: "Tone",
  url: "https://fake.example/1",
  tags: [],
  category: "synth.pluck",
  unit: "sample",
  downloadable: true,
  bpm: 90,
  files: [
    { url: "https://cdn.example/1.wav", filename: "1.wav", format: "wav", role: "original" },
    { url: "https://cdn.example/1.mp3", filename: "1.mp3", format: "mp3", role: "preview" },
  ],
};

describe("enrichSample", () => {
  const analysis: AudioAnalysis = {
    durationSec: 1.0712,
    sampleRate: 44100,
    bitDepth: 24,
    channels: 2,
    loudnessLufs: -14.2,
    bpm: 120,
    bpmConfidence: 0.9,
    key: { tonic: "F", mode: "minor" },
    keyConfidence: 0.3,
    rootNote: 69,
    rootNoteConfidence: 0.95,
    form: "one-shot",
    formConfidence: 1,
    source: { durationSec: "chunk", sampleRate: "chunk", bitDepth: "chunk", channels: "chunk", loudnessLufs: "analysis", bpm: "analysis", key: "analysis", rootNote: "analysis", form: "chunk" },
    warnings: [],
    deep: true,
    tookMs: 1,
  };

  it("fills missing fields, never overwrites, skips low-confidence estimates, records evidence", () => {
    const e = enrichSample(SAMPLE, analysis, { fileUrl: "https://cdn.example/1.wav" });
    expect(e.bpm).toBe(90); // source value kept
    expect(e.durationSec).toBe(1.071);
    expect(e).toMatchObject({ sampleRate: 44100, bitDepth: 24, channels: 2, loudnessLufs: -14.2, rootNote: 69, form: "one-shot" });
    expect(e.key).toBeUndefined(); // confidence 0.3
    expect(e.analysisEvidence).toEqual({
      durationSec: { by: "chunk" },
      sampleRate: { by: "chunk" },
      bitDepth: { by: "chunk" },
      channels: { by: "chunk" },
      loudnessLufs: { by: "analysis" },
      rootNote: { by: "analysis", confidence: 0.95 },
      form: { by: "chunk", confidence: 1 },
    });
    expect(e.files[0]).toMatchObject({ sampleRate: 44100, bitDepth: 24, channels: 2 });
    expect(e.files[1]!.sampleRate).toBeUndefined();
    expect(SAMPLE.durationSec).toBeUndefined(); // input untouched
  });

  it("does not give a one-shot a BPM", () => {
    const { bpm: _bpm, ...noBpm } = SAMPLE;
    expect(enrichSample(noBpm, analysis).bpm).toBeUndefined();
    expect(enrichSample(noBpm, { ...analysis, form: "loop", source: { ...analysis.source, form: "chunk" } }).bpm).toBe(120);
  });

  it("pickAnalysisFile prefers the original audio under the cap, else a preview", () => {
    expect(pickAnalysisFile(SAMPLE)?.url).toBe("https://cdn.example/1.wav");
    const huge = { ...SAMPLE, files: SAMPLE.files.map((f) => (f.role === "original" ? { ...f, sizeBytes: 500e6 } : f)) };
    expect(pickAnalysisFile(huge)?.url).toBe("https://cdn.example/1.mp3");
    expect(pickAnalysisFile({ ...SAMPLE, files: [], previewUrl: "https://p.example/x.ogg" })?.url).toBe("https://p.example/x.ogg");
    expect(pickAnalysisFile({ ...SAMPLE, files: [{ url: "u", filename: "a.zip", format: "zip", role: "pack" }] })).toBeUndefined();
  });

  it.skipIf(!hasFfmpeg)("analyzeSample analyses and enriches, and never throws", async () => {
    const http = fakeHttp({ "https://cdn.example/1.wav": readFileSync(path("smpl-c4.wav")) });
    const { bpm: _bpm, ...s } = SAMPLE;
    const r = await analyzeSample(s, { http, deep: true });
    expect(r.fileUrl).toBe("https://cdn.example/1.wav");
    expect(r.sample).toMatchObject({ rootNote: 60, sampleRate: 22050, bitDepth: 16, durationSec: 0.25 });
    expect(r.sample.files[0]!.sampleRate).toBe(22050);
    const bad = await analyzeSample({ ...s, files: [{ url: "https://cdn.example/404.wav", filename: "x.wav", format: "wav", role: "original" }] }, { http });
    expect(bad.warnings[0]).toMatch(/analysis failed/);
    expect(bad.sample.rootNote).toBeUndefined();
  });
});
