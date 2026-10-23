import { describe, expect, it } from "vitest";
import { bigsoundbank, parseSearch, ucsPrefix } from "../../src/providers/bigsoundbank.js";
import { fixture, fixtureCtx } from "../helpers.js";

const SITE = "https://bigsoundbank.com";
const routes: [string | RegExp, string][] = [
  ["/search?q=door", "bigsoundbank/search_door.html"],
  ["/search?q=zzqxv", "bigsoundbank/search_empty.html"],
  [/\/search$/, "bigsoundbank/search_door.html"],
  ["/s1703.html", "bigsoundbank/s1703.html"],
];

describe("bigsoundbank", () => {
  it("searches in one request and maps results without touching /UPLOAD/", async () => {
    const ctx = fixtureCtx(routes);
    const r = await bigsoundbank.search({ query: "door", limit: 20 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/search?q=door`]);
    expect(r.total).toBe(90);
    expect(r.searchUrl).toBe(`${SITE}/search?q=door`);
    expect(r.samples).toHaveLength(6);
    expect(r.samples[0]).toMatchObject({
      id: "bigsoundbank:1703",
      title: "Apartment Door, Opening #2",
      description: "Opening of a Parisian apartment door. Grinding.",
      url: `${SITE}/s1703.html`,
      author: "Joseph Sardin",
      category: "foley",
      durationSec: 5,
      price: { free: true },
      downloadable: false,
      license: { id: "CC0-1.0", verdict: "yes", assertedBy: "site" },
    });
    expect(r.samples[0]!.tags).toContain("doorwood");
    // robots.txt closes /UPLOAD/ (previews, files, waveforms) to every robot.
    expect(JSON.stringify(r.samples)).not.toMatch(/UPLOAD/);
    expect(r.samples.every((s) => s.previewUrl === undefined && s.thumbnailUrl === undefined)).toBe(true);
    // The UCS code steers the category: a car door is a vehicle sound.
    expect(r.samples.find((s) => s.title.startsWith("Car Door"))!.category).toBe("fx");
    expect(r.samples.find((s) => s.title.startsWith("Door Slamming"))).toMatchObject({ form: "one-shot", durationSec: 1 });
  });

  it("pages 40 at a time", async () => {
    const ctx = fixtureCtx(routes);
    const r = await bigsoundbank.search({ query: "door", limit: 3, offset: 42 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/search?q=door&page=2`]);
    expect(r.samples).toHaveLength(3); // the fixture's 6 rows stand in for page 2, sliced from 42 % 40
    expect(r.samples[0]!.nativeId).toBe("1501");
  });

  it("returns nothing for no results, or for categories it doesn't carry", async () => {
    const ctx = fixtureCtx(routes);
    const r = await bigsoundbank.search({ query: "zzqxv", limit: 5 }, ctx);
    expect(r.samples).toEqual([]);
    expect(r.total).toBe(0);
    expect((await bigsoundbank.search({ query: "door", limit: 5, categories: ["synth"] }, ctx)).samples).toEqual([]);
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("resolves a sound page from its JSON-LD, still without files", async () => {
    const ctx = fixtureCtx(routes);
    const d = await bigsoundbank.getSample!("1703", ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/s1703.html`]);
    expect(d).toMatchObject({
      id: "bigsoundbank:1703",
      title: "Apartment Door, Opening #2",
      category: "foley",
      durationSec: 5,
      createdAt: "2020-01-09",
      formats: ["wav", "aiff", "mp3", "ogg", "flac", "aac", "m4a"],
      downloadable: false,
      files: [],
    });
    expect(d!.tags).toEqual(expect.arrayContaining(["door", "creak", "squeak"]));
    expect(JSON.stringify(d)).not.toMatch(/UPLOAD/);
    expect(await bigsoundbank.getSample!("../gestion", ctx)).toBeNull();
    expect(await bigsoundbank.getSample!("99999", ctx)).toBeNull();
  });

  it("counts the catalogue from the empty search heading", async () => {
    const ctx = fixtureCtx(routes);
    // The fixture heading says 90; the live page says "3579 results".
    expect(await bigsoundbank.census!(ctx)).toMatchObject({ total: 90, free: 90, unit: "samples" });
    expect(parseSearch("<h1>3579 results - Most Popular</h1>").total).toBe(3579);
    expect(parseSearch(fixture("bigsoundbank/search_empty.html")).total).toBe(0);
  });

  it("reads UCS prefixes", () => {
    expect(ucsPrefix("DOORWood")).toBe("DOOR");
    expect(ucsPrefix("VEHDoor")).toBe("VEH");
    expect(ucsPrefix("UIClick")).toBe("UI");
    expect(ucsPrefix("AMB")).toBe("AMB");
  });

  it("builds search links", () => {
    expect(bigsoundbank.buildSearchUrl({ query: "rain on roof", limit: 1 })).toBe(`${SITE}/search?q=rain+on+roof`);
    expect(bigsoundbank.buildSearchUrl({ query: "", limit: 1 })).toBe(`${SITE}/search`);
  });
});
