import { load } from "cheerio";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildInstrument,
  instrumentFileBase,
  listAudioFiles,
  mapInstrument,
  parseSampleName,
  toDecentSampler,
  toSfz,
  writeInstrument,
  type InstrumentMap,
  type InstrumentSample,
} from "../src/core/instrument.js";
import { noteName, parseNoteName } from "../src/core/notes.js";
import { smplChunk } from "./fixtures/audio/riff.js";
import { hasFfmpeg, SR, writeKeysPack, writeTone } from "./fixtures/instrument/make.js";

const tmp = mkdtempSync(join(tmpdir(), "instrument-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let dirN = 0;
const freshDir = () => join(tmp, `d${++dirN}`);

/** A resolved sample from a file name (as resolveSamples would build it). */
function sample(file: string, extra: Partial<InstrumentSample> = {}): InstrumentSample {
  const p = parseSampleName(file);
  if (p.note === undefined && extra.note === undefined) throw new Error(`no note in ${file}`);
  return {
    path: file,
    file,
    note: p.note!,
    noteSource: "filename",
    confidence: 1,
    ...(p.layer !== undefined ? { layer: p.layer, layerRank: p.layerRank } : {}),
    ...(p.rr !== undefined ? { rr: p.rr } : {}),
    numbers: p.numbers,
    words: p.words,
    dir: file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "",
    ...extra,
  };
}

/** Parse SFZ text into headers and regions; throws on lines that are not SFZ. */
function parseSfz(text: string): { headers: string[]; regions: Record<string, string>[] } {
  const headers: string[] = [];
  const regions: Record<string, string>[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const m = /^<(control|global|master|group|region)>\s*(.*)$/.exec(line);
    const rest = m ? m[2]! : line;
    if (m) headers.push(m[1]!);
    const ops: Record<string, string> = {};
    // `sample=` runs to the end of the line; other opcodes are key=value tokens.
    const sampleAt = rest.indexOf("sample=");
    const head = sampleAt >= 0 ? rest.slice(0, sampleAt) : rest;
    for (const tok of head.split(/\s+/).filter(Boolean)) {
      const kv = /^([a-z_]+)=(\S+)$/.exec(tok);
      if (!kv) throw new Error(`bad SFZ token "${tok}" in: ${line}`);
      ops[kv[1]!] = kv[2]!;
    }
    if (sampleAt >= 0) ops.sample = rest.slice(sampleAt + 7);
    if (m?.[1] === "region") regions.push(ops);
    else if (!m && headers.length === 0) throw new Error(`opcode before any header: ${line}`);
  }
  return { headers, regions };
}

/** Strict well-formedness check: matching tags, quoted attributes, escaped text, one root. */
function assertWellFormedXml(text: string): void {
  expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const body = text.replace(/^<\?xml[^?]*\?>/, "").replace(/<!--(?:(?!--)[\s\S])*-->/g, "");
  const tag = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.-]*="(?:[^"<&]|&(?:amp|lt|gt|quot|apos);)*")*)\s*(\/?)>/g;
  const stack: string[] = [];
  let roots = 0;
  let last = 0;
  for (let m = tag.exec(body); m; m = tag.exec(body)) {
    const between = body.slice(last, m.index);
    if (/[<>]|&(?!(?:amp|lt|gt|quot|apos);)/.test(between)) throw new Error(`stray markup near: ${between.slice(0, 40)}`);
    last = tag.lastIndex;
    const [, close, name, attrs, selfClose] = m;
    const names = [...attrs!.matchAll(/([A-Za-z_][\w.-]*)=/g)].map((a) => a[1]);
    if (new Set(names).size !== names.length) throw new Error(`duplicate attribute on <${name}>`);
    if (close) {
      if (stack.pop() !== name) throw new Error(`mismatched </${name}>`);
    } else {
      if (!stack.length) roots++;
      if (!selfClose) stack.push(name!);
    }
  }
  if (/[<>]/.test(body.slice(last))) throw new Error("unparsed markup at the end");
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
}

