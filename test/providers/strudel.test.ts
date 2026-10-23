import { describe, expect, it } from "vitest";
import {
  EXCLUDED_MANIFESTS,
  STRUDEL_MANIFESTS,
  bankWords,
  encodePath,
  machineName,
  noteToMidi,
  strudel,
  strudelBankFor,
} from "../../src/providers/strudel.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string, string][] = [
  ["dough-samples/main/tidal-drum-machines.json", "strudel/tidal-drum-machines.json"],
  ["Dirt-Samples/master/strudel.json", "strudel/dirt-samples.json"],
  ["dough-samples/main/vcsl.json", "strudel/vcsl.json"],
  ["dough-samples/main/piano.json", "strudel/piano.json"],
  ["dough-samples/main/mridangam.json", "strudel/mridangam.json"],
  ["uzu-drumkit/main/strudel.json", "strudel/uzu-drumkit.json"],
  ["Dough-Samples/main/strudel.json", "strudel/dough-samples.json"],
  ["Dough-Fox/main/strudel.json", "strudel/dough-fox.json"],
];

const all = () => strudel.search({ query: "", limit: 1000 }, fixtureCtx(routes));

describe("strudel", () => {
  it("fetches every allow-listed manifest once and lists each file", async () => {
    const ctx = fixtureCtx(routes);
    const r = await strudel.search({ query: "", limit: 1000 }, ctx);
    expect(ctx.fetch.requests).toHaveLength(STRUDEL_MANIFESTS.length);
    expect(new Set(ctx.fetch.requests)).toEqual(new Set(STRUDEL_MANIFESTS.map((m) => m.url)));
    // 17 drum machine + 8 dirt (excluded banks dropped) + 6 vcsl + 3 piano + 2 mridangam + 1 uzu + 4 dough + 2 fox
    expect(r.total).toBe(43);
    expect(r.searchUrl).toBe("https://strudel.cc/learn/samples/");
    const tr808 = r.samples[0]!;
    expect(tr808).toMatchObject({
      id: "strudel:tidal-drum-machines/RolandTR808_bd/0",
      title: "Roland TR-808 · bd · 0",
      category: "drums.kick",
      categoryEvidence: { by: "source", confidence: 1 },
      form: "one-shot",
      unit: "sample",
      downloadable: true,
      price: { free: true },
      formats: ["wav"],
      previewUrl: "https://raw.githubusercontent.com/ritchse/tidal-drum-machines/main/machines/RolandTR808/rolandtr808-bd/BD0000.WAV",
      url: "https://github.com/ritchse/tidal-drum-machines/blob/main/machines/RolandTR808/rolandtr808-bd/BD0000.WAV",
      license: { id: "LicenseRef-Unknown", verdict: "check-terms" },
    });
    expect(tr808.tags).toEqual(expect.arrayContaining(["drum machine", "rolandtr808", "roland", "tr808", "kick"]));
  });

  it("maps drum bank suffixes to categories deterministically", async () => {
    const byId = Object.fromEntries((await all()).samples.map((s) => [s.nativeId, s.category]));
    expect(byId).toMatchObject({
      "tidal-drum-machines/RolandTR808_bd/2": "drums.kick",
      "tidal-drum-machines/RolandTR808_sd/0": "drums.snare",
      "tidal-drum-machines/RolandTR808_hh/0": "drums.hat.closed",
      "tidal-drum-machines/RolandTR808_oh/0": "drums.hat.open",
      "tidal-drum-machines/RolandTR808_cp/0": "drums.clap",
      "tidal-drum-machines/RolandTR808_rim/0": "drums.perc",
      "tidal-drum-machines/RolandTR808_lt/0": "drums.tom",
      "tidal-drum-machines/RolandTR808_cr/0": "drums.cymbal.crash",
      "tidal-drum-machines/RolandTR808_cb/0": "drums.perc",
      "tidal-drum-machines/RolandTR909_rd/0": "drums.cymbal.ride",
      "tidal-drum-machines/LinnDrum_sh/0": "drums.perc",
      // misc banks are classified from the file name ("Bass.wav", "Electric Piano.wav")
      "tidal-drum-machines/AkaiMPC60_misc/0": "bass",
      "tidal-drum-machines/AkaiMPC60_misc/1": "keys",
      // Dirt-Samples banks
      "dirt-samples/bd/0": "drums.kick",
      "dirt-samples/sn/1": "drums.snare",
      "dirt-samples/808oh/0": "drums.hat.open",
      "dirt-samples/tabla/0": "drums.perc",
      "dirt-samples/jvbass/0": "bass",
      // VCSL
      "vcsl/snare_modern/0": "drums.snare",
      "vcsl/timpani/0": "drums.perc",
      "vcsl/kawai/0": "keys",
      "vcsl/recorder_alto_stacc/0": "woodwind",
      // forced per collection
      "piano/piano/0": "keys",
      "mridangam/gumki/0": "drums.perc",
      "uzu-drumkit/bd/0": "drums.kick",
      // run-together bank names are read word by word
      "dough-samples/kick/1": "drums.kick",
      "dough-fox/fdarkkick/0": "drums.kick",
      "dough-fox/fclap/0": "drums.clap",
    });
    const misc = (await all()).samples.find((s) => s.nativeId === "tidal-drum-machines/AkaiMPC60_misc/0")!;
    expect(misc.categoryEvidence?.by).toBe("rules");
    expect(machineName("RolandCompurhythm78")).toBe("Roland CR-78");
    expect(machineName("SomeNewBox12")).toBe("Some New Box 12");
    expect(bankWords("fdarkkick", "f")).toBe("dark kick");
    expect(bankWords("fohh", "f")).toBe("open hat");
  });

  it("applies the per-manifest licence allow-list", async () => {
    const r = await all();
    const ids = r.samples.map((s) => s.nativeId);
    // copyrighted break and record banks are never listed
    expect(ids.some((id) => /\/(amencutup|breaks125|rave|brk)\//.test(id))).toBe(false);
    expect(STRUDEL_MANIFESTS.some((m) => /clean-breaks|Dough-Amen/.test(m.url))).toBe(false);
    expect(EXCLUDED_MANIFESTS.map((e) => e.url)).toContain("https://raw.githubusercontent.com/yaxu/clean-breaks/main/strudel.json");

    const lic = (id: string) => r.samples.find((s) => s.nativeId === id)!.license!;
    expect(lic("vcsl/kawai/0")).toMatchObject({ id: "CC0-1.0", verdict: "yes" });
    expect(lic("piano/piano/0")).toMatchObject({ id: "CC-BY-3.0", verdict: "yes-with-credit" });
    expect(lic("mridangam/gumki/0")).toMatchObject({ id: "CC-BY-SA-4.0", verdict: "restricted" });
    expect(lic("dirt-samples/bd/0")).toMatchObject({ id: "LicenseRef-Unknown", verdict: "check-terms" });
    expect(lic("tidal-drum-machines/RolandTR808_bd/0").note).toMatch(/drum machines/);
    expect(lic("uzu-drumkit/bd/0")).toMatchObject({ verdict: "yes", name: "The Unlicense" });
    expect(lic("dough-samples/kick/0").verdict).toBe("check-terms");

    const piano = r.samples.find((s) => s.nativeId === "piano/piano/0")!;
    expect(piano.attribution).toMatch(/Alexander Holm.*CC BY 3\.0/);

    const commercial = await strudel.search({ query: "", commercialOnly: true, limit: 1000 }, fixtureCtx(routes));
    expect(new Set(commercial.samples.map((s) => s.license!.verdict))).toEqual(new Set(["yes", "yes-with-credit"]));
  });

  it("reads notes of pitched banks as root notes", async () => {
    const r = await strudel.search({ query: "piano", limit: 20 }, fixtureCtx(routes));
    const salamander = r.samples.filter((s) => s.nativeId.startsWith("piano/"));
    expect(salamander.map((s) => [s.title, s.rootNote])).toEqual([
      ["Salamander Grand Piano · piano A0 · 0", 21],
      ["Salamander Grand Piano · piano C1 · 1", 24],
      ["Salamander Grand Piano · piano D#1 · 2", 27],
    ]);
    expect(salamander[0]!.formats).toEqual(["mp3"]);
    expect(noteToMidi("A#2")).toBe(46);
    expect(noteToMidi("Ds1")).toBe(27);
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("Eb4")).toBe(63);
  });

  it("searches text and filters by category and form locally", async () => {
    const kicks = await strudel.search({ query: "808 kick", limit: 5 }, fixtureCtx(routes));
    expect(kicks.samples[0]!.nativeId).toBe("tidal-drum-machines/RolandTR808_bd/0");
    expect(kicks.samples.slice(0, 3).every((s) => s.category === "drums.kick")).toBe(true);

    const hats = await strudel.search({ query: "", categories: ["drums.hat"], limit: 50 }, fixtureCtx(routes));
    expect(hats.samples.map((s) => s.nativeId).sort()).toEqual([
      "dirt-samples/808oh/0",
      "tidal-drum-machines/RolandTR808_hh/0",
      "tidal-drum-machines/RolandTR808_oh/0",
    ]);

    const loops = await strudel.search({ query: "", forms: ["loop"], limit: 50 }, fixtureCtx(routes));
    expect(loops.samples.map((s) => s.nativeId)).toContain("dough-samples/loop/0");
    expect(loops.samples.every((s) => s.form === "loop" || s.form === undefined)).toBe(true);

    const page = await strudel.search({ query: "", limit: 2, offset: 2 }, fixtureCtx(routes));
    expect(page.samples.map((s) => s.nativeId)).toEqual(["tidal-drum-machines/RolandTR808_bd/2", "tidal-drum-machines/RolandTR808_sd/0"]);
    expect(page.total).toBe(43);

    const none = await strudel.search({ query: "xylophonezzz", limit: 5 }, fixtureCtx(routes));
    expect(none.samples).toEqual([]);
  });

  it("skips single-instrument manifests the category filter rules out", async () => {
    const ctx = fixtureCtx(routes);
    await strudel.search({ query: "", categories: ["vocals"], limit: 5 }, ctx);
    expect(ctx.fetch.requests.some((u) => u.includes("piano.json") || u.includes("mridangam.json"))).toBe(false);
    expect(ctx.fetch.requests).toHaveLength(STRUDEL_MANIFESTS.length - 2);
  });

  it("returns the wav for getSample with one request", async () => {
    const ctx = fixtureCtx(routes);
    const d = await strudel.getSample!("dough-samples/kick/1", ctx);
    expect(ctx.fetch.requests).toEqual(["https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Samples/main/strudel.json"]);
    expect(d!.files).toEqual([
      {
        url: "https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Samples/main/kick/kick%203-1.wav",
        filename: "kick 3-1.wav",
        format: "wav",
        role: "original",
      },
    ]);
    expect(d!.previewUrl).toBe(d!.files[0]!.url);

    const vcsl = await strudel.getSample!("vcsl/kawai/1", fixtureCtx(routes));
    // already-encoded paths are not encoded twice
    expect(vcsl!.files[0]!.url).toBe(
      "https://raw.githubusercontent.com/sgossner/VCSL/master/Chordophones/Zithers/Grand%20Piano%2C%20Kawai/Sustains/GPiano_sus_A%233_v4_rr1_Player.wav",
    );
    expect(vcsl!.rootNote).toBe(58);

    expect(await strudel.getSample!("dirt-samples/amencutup/0", fixtureCtx(routes))).toBeNull();
    expect(await strudel.getSample!("dirt-samples/bd/99", fixtureCtx(routes))).toBeNull();
    expect(await strudel.getSample!("clean-breaks/funkydrummer/0", fixtureCtx(routes))).toBeNull();
    expect(await strudel.getSample!("nonsense", fixtureCtx(routes))).toBeNull();
    expect(encodePath("a b/c%20d/e#1.wav")).toBe("a%20b/c%20d/e%231.wav");
  });

  it("tells a kit exporter where a sample lives in Strudel", () => {
    expect(strudelBankFor("tidal-drum-machines/RolandTR808_bd/3")).toEqual({
      manifestUrl: "https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json",
      bank: "RolandTR808_bd",
      index: 3,
    });
    expect(strudelBankFor("strudel:vcsl/snare_modern/0")).toEqual({
      manifestUrl: "https://raw.githubusercontent.com/felixroos/dough-samples/main/vcsl.json",
      bank: "snare_modern",
      index: 0,
    });
    expect(strudelBankFor("unknown/bd/0")).toBeNull();
    expect(strudelBankFor("dirt-samples/bd/x")).toBeNull();
  });

  it("counts the catalogue for the census", async () => {
    const c = await strudel.census!(fixtureCtx(routes));
    expect(c.total).toBe(43);
    expect(c.unit).toBe("samples");
    expect(c.byCategory.drums).toBeGreaterThan(20);
    expect(c.byLicense?.["CC0-1.0"]).toBe(6);
  });

  it("throws on a broken manifest instead of returning nothing", async () => {
    const broken: [string, string][] = [["piano.json", "strudel/broken.txt"], ...routes];
    await expect(strudel.getSample!("piano/piano/0", fixtureCtx(broken))).rejects.toThrow(/Invalid Strudel manifest/);
  });
});
