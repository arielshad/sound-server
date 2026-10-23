import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bestLicense, opengameart, opengameartTiming, pageFor, toLicense } from "../../src/providers/opengameart.js";
import { fixtureCtx } from "../helpers.js";

const BASE = "https://opengameart.org/art-search-advanced?keys=";
const BOTH = "field_art_type_tid%5B%5D=13&field_art_type_tid%5B%5D=12";
const routes: [string | RegExp, string][] = [
  [/keys=explosion&/, "opengameart/search_explosion.html"],
  [/keys=battle&/, "opengameart/search_battle_music.html"],
  [/keys=zzqxv&/, "opengameart/search_empty.html"],
  [`keys=&field_art_type_tid%5B%5D=13`, "opengameart/search_explosion.html"],
  [`keys=&field_art_type_tid%5B%5D=12`, "opengameart/search_battle_music.html"],
  [/\/content\/explosion-0$/, "opengameart/explosion-0.html"],
  [/\/content\/battle-in-the-winter$/, "opengameart/battle-in-the-winter.html"],
];

describe("opengameart", () => {
  it("searches Sound Effect and Music entries in exactly one request", async () => {
    const ctx = fixtureCtx(routes);
    const r = await opengameart.search({ query: "explosion", limit: 3 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${BASE}explosion&${BOTH}`]);
    expect(r.total).toBe(81);
    expect(r.searchUrl).toBe(`${BASE}explosion&${BOTH}`);
    expect(r.samples).toHaveLength(3);
    expect(r.samples[0]).toMatchObject({
      id: "opengameart:explosion-0",
      title: "Explosion",
      url: "https://opengameart.org/content/explosion-0",
      previewUrl: "https://opengameart.org/sites/default/files/explosion_preview.mp3",
      thumbnailUrl: "https://opengameart.org/sites/default/files/styles/thumbnail/public/audio_preview/explosion_preview.mp3.png",
      downloadable: true,
      price: { free: true },
      // Cards never state the licence: the sample page has it.
      license: { verdict: "check-terms", assertedBy: "source" },
    });
  });

  it("picks one page size that covers offset+limit instead of a second request", async () => {
    expect(pageFor(0, 20)).toEqual({ size: 24, page: 0 });
    expect(pageFor(22, 5)).toEqual({ size: 48, page: 0 });
    expect(pageFor(150, 10)).toEqual({ size: 24, page: 6 });
    expect(pageFor(0, 500)).toEqual({ size: 144, page: 0 });
    const ctx = fixtureCtx(routes);
    const r = await opengameart.search({ query: "explosion", limit: 5, offset: 22 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${BASE}explosion&${BOTH}&items_per_page=48`]);
    expect(r.samples).toHaveLength(2); // the 24-card fixture stands in for a 48-card page
  });

  it("narrows the art type from category filters and filters licences for commercial use", async () => {
    const ctx = fixtureCtx(routes);
    const fx = await opengameart.search({ query: "explosion", categories: ["foley"], limit: 2 }, ctx);
    expect(ctx.fetch.requests.at(-1)).toBe(`${BASE}explosion&field_art_type_tid%5B%5D=13`);
    // An unclassified Sound Effect falls back to fx.
    expect(fx.samples[0]).toMatchObject({ category: "fx", categoryEvidence: { by: "source" } });

    await opengameart.search({ query: "battle", categories: ["other"], limit: 2 }, ctx);
    expect(ctx.fetch.requests.at(-1)).toBe(`${BASE}battle&field_art_type_tid%5B%5D=12`);

    const before = ctx.fetch.requests.length;
    expect((await opengameart.search({ query: "explosion", categories: ["vocals.acapella", "keys"], limit: 2 }, ctx)).samples.length).toBeGreaterThan(0);
    expect(ctx.fetch.requests.length).toBe(before + 1);

    const safe = await opengameart.search({ query: "explosion", commercialOnly: true, limit: 2 }, ctx);
    expect(ctx.fetch.requests.at(-1)).toBe(
      `${BASE}explosion&${BOTH}&field_art_licenses_tid%5B%5D=4&field_art_licenses_tid%5B%5D=2&field_art_licenses_tid%5B%5D=17981&field_art_licenses_tid%5B%5D=10310&field_art_licenses_tid%5B%5D=31772`,
    );
    expect(safe.samples[0]!.license).toMatchObject({ verdict: "yes-with-credit", commercialUse: true });
    expect(opengameart.nativeFilters).toEqual(["categories", "commercialOnly"]);
  });

  it("returns no samples for an empty result page", async () => {
    const ctx = fixtureCtx(routes);
    const r = await opengameart.search({ query: "zzqxv", limit: 10 }, ctx);
    expect(r.samples).toEqual([]);
    expect(r.total).toBe(0);
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("reads licence, tags, author and plain-GET files from a sound effect page", async () => {
    const ctx = fixtureCtx(routes);
    const d = await opengameart.getSample!("explosion-0", ctx);
    expect(ctx.fetch.requests).toEqual(["https://opengameart.org/content/explosion-0"]);
    expect(d).toMatchObject({
      id: "opengameart:explosion-0",
      title: "Explosion",
      author: "TinyWorlds",
      authorUrl: "https://opengameart.org/users/tinyworlds",
      createdAt: "2015-01-28",
      category: "fx.impact", // from the "boom" tag
      license: { id: "CC0-1.0", verdict: "yes" },
      formats: ["wav"],
      unit: "sample",
      downloadable: true,
      previewUrl: "https://opengameart.org/sites/default/files/explosion_preview.mp3",
    });
    expect(d!.tags).toEqual(["explosion", "explode", "boom", "retro"]);
    expect(d!.files).toEqual([
      { url: "https://opengameart.org/sites/default/files/explosion.wav", filename: "explosion.wav", format: "wav", role: "original", sizeBytes: 86796 },
      { url: "https://opengameart.org/sites/default/files/explosion_preview.mp3", filename: "explosion_preview.mp3", format: "mp3", role: "preview" },
    ]);
  });

  it("offers the most permissive of several licences on a music page", async () => {
    const d = await opengameart.getSample!("battle-in-the-winter", fixtureCtx(routes));
    expect(d).toMatchObject({
      title: "Battle in the winter",
      author: "jobromedia",
      category: "other",
      form: "phrase",
      license: { id: "CC-BY-3.0", verdict: "yes-with-credit" },
    });
    expect(d!.attribution).toContain("by jobromedia (OpenGameArt)");
    expect(d!.files[0]).toMatchObject({ filename: "Battle in the winter.mp3", role: "original", sizeBytes: 10500265 });
  });

  it("maps OpenGameArt's licence names", () => {
    expect(toLicense("CC0", "http://creativecommons.org/publicdomain/zero/1.0/")).toMatchObject({ id: "CC0-1.0", verdict: "yes" });
    expect(toLicense("CC-BY 4.0", "https://creativecommons.org/licenses/by/4.0/")).toMatchObject({ id: "CC-BY-4.0", verdict: "yes-with-credit" });
    expect(toLicense("CC-BY-SA 3.0")).toMatchObject({ id: "CC-BY-SA-3.0", verdict: "restricted" });
    expect(toLicense("OGA-BY 3.0", "http://opengameart.org/content/oga-by-30-faq")).toMatchObject({ name: "OGA-BY 3.0", verdict: "yes-with-credit" });
    expect(toLicense("GPL 2.0", "http://www.gnu.org/licenses/old-licenses/gpl-2.0.html")).toMatchObject({ name: "GPL 2.0", verdict: "check-terms" });
    expect(bestLicense([toLicense("GPL 3.0"), toLicense("CC-BY-SA 4.0"), toLicense("OGA-BY 4.0")])!.name).toBe("OGA-BY 4.0");
  });

  it("returns null for unknown or malformed ids", async () => {
    const ctx = fixtureCtx(routes);
    expect(await opengameart.getSample!("no-such-entry", ctx)).toBeNull();
    expect(await opengameart.getSample!("../etc", ctx)).toBeNull();
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("builds search links", () => {
    expect(opengameart.buildSearchUrl({ query: "laser shot", limit: 1 })).toBe(`${BASE}laser+shot&${BOTH}`);
    expect(opengameart.buildSearchUrl({ query: "chiptune", categories: ["other"], limit: 1 })).toBe(`${BASE}chiptune&field_art_type_tid%5B%5D=12`);
  });

  describe("census", () => {
    beforeEach(() => {
      opengameartTiming.crawlDelayMs = 0;
    });
    afterEach(() => {
      opengameartTiming.crawlDelayMs = 10_000;
    });
    it("counts Sound Effect and Music listings", async () => {
      const ctx = fixtureCtx(routes);
      const c = await opengameart.census!(ctx);
      expect(ctx.fetch.requests).toHaveLength(2);
      expect(c).toMatchObject({ total: 81 + 868, free: 81 + 868, byCategory: { fx: 81, other: 868 } });
    });
  });
});