/** Every key 0..127 × velocity 1..127 is covered at most once per round-robin step, and the range lo..hi fully. */
function assertCoverage(map: InstrumentMap): void {
  for (let key = map.lo; key <= map.hi; key++) {
    for (let vel = 1; vel <= 127; vel++) {
      const hits = map.zones.filter((z) => z.lokey <= key && key <= z.hikey && z.lovel <= vel && vel <= z.hivel);
      expect(hits.length, `${noteName(key)} vel ${vel}`).toBeGreaterThan(0);
      const positions = hits.map((h) => h.seqPosition);
      expect(new Set(positions).size, `${noteName(key)} vel ${vel} overlaps`).toBe(positions.length);
      for (const h of hits) expect(h.seqLength).toBe(hits.length);
    }
  }
}

describe("note names", () => {
  it("parses scientific pitch names, flats, Philharmonia sharps and octave -1", () => {
    expect(parseNoteName("C4")).toBe(60);
    expect(parseNoteName("A4")).toBe(69);
    expect(parseNoteName("C#3")).toBe(49);
    expect(parseNoteName("Db3")).toBe(49);
    expect(parseNoteName("As4")).toBe(70);
    expect(parseNoteName("bb2")).toBe(46);
    expect(parseNoteName("A-1")).toBe(9);
    expect(parseNoteName("C-1")).toBe(0);
    expect(parseNoteName("G9")).toBe(127);
    expect(parseNoteName("G#9")).toBeUndefined();
    expect(parseNoteName("H4")).toBeUndefined();
    expect(noteName(61)).toBe("C#4");
    expect(noteName(61, { flats: true })).toBe("Db4");
  });
});

describe("parseSampleName", () => {
  const cases: [string, Partial<ReturnType<typeof parseSampleName>>][] = [
    ["Horn.ff.C4.aiff", { note: 60, layer: "ff", layerRank: 7, words: ["horn"] }],
    ["Piano.pp.Db3.aiff", { note: 49, layer: "pp", words: ["piano"] }],
    ["Violin.arco.ff.sulG.G3.stereo.aif", { note: 55, layer: "ff", words: ["violin", "arco", "sulg"] }],
    ["violin_A4_1_forte_arco-normal.mp3", { note: 69, layer: "f", layerRank: 6, numbers: [1], words: ["violin", "arco"] }],
    ["violin_As4_05_mezzo-forte_arco-normal.mp3", { note: 70, layer: "mf", layerRank: 5, numbers: [5] }],
    ["violin_A4_1_piano_arco-normal.mp3", { note: 69, layer: "p", layerRank: 3 }],
    ["Celesta_C5_vl1.wav", { note: 72, layer: "vl1", layerRank: 1, words: ["celesta"] }],
    ["Celesta_C5_vl3.wav", { note: 72, layer: "vl3", layerRank: 3 }],
    ["C4v8.flac", { note: 60, layer: "v8", layerRank: 8 }],
    ["A0vH.wav", { note: 21, layer: "vH", layerRank: 7 }],
    ["Upright Bass A-1.wav", { note: 9, words: ["upright", "bass"] }],
    ["Harp_C#3_rr2.wav", { note: 49, rr: 2 }],
    ["Harp_Eb3_round_robin_3.wav", { note: 51, rr: 3 }],
    ["piano_060.wav", { note: 60, numbers: [] }],
    ["Marimba midi72 soft.wav", { note: 72, layer: "soft", layerRank: 3 }],
    ["Glock_E5_loud_2.wav", { note: 76, layer: "loud", numbers: [2] }],
    ["pp/Glock_E5.wav", { note: 76, layer: "pp" }],
  ];
  it.each(cases)("%s", (file, want) => {
    expect(parseSampleName(file)).toMatchObject(want);
  });

  it("leaves names without a note alone", () => {
    expect(parseSampleName("Kick.wav").note).toBeUndefined();
    expect(parseSampleName("Kick.wav").words).toEqual(["kick"]);
  });

  it("flags Iowa-style runs of notes", () => {
    const p = parseSampleName("Piano.ff.C4B4.aiff");
    expect(p.noteRun).toEqual([60, 71]);
    expect(p.note).toBeUndefined();
  });

  it("does not read instrument names or string names as notes or dynamics", () => {
    expect(parseSampleName("Piano.mf.C4.aiff").layer).toBe("mf");
    expect(parseSampleName("Piano_C4.wav").layer).toBeUndefined();
    expect(parseSampleName("Violin.sulA.A4.aif").note).toBe(69);
  });

  it("applies an octave offset to named notes (C3 = 60 packs)", () => {
    expect(parseSampleName("Synth_C3.wav", { octaveOffset: 12 }).note).toBe(60);
    expect(parseSampleName("Synth_060.wav", { octaveOffset: 12 }).note).toBe(60);
  });
});

