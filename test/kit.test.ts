import { describe, expect, it } from "vitest";
import { creativeCommons, license } from "../src/core/licence.js";
import { gmDrumMap, kitName, kitSamples, planKit, scorePick, slotCategory, strudelName, strudelSampleMap, type KitPlan } from "../src/core/kit.js";
import { SampleService, UnknownProviderError } from "../src/core/service.js";
import type { Provider, Sample, SampleQuery } from "../src/core/types.js";
import { categoryMatches, type Category } from "../src/core/vocab.js";

const CC0 = license("CC0-1.0");
const BY = creativeCommons({});
const NC = creativeCommons({ nc: true });

let n = 0;
function s(title: string, category: Category, extra: Partial<Sample> = {}): Sample {
  const id = String(++n);
  return {
    id: `fake:${id}`,
    provider: "fake",
    nativeId: id,
    title,
    url: `https://fake.example/s/${id}`,
    author: "Jane",
    tags: [],
    category,
    categoryEvidence: { by: "rules", confidence: 0.9 },
    form: "one-shot",
    unit: "sample",
    durationSec: 0.5,
    license: CC0,
    downloadable: true,
    ...extra,
  };
}

const LIBRARY: Sample[] = [
  s("Kick Loop 140", "drums.kick", { form: "loop", durationSec: 4, bpm: 140 }),
  s("Long Boomy Kick", "drums.kick", { durationSec: 3.2 }),
  s("Dark Trap Kick", "drums.kick", { durationSec: 0.4 }),
  s("NC Kick", "drums.kick", { license: NC }),
  s("Unsure Kick", "drums.kick", { categoryEvidence: { by: "rules", confidence: 0.2 }, durationSec: 0.4 }),
  s("Trap Snare", "drums.snare"),
  s("Trap Clap", "drums.clap", { license: BY }),
  s("Closed Hat 1", "drums.hat.closed", { durationSec: 0.1 }),
  s("Open Hat 1", "drums.hat.open", { durationSec: 0.9 }),
  s("808 C", "bass.808", { durationSec: 2, key: { tonic: "C", mode: "major" } }),
  s("808 F minor", "bass.808", { durationSec: 2, key: { tonic: "F", mode: "minor" } }),
  s("808 rooted F", "bass.808", { durationSec: 2, rootNote: 41 }),
  s("Crash 1", "drums.cymbal.crash", { durationSec: 2.5 }),
  s("Shaker", "drums.perc"),
  s("Riser 8 bars", "fx.riser", { form: undefined, durationSec: 8 }),
  s("Vocal Chop Hey", "vocals.chop", { license: BY }),
  s("Trap Drum Loop", "drums", { form: "loop", durationSec: 8, bpm: 140 }),
];

interface Recorded {
  query: string;
  categories?: string[];
  forms?: string[];
  key?: SampleQuery["key"];
}

function fakeProvider(opts: { id?: string; samples?: Sample[]; delayMs?: number; fail?: boolean; record?: Recorded[]; inflight?: { now: number; max: number } } = {}): Provider {
  const samples = (opts.samples ?? LIBRARY).map((x) => ({ ...x, provider: opts.id ?? "fake", id: `${opts.id ?? "fake"}:${x.nativeId}` }));
  return {
    id: opts.id ?? "fake",
    name: opts.id === "other" ? "Other Source" : "Fake Source",
    homepage: "https://fake.example",
    description: "test",
    categories: ["drums", "bass", "fx", "vocals"],
    access: "api",
    pricing: "free",
    supportsDownload: true,
    buildSearchUrl: (q) => `https://fake.example/search?q=${encodeURIComponent(q.query)}`,
    async search(q) {
      opts.record?.push({ query: q.query, categories: q.categories, forms: q.forms, key: q.key });
      if (opts.inflight) {
        opts.inflight.now++;
        opts.inflight.max = Math.max(opts.inflight.max, opts.inflight.now);
      }
      try {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (opts.fail) throw new Error("boom");
        return { samples: samples.filter((x) => categoryMatches(x.category, q.categories)) };
      } finally {
        if (opts.inflight) opts.inflight.now--;
      }
    },
  };
}

const slotOf = (plan: KitPlan, slot: string) => plan.slots.find((x) => x.slot === slot)!;

