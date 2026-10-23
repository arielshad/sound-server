import { describe, expect, it } from "vitest";
import { ghosthack, parseCards, parsePrice } from "../../src/providers/ghosthack.js";
import { fixture, fixtureCtx } from "../helpers.js";

const SITE = "https://www.ghosthack.de";
const routes: [string | RegExp, string][] = [
  ["/search?search=vocal", "ghosthack/search_vocal.html"],
  ["/search?search=zzqxv", "ghosthack/search_empty.html"],
  ["/Categories/Sample-Packs/", "ghosthack/search_vocal.html"],
  [/\/producer-essentials-vocal-loops$/, "ghosthack/product.html"],
];

describe("ghosthack", () => {
  it("searches the store in one request and maps product cards to packs", async () => {
    const ctx = fixtureCtx(routes);
    const r = await ghosthack.search({ query: "vocal", limit: 20 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/search?search=vocal`]);
    expect(r.searchUrl).toBe(`${SITE}/search?search=vocal`);
    expect(r.samples).toHaveLength(6);
    expect(r.samples[0]).toMatchObject({
      id: "ghosthack:producer-essentials-vocal-loops",
      title: "Producer Essentials - Vocal Loops",
      url: `${SITE}/producer-essentials-vocal-loops`,
      author: "Ghosthack",
      category: "vocals",
      unit: "pack",
      form: "pack",
      price: { free: false, amount: 7, currency: "USD" },
      previewUrl: `${SITE}/media/47/69/c2/1725024556/Vocal_Loops_Demotrack.mp3`,
      thumbnailUrl: `${SITE}/media/c4/39/cc/1725014330/producer-essentials-vocal-loops.webp`,
      downloadable: false,
      license: { id: "LicenseRef-Ghosthack-licence", verdict: "yes", commercialUse: true, redistribution: false },
    });
    // The struck-through list price is not the price.
    expect(r.samples.find((s) => s.nativeId === "ultimate-techno-vocals")!.price).toEqual({ free: false, amount: 47, currency: "USD" });
    expect(r.samples.every((s) => s.previewUrl?.endsWith(".mp3") && s.license?.url?.includes("General-Terms-Conditions"))).toBe(true);
  });

  it("pages with p= (24 per page) and browses only the first category page", async () => {
    const ctx = fixtureCtx(routes);
    await ghosthack.search({ query: "vocal", limit: 10, offset: 30 }, ctx);
    expect(ctx.fetch.requests[0]).toBe(`${SITE}/search?search=vocal&p=2`);
    const browse = await ghosthack.search({ query: "", limit: 3 }, ctx);
    expect(ctx.fetch.requests[1]).toBe(`${SITE}/Categories/Sample-Packs/`);
    expect(browse.samples).toHaveLength(3);
    // Category paging (`/?p=`) is disallowed by robots.txt.
    expect((await ghosthack.search({ query: "", limit: 3, offset: 24 }, ctx)).samples).toEqual([]);
    expect(ctx.fetch.requests).toHaveLength(2);
  });

  it("skips requests the store can't answer", async () => {
    const ctx = fixtureCtx(routes);
    expect((await ghosthack.search({ query: "vocal", limit: 5, categories: ["mallets"] }, ctx)).samples).toEqual([]);
    expect((await ghosthack.search({ query: "vocal", limit: 5, forms: ["one-shot"] }, ctx)).samples).toEqual([]);
    expect((await ghosthack.search({ query: "vocal", limit: 5, freeOnly: true }, ctx)).samples).toEqual([]);
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("returns nothing for no results", async () => {
    const ctx = fixtureCtx(routes);
    expect((await ghosthack.search({ query: "zzqxv", limit: 5 }, ctx)).samples).toEqual([]);
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("throws on the bot challenge page instead of returning nothing", async () => {
    const ctx = { fetch: { text: async () => "<html><head><title>www.ghosthack.de | Under Attack Mode - checking your browser</title></head></html>", json: async () => ({}), raw: async () => new Response("") } };
    await expect(ghosthack.search({ query: "vocal", limit: 5 }, ctx as never)).rejects.toThrow(/bot challenge/);
  });

  it("resolves a product page: price, demo, pack size, genre", async () => {
    const ctx = fixtureCtx(routes);
    const d = await ghosthack.getSample!("producer-essentials-vocal-loops", ctx);
    expect(ctx.fetch.requests).toEqual([`${SITE}/producer-essentials-vocal-loops`]);
    expect(d).toMatchObject({
      title: "Producer Essentials - Vocal Loops",
      packSize: 110,
      price: { free: false, amount: 7, currency: "USD" },
      previewUrl: `${SITE}/media/47/69/c2/1725024556/Vocal_Loops_Demotrack.mp3`,
      thumbnailUrl: `${SITE}/media/c4/39/cc/1725014330/producer-essentials-vocal-loops.webp`,
      downloadable: false,
    });
    expect(d!.tags).toContain("edm");
    expect(d!.description).toMatch(/^Quality vocals/);
    expect(d!.files).toEqual([
      { url: `${SITE}/media/47/69/c2/1725024556/Vocal_Loops_Demotrack.mp3`, filename: "Vocal_Loops_Demotrack.mp3", format: "mp3", role: "preview" },
    ]);
    expect(await ghosthack.getSample!("../account", ctx)).toBeNull();
    expect(await ghosthack.getSample!("missing-pack", ctx)).toBeNull();
  });

  it("parses prices and cards", () => {
    expect(parsePrice("$7.00")).toEqual({ free: false, amount: 7, currency: "USD" });
    expect(parsePrice("€1.234,50")).toEqual({ free: false, amount: 1234.5, currency: "EUR" });
    expect(parsePrice("$0.00")).toEqual({ free: true });
    expect(parsePrice("")).toBeUndefined();
    expect(parseCards(fixture("ghosthack/search_empty.html"))).toEqual([]);
  });

  it("builds search links", () => {
    expect(ghosthack.buildSearchUrl({ query: "dark vocals", limit: 1 })).toBe(`${SITE}/search?search=dark+vocals`);
    expect(ghosthack.buildSearchUrl({ query: "", limit: 1 })).toBe(`${SITE}/Categories/Sample-Packs/`);
  });
});

describe("ghosthack census", () => {
  it("counts top-level product pages in the gzipped www sitemap", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { FIXTURES } = await import("../helpers.js");
    const { ghosthack } = await import("../../src/providers/ghosthack.js");
    const gz = readFileSync(join(FIXTURES, "ghosthack/sitemap-www.xml.gz"));
    const index = readFileSync(join(FIXTURES, "ghosthack/sitemap-index.xml"), "utf8");
    const fetch = {
      async text() {
        return index;
      },
      async json() {
        throw new Error("unused");
      },
      async raw(url: string) {
        if (!url.includes("sitemap-www-")) throw new Error(`unexpected ${url}`);
        return new Response(gz);
      },
    };
    expect(await ghosthack.census!({ fetch })).toMatchObject({ total: 2, unit: "packs" });
  });
});