describe("mapInstrument", () => {
  it("maps keys midway between neighbours, with the upper sample taking the middle key", () => {
    const map = mapInstrument(["Pad_C3.wav", "Pad_E3.wav", "Pad_A3.wav"].map((f) => sample(f)), { edge: 3 });
    const z = map.zones.map((z) => [z.note, z.lokey, z.hikey]);
    // C3=48, E3=52 (gap 4): C3 → 49, E3 from 50; E3–A3 (gap 5): E3 → 54, A3 from 55.
    expect(z).toEqual([
      [48, 45, 49],
      [52, 50, 54],
      [57, 55, 60],
    ]);
    expect(map.layers).toEqual([expect.objectContaining({ name: "all", lovel: 1, hivel: 127 })]);
    expect(map.name).toBe("Pad");
    expect(map.gaps).toEqual([]);
    assertCoverage(map);
  });

  it("splits velocity evenly across dynamics layers, ordered pp → ff", () => {
    const files = ["ff", "mf", "pp"].flatMap((d) => ["C3", "C4"].map((n) => `Horn.${d}.${n}.aiff`));
    const map = mapInstrument(files.map((f) => sample(f)));
    expect(map.layers.map((l) => [l.name, l.lovel, l.hivel])).toEqual([
      ["pp", 1, 42],
      ["mf", 43, 84],
      ["ff", 85, 127],
    ]);
    expect(map.name).toBe("Horn");
    assertCoverage(map);
  });

  it("turns repeated note + dynamic into round robins (rrN, or _1/_2 numbering)", () => {
    const map = mapInstrument(
      ["Glock_C5_ff_2.wav", "Glock_C5_ff_1.wav", "Glock_C5_ff_3.wav", "Glock_G5_ff.wav", "Glock_C5_pp.wav", "Glock_G5_pp_rr2.wav", "Glock_G5_pp_rr1.wav"].map((f) => sample(f)),
    );
    const c5ff = map.zones.filter((z) => z.note === 72 && z.layer === "ff");
    expect(c5ff.map((z) => [z.file, z.seqPosition, z.seqLength])).toEqual([
      ["Glock_C5_ff_1.wav", 1, 3],
      ["Glock_C5_ff_2.wav", 2, 3],
      ["Glock_C5_ff_3.wav", 3, 3],
    ]);
    const g5pp = map.zones.filter((z) => z.note === 79 && z.layer === "pp");
    expect(g5pp.map((z) => [z.file, z.seqPosition])).toEqual([
      ["Glock_G5_pp_rr1.wav", 1],
      ["Glock_G5_pp_rr2.wav", 2],
    ]);
    expect(map.roundRobins).toBe(3);
    assertCoverage(map);

    const sfz = parseSfz(toSfz(map));
    const r = sfz.regions.find((x) => x.sample === "Glock_C5_ff_2.wav")!;
    expect(r).toMatchObject({ seq_length: "3", seq_position: "2", pitch_keycenter: "72" });
    expect(sfz.regions.find((x) => x.sample === "Glock_G5_ff.wav")!.seq_length).toBeUndefined();

    const $ = load(toDecentSampler(map), { xml: true });
    const rr3 = $('group[seqLength="3"]');
    expect(rr3.attr("seqMode")).toBe("round_robin");
    expect(rr3.find("sample").map((_, el) => $(el).attr("seqPosition")).get()).toEqual(["1", "2", "3"]);
    // Notes without round robins sit in a group without a sequence, so no step is ever silent.
    expect($("group").filter((_, el) => !$(el).attr("seqLength")).find('sample[path="Glock_G5_ff.wav"]').length).toBe(1);
  });

  it("reports gaps between sampled notes and layers that stop short", () => {
    const map = mapInstrument(["Bass_C2_ff.wav", "Bass_G2_ff.wav", "Bass_C3_ff.wav", "Bass_C3_pp.wav"].map((f) => sample(f)), { maxGap: 5 });
    expect(map.gaps).toEqual([{ from: 36, to: 43, fromName: "C2", toName: "G2", semitones: 7 }]);
    expect(map.warnings.join("\n")).toMatch(/missing notes between C2 and G2/);
    expect(map.warnings.join("\n")).toMatch(/layer pp starts at C3 \(lowest sample: C2\)/);
    assertCoverage(map);
  });

  it("picks the variant covering most notes and lists the others; `variant` overrides", () => {
    const files = [
      ...["C4", "E4", "G4", "C5"].map((n) => `Celesta/Celesta_${n}_vl1.wav`),
      ...["C5", "G5"].map((n) => `Glock/Glock_${n}.wav`),
    ];
    const map = mapInstrument(files.map((f) => sample(f)));
    expect(map.variant).toBe("Celesta");
    expect(map.zones.every((z) => z.file.startsWith("Celesta/"))).toBe(true);
    expect(map.variants.map((v) => [v.name, v.used])).toEqual([
      ["Celesta", "primary"],
      ["Glock", "no"],
    ]);
    expect(map.warnings.join("\n")).toMatch(/2 variants found; using "Celesta"/);

    const glock = mapInstrument(files.map((f) => sample(f)), { variant: "glock" });
    expect(glock.zones.map((z) => z.file)).toEqual(["Glock/Glock_C5.wav", "Glock/Glock_G5.wav"]);
    expect(glock.name).toBe("Glock");
  });

  it("fills missing notes from sibling variants in the same folder (Iowa strings)", () => {
    const files = ["Violin.arco.ff.sulG.G3.aif", "Violin.arco.ff.sulG.A3.aif", "Violin.arco.ff.sulG.B3.aif", "Violin.arco.ff.sulD.B3.aif", "Violin.arco.ff.sulD.D4.aif"];
    const map = mapInstrument(files.map((f) => sample(f)));
    expect(map.variant).toBe("sulg");
    expect(map.notes).toEqual([55, 57, 59, 62]);
    expect(map.zones.find((z) => z.note === 59)!.file).toBe("Violin.arco.ff.sulG.B3.aif");
    expect(map.zones.find((z) => z.note === 62)!.file).toBe("Violin.arco.ff.sulD.D4.aif");
    expect(map.warnings.join("\n")).toMatch(/filled 1 note\(s\) \(D4\) from variant "suld"/);
    expect(mapInstrument(files.map((f) => sample(f)), { fillGaps: false }).notes).toEqual([55, 57, 59]);
  });

  it("writes smpl loops and fine tuning into both formats, and escapes XML", () => {
    const map = mapInstrument(
      [sample("Organ & Co <1>.wav", { note: 60, noteSource: "smpl", loop: { start: 100, end: 900 }, tuneCents: -12 })],
      { name: 'Organ "A&B"', release: 1.5 },
    );
    const sfz = parseSfz(toSfz(map));
    expect(sfz.headers).toEqual(["control", "global", "group", "region"]);
    expect(sfz.regions[0]).toMatchObject({ loop_mode: "loop_continuous", loop_start: "100", loop_end: "900", tune: "-12", sample: "Organ & Co <1>.wav" });
    expect(toSfz(map)).toMatch(/ampeg_release=1\.5/);
    const ds = toDecentSampler(map);
    assertWellFormedXml(ds);
    const $ = load(ds, { xml: true });
    expect($("sample").attr("path")).toBe("Organ & Co <1>.wav");
    expect($("sample").attr("loopEnabled")).toBe("true");
    expect($("sample").attr("tuning")).toBe("-0.12");
    expect($("label").attr("text")).toBe('Organ "A&B"');
    expect($("groups").attr("release")).toBe("1.5");
  });

  it("throws on an empty list", () => {
    expect(() => mapInstrument([])).toThrow(/no samples/);
  });
});

