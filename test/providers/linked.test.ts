import { describe, expect, it } from "vitest";
import type { Provider, SampleQuery } from "../../src/core/types.js";
import { TOP_CATEGORIES, SAMPLE_FORMS } from "../../src/core/vocab.js";
import * as linked from "../../src/providers/linked.js";
import { fixtureCtx } from "../helpers.js";

const q = (o: Partial<SampleQuery>): SampleQuery => ({ query: "", limit: 10, ...o });
const SIMPLE = q({ query: "dark piano" });
const BPM_KEY = q({ query: "trap", bpm: { min: 140, max: 140 }, key: { tonic: "F#", mode: "minor" } });
const EMPTY = q({ query: "" });

/** [simple, bpm+key, empty] for every link provider. */
const EXPECTED: Record<string, [string, string, string]> = {
  splice: [
    "https://splice.com/sounds/search/samples?q=dark+piano",
    "https://splice.com/sounds/search/samples?q=trap&bpm=140&key=F%23&chord_type=minor",
    "https://splice.com/sounds/search/samples",
  ],
  loopmasters: [
    "https://www.loopmasters.com/search?q=dark+piano",
    "https://www.loopmasters.com/search?q=trap+140+bpm+F%23+minor",
    "https://www.loopmasters.com/",
  ],
  loopcloud: [
    "https://sounds.loopcloud.com/search?q=dark+piano",
    "https://sounds.loopcloud.com/search?q=trap+140+bpm+F%23+minor",
    "https://sounds.loopcloud.com/",
  ],
  producerloops: [
    "https://www.producerloops.com/search.php?mode=search&substring=dark+piano",
    "https://www.producerloops.com/search.php?mode=search&substring=trap+140+bpm+F%23+minor",
    "https://www.producerloops.com/",
  ],
  adsr: [
    "https://www.adsrsounds.com/?fastwpac_s=dark+piano",
    "https://www.adsrsounds.com/?fastwpac_s=trap+140+bpm+F%23+minor",
    "https://www.adsrsounds.com/",
  ],
  pluginboutique: [
    "https://www.pluginboutique.com/search?q=dark+piano",
    "https://www.pluginboutique.com/search?q=trap+140+bpm+F%23+minor",
    "https://www.pluginboutique.com/categories/99-Sample-Packs",
  ],
  landr: [
    "https://samples.landr.com/browse?textsearch=dark+piano",
    "https://samples.landr.com/browse?textsearch=trap&bpmlowerbound=140&bpmupperbound=140&keyrootnote=FSharpGFlat&keyquality=minor",
    "https://samples.landr.com/browse",
  ],
  tracklib: ["https://www.tracklib.com/songs", "https://www.tracklib.com/songs", "https://www.tracklib.com/songs"],
  looperman: [
    "https://www.looperman.com/loops?keys=dark+piano",
    "https://www.looperman.com/loops?keys=trap&ftempo=140&ttempo=140&mkey=fsm",
    "https://www.looperman.com/loops",
  ],
  samplefocus: [
    "https://samplefocus.com/samples?search=dark+piano",
    "https://samplefocus.com/samples?search=trap+140+bpm+F%23+minor",
    "https://samplefocus.com/samples",
  ],
  zapsplat: [
    "https://www.zapsplat.com/?s=dark+piano&post_type=music",
    "https://www.zapsplat.com/?s=trap+140+bpm+F%23+minor&post_type=music",
    "https://www.zapsplat.com/sound-effect-categories/",
  ],
  pixabay: [
    "https://pixabay.com/sound-effects/search/dark%20piano/",
    "https://pixabay.com/sound-effects/search/trap%20140%20bpm%20F%23%20minor/",
    "https://pixabay.com/sound-effects/",
  ],
  sonniss: [
    "https://sonniss.com/?s=dark+piano&post_type=product",
    "https://sonniss.com/?s=trap+140+bpm+F%23+minor&post_type=product",
    "https://sonniss.com/gameaudiogdc",
  ],
  uppbeat: [
    "https://uppbeat.io/sfx/search?query=dark+piano",
    "https://uppbeat.io/sfx/search?query=trap+140+bpm+F%23+minor",
    "https://uppbeat.io/sfx",
  ],
  bandcamp: [
    "https://bandcamp.com/search?q=dark+piano+sample+pack&item_type=a",
    "https://bandcamp.com/search?q=trap+140+bpm+F%23+minor+sample+pack&item_type=a",
    "https://bandcamp.com/tag/sample-pack",
  ],
  soundsnap: [
    "https://www.soundsnap.com/search/audio?query=dark+piano",
    "https://www.soundsnap.com/search/audio?query=trap+140+bpm+F%23+minor",
    "https://www.soundsnap.com/",
  ],
  epidemicsound: [
    "https://www.epidemicsound.com/sound-effects/?term=dark+piano",
    "https://www.epidemicsound.com/sound-effects/?term=trap+140+bpm+F%23+minor",
    "https://www.epidemicsound.com/sound-effects/",
  ],
  artlist: [
    "https://artlist.io/sfx/search?terms=dark+piano",
    "https://artlist.io/sfx/search?terms=trap+140+bpm+F%23+minor",
    "https://artlist.io/sfx",
  ],
};

