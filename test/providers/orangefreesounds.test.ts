import { describe, expect, it } from "vitest";
import { orangefreesounds, parseDuration, parsePostLicense } from "../../src/providers/orangefreesounds.js";
import { fixtureCtx } from "../helpers.js";

const API = "https://orangefreesounds.com/wp-json/wp/v2";
const FIELDS = "_fields=id%2Cdate%2Cslug%2Clink%2Ctitle%2Ccontent%2Ccategories";
const routes: [string | RegExp, string][] = [
  ["/posts?search=kick", "orangefreesounds/search_kick.json"],
  ["/posts?search=zzqxv", "orangefreesounds/search_empty.json"],
  [/\/posts\/58632\?/, "orangefreesounds/post_58632.json"],
  ["/categories?", "orangefreesounds/categories.json"],
  ["/posts?per_page=1", "orangefreesounds/search_empty.json"],
];

describe("orangefreesounds", () => {
  it("searches the WordPress REST API in one request", async () => {
    const ctx = fixtureCtx(routes);
    const r = await orangefreesounds.search({ query: "kick", limit: 20 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${API}/posts?search=kick&per_page=20&categories_exclude=3979%2C3290&${FIELDS}`]);
    expect(r.searchUrl).toBe("https://orangefreesounds.com/?s=kick");
    // 12 posts in the fixture; the paid Gumroad pack is skipped.
    expect(r.samples).toHaveLength(11);
    expect(r.samples.some((s) => s.nativeId === "57972")).toBe(false);
  });

  it("maps loops: CC BY 4.0, BPM, duration, WAV in a zip and an MP3 preview", async () => {
    const r = await orangefreesounds.search({ query: "kick", limit: 20 }, fixtureCtx(routes));
    const loop = r.samples.find((s) => s.nativeId === "55157")!;
    expect(loop).toMatchObject({
      id: "orangefreesounds:55157",
      title: "Kick Drum Loop – 140 BPM – Techno/Electronic",
      url: "https://orangefreesounds.com/kick-drum-loop-140-bpm-techno-electronic/",
      author: "Alexander",
      category: "drums.kick",
      form: "loop",
      bpm: 140,
      formats: ["wav", "zip", "mp3"],
      downloadable: true,
      license: { id: "CC-BY-4.0", verdict: "yes-with-credit" },
    });
    expect(loop.previewUrl).toMatch(/^https:\/\/orangefreesounds\.com\/wp-content\/uploads\/.+\.mp3$/);
    expect(loop.attribution).toContain("by Alexander (Orange Free Sounds)");
    // A drum loop whose words don't name a drum still lands in drums.
    expect(r.samples.find((s) => s.nativeId === "55437")).toMatchObject({ category: "drums", form: "loop", bpm: 132 });
  });

  it("reads per-post licences: non-commercial and personal use are never commercial-safe", async () => {
    const r = await orangefreesounds.search({ query: "kick", limit: 20 }, fixtureCtx(routes));
    const byId = new Map(r.samples.map((s) => [s.nativeId, s]));
    expect(byId.get("57205")!.license).toMatchObject({ id: "CC-BY-NC-4.0", verdict: "no" });
    expect(byId.get("57205")).toMatchObject({ category: "fx", formats: ["mp3"] }); // "kick" only in the description
    expect(byId.get("57621")!.license).toMatchObject({ name: "Personal Use Only", verdict: "no", commercialUse: false });
    expect(byId.get("37874")!.license).toMatchObject({ name: "Personal Use Only", verdict: "no" });
    expect(byId.get("18471")).toMatchObject({ category: "other", form: "phrase", durationSec: 76, author: "US Army Band", license: { id: "CC0-1.0", verdict: "yes" } });
  });

  it("passes offset and category filters to WordPress", async () => {
    const ctx = fixtureCtx(routes);
    await orangefreesounds.search({ query: "kick", categories: ["drums.kick"], limit: 5, offset: 10 }, ctx);
    expect(ctx.fetch.requests[0]).toBe(`${API}/posts?search=kick&per_page=5&offset=10&categories=4&categories_exclude=3979%2C3290&${FIELDS}`);
    await orangefreesounds.search({ query: "kick", categories: ["fx", "ambience"], limit: 5 }, ctx);
    expect(ctx.fetch.requests[1]).toContain("&categories=9&");
    // A category the site has no section for: search everything, the aggregator filters.
    await orangefreesounds.search({ query: "kick", categories: ["drums", "bass"], limit: 5 }, ctx);
    expect(ctx.fetch.requests[2]).not.toContain("&categories=");
  });

  it("returns nothing for no results", async () => {
    const ctx = fixtureCtx(routes);
    expect((await orangefreesounds.search({ query: "zzqxv", limit: 5 }, ctx)).samples).toEqual([]);
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("resolves one post with its files", async () => {
    const ctx = fixtureCtx(routes);
    const d = await orangefreesounds.getSample!("58632", ctx);
    expect(ctx.fetch.requests).toEqual([`${API}/posts/58632?${FIELDS}`]);
    expect(d).toMatchObject({
      id: "orangefreesounds:58632",
      category: "drums",
      form: "loop",
      bpm: 160,
      durationSec: 6,
      sampleRate: 44100,
      bitDepth: 16,
      createdAt: "2026-09-30",
      license: { id: "CC-BY-4.0" },
    });
    const base = "https://orangefreesounds.com/wp-content/uploads/2026/09/Upbeat-cyberpunk-synth-drum-loop-pulsating-beat-160-bpm";
    expect(d!.files).toEqual([
      { url: `${base}.zip`, filename: "Upbeat-cyberpunk-synth-drum-loop-pulsating-beat-160-bpm.zip", format: "zip", role: "pack" },
      { url: `${base}.mp3`, filename: "Upbeat-cyberpunk-synth-drum-loop-pulsating-beat-160-bpm.mp3", format: "mp3", role: "preview" },
    ]);
  });

  it("returns null for unknown or malformed ids", async () => {
    const ctx = fixtureCtx(routes);
    expect(await orangefreesounds.getSample!("1", ctx)).toBeNull();
    expect(await orangefreesounds.getSample!("../wp-admin", ctx)).toBeNull();
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("parses licence cells and durations", () => {
    expect(parsePostLicense("The sound is licensed under “private use only”")).toMatchObject({ verdict: "no" });
    expect(parsePostLicense("The drum loop is permitted for commercial use under license Creative Commons Attribution 4.0 International License")).toMatchObject({
      id: "CC-BY-4.0",
    });
    expect(parsePostLicense("…non-commercial use under license “Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)”", "http://creativecommons.org/licenses/by-nc/4.0/")).toMatchObject({
      id: "CC-BY-NC-4.0",
      verdict: "no",
    });
    expect(parsePostLicense("Free")).toMatchObject({ id: "LicenseRef-Unknown" });
    expect(parseDuration("00:06 sec")).toBe(6);
    expect(parseDuration("01:16 min")).toBe(76);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration(undefined)).toBeUndefined();
  });

  it("builds search links", () => {
    expect(orangefreesounds.buildSearchUrl({ query: "drum loop", limit: 1 })).toBe("https://orangefreesounds.com/?s=drum+loop");
    expect(orangefreesounds.buildSearchUrl({ query: "", limit: 1 })).toBe("https://orangefreesounds.com");
  });

  it("counts posts from X-WP-Total and sections from the category counts", async () => {
    const ctx = fixtureCtx(routes);
    const raw = ctx.fetch.raw.bind(ctx.fetch);
    ctx.fetch.raw = async (url, init) => {
      const res = await raw(url, init);
      return new Response(res.body, { headers: { "x-wp-total": "7012" } });
    };
    const c = await orangefreesounds.census!(ctx);
    expect(ctx.fetch.requests).toHaveLength(2);
    expect(c).toMatchObject({ total: 7012, free: 7012, byCategory: { drums: 268, synth: 292, fx: 6378, other: 1209 } });
    expect(c.categories).toMatchObject({ "Sound Effects": 6378, Loops: 561, Music: 1209 });
    expect(c.categories).not.toHaveProperty("Sound Packs");
  });
});
