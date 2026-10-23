import { describe, expect, it } from "vitest";
import { SAMPLERADAR_INDEX_URL, nativeIdFromUrl, packCategory, packGenres, parseIndex, sampleradar } from "../../src/providers/sampleradar.js";
import { fixture, fixtureCtx } from "../helpers.js";

const routes: [RegExp, string][] = [
  [/free-music-samples-royalty-free-loops-hits-and-multis-to-download-sampleradar$/, "sampleradar/index.html"],
  [/\/news\/tech\/sampleradar-236-free-wonky-step-samples-328102$/, "sampleradar/wonky-step.html"],
  [/\/music-tech\/samples\/sampleradar-213-free-wooden-percussion-samples$/, "sampleradar/wooden-percussion.html"],
  [/\/news\/tech\/no-zip-article$/, "sampleradar/no-zip.html"],
];

describe("sampleradar", () => {
  it("reads every pack link from the hub article with one cached request", async () => {
    const ctx = fixtureCtx(routes);
    const r = await sampleradar.search({ query: "", limit: 100 }, ctx);
    expect(ctx.fetch.requests).toEqual([SAMPLERADAR_INDEX_URL]);
    // 1 latest update + 2 (0-9) + 14 A-Z; recirculation cards, how-to and author links are ignored
    expect(r.total).toBe(17);
    const ids = r.samples.map((s) => s.nativeId);
    expect(ids).not.toContain("music-tech/samples/sampleradar-505-free-rave-synths-samples");
    expect(ids).not.toContain("music-tech/samples/sampleradar-473-free-sub-bass-samples");
    expect(ids).not.toContain("how-to/create-your-own-sample-packs");
    const wooden = r.samples.find((s) => s.nativeId === "music-tech/samples/sampleradar-213-free-wooden-percussion-samples")!;
    expect(wooden).toMatchObject({
      id: "sampleradar:music-tech/samples/sampleradar-213-free-wooden-percussion-samples",
      title: "SampleRadar: 213 free wooden percussion samples",
      url: "https://www.musicradar.com/music-tech/samples/sampleradar-213-free-wooden-percussion-samples",
      unit: "pack",
      form: "pack",
      packSize: 213,
      downloadable: true,
      price: { free: true },
      author: "MusicRadar",
      license: { name: "MusicRadar SampleRadar licence", verdict: "yes", redistribution: false, url: SAMPLERADAR_INDEX_URL },
    });
    expect(wooden.category).toBe("drums");
    const vocals = r.samples.find((s) => s.title.includes("female vocal"))!;
    expect(vocals).toMatchObject({ category: "vocals", packSize: 1338 });
  });

  it("maps pack names to categories and genres", async () => {
    const r = await sampleradar.search({ query: "", limit: 100 }, fixtureCtx(routes));
    const byName = Object.fromEntries(r.samples.map((s) => [s.title.replace(/^SampleRadar: /, ""), s.category]));
    expect(byName).toMatchObject({
      "378 free 808 drum samples": "drums",
      "105 free 808 weight samples": "bass.808",
      "493 creative kick drum samples": "drums.kick",
      "435 free glitch vocal samples": "vocals",
      "338 free FX samples": "fx",
      "382 free ambient samples": "ambience",
      "266 free acoustic guitar samples": "guitar",
      "250 free bass synth samples": "synth",
      "488 free broken piano samples": "keys",
      "282 experimental breaks samples": "drums.break",
      "586 free analogue drum and bass samples": "other",
    });
    expect(packCategory("free trap drum").category).toBe("drums");
    expect(packGenres("analogue drum and bass")).toEqual(["drum and bass"]);
    expect(packGenres("'90s hip-hop")).toEqual(["hip hop"]);
    const dnb = r.samples.find((s) => s.title.includes("drum and bass"))!;
    expect(dnb.genres).toEqual(["drum and bass"]);
  });

  it("searches titles locally and filters by category", async () => {
    const r = await sampleradar.search({ query: "808", limit: 10 }, fixtureCtx(routes));
    expect(r.samples.map((s) => s.packSize)).toEqual([378, 105]);
    expect(r.searchUrl).toBe("https://www.musicradar.com/search?searchTerm=sampleradar+808");

    const drums = await sampleradar.search({ query: "", categories: ["drums"], limit: 50 }, fixtureCtx(routes));
    expect(drums.samples.every((s) => s.category.startsWith("drums"))).toBe(true);
    expect(drums.total).toBe(5);

    const page = await sampleradar.search({ query: "", limit: 2, offset: 1 }, fixtureCtx(routes));
    expect(page.samples).toHaveLength(2);
    expect(page.samples[0]!.packSize).toBe(378);

    const none = await sampleradar.search({ query: "bagpipes", limit: 10 }, fixtureCtx(routes));
    expect(none).toMatchObject({ samples: [], total: 0 });
  });

  it("finds the zip, demo mp3s and date on the pack page", async () => {
    const ctx = fixtureCtx(routes);
    const d = await sampleradar.getSample!("news/tech/sampleradar-236-free-wonky-step-samples-328102", ctx);
    // article + HEAD for the zip size (unanswered offline, so the size stays unknown)
    expect(ctx.fetch.requests).toEqual([
      "https://www.musicradar.com/news/tech/sampleradar-236-free-wonky-step-samples-328102",
      "https://cdn.mos.musicradar.com/audio/samples/musicradar-wonky-steps-samples.zip",
    ]);
    expect(d).toMatchObject({
      title: "SampleRadar: 236 free wonky step samples",
      packSize: 236,
      downloadable: true,
      previewUrl: "https://cdn.mos.musicradar.com/audio/samples/wonky-steps-demo-loops/WSk1BeatC120-01.mp3",
      thumbnailUrl: "https://cdn.mos.cms.futurecdn.net/02d1c758f5f07361aec21e88634059d8-850-80.jpg",
      createdAt: "2010-12-10T11:40:00.000Z",
    });
    expect(d!.files).toEqual([
      {
        url: "https://cdn.mos.musicradar.com/audio/samples/musicradar-wonky-steps-samples.zip",
        filename: "musicradar-wonky-steps-samples.zip",
        format: "zip",
        role: "pack",
      },
      {
        url: "https://cdn.mos.musicradar.com/audio/samples/wonky-steps-demo-loops/WSk1BeatC120-01.mp3",
        filename: "WSk1BeatC120-01.mp3",
        format: "mp3",
        role: "preview",
      },
    ]);
  });

  it("records the zip size from a HEAD and skips SoundCloud embeds as previews", async () => {
    const ctx = fixtureCtx(routes);
    const head = new Response(null, { headers: { "content-length": "185426017" } });
    const raw = ctx.fetch.raw;
    ctx.fetch.raw = async (url, init) => (url.endsWith(".zip") && init?.method === "HEAD" ? head : raw(url, init));
    const d = await sampleradar.getSample!("music-tech/samples/sampleradar-213-free-wooden-percussion-samples", ctx);
    expect(d!.previewUrl).toBeUndefined();
    expect(d!.description).toMatch(/wooden objects/);
    expect(d!.files).toEqual([
      {
        url: "https://cdn.mos.musicradar.com/musicradar-wooden-percussion-samples.zip",
        filename: "musicradar-wooden-percussion-samples.zip",
        format: "zip",
        role: "pack",
        sizeBytes: 185426017,
      },
    ]);
  });

  it("marks a page without a zip as not downloadable and rejects foreign ids", async () => {
    const d = await sampleradar.getSample!("news/tech/no-zip-article", fixtureCtx(routes));
    expect(d).toMatchObject({ downloadable: false, files: [] });
    expect(await sampleradar.getSample!("../etc/passwd", fixtureCtx(routes))).toBeNull();
    expect(await sampleradar.getSample!("news/tech/missing-article", fixtureCtx(routes))).toBeNull();
    expect(nativeIdFromUrl("https://example.com/news/x")).toBeUndefined();
    expect(nativeIdFromUrl("https://www.musicradar.com/news/sampleradar-378-free-808-drum-samples")).toBe("news/sampleradar-378-free-808-drum-samples");
  });

  it("throws when the hub page no longer has pack links", async () => {
    expect(parseIndex(fixture("sampleradar/no-zip.html"))).toEqual([]);
    const ctx = fixtureCtx([[/sampleradar$/, "sampleradar/no-zip.html"]]);
    await expect(sampleradar.search({ query: "", limit: 5 }, ctx)).rejects.toThrow(/no pack links/);
  });

  it("counts packs for the census", async () => {
    const c = await sampleradar.census!(fixtureCtx(routes));
    expect(c).toMatchObject({ total: 17, unit: "packs" });
    expect(c.byCategory.drums).toBe(5);
  });
});
