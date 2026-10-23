import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { bigsoundbank } from "../../src/providers/bigsoundbank.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("bigsoundbank (live)", () => {
  it("searches and resolves a sound page, never linking /UPLOAD/", async () => {
    const r = await bigsoundbank.search({ query: "rain", limit: 5 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThan(5);
    expect(r.samples.every((s) => s.license?.id === "CC0-1.0" && !s.downloadable)).toBe(true);
    const d = await bigsoundbank.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d!.title).toBe(r.samples[0]!.title);
    expect(d!.formats).toContain("wav");
    expect(JSON.stringify([r.samples, d])).not.toMatch(/\/UPLOAD\//);
  }, 60_000);

  it("counts the catalogue", async () => {
    expect((await bigsoundbank.census!(ctx)).total).toBeGreaterThan(3000);
  });
});
