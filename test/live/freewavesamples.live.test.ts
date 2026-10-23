import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { freewavesamples } from "../../src/providers/freewavesamples.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("freewavesamples (live)", () => {
  it("searches and resolves a plain-GET WAV", async () => {
    const r = await freewavesamples.search({ query: "snare", limit: 3 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples[0]).toMatchObject({ provider: "freewavesamples", downloadable: true });

    const d = await freewavesamples.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d!.files[0]!.url).toMatch(/^https:\/\/freewavesamples\.com\/files\/.+\.wav$/);
    const res = await ctx.fetch.raw(d!.files[0]!.url, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).not.toMatch(/text\/html/);
  });

  it("counts the catalogue", async () => {
    const c = await freewavesamples.census!(ctx);
    expect(c.total).toBeGreaterThan(1000);
    expect(c.byCategory.drums).toBeGreaterThan(0);
  }, 60_000);
});