describe("slotCategory", () => {
  it("maps ids, id suffixes and free words to categories", () => {
    expect(slotCategory("drums.kick")).toBe("drums.kick");
    expect(slotCategory("kick")).toBe("drums.kick");
    expect(slotCategory("hat.closed")).toBe("drums.hat.closed");
    expect(slotCategory("hat.open")).toBe("drums.hat.open");
    expect(slotCategory("808")).toBe("bass.808");
    expect(slotCategory("clap")).toBe("drums.clap");
    expect(slotCategory("crash")).toBe("drums.cymbal.crash");
    expect(slotCategory("ride")).toBe("drums.cymbal.ride");
    expect(slotCategory("perc")).toBe("drums.perc");
    expect(slotCategory("riser")).toBe("fx.riser");
    expect(slotCategory("vocal chop")).toBe("vocals.chop");
    expect(slotCategory("closed hat")).toBe("drums.hat.closed");
    expect(slotCategory("low tom")).toBe("drums.tom");
    expect(slotCategory("Snare")).toBe("drums.snare");
    expect(slotCategory("zzzz")).toBeUndefined();
  });

  it("kitName slugs the style", () => {
    expect(kitName("Dark Trap")).toBe("darktrap");
    expect(kitName("90s boom-bap!")).toBe("90sboombap");
    expect(kitName()).toBe("kit");
  });
});

