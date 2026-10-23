import { describe, expect, it } from "vitest";
import type { SampleQuery } from "../../src/core/types.js";
import { cymatics, primeloops as primeloopsLink, primeloopsSpec } from "../../src/providers/packstores.js";
import { parseDemoUrls, shopifyStore, storeForm, storeTags } from "../../src/providers/shopify.js";
import { royaltyFree } from "../../src/core/licence.js";
import { fixture, fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  [/primeloops\.com\/search\/suggest\.json\?q=drum\+kit/, "primeloops/suggest_drum_kit.json"],
  [/primeloops\.com\/search\/suggest\.json\?q=vocal/, "primeloops/suggest_vocal.json"],
  [/primeloops\.com\/search\/suggest\.json\?q=presets/, "primeloops/suggest_forms_synthetic.json"],
  [/primeloops\.com\/search\/suggest\.json\?q=nothing/, "primeloops/suggest_empty.json"],
  [/primeloops\.com\/products\.json/, "primeloops/products_page1.json"],
  [/primeloops\.com\/products\/bounce-kit-hip-hop-drums\.js$/, "primeloops/product_bounce_kit.js.json"],
  [/primeloops\.com\/products\/bounce-kit-hip-hop-drums$/, "primeloops/product_bounce_kit.html"],
];

const q = (o: Partial<SampleQuery>): SampleQuery => ({ query: "", limit: 10, ...o });

// Prime Loops itself is link-only (its terms); the scraper is tested on a scrape-mode copy.
const primeloops = shopifyStore({ ...primeloopsSpec, linkOnly: undefined });

describe("primeloops (live provider)", () => {
  it("is link-only because its terms forbid extracting site contents", () => {
    expect(primeloopsLink).toMatchObject({ id: "primeloops", access: "link" });
  });
});

