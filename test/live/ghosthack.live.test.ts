import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { ghosthack } from "../../src/providers/ghosthack.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("ghosthack (live)", () => {
  it("searches the store, plays a demo and resolves a product", async () => {
    const r = await ghosthack.search({ query: "vocals", limit: 10 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    // Most cards carry a demo mp3; a few packs have none.
    const s = r.samples.find((x) => x.previewUrl)!;
    expect(s).toMatchObject({ unit: "pack", downloadable: false, license: { verdict: "yes" } });
    expect(s.price?.amount ?? 0).toBeGreaterThanOrEqual(0);
    expect(s.previewUrl).toMatch(/^https:\/\/www\.ghosthack\.de\/media\/.+\.mp3$/);
    const res = await ctx.fetch.raw(s.previewUrl!, { headers: { range: "bytes=0-0" } });
    await res.body?.cancel().catch(() => undefined);
    expect(res.headers.get("content-type")).toMatch(/audio/);

    const d = await ghosthack.getSample!(s.nativeId, ctx);
    expect(d!.title).toBe(s.title);
    expect(d!.files.length).toBeGreaterThan(0);
  }, 60_000);
});