describe("buildInstrument (folder)", () => {
  it("builds SFZ, Decent Sampler and a summary from the Keys pack (names + smpl chunk)", async () => {
    const dir = freshDir();
    writeKeysPack(dir);
    expect((await listAudioFiles(dir)).map((p) => p.slice(dir.length + 1))).not.toContain("notes.txt");
    const b = await buildInstrument(dir, { detectPitch: false });
    const { map, summary } = b;
    expect(map.name).toBe("Keys");
    expect(map.notes).toEqual([48, 52, 55, 60, 76]);
    expect(map.lo).toBe(42);
    expect(map.hi).toBe(82);
    expect(map.layers.map((l) => [l.name, l.lovel, l.hivel, l.notes])).toEqual([
      ["pp", 1, 63, [48, 52, 55, 60]],
      ["ff", 64, 127, [48, 52, 55, 60, 76]],
    ]);
    assertCoverage(map);

    const zone = (file: string) => map.zones.find((z) => z.file === file)!;
    expect(zone("Keys_C3_pp_rr2.wav")).toMatchObject({ note: 48, lokey: 42, hikey: 49, lovel: 1, hivel: 63, seqLength: 2, seqPosition: 2 });
    expect(zone("Keys_C4_pp.wav")).toMatchObject({ lokey: 58, hikey: 82 });
    expect(zone("Keys_C4_ff.wav")).toMatchObject({ lokey: 58, hikey: 67 });
    // No note in the name: root from the smpl chunk (written after `data`), with its loop.
    expect(zone("Keys_loop_ff.wav")).toMatchObject({ note: 76, noteSource: "smpl", lokey: 68, hikey: 82, loop: { start: 1000, end: 5000 } });

    expect(summary.files).toEqual({ found: 11, used: 10, skipped: 1 });
    expect(summary.skipped[0]).toMatchObject({ file: "Keys_C4B4_ff.wav", reason: expect.stringMatching(/run of notes \(C4–B4\)/) });
    expect(summary.rootNotes).toEqual({ filename: 9, smpl: 1 });
    expect(summary.loops).toBe(1);
    expect(summary.roundRobins).toBe(2);
    expect(summary.sampledNotes).toEqual(["C3", "E3", "G3", "C4", "E5"]);
    expect(summary.range).toEqual({ lo: 42, hi: 82, loName: "F#2", hiName: "A#5" });
    expect(summary.gaps).toEqual([{ from: 60, to: 76, fromName: "C4", toName: "E5", semitones: 16 }]);
    expect(summary.warnings.join("\n")).toMatch(/missing notes between C4 and E5/);
    expect(summary.zones.find((z) => z.file === "Keys_C3_pp_rr1.wav")).toEqual({ file: "Keys_C3_pp_rr1.wav", root: "C3", keys: "F#2-C#3", vel: "1-63", layer: "pp", rr: "1/2", source: "filename" });
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);

    // SFZ: valid structure, one region per file, relative paths.
    const sfz = parseSfz(b.sfz);
    expect(sfz.headers.slice(0, 2)).toEqual(["control", "global"]);
    expect(sfz.regions).toHaveLength(10);
    expect(sfz.regions.find((r) => r.sample === "Keys_C3_pp_rr1.wav")).toEqual({
      pitch_keycenter: "48", lokey: "42", hikey: "49", lovel: "1", hivel: "63", seq_length: "2", seq_position: "1", sample: "Keys_C3_pp_rr1.wav",
    });
    expect(sfz.regions.find((r) => r.sample === "Keys_loop_ff.wav")).toMatchObject({ loop_mode: "loop_continuous", loop_start: "1000", loop_end: "5000" });
    expect(b.sfz).toMatch(/ampeg_release=0\.3/);

    // Decent Sampler: well-formed, same zones, knobs bound to the envelope.
    assertWellFormedXml(b.dspreset);
    const $ = load(b.dspreset, { xml: true });
    expect($("DecentSampler > groups > group > sample").length).toBe(10);
    const s = $('sample[path="Keys_E3_ff.wav"]');
    expect([s.attr("rootNote"), s.attr("loNote"), s.attr("hiNote"), s.attr("loVel"), s.attr("hiVel")]).toEqual(["52", "50", "53", "64", "127"]);
    expect($('group[seqMode="round_robin"]').attr("seqLength")).toBe("2");
    expect($("labeled-knob binding").map((_, el) => $(el).attr("parameter")).get()).toEqual(["ENV_ATTACK", "ENV_RELEASE"]);
  });

  it("writes the files, and maps paths relative to another output folder", async () => {
    const root = freshDir();
    writeKeysPack(join(root, "samples"));
    const files = (await listAudioFiles(join(root, "samples"))).map((path) => ({ path, url: `https://example.org/${path.split("/").pop()}` }));
    const b = await buildInstrument(files, { relativeTo: root, name: "My Keys!", detectPitch: false });
    expect(b.map.zones.every((z) => z.file.startsWith("samples/"))).toBe(true);
    expect(b.map.zones[0]!.url).toMatch(/^https:\/\/example\.org\//);
    expect(instrumentFileBase(b.map.name)).toBe("My-Keys");
    const out = await writeInstrument(b, root);
    expect(out.sfz).toBe(join(root, "My-Keys.sfz"));
    expect(readFileSync(out.sfz, "utf8")).toBe(b.sfz);
    assertWellFormedXml(readFileSync(out.dspreset, "utf8"));
    expect(JSON.parse(readFileSync(out.json, "utf8")).name).toBe("My Keys!");
  });

  it("filters files and throws when nothing is playable", async () => {
    const dir = freshDir();
    writeKeysPack(dir);
    const ff = await buildInstrument(dir, { filter: "_ff", detectPitch: false });
    expect(ff.map.layers.map((l) => l.name)).toEqual(["ff"]);
    await expect(buildInstrument(dir, { filter: "nothing-matches" })).rejects.toThrow(/no audio files/);
    const odd = freshDir();
    writeTone(join(odd, "mystery.wav"), 60);
    await expect(buildInstrument(odd, { detectPitch: false })).rejects.toThrow(/no root note found for any of 1 file/);
  });
});