const providers: Provider[] = linked.linkedProviders;

describe("link-only providers", () => {
  it("lists every provider once, with an expected-URL row each", () => {
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  describe.each(providers.map((p) => [p.id, p] as const))("%s", (id, p) => {
    it("is a well-formed link provider", () => {
      expect(p.access).toBe("link");
      expect(p.supportsDownload).toBe(false);
      expect(p.homepage).toMatch(/^https:\/\//);
      expect(p.description.length).toBeGreaterThan(30);
      expect(p.categories.length).toBeGreaterThan(0);
      for (const c of p.categories) expect(TOP_CATEGORIES).toContain(c);
      for (const f of p.forms ?? []) expect(SAMPLE_FORMS).toContain(f);
      expect(["free", "freemium", "paid"]).toContain(p.pricing);
    });

    it("builds the simple, bpm+key and empty search URLs", () => {
      const [simple, bpmKey, empty] = EXPECTED[id]!;
      expect(p.buildSearchUrl(SIMPLE)).toBe(simple);
      expect(p.buildSearchUrl(BPM_KEY)).toBe(bpmKey);
      expect(p.buildSearchUrl(EMPTY)).toBe(empty);
      for (const u of [simple, bpmKey, empty]) expect(() => new URL(u)).not.toThrow();
    });

    it("search returns no samples, the search URL and makes no requests", async () => {
      const ctx = fixtureCtx([]);
      expect(await p.search(SIMPLE, ctx)).toEqual({ samples: [], searchUrl: EXPECTED[id]![0] });
      expect(ctx.fetch.requests).toEqual([]);
    });
  });
});

describe("native URL parameters", () => {
  it("splice: BPM range, key without mode, loop/one-shot", () => {
    expect(linked.splice.buildSearchUrl(q({ query: "kick", bpm: { min: 120, max: 128 }, forms: ["one-shot"] }))).toBe(
      "https://splice.com/sounds/search/samples?q=kick&min_bpm=120&max_bpm=128&asset_category_slug=oneshot",
    );
    expect(linked.splice.buildSearchUrl(q({ query: "pad", key: { tonic: "C" }, forms: ["loop"] }))).toBe(
      "https://splice.com/sounds/search/samples?q=pad&key=C&asset_category_slug=loop",
    );
    // Both forms asked: no type filter.
    expect(linked.splice.buildSearchUrl(q({ query: "snare", forms: ["loop", "one-shot"] }))).toBe("https://splice.com/sounds/search/samples?q=snare");
  });

  it("landr: range, type and free", () => {
    expect(linked.landr.buildSearchUrl(q({ query: "house", bpm: { min: 120, max: 126 }, forms: ["loop"], freeOnly: true }))).toBe(
      "https://samples.landr.com/browse?textsearch=house&bpmlowerbound=120&bpmupperbound=126&type=loop&tags=free",
    );
    expect(linked.landr.buildSearchUrl(q({ query: "clap", forms: ["one-shot"], key: { tonic: "A#", mode: "major" } }))).toBe(
      "https://samples.landr.com/browse?textsearch=clap&keyrootnote=ASharpBFlat&keyquality=major&type=one_shot",
    );
  });

  it("looperman: a cappellas for vocal queries, key codes, open BPM ranges", () => {
    expect(linked.looperman.buildSearchUrl(q({ query: "soul female", hints: ["vocals"], key: { tonic: "A", mode: "minor" } }))).toBe(
      "https://www.looperman.com/acapellas?keys=soul+female&mkey=am",
    );
    expect(linked.looperman.buildSearchUrl(q({ query: "rap", categories: ["vocals.acapella"], bpm: { min: 90, max: 90 } }))).toBe(
      "https://www.looperman.com/acapellas?keys=rap+90+bpm",
    );
    // Vocal loops stay in the loop section.
    expect(linked.looperman.buildSearchUrl(q({ query: "vocal chop", hints: ["vocals.chop"], forms: ["loop"] }))).toBe(
      "https://www.looperman.com/loops?keys=vocal+chop",
    );
    // A key without a mode has no Looperman code: it goes into the text.
    expect(linked.looperman.buildSearchUrl(q({ query: "piano", key: { tonic: "C#" }, bpm: { min: 85 } }))).toBe(
      "https://www.looperman.com/loops?keys=piano+C%23&ftempo=85",
    );
    expect(linked.looperman.buildSearchUrl(q({ query: "", key: { tonic: "D#", mode: "major" } }))).toBe("https://www.looperman.com/loops?mkey=ds");
  });

  it("pluginboutique: free shortcut", () => {
    expect(linked.pluginboutique.buildSearchUrl(q({ query: "808", freeOnly: true }))).toBe("https://www.pluginboutique.com/search?q=808&shortcut=free");
    expect(linked.pluginboutique.buildSearchUrl(q({ query: "", freeOnly: true }))).toBe("https://www.pluginboutique.com/search?shortcut=free");
  });

  it("bandcamp: does not add 'sample pack' when the query already names a pack", () => {
    expect(linked.bandcamp.buildSearchUrl(q({ query: "lofi drum kit" }))).toBe("https://bandcamp.com/search?q=lofi+drum+kit&item_type=a");
  });

  it("text-only sites get the BPM range words from linkTerms only for an exact BPM", () => {
    expect(linked.loopmasters.buildSearchUrl(q({ query: "techno", bpm: { min: 125, max: 130 } }))).toBe("https://www.loopmasters.com/search?q=techno");
  });
});

describe("licences", () => {
  it("states the commercial verdict each site's terms give", () => {
    const v = (p: Provider) => p.license?.verdict;
    expect(v(linked.tracklib)).toBe("clearance-required");
    expect(v(linked.looperman)).toBe("check-terms");
    expect(linked.looperman.license?.assertedBy).toBe("uploader");
    expect(v(linked.samplefocus)).toBe("check-terms");
    expect(v(linked.zapsplat)).toBe("yes-with-credit");
    expect(linked.zapsplat.license?.attributionRequired).toBe(true);
    expect(v(linked.pixabay)).toBe("yes");
    for (const p of [linked.soundsnap, linked.epidemicsound, linked.artlist, linked.uppbeat]) expect(v(p)).toBe("check-terms");
    for (const p of [linked.splice, linked.loopmasters, linked.loopcloud, linked.producerloops, linked.adsr, linked.landr, linked.sonniss]) {
      expect(v(p)).toBe("yes");
      expect(p.license?.redistribution).toBe(false);
    }
    // Per-label or per-artist licences: none claimed for the site.
    expect(linked.pluginboutique.license).toBeUndefined();
    expect(linked.bandcamp.license).toBeUndefined();
  });
});
