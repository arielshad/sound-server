import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { blackoctopus } from "../../src/providers/blackoctopus.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("blackoctopus (live)", () => {
  it("searches the Store API and finds a product's demo", async () => {
    const r = await blackoctopus.search({ query: "drum hits", limit: 10 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => s.unit === "pack" && s.url.startsWith("https://blackoctopus-sound.com/product/"))).toBe(true);
    const d = await blackoctopus.getSample!("wicked-drum-hits-2", ctx);
    expect(d!.previewUrl).toMatch(/\.mp3$/);
    const res = await ctx.fetch.raw(d!.previewUrl!, { headers: { range: "bytes=0-0" } });
    await res.body?.cancel().catch(() => undefined);
    expect(res.headers.get("content-type")).toMatch(/audio/);
  }, 60_000);

  it("counts the catalogue", async () => {
    const c = await blackoctopus.census!(ctx);
    expect(c.total).toBeGreaterThan(500);
    expect(c.free).toBeGreaterThanOrEqual(0);
  });
});
