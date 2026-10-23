import { describe, expect, it } from "vitest";
import { freewavesamples, rootNoteFromTitle } from "../../src/providers/freewavesamples.js";
import { fixtureCtx } from "../helpers.js";

const SITE = "https://freewavesamples.com";
const routes: [string | RegExp, string][] = [
  ["/search?q=kick", "freewavesamples/search_kick.html"],
  ["/search?q=piano", "freewavesamples/search_piano.html"],
  ["/search?q=", "freewavesamples/search_empty.html"],
  [/\/boom-kick$/, "freewavesamples/boom-kick.html"],
  [/\/kawai-k1-ii-brt-el-piano-c4$/, "freewavesamples/kawai-k1-ii-brt-el-piano-c4.html"],
  ["/sample-type/", "freewavesamples/category_drums_kick.html"],
];

describe("freewavesamples", () => {
  it("maps search hits to samples with one request, skipping category and instrument hits", async () => {
    const ctx = fixtureCtx(routes);
    const r = await freewavesamples.search({ query: "kick", limit: 5 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/search?q=kick`]);
    expect(r.searchUrl).toBe(`${SITE}/search?q=kick`);
    expect(r.total).toBe(49); // 50 hits minus the "Drums - Kick" category
    expect(r.samples).toHaveLength(5);
    expect(r.samples[0]).toMatchObject({
      id: "freewavesamples:boom-kick",
      title: "Boom Kick",
      url: `${SITE}/boom-kick`,
      category: "drums.kick",
      formats: ["wav"],
      downloadable: true,
      price: { free: true },
      license: { verdict: "yes", assertedBy: "site", attributionRequired: false, url: `${SITE}/about-us-license` },
    });
    // The WAV name is not derivable from the hit, so no preview until getSample.
    expect(r.samples[0]!.previewUrl).toBeUndefined();
    expect(r.samples.every((s) => !s.url.includes("/sample-type/"))).toBe(true);
  });

  it("keeps the blurb when it says more than the title, and pages locally", async () => {
    const all = await freewavesamples.search({ query: "kick", limit: 100 }, fixtureCtx(routes));
    expect(all.samples.find((s) => s.nativeId === "ensoniq-sq-1-rock-kick")?.description).toBe(`From the "Big Ol'Rock Kit" drum kit.`);
    const page = await freewavesamples.search({ query: "kick", limit: 2, offset: 3 }, fixtureCtx(routes));
    expect(page.samples.map((s) => s.id)).toEqual(all.samples.slice(3, 5).map((s) => s.id));
  });

  it("reads root notes from pitched titles", async () => {
    const r = await freewavesamples.search({ query: "piano", limit: 100 }, fixtureCtx(routes));
    const c4 = r.samples.find((s) => s.nativeId === "kawai-k1-ii-brt-el-piano-c4");
    expect(c4).toMatchObject({ rootNote: 60, form: "one-shot", category: "keys" });
    expect(r.samples.find((s) => s.nativeId === "korg-m3r-grand-piano-c1")?.rootNote).toBe(24);
    expect(r.samples.some((s) => s.nativeId.startsWith("sample-type") || s.url.includes("/source/"))).toBe(false);
    expect(rootNoteFromTitle("Ensoniq ESQ-1 Piano C4")).toBe(60);
    expect(rootNoteFromTitle("Strings F#3")).toBe(54);
    expect(rootNoteFromTitle("Roland D-20 Kick")).toBeUndefined();
    expect(rootNoteFromTitle("Roland TR-808")).toBeUndefined();
  });

  it("returns nothing for no hits or an empty query", async () => {
    const ctx = fixtureCtx(routes);
    expect((await freewavesamples.search({ query: "zzqxv", limit: 5 }, ctx)).samples).toEqual([]);
    const browse = await freewavesamples.search({ query: " ", limit: 5 }, ctx);
    expect(browse).toEqual({ samples: [], searchUrl: SITE });
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("resolves the WAV, category and specs from the detail page", async () => {
    const ctx = fixtureCtx(routes);
    const d = await freewavesamples.getSample!("boom-kick", ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/boom-kick`]);
    expect(d).toMatchObject({
      id: "freewavesamples:boom-kick",
      title: "Boom Kick",
      category: "drums.kick",
      categoryEvidence: { by: "source" },
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      createdAt: "2015-02-11",
      popularity: 148504,
      previewUrl: `${SITE}/files/Boom-Kick.wav`,
      downloadable: true,
    });
    expect(d!.tags).toEqual(["bass drum 2", "bass drum 1"]);
    expect(d!.files).toEqual([
      { url: `${SITE}/files/Boom-Kick.wav`, filename: "Boom-Kick.wav", format: "wav", role: "original", sampleRate: 44100, bitDepth: 16, channels: 2 },
    ]);
  });

  it("maps instrument notes to keys with a root note", async () => {
    const d = await freewavesamples.getSample!("kawai-k1-ii-brt-el-piano-c4", fixtureCtx(routes));
    expect(d).toMatchObject({
      title: "Kawai K1 II Brt El Piano C4",
      description: "A bright electric piano sound.",
      category: "keys",
      rootNote: 60,
      form: "one-shot",
      createdAt: "2026-03-01",
    });
    expect(d!.tags).toContain("kawai k1 ii");
    expect(d!.files[0]!.url).toBe(`${SITE}/files/Kawai-K1-II-Brt-El-Piano-C4.wav`);
  });

  it("returns null for unknown or malformed ids without fetching bad paths", async () => {
    const ctx = fixtureCtx(routes);
    expect(await freewavesamples.getSample!("no-such-sample", ctx)).toBeNull();
    expect(await freewavesamples.getSample!("../etc/passwd", ctx)).toBeNull();
    expect(await freewavesamples.getSample!("about-us-license", ctx)).toBeNull();
    expect(ctx.fetch.requests).toEqual([`${SITE}/no-such-sample`]);
  });

  it("builds search links", () => {
    expect(freewavesamples.buildSearchUrl({ query: "808 snare", limit: 1 })).toBe(`${SITE}/search?q=808+snare`);
    expect(freewavesamples.buildSearchUrl({ query: "", limit: 1 })).toBe(SITE);
  });

  it("counts the catalogue from the top-level category pages", async () => {
    const ctx = fixtureCtx(routes);
    const c = await freewavesamples.census!(ctx);
    expect(ctx.fetch.requests).toHaveLength(10);
    expect(c.total).toBe(970); // the fixture says 97 for every page
    expect(c.byCategory).toMatchObject({ drums: 97 * 3, synth: 97, fx: 97, other: 97 });
    expect(c.free).toBe(c.total);
  });
});
