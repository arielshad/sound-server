import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { bbc } from "../../src/providers/bbc.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("bbc (live)", () => {
  it("finds short door sounds and resolves the wav zip and mp3", async () => {
    const r = await bbc.search({ query: "door slam", limit: 5, maxDurationSec: 10 }, ctx);
    expect(r.total).toBeGreaterThan(0);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => s.license?.verdict === "no" && (s.durationSec ?? 0) <= 10)).toBe(true);
    const d = await bbc.getSample!(r.samples[0]!.nativeId, ctx);
    const zip = d!.files.find((f) => f.role === "original")!;
    const head = await ctx.fetch.raw(zip.url, { method: "HEAD" });
    expect(head.headers.get("content-type")).toContain("zip");
    const mp3 = await ctx.fetch.raw(d!.previewUrl!, { method: "HEAD" });
    expect(mp3.headers.get("content-type")).toMatch(/audio/);
  });

  it("counts the catalogue", async () => {
    const c = await bbc.census!(ctx);
    expect(c.total).toBeGreaterThan(30_000);
  });
});
