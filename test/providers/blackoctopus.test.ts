import { describe, expect, it } from "vitest";
import { blackoctopus, parseDemos } from "../../src/providers/blackoctopus.js";
import { fixture, fixtureCtx } from "../helpers.js";

const SITE = "https://blackoctopus-sound.com";
const API = `${SITE}/wp-json/wc/store/products`;
const EXCLUDE = "category=162%2C2237&category_operator=not_in";
const routes: [string | RegExp, string][] = [
  ["/products?search=drum", "blackoctopus/search_drum.json"],
  ["/products?search=zzqxv", "blackoctopus/search_empty.json"],
  ["/products?slug=wicked-drum-hits-2", "blackoctopus/product_wicked-drum-hits-2.json"],
  ["/products?slug=", "blackoctopus/search_empty.json"],
  ["/product/wicked-drum-hits-2/", "blackoctopus/product_wicked-drum-hits-2.html"],
];

describe("blackoctopus", () => {
  it("searches the WooCommerce Store API in one request, without plugins and hardware", async () => {
    const ctx = fixtureCtx(routes);
    const r = await blackoctopus.search({ query: "drum", limit: 20 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${API}?search=drum&per_page=20&${EXCLUDE}`]);
    expect(r.searchUrl).toBe(`${SITE}/?s=drum&post_type=product`);
    expect(r.samples).toHaveLength(6);
    expect(r.samples[2]).toMatchObject({
      id: "blackoctopus:soulful-drum-and-bass",
      title: "Soulful Drum and Bass",
      url: `${SITE}/product/soulful-drum-and-bass/`,
      author: "Black Octopus Sound",
      unit: "pack",
      form: "pack",
      genres: ["Drum & Bass", "Soul"],
      price: { free: false, amount: 29.95, currency: "USD" },
      downloadable: false,
      license: { id: "LicenseRef-Black-Octopus-Sound-licence", verdict: "yes", redistribution: false },
    });
    expect(r.samples[2]!.thumbnailUrl).toMatch(/^https:\/\/blackoctopus-sound\.com\/wp-content\/uploads\/.+-200x200\.jpg$/);
    // Entities decoded; preset-only packs are presets.
    expect(r.samples[0]!.title).toBe("Deadly Drums & Percussion Bundle 4 Packs for $5");
    expect(r.samples[5]).toMatchObject({ title: "Rupture – Hard Drum & Bass for Serum 2 by Killsam", form: "preset" });
    expect(r.samples.every((s) => s.license?.note?.includes("vocalists"))).toBe(true);
  });

  it("passes paging and the free filter to the store", async () => {
    const ctx = fixtureCtx(routes);
    await blackoctopus.search({ query: "drum", limit: 5, offset: 10 }, ctx);
    expect(ctx.fetch.requests[0]).toBe(`${API}?search=drum&per_page=5&offset=10&${EXCLUDE}`);
    await blackoctopus.search({ query: "drum", limit: 5, freeOnly: true }, ctx);
    expect(ctx.fetch.requests[1]).toBe(`${API}?search=drum&per_page=5&category=3532`);
    expect((await blackoctopus.search({ query: "drum", limit: 5, forms: ["one-shot"] }, ctx)).samples).toEqual([]);
    expect(ctx.fetch.requests).toHaveLength(2);
  });

  it("returns nothing for no results", async () => {
    const ctx = fixtureCtx(routes);
    expect((await blackoctopus.search({ query: "zzqxv", limit: 5 }, ctx)).samples).toEqual([]);
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("resolves a product with its demo mp3 from the product page", async () => {
    const ctx = fixtureCtx(routes);
    const d = await blackoctopus.getSample!("wicked-drum-hits-2", ctx);
    expect(ctx.fetch.requests).toEqual([`${API}?slug=wicked-drum-hits-2`, `${SITE}/product/wicked-drum-hits-2/`]);
    const demo = `${SITE}/wp-content/uploads/2019/12/Black-Octopus-Sound-Wicked-Drum-Hits-2.mp3`;
    expect(d).toMatchObject({ title: "Wicked Drum Hits 2", category: "drums", previewUrl: demo, downloadable: false });
    expect(d!.files).toEqual([{ url: demo, filename: "Black-Octopus-Sound-Wicked-Drum-Hits-2.mp3", format: "mp3", role: "preview" }]);
    expect(await blackoctopus.getSample!("missing", ctx)).toBeNull();
    expect(await blackoctopus.getSample!("../wp-admin", ctx)).toBeNull();
  });

  it("only takes demos tagged with the product's own permalink", () => {
    const html = fixture("blackoctopus/product_wicked-drum-hits-2.html");
    expect(parseDemos(html, `${SITE}/product/wicked-drum-hits-2/`)).toHaveLength(1);
    expect(parseDemos(html, `${SITE}/product/wicked-drum-hits/`)).toEqual([`${SITE}/wp-content/uploads/2019/12/Black-Octopus-Sound-Wicked-Drum-Hits-main-demo.mp3`]);
    expect(parseDemos(html, `${SITE}/product/house-pop-vocals/`)).toEqual([]);
  });

  it("counts the catalogue from X-WP-Total", async () => {
    const seen: string[] = [];
    const ctx = {
      fetch: {
        async raw(url: string) {
          seen.push(url);
          return new Response("[]", { headers: { "x-wp-total": url.includes("category=3532") ? "4" : "1463" } });
        },
        text: async () => "",
        json: async () => ({}),
      },
    };
    const c = await blackoctopus.census!(ctx as never);
    expect(c).toMatchObject({ total: 1463, free: 4, unit: "packs" });
    expect(seen).toHaveLength(2);
  });

  it("builds search links", () => {
    expect(blackoctopus.buildSearchUrl({ query: "vocal chops", limit: 1 })).toBe(`${SITE}/?s=vocal+chops&post_type=product`);
    expect(blackoctopus.buildSearchUrl({ query: "", limit: 1 })).toBe(`${SITE}/shop/`);
  });
});