describe("shopifyStore: primeloops", () => {
  it("is a scrape provider with one suggest.json request per search", async () => {
    expect(primeloops).toMatchObject({ id: "primeloops", access: "scrape", pricing: "freemium", supportsDownload: false });
    const ctx = fixtureCtx(routes);
    const r = await primeloops.search(q({ query: "drum kit", limit: 5 }), ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    const url = new URL(ctx.fetch.requests[0]!);
    expect(url.origin + url.pathname).toBe("https://primeloops.com/search/suggest.json");
    expect(url.searchParams.get("q")).toBe("drum kit");
    expect(url.searchParams.get("resources[type]")).toBe("product");
    expect(url.searchParams.get("resources[limit]")).toBe("5");
    expect(r.samples).toHaveLength(5);
    expect(r.searchUrl).toBe("https://primeloops.com/search?q=drum+kit&type=product");
  });

  it("maps products to paid packs with price, licence, thumbnail and a clean product url", async () => {
    const r = await primeloops.search(q({ query: "drum kit" }), fixtureCtx(routes));
    const s = r.samples[0]!;
    expect(s).toMatchObject({
      id: "primeloops:bounce-kit-hip-hop-drums",
      provider: "primeloops",
      nativeId: "bounce-kit-hip-hop-drums",
      title: "Bounce Kit: Hip Hop Drums",
      url: "https://primeloops.com/products/bounce-kit-hip-hop-drums",
      author: "UNKWN Sounds",
      unit: "pack",
      form: "pack",
      category: "drums",
      price: { free: false, amount: 10.95, currency: "GBP" },
      downloadable: false,
      requiresAccount: true,
      license: { id: "LicenseRef-Prime-Loops-licence", verdict: "yes", redistribution: false, assertedBy: "site" },
    });
    expect(s.thumbnailUrl).toMatch(/^https:\/\/cdn\.shopify\.com\/.+unkwn_bounce_kit\.jpg\?v=\d+&width=600$/);
    expect(s.description).toMatch(/^UNKWN teams up with OCTVE/);
    expect(s.description).not.toMatch(/tb_button|<p>/);
    // Merchandising tags are dropped; sound/genre/label tags stay.
    expect(s.tags).toContain("drum kits");
    expect(s.tags).toContain("drill");
    expect(s.tags.some((t) => /compatible|template|royalty|latest|^daw$|^genres$/.test(t))).toBe(false);
    // No demo in suggest.json: no preview in search.
    expect(s.previewUrl).toBeUndefined();
    expect(r.samples.every((x) => x.unit === "pack" && x.downloadable === false)).toBe(true);
  });

  it("marks price 0 as free but still not downloadable", async () => {
    const r = await primeloops.search(q({ query: "vocal" }), fixtureCtx(routes));
    const free = r.samples.find((s) => s.nativeId === "xoxo-free-taster-pack")!;
    expect(free).toMatchObject({ price: { free: true }, downloadable: false, category: "vocals", unit: "pack" });
    const paid = r.samples.find((s) => s.title === "Ceremonial Vocals")!;
    expect(paid.price).toEqual({ free: false, amount: 30.95, currency: "GBP" });
    expect(paid.category).toBe("vocals");
  });

  it("filters freeOnly locally (suggest.json cannot)", async () => {
    const ctx = fixtureCtx(routes);
    const r = await primeloops.search(q({ query: "vocal", freeOnly: true }), ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => s.price?.free)).toBe(true);
  });

  it("reads preset and MIDI forms from title/product type, hides unavailable, uses the lowest variant price", async () => {
    const r = await primeloops.search(q({ query: "presets" }), fixtureCtx(routes));
    const by = Object.fromEntries(r.samples.map((s) => [s.nativeId, s]));
    expect(Object.keys(by)).not.toContain("retired-pack");
    expect(by["future-bass-serum-presets"]).toMatchObject({ form: "preset", unit: "pack", category: "synth" });
    expect(by["future-bass-serum-presets"]!.description).toBe("128 Serum presets for melodic dubstep.");
    expect(by["rnb-chords-midi-pack"]).toMatchObject({ form: "midi", unit: "pack" });
    expect(by["rnb-chords-midi-pack"]!.thumbnailUrl).toContain("midi.jpg");
    expect(by["free-vocal-shots"]).toMatchObject({ form: "pack", price: { free: true }, category: "vocals" });
    expect(by["lofi-piano-loops"]).toMatchObject({ form: "pack", category: "keys", price: { free: false, amount: 12, currency: "GBP" } });
  });

  it("drops results by form locally and skips the request when forms or categories rule the store out", async () => {
    let ctx = fixtureCtx(routes);
    let r = await primeloops.search(q({ query: "presets", forms: ["preset"] }), ctx);
    expect(r.samples.map((s) => s.nativeId)).toEqual(["future-bass-serum-presets"]);

    ctx = fixtureCtx(routes);
    r = await primeloops.search(q({ query: "kick", forms: ["one-shot"] }), ctx);
    expect(r).toEqual({ samples: [], searchUrl: "https://primeloops.com/search?q=kick&type=product" });
    expect(ctx.fetch.requests).toEqual([]);

    ctx = fixtureCtx(routes);
    r = await primeloops.search(q({ query: "door", categories: ["foley"] }), ctx);
    expect(r.samples).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("pages within the 10 predictive results and stops past them", async () => {
    let ctx = fixtureCtx(routes);
    const r = await primeloops.search(q({ query: "drum kit", limit: 3, offset: 3 }), ctx);
    expect(new URL(ctx.fetch.requests[0]!).searchParams.get("resources[limit]")).toBe("6");
    expect(r.samples.map((s) => s.title)).toEqual(["BALI: Afro Pop Drum Kit", "Afrobounce: Afro-Pop Drum Kit", "LIT Tool Kit: Drill + Trap Drum Kit"]);

    ctx = fixtureCtx(routes);
    const past = await primeloops.search(q({ query: "drum kit", offset: 10 }), ctx);
    expect(past.samples).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("returns an empty list (not an error) when nothing matches", async () => {
    const r = await primeloops.search(q({ query: "nothing" }), fixtureCtx(routes));
    expect(r.samples).toEqual([]);
  });

  it("browses the catalogue feed for an empty query", async () => {
    const ctx = fixtureCtx(routes);
    const r = await primeloops.search(q({ query: "", limit: 4 }), ctx);
    expect(ctx.fetch.requests).toEqual(["https://primeloops.com/products.json?limit=4&page=1"]);
    expect(r.searchUrl).toBe("https://primeloops.com/collections/all");
    expect(r.samples).toHaveLength(4);
    expect(r.samples[0]).toMatchObject({ nativeId: "obsessed", author: "Project Blvck", price: { free: false, amount: 17.95, currency: "GBP" } });
    expect(r.samples[0]!.createdAt).toMatch(/^2026-10-22/);
    expect(r.samples.filter((s) => s.price?.free)).toHaveLength(2);
  });

  it("getSample reads the product JSON and the product page's own demo mp3", async () => {
    const ctx = fixtureCtx(routes);
    const d = await primeloops.getSample!("bounce-kit-hip-hop-drums", ctx);
    expect(ctx.fetch.requests).toEqual([
      "https://primeloops.com/products/bounce-kit-hip-hop-drums.js",
      "https://primeloops.com/products/bounce-kit-hip-hop-drums",
    ]);
    expect(d).toMatchObject({
      id: "primeloops:bounce-kit-hip-hop-drums",
      price: { free: false, amount: 10.95, currency: "GBP" },
      unit: "pack",
      downloadable: false,
      previewUrl: "https://primeloops.com/cdn/shop/files/unkwn_bounce_kit_demo.mp3?v=3637458771990034597",
    });
    // Related products' demos on the same page are not this product's.
    expect(d!.files).toEqual([
      {
        url: "https://primeloops.com/cdn/shop/files/unkwn_bounce_kit_demo.mp3?v=3637458771990034597",
        filename: "unkwn_bounce_kit_demo.mp3",
        format: "mp3",
        role: "preview",
      },
    ]);
  });

  it("getSample returns null for an unknown handle", async () => {
    expect(await primeloops.getSample!("no-such-pack", fixtureCtx(routes))).toBeNull();
  });

  it("census walks products.json until a short page", async () => {
    const ctx = fixtureCtx(routes);
    const c = await primeloops.census!(ctx);
    expect(ctx.fetch.requests).toEqual(["https://primeloops.com/products.json?limit=250&page=1"]);
    expect(c).toMatchObject({ total: 4, free: 2, unit: "packs" });
    expect(c.method).toMatch(/products\.json/);
  });
});

describe("shopify helpers", () => {
  it("storeForm only trusts title and product type", () => {
    expect(storeForm({ title: "Vital Presets Vol 2", type: "", tags: [] })).toBe("preset");
    expect(storeForm({ title: "Anything", type: "Serum Presets", tags: [] })).toBe("preset");
    expect(storeForm({ title: "Trap MIDI Collection", type: "", tags: [] })).toBe("midi");
    expect(storeForm({ title: "Blue Keys + MIDI", type: "Products", tags: ["MIDI Melodies"] })).toBe("pack");
    expect(storeForm({ title: "Serum Drum Kit", type: "", tags: ["Hip Hop Samples  Presets"] })).toBe("pack");
    expect(storeForm({ title: "Drum Kit", type: "", tags: ["Serum Presets"] })).toBe("preset");
  });

  it("storeTags drops merchandising tags", () => {
    expect(storeTags(["100% Royalty-Free", "Products Compatible with FL Studio", "Drill", "Winter Sale", "Flame Audio", "Hip Hop Samples  Presets"])).toEqual([
      "Drill",
      "Flame Audio",
    ]);
    expect(storeTags("Trap, Labels, 808")).toEqual(["Trap", "808"]);
  });

  it("parseDemoUrls reads an audioSources_demos array (Cymatics-style themes)", () => {
    const html = `<script>var audioSources_demos = [
      'https://cdn.shopify.com/s/files/1/x/files/Demo_Loop.mp3?v=1',
      'https://cdn.shopify.com/s/files/1/x/files/Demo_Kick.mp3?v=1',
    ];</script>`;
    expect(parseDemoUrls(html, 1, "https://example.com")).toEqual([
      "https://cdn.shopify.com/s/files/1/x/files/Demo_Loop.mp3?v=1",
      "https://cdn.shopify.com/s/files/1/x/files/Demo_Kick.mp3?v=1",
    ]);
  });

  it("parseDemoUrls ignores empty demo slots", () => {
    expect(parseDemoUrls(fixture("primeloops/product_bounce_kit.html"), 11137311899990, "https://primeloops.com")).toHaveLength(1);
  });

  it("a linkOnly store makes no requests", async () => {
    const store = shopifyStore({
      id: "x",
      name: "X",
      homepage: "https://x.example/",
      description: "d",
      categories: ["drums"],
      currency: "USD",
      license: royaltyFree("X licence"),
      linkOnly: "terms",
    });
    const ctx = fixtureCtx([]);
    expect(store.access).toBe("link");
    expect(await store.search(q({ query: "kick" }), ctx)).toEqual({ samples: [], searchUrl: "https://x.example/search?q=kick&type=product" });
    expect(ctx.fetch.requests).toEqual([]);
  });
});

describe("cymatics (link-only: terms forbid robots)", () => {
  it("builds the store search link and makes no requests", async () => {
    expect(cymatics).toMatchObject({ id: "cymatics", access: "link", supportsDownload: false, pricing: "freemium" });
    expect(cymatics.license).toMatchObject({ verdict: "yes", redistribution: false });
    expect(cymatics.forms).toEqual(["pack", "preset", "midi"]);
    const ctx = fixtureCtx([]);
    const r = await cymatics.search(q({ query: "drill drum kit" }), ctx);
    expect(r).toEqual({ samples: [], searchUrl: "https://cymatics.fm/search?q=drill+drum+kit&type=product" });
    expect(ctx.fetch.requests).toEqual([]);
    expect(cymatics.buildSearchUrl(q({ query: "" }))).toBe("https://cymatics.fm/collections/all");
    expect(cymatics.buildSearchUrl(q({ query: "trap", bpm: { min: 140, max: 140 }, key: { tonic: "F#", mode: "minor" } }))).toBe(
      "https://cymatics.fm/search?q=trap&type=product",
    );
  });
});