describe("planKit", () => {
  it("fills the default slots with the best one-shot per slot", async () => {
    const record: Recorded[] = [];
    const service = new SampleService({ providers: [fakeProvider({ record })] });
    const plan = await planKit(service, { style: "dark trap", key: { tonic: "F", mode: "minor" } });
    expect(plan.name).toBe("darktrap");
    expect(plan.slots.map((x) => [x.slot, x.category])).toEqual([
      ["kick", "drums.kick"],
      ["snare", "drums.snare"],
      ["clap", "drums.clap"],
      ["hat.closed", "drums.hat.closed"],
      ["hat.open", "drums.hat.open"],
      ["808", "bass.808"],
    ]);
    const kick = slotOf(plan, "kick");
    expect(kick.pick?.title).toBe("Dark Trap Kick");
    expect(kick.reason).toMatch(/drums\.kick \(confidence 0\.9\)/);
    expect(kick.reason).toMatch(/one-shot/);
    expect(kick.reason).toMatch(/Commercial use OK/);
    // The loop is filtered out by forms=one-shot, the NC kick by commercialOnly.
    const kickTitles = [kick.pick, ...kick.alternatives].map((x) => x!.title);
    expect(kickTitles).not.toContain("Kick Loop 140");
    expect(kickTitles).not.toContain("NC Kick");
    expect(kick.alternatives).toHaveLength(2); // the unsure and the long kick
    expect(kick.alternatives[0]!.title).toBe("Unsure Kick");

    const bass = slotOf(plan, "808");
    expect(bass.pick?.title).toBe("808 F minor");
    expect(bass.reason).toMatch(/in F minor/);
    // The C major 808 is a known key mismatch: the search drops it.
    expect([bass.pick, ...bass.alternatives].map((x) => x!.title)).not.toContain("808 C");
    expect(bass.alternatives.map((x) => x.title)).toContain("808 rooted F");

    expect(plan.licences).toMatchObject({ yes: 5, "yes-with-credit": 1, no: 0 });
    expect(plan.creditsNeeded).toBe(true);
    expect(plan.warnings).toEqual([]);

    // Each search: style + slot words, the slot category, one-shot for drums/808, key only for the 808.
    const q = record.find((r) => r.categories?.[0] === "drums.hat.closed")!;
    expect(q.query).toBe("dark trap closed hat");
    expect(q.forms).toEqual(["one-shot"]);
    expect(q.key).toBeUndefined();
    expect(record.find((r) => r.categories?.[0] === "bass.808")!.key).toEqual({ tonic: "F", mode: "minor" });
  });

  it("runs the slot searches in parallel", async () => {
    const inflight = { now: 0, max: 0 };
    const service = new SampleService({ providers: [fakeProvider({ delayMs: 40, inflight })] });
    const t0 = Date.now();
    await planKit(service, {});
    expect(inflight.max).toBe(6);
    expect(Date.now() - t0).toBeLessThan(6 * 40);
  });

  it("accepts free words, loop slots and unknown words", async () => {
    const record: Recorded[] = [];
    const service = new SampleService({ providers: [fakeProvider({ record })] });
    const plan = await planKit(service, { slots: ["crash", "perc", "riser", "vocal chop", "drum loop", "zzzz"], perSlot: 1, bpm: 140 });
    expect(slotOf(plan, "crash").pick?.title).toBe("Crash 1");
    expect(slotOf(plan, "perc").pick?.title).toBe("Shaker");
    expect(slotOf(plan, "riser").pick?.title).toBe("Riser 8 bars");
    expect(slotOf(plan, "vocal chop").pick?.title).toBe("Vocal Chop Hey");
    const loop = slotOf(plan, "drum loop");
    expect(loop.category).toBe("drums");
    expect(loop.pick?.form).toBe("loop");
    expect(loop.reason).toMatch(/140 BPM/);
    expect(record.find((r) => r.query === "riser")!.forms).toBeUndefined();
    expect(record.find((r) => r.query === "drum loop")!.forms).toEqual(["loop"]);
    expect(plan.warnings.some((w) => w.includes('"zzzz"') && w.includes("no matching category"))).toBe(true);
    expect(slotOf(plan, "zzzz").category).toBe("other");
  });

  it("commercialOnly=false lets non-commercial samples in; warnings name failing sources", async () => {
    const service = new SampleService({
      providers: [fakeProvider({ samples: [s("Only NC Kick", "drums.kick", { license: NC })] }), fakeProvider({ id: "other", fail: true })],
    });
    const safe = await planKit(service, { slots: ["kick"] });
    expect(safe.slots[0]!.pick).toBeUndefined();
    expect(safe.slots[0]!.reason).toBe("No results.");
    expect(safe.warnings.join("\n")).toMatch(/"kick": nothing found that is commercial-safe/);
    expect(safe.warnings.join("\n")).toMatch(/Other Source failed \(boom\)/);
    const any = await planKit(service, { slots: ["kick"], commercialOnly: false });
    expect(any.slots[0]!.pick?.title).toBe("Only NC Kick");
    expect(any.licences.no).toBe(1);
    expect(any.creditsNeeded).toBe(true);
  });

  it("downloadableOnly filters link-only results; unknown providers throw", async () => {
    const service = new SampleService({ providers: [fakeProvider({ samples: [s("Link Kick", "drums.kick", { downloadable: false })] })] });
    expect((await planKit(service, { slots: ["kick"] })).slots[0]!.pick).toBeUndefined();
    expect((await planKit(service, { slots: ["kick"], downloadableOnly: false })).slots[0]!.pick?.title).toBe("Link Kick");
    await expect(planKit(service, { providers: ["nope"] })).rejects.toBeInstanceOf(UnknownProviderError);
  });

  it("scorePick prefers exact category, one-shot, short and commercial-safe", () => {
    const ctx = { category: "drums.kick" as Category, oneShot: true, pitched: false, loop: false };
    const good = scorePick(s("a", "drums.kick", { durationSec: 0.3 }), ctx).score;
    expect(good).toBeGreaterThan(scorePick(s("b", "drums.kick", { durationSec: 3 }), ctx).score);
    expect(good).toBeGreaterThan(scorePick(s("c", "drums", { durationSec: 0.3 }), ctx).score);
    expect(good).toBeGreaterThan(scorePick(s("d", "drums.kick", { durationSec: 0.3, license: BY }), ctx).score);
    expect(good).toBeGreaterThan(scorePick(s("e", "drums.kick", { durationSec: 0.3, form: undefined }), ctx).score);
  });
});

