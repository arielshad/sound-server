import { describe, expect, it } from "vitest";
import { classify, soundTokens } from "../src/core/classify.js";
import { attributionLine, creativeCommons, license, parseLicense, royaltyFree } from "../src/core/licence.js";
import { bpmFromText, keyFromText, keyMatches, normalizePitch, parseQuery } from "../src/core/query.js";
import { makeSample, matchScore, parseSampleId } from "../src/core/util.js";

describe("classify", () => {
  it.each([
    ["Deep Kick 01", "drums.kick"],
    ["808 Snare", "drums.snare"],
    ["808 Kick", "drums.kick"],
    ["Dark 808 Bass", "bass.808"],
    ["bass drum hit", "drums.kick"],
    ["Closed HiHat 3", "drums.hat.closed"],
    ["OpenHat_02.wav", "drums.hat.open"],
    ["Vocal Chop Fmin", "vocals.chop"],
    ["Laser Zap", "fx.zap"],
    ["White Noise Riser", "fx.riser"],
    ["rain on window", "ambience"],
    ["Kickstarter promo", "other"],
  ])("%s -> %s", (title, category) => expect(classify({ title }).category).toBe(category));

  it("uses the source's categories and tags", () => {
    expect(classify({ title: "Sample 12", sourceCategories: ["Drums > Snares"] }).category).toBe("drums.snare");
    expect(classify({ title: "Untitled", tags: ["clap", "trap"] }).category).toBe("drums.clap");
  });

  it("decides one-shot vs loop from words, duration and tempo", () => {
    expect(classify({ title: "Kick", durationSec: 0.4 }).form).toBe("one-shot");
    expect(classify({ title: "Drum Loop" }).form).toBe("loop");
    expect(classify({ title: "Groove", durationSec: 8, bpm: 120 }).form).toBe("loop");
    expect(classify({ title: "Pad texture", durationSec: 20 }).form).toBeUndefined();
  });

  it("splits camelCase and digits", () => {
    expect(soundTokens("DeepKick01_TR808")).toEqual(["deep", "kick", "01", "tr", "808"]);
  });
});

describe("query parsing", () => {
  it("pulls BPM, key and form words out of the query", () => {
    expect(parseQuery("140 bpm dark trap 808 in F minor")).toMatchObject({
      query: "dark trap 808",
      bpm: { min: 140, max: 140 },
      key: { tonic: "F", mode: "minor" },
      hints: ["bass.808"],
    });
    expect(parseQuery("lofi drum loop 80-90 bpm")).toMatchObject({ query: "lofi drum loop", bpm: { min: 80, max: 90 }, forms: ["loop"] });
    expect(parseQuery("vocal chops Abm").key).toEqual({ tonic: "G#", mode: "minor" });
    expect(parseQuery("I am a snare").key).toBeUndefined();
  });

  it("reads BPM and key from file names", () => {
    expect(bpmFromText("Trap_Loop_140BPM_Fmin.wav")).toBe(140);
    expect(keyFromText("Trap_Loop_140BPM_Fmin.wav")).toEqual({ tonic: "F", mode: "minor" });
    expect(keyFromText("Bass C#m 01")).toEqual({ tonic: "C#", mode: "minor" });
    expect(keyFromText("pad E flat major")).toEqual({ tonic: "D#", mode: "major" });
    expect(bpmFromText("Room 101")).toBeUndefined();
  });

  it("spells pitches with sharps and matches relative keys", () => {
    expect(normalizePitch("e", "b")).toBe("D#");
    expect(normalizePitch("B", "#")).toBe("C");
    expect(keyMatches({ tonic: "G#", mode: "major" }, { tonic: "F", mode: "minor" }, true)).toBe(true);
    expect(keyMatches({ tonic: "G#", mode: "major" }, { tonic: "F", mode: "minor" })).toBe(false);
  });
});

describe("licences", () => {
  it.each([
    ["http://creativecommons.org/publicdomain/zero/1.0/", "CC0-1.0", "yes"],
    ["Creative Commons 0", "CC0-1.0", "yes"],
    ["https://creativecommons.org/licenses/by/4.0/", "CC-BY-4.0", "yes-with-credit"],
    ["Attribution NonCommercial", "CC-BY-NC-4.0", "no"],
    ["CC BY-SA 3.0", "CC-BY-SA-3.0", "restricted"],
    ["https://creativecommons.org/licenses/by-nd/4.0/", "CC-BY-ND-4.0", "no"],
    ["http://creativecommons.org/licenses/sampling+/1.0/", "LicenseRef-Sampling-Plus-1.0", "restricted"],
    ["Public domain", "CC-PDM-1.0", "yes"],
  ])("%s -> %s (%s)", (input, id, verdict) => {
    const l = parseLicense(input)!;
    expect(l.id).toBe(id);
    expect(l.verdict).toBe(verdict);
  });

  it("never treats an uploader's claim as cleared", () => {
    expect(license("CC0-1.0", "uploader").verdict).toBe("check-terms");
    expect(creativeCommons({}, "4.0", "uploader").verdict).toBe("check-terms");
  });

  it("royalty-free site licences allow music use but not redistribution", () => {
    const l = royaltyFree("Mixkit licence");
    expect(l).toMatchObject({ verdict: "yes", redistribution: false, assertedBy: "site" });
    expect(royaltyFree("X", { attributionRequired: true }).verdict).toBe("yes-with-credit");
  });

  it("writes a credit line only when attribution is required", () => {
    const s = { title: "Kick", author: "Jane", url: "https://x/1", provider: "freesound", license: creativeCommons({}) };
    expect(attributionLine(s, "Freesound")).toBe("“Kick” by Jane (Freesound), https://x/1, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)");
    expect(attributionLine({ ...s, license: license("CC0-1.0") })).toBeUndefined();
  });
});

describe("makeSample", () => {
  it("fills category, form, BPM, key and credits from the words", () => {
    const s = makeSample({ provider: "x", nativeId: "1", title: "Vocal Chop Loop 140 BPM Fmin", tags: ["Vocals"], url: "https://x", downloadable: true, durationSec: 6.86 });
    expect(s).toMatchObject({ id: "x:1", category: "vocals.chop", form: "loop", unit: "sample", bpm: 140, key: { tonic: "F", mode: "minor" }, tags: ["vocals"] });
    expect(s.categoryEvidence?.by).toBe("rules");
  });
  it("keeps the source's own category", () => {
    const s = makeSample({ provider: "x", nativeId: "1", title: "Thing", category: "fx.zap", tags: [], url: "https://x", downloadable: true });
    expect(s.categoryEvidence).toEqual({ by: "source", confidence: 1 });
  });
});

describe("matchScore", () => {
  it("prefers title over tags and handles plurals", () => {
    expect(matchScore({ title: "Snare Rolls" }, "snare roll")).toBe(1);
    expect(matchScore({ title: "Hit", tags: ["snare"] }, "snare")).toBeCloseTo(0.7);
    expect(matchScore({ title: "Kick" }, "snare")).toBe(0);
  });
});

describe("parseSampleId", () => {
  it("splits on the first colon only", () => {
    expect(parseSampleId("strudel:tr808:bd:3")).toEqual({ provider: "strudel", nativeId: "tr808:bd:3" });
    expect(parseSampleId("bad")).toBeNull();
  });
});
