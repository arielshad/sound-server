import { describe, expect, it } from "vitest";
import { soundbible, soundbibleLicense } from "../../src/providers/soundbible.js";
import { fixtureCtx } from "../helpers.js";

const SITE = "https://soundbible.com";
const routes: [string | RegExp, string][] = [
  ["/search.php?q=door", "soundbible/search_door.html"],
  ["/search.php?q=", "soundbible/search_empty.html"],
  [/\/1196-Knocking-On-Door\.html$/, "soundbible/1196-Knocking-On-Door.html"],
  [/\/99999-No-Such\.html$/, "soundbible/99999-No-Such.html"],
];

describe("soundbible", () => {
  it("maps search cards with per-sound licences in one request", async () => {
    const ctx = fixtureCtx(routes);
    const r = await soundbible.search({ query: "door", limit: 30 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/search.php?q=door`]);
    expect(r.total).toBe(30);
    expect(r.searchUrl).toBe(`${SITE}/search.php?q=door`);
    const byId = new Map(r.samples.map((s) => [s.nativeId, s]));

    expect(byId.get("1870-Sqeaking-Door")).toMatchObject({
      id: "soundbible:1870-Sqeaking-Door",
      title: "Sqeaking Door",
      url: `${SITE}/1870-Sqeaking-Door.html`,
      author: "Sarasprella",
      category: "foley",
      previewUrl: `${SITE}/mp3/Sqeaking_door-Sarasprella-1653672487.mp3`,
      formats: ["wav", "mp3"],
      downloadable: true,
      popularity: 423345,
      license: { id: "CC-BY-3.0", verdict: "yes-with-credit" },
    });
    expect(byId.get("1870-Sqeaking-Door")!.attribution).toContain("by Sarasprella (SoundBible)");
    expect(byId.get("1717-Creaking-Door-Spooky")!.license).toMatchObject({ id: "CC-PDM-1.0", verdict: "yes" });
    expect(byId.get("1196-Knocking-On-Door")!.license).toMatchObject({ id: "LicenseRef-Sampling-Plus-1.0", verdict: "restricted" });
    expect(byId.get("1331-Owl-Hooting")!.license).toMatchObject({ id: "CC-BY-NC-3.0", verdict: "no" });
    // Personal-use sounds are shown, but never as commercial-safe.
    const personal = byId.get("264-Close-Vault-Or-Jail-Door")!;
    expect(personal.license).toMatchObject({ name: "Personal Use Only", verdict: "no", commercialUse: false });
    expect(personal.author).toBeUndefined();
    // Spaces in the relative player path are encoded.
    expect(personal.previewUrl).toBe(`${SITE}/mp3/Close%20Vault%20Or%20Jail%20Door-SoundBible.com-1221913084.mp3`);
  });

  it("pages locally and returns nothing for no hits or an empty query", async () => {
    const ctx = fixtureCtx(routes);
    const all = await soundbible.search({ query: "door", limit: 30 }, ctx);
    const page = await soundbible.search({ query: "door", limit: 3, offset: 4 }, ctx);
    expect(page.samples.map((s) => s.id)).toEqual(all.samples.slice(4, 7).map((s) => s.id));
    expect((await soundbible.search({ query: "zzqxvnotfound", limit: 5 }, ctx)).samples).toEqual([]);
    expect(await soundbible.search({ query: "", limit: 5 }, ctx)).toEqual({ samples: [], searchUrl: `${SITE}/free-sound-effects-1.html` });
    expect(ctx.fetch.requests).toHaveLength(3);
  });

  it("resolves the WAV and MP3 from the detail page", async () => {
    const ctx = fixtureCtx(routes);
    const d = await soundbible.getSample!("1196-Knocking-On-Door", ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/1196-Knocking-On-Door.html`]);
    expect(d).toMatchObject({
      id: "soundbible:1196-Knocking-On-Door",
      title: "Knocking On Door",
      author: "ERH",
      category: "foley",
      popularity: 604435,
      license: { id: "LicenseRef-Sampling-Plus-1.0", verdict: "restricted" },
    });
    expect(d!.description).toMatch(/^Sound of someone knocking on a door\./);
    // Only the uploader's tags, not the thesaurus padding after them.
    expect(d!.tags).toEqual(["knocking on a door", "knock", "knock knock", "door knock", "door knocker", "knocker"]);
    expect(d!.files).toEqual([
      { url: `${SITE}/grab.php?id=1196&type=wav`, filename: "Knocking On Door-SoundBible.com-84643603.wav", format: "wav", role: "original", sizeBytes: 637000 },
      { url: `${SITE}/mp3/Knocking%20On%20Door-SoundBible.com-84643603.mp3`, filename: "Knocking On Door-SoundBible.com-84643603.mp3", format: "mp3", role: "preview" },
    ]);
  });

  it("returns null for unknown or malformed ids", async () => {
    const ctx = fixtureCtx(routes);
    expect(await soundbible.getSample!("99999-No-Such", ctx)).toBeNull();
    expect(await soundbible.getSample!("../../etc/passwd", ctx)).toBeNull();
    expect(await soundbible.getSample!("Knocking-On-Door", ctx)).toBeNull();
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("maps every licence label the site uses", () => {
    expect(soundbibleLicense("Attribution 3.0")).toMatchObject({ id: "CC-BY-3.0", verdict: "yes-with-credit" });
    expect(soundbibleLicense("Public Domain")).toMatchObject({ id: "CC-PDM-1.0", verdict: "yes" });
    expect(soundbibleLicense("Sampling Plus 1.0")).toMatchObject({ id: "LicenseRef-Sampling-Plus-1.0", verdict: "restricted" });
    expect(soundbibleLicense("Noncommercial 3.0")).toMatchObject({ id: "CC-BY-NC-3.0", verdict: "no" });
    expect(soundbibleLicense("Personal Use Only")).toMatchObject({ verdict: "no", commercialUse: false });
    expect(soundbibleLicense("Share Alike 3.0")).toMatchObject({ id: "CC-BY-SA-3.0", verdict: "restricted" });
    expect(soundbibleLicense("")).toMatchObject({ id: "LicenseRef-Unknown", verdict: "check-terms" });
  });

  it("builds search links", () => {
    expect(soundbible.buildSearchUrl({ query: "glass break", limit: 1 })).toBe(`${SITE}/search.php?q=glass+break`);
  });
});

describe("soundbible census", () => {
  it("counts sound pages in the sitemap as a lower bound", async () => {
    const { fixtureCtx } = await import("../helpers.js");
    const { soundbible } = await import("../../src/providers/soundbible.js");
    const ctx = fixtureCtx([["soundbible.com/sitemap.xml", "soundbible/sitemap.xml"]]);
    expect(await soundbible.census!(ctx)).toMatchObject({ total: 2, atLeast: true, unit: "samples" });
  });
});
