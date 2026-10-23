import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { orangefreesounds } from "../../src/providers/orangefreesounds.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("orangefreesounds (live)", () => {
  it("searches the REST API and resolves a post", async () => {
    const r = await orangefreesounds.search({ query: "drum loop", limit: 5 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => s.license && s.license.id !== "LicenseRef-Unknown")).toBe(true);
    expect(r.samples[0]!.previewUrl).toMatch(/\/wp-content\/uploads\/.+\.mp3$/);

    const d = await orangefreesounds.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d!.files.length).toBeGreaterThan(0);
    const res = await ctx.fetch.raw(d!.files[0]!.url, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).not.toMatch(/text\/html/);
  });

  it("counts the catalogue", async () => {
    const c = await orangefreesounds.census!(ctx);
    expect(c.total).toBeGreaterThan(1000);
    expect(c.byCategory.fx).toBeGreaterThan(0);
  });
});