describe.skipIf(!hasFfmpeg)("buildInstrument with pitch detection (ffmpeg)", () => {
  it("detects the root of a file with no note in its name or header", async () => {
    const dir = freshDir();
    writeKeysPack(dir, { withOgg: true });
    const b = await buildInstrument(dir);
    const z = b.map.zones.find((x) => x.file === "Keys_mystery_ff.ogg")!;
    expect(z).toMatchObject({ note: 69, noteSource: "pitch", layer: "ff" });
    expect(b.summary.rootNotes).toEqual({ filename: 9, smpl: 1, pitch: 1 });
    expect(b.summary.gaps.map((g) => [g.fromName, g.toName])).toEqual([
      ["C4", "A4"],
      ["A4", "E5"],
    ]);
  });

  it("replaces header roots that are all the same default by detected pitch", async () => {
    const dir = freshDir();
    for (const [i, midi] of [48, 55, 67].entries()) {
      writeTone(join(dir, `take_${i + 1}.wav`), midi, { sec: 0.6, chunks: [smplChunk({ unityNote: 60, sampleRate: SR })] });
    }
    const b = await buildInstrument(dir);
    expect(b.map.notes).toEqual([48, 55, 67]);
    expect(b.summary.rootNotes).toEqual({ pitch: 3 });
    expect(b.summary.warnings.join("\n")).toMatch(/header root notes were C4/);
  });

  it("fixes a whole-octave naming offset with verifyOctave", async () => {
    const dir = freshDir();
    // Named an octave low (C3 = 60 convention): "C3" files hold C4.
    for (const [n, midi] of [["C3", 60], ["G3", 67], ["C4", 72]] as const) writeTone(join(dir, `Synth_${n}.wav`), midi, { sec: 0.6 });
    const b = await buildInstrument(dir, { verifyOctave: true });
    expect(b.map.notes).toEqual([60, 67, 72]);
    expect(b.summary.warnings.join("\n")).toMatch(/1 octave\(s\) low/);
  });
});
