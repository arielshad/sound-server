import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { primeloops } from "../../src/providers/packstores.js";

const ctx = { fetch: createHttpClient() };

// Only Prime Loops is fetched: Cymatics is link-only (its terms forbid robots).
describe.skipIf(!process.env.LIVE)("primeloops (live)", () => {
  it("searches suggest.json and maps paid and free packs", async () => {
    const r = await primeloops.search({ query: "drum kit", limit: 10 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples[0]).toMatchObject({ provider: "primeloops", unit: "pack", downloadable: false });
    expect(r.samples.some((s) => s.price && !s.price.free && s.price.currency === "GBP" && (s.price.amount ?? 0) > 0)).toBe(true);
    expect(r.samples.some((s) => s.category.startsWith("drums"))).toBe(true);

    const free = await primeloops.search({ query: "free taster pack", limit: 10, freeOnly: true }, ctx);
    expect(free.samples.length).toBeGreaterThan(0);
    expect(free.samples.every((s) => s.price?.free && !s.downloadable)).toBe(true);
  });

  it("getSample finds the product's demo mp3", async () => {
    const r = await primeloops.search({ query: "drum kit", limit: 3 }, ctx);
    const d = await primeloops.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d?.title).toBe(r.samples[0]!.title);
    expect(d?.files.every((f) => f.role === "preview" && f.format === "mp3")).toBe(true);
    if (d?.previewUrl) {
      const res = await ctx.fetch.raw(d.previewUrl, { headers: { range: "bytes=0-2" } });
      expect([200, 206]).toContain(res.status);
      await res.body?.cancel();
    }
  });

  it("browses the catalogue feed for an empty query", async () => {
    const r = await primeloops.search({ query: "", limit: 5 }, ctx);
    expect(r.samples).toHaveLength(5);
  });
});
