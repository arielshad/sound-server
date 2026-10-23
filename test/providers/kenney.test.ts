import { describe, expect, it } from "vitest";
import { KENNEY_AUDIO_URL, kenney, kenneyCategory, parseListing } from "../../src/providers/kenney.js";
import { fixture, fixtureCtx } from "../helpers.js";

const routes: [RegExp, string][] = [
  [/kenney\.nl\/assets\/category:Audio$/, "kenney/category-audio.html"],
  [/kenney\.nl\/assets\/impact-sounds$/, "kenney/impact-sounds.html"],
  [/kenney\.nl\/assets\/voiceover-pack$/, "kenney/voiceover-pack.html"],
  [/kenney\.nl\/assets\/music-jingles$/, "kenney/music-jingles.html"],
];

describe("kenney (audio packs)", () => {
  it("lists the Audio category with one request", async () => {
    const ctx = fixtureCtx(routes);
    const r = await kenney.search({ query: "", limit: 50 }, ctx);
    expect(ctx.fetch.requests).toEqual([KENNEY_AUDIO_URL]);
    expect(r.total).toBe(10);
    const impact = r.samples.find((s) => s.nativeId === "impact-sounds")!;
    expect(impact).toMatchObject({
      id: "kenney:impact-sounds",
      title: "Impact Sounds",
      url: "https://kenney.nl/assets/impact-sounds",
      category: "fx.impact",
      unit: "pack",
      form: "pack",
      downloadable: true,
      author: "Kenney",
      price: { free: true },
      license: { id: "CC0-1.0", verdict: "yes", assertedBy: "site" },
    });
    expect(impact.thumbnailUrl).toMatch(/^https:\/\/kenney\.nl\/media\/pages\/assets\/impact-sounds\//);
    expect(r.searchUrl).toBe("https://kenney.nl/assets/category:Audio");
  });

  it("maps pack names to categories", async () => {
    const r = await kenney.search({ query: "", limit: 50 }, fixtureCtx(routes));
    expect(Object.fromEntries(r.samples.map((s) => [s.nativeId, s.category]))).toEqual({
      "casino-audio": "foley",
      "sci-fi-sounds": "fx",
      "interface-sounds": "fx",
      "impact-sounds": "fx.impact",
      "voiceover-pack-fighter": "vocals.spoken",
      "voiceover-pack": "vocals.spoken",
      "music-jingles": "other",
      "rpg-audio": "foley",
      "digital-audio": "fx",
      "ui-audio": "fx",
    });
    expect(kenneyCategory("foley-sounds", "Foley Sounds")).toBe("foley");
    expect(kenneyCategory("new-announcer-pack", "New Announcer Pack")).toBe("vocals.spoken");
    expect(kenneyCategory("new-thing", "New Thing")).toBe("fx");
  });

  it("searches names and the site's tags locally, and filters by category", async () => {
    const lasers = await kenney.search({ query: "laser", limit: 5 }, fixtureCtx(routes));
    expect(lasers.samples.map((s) => s.nativeId).sort()).toEqual(["digital-audio", "sci-fi-sounds"]);
    expect(lasers.searchUrl).toBe("https://kenney.nl/assets/category:Audio?search=laser");

    const voices = await kenney.search({ query: "", categories: ["vocals"], limit: 5 }, fixtureCtx(routes));
    expect(voices.samples.map((s) => s.nativeId)).toEqual(["voiceover-pack-fighter", "voiceover-pack"]);

    const page = await kenney.search({ query: "", limit: 3, offset: 3 }, fixtureCtx(routes));
    expect(page.samples.map((s) => s.nativeId)).toEqual(["impact-sounds", "voiceover-pack-fighter", "voiceover-pack"]);
  });

  it("skips the request when the category filter rules Kenney out", async () => {
    const ctx = fixtureCtx(routes);
    const r = await kenney.search({ query: "kick", categories: ["drums"], limit: 5 }, ctx);
    expect(r.samples).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("returns the zip and the <audio> preview from the pack page", async () => {
    const ctx = fixtureCtx(routes);
    const d = await kenney.getSample!("impact-sounds", ctx);
    expect(ctx.fetch.requests).toEqual(["https://kenney.nl/assets/impact-sounds"]);
    expect(d).toMatchObject({
      packSize: 130,
      previewUrl: "https://kenney.nl/media/pages/assets/impact-sounds/4ef56f2408-1677589755/foley-preview.ogg",
      createdAt: "2019-12-19T00:00:00.000Z",
      downloadable: true,
      category: "fx.impact",
    });
    expect(d!.tags).toEqual(expect.arrayContaining(["impact", "foley"]));
    expect(d!.files).toEqual([
      {
        url: "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
        filename: "kenney_impact-sounds.zip",
        format: "zip",
        role: "pack",
      },
      {
        url: "https://kenney.nl/media/pages/assets/impact-sounds/4ef56f2408-1677589755/foley-preview.ogg",
        filename: "foley-preview.ogg",
        format: "ogg",
        role: "preview",
      },
    ]);
    const voice = await kenney.getSample!("voiceover-pack", fixtureCtx(routes));
    expect(voice).toMatchObject({ category: "vocals.spoken", packSize: 90 });
    const jingles = await kenney.getSample!("music-jingles", fixtureCtx(routes));
    expect(jingles).toMatchObject({ category: "other", packSize: 85 });
  });

  it("returns null for unknown or malformed ids", async () => {
    expect(await kenney.getSample!("../x", fixtureCtx(routes))).toBeNull();
    expect(await kenney.getSample!("no-such-pack", fixtureCtx(routes))).toBeNull();
    // The listing parser ignores anything that is not a pack card.
    expect(parseListing(fixture("kenney/impact-sounds.html")).map((e) => e.slug)).not.toContain("impact-sounds");
  });

  it("counts packs for the census", async () => {
    const c = await kenney.census!(fixtureCtx(routes));
    expect(c).toMatchObject({ total: 10, unit: "packs", byCategory: { fx: 5, foley: 2, vocals: 2, other: 1 } });
  });
});