describe("exports", () => {
  async function plan(): Promise<KitPlan> {
    const service = new SampleService({ providers: [fakeProvider()] });
    return planKit(service, { style: "dark trap", bpm: 140, slots: ["kick", "snare", "clap", "hat.closed", "hat.open", "808", "crash", "riser", "vocal chop"] });
  }
  const paths = { kick: "kick.wav", snare: "snare.wav", clap: "clap.wav", "hat.closed": "hh.wav", "hat.open": "oh.wav", "808": "808.wav", crash: "crash.wav", riser: "riser.wav" };

  it("strudelSampleMap: bank-style names, _base, and a ready-to-paste snippet", async () => {
    const p = await plan();
    const out = strudelSampleMap(p, { baseUrl: "https://sound.example/kits/darktrap", paths });
    expect(out.bank).toBe("darktrap");
    expect(out.json).toEqual({
      _base: "https://sound.example/kits/darktrap/",
      darktrap_bd: ["kick.wav"],
      darktrap_sd: ["snare.wav"],
      darktrap_cp: ["clap.wav"],
      darktrap_hh: ["hh.wav"],
      darktrap_oh: ["oh.wav"],
      darktrap_bass808: ["808.wav"],
      darktrap_cr: ["crash.wav"],
      darktrap_fx: ["riser.wav"],
    });
    expect(out.names).toMatchObject({ kick: "bd", "hat.closed": "hh", "808": "bass808", riser: "fx" });
    expect(out.snippet).toContain("samples({");
    expect(out.snippet).toContain('"darktrap_bd"');
    expect(out.snippet).toContain('s("bd sd [~ bd] sd")');
    expect(out.snippet).toContain('s("hh*8")');
    expect(out.snippet).toContain('.bank("darktrap")');
    expect(out.snippet).toContain("setcpm(35)");
    // The JSON inside the snippet is the map itself.
    const json = out.snippet.slice(out.snippet.indexOf("(") + 1, out.snippet.indexOf("\n})") + 2);
    expect(JSON.parse(json)).toEqual(out.json);
  });

  it("strudelSampleMap: shared names become arrays, slots without paths are skipped", async () => {
    const p = await plan();
    const two = { ...p, slots: [...p.slots, { slot: "impact", category: "fx.impact" as Category, alternatives: [], reason: "" }] };
    const out = strudelSampleMap(two, { paths: { riser: "a.wav", impact: "b.wav", kick: "k.wav" } });
    expect(out.json).toEqual({ darktrap_fx: ["a.wav", "b.wav"], darktrap_bd: ["k.wav"] });
    expect(out.snippet).toContain('s("bd*4").bank("darktrap")');
    expect(strudelName("low tom", "drums.tom")).toBe("lt");
    expect(strudelName("rim", "drums.perc")).toBe("rim");
    expect(strudelName("ride", "drums.cymbal.ride")).toBe("rd");
  });

  it("gmDrumMap: General MIDI notes, choke groups and an SFZ", async () => {
    const p = await plan();
    const gm = gmDrumMap(p, { paths });
    expect(gm.bySlot).toEqual({ kick: 36, snare: 38, clap: 39, "hat.closed": 42, "hat.open": 46, "808": 35, crash: 49, riser: 84, "vocal chop": 85 });
    expect(gm.notes[36]).toMatchObject({ slot: "kick", category: "drums.kick", title: "Dark Trap Kick", path: "kick.wav", gm: true });
    expect(gm.notes[84]).toMatchObject({ slot: "riser", gm: false });
    expect(gm.sfz).toContain("<region> key=36 sample=kick.wav");
    expect(gm.sfz).toContain("<region> key=42 group=2 sample=hh.wav");
    expect(gm.sfz).toContain("<region> key=46 group=1 off_by=2 sample=oh.wav");
    expect(gm.sfz).toContain("<region> key=85 sample=vocal-chop.wav"); // no path given → slot-named default
    expect(gm.sfz).toContain("loop_mode=one_shot");
    expect(gm.sfz.indexOf("key=35")).toBeLessThan(gm.sfz.indexOf("key=36"));
  });

  it("gmDrumMap: toms spread over 41/45/48, extra kicks go to 35", () => {
    const slot = (name: string, category: Category) => ({ slot: name, category, alternatives: [], reason: "", pick: s(name, category) });
    const p: KitPlan = {
      name: "kit",
      slots: [slot("kick", "drums.kick"), slot("kick 2", "drums.kick"), slot("low tom", "drums.tom"), slot("tom", "drums.tom"), slot("high tom", "drums.tom"), slot("rim", "drums.perc"), slot("perc", "drums.perc")],
      warnings: [],
      licences: { yes: 7, "yes-with-credit": 0, restricted: 0, "clearance-required": 0, "check-terms": 0, no: 0 },
      creditsNeeded: false,
    };
    expect(gmDrumMap(p).bySlot).toEqual({ kick: 36, "kick 2": 35, "low tom": 41, tom: 45, "high tom": 48, rim: 37, perc: 54 });
  });

  it("kitSamples lists the picks", async () => {
    const p = await plan();
    expect(kitSamples(p).map((x) => x.title)).toContain("Dark Trap Kick");
    expect(kitSamples(p)).toHaveLength(9);
  });
});
