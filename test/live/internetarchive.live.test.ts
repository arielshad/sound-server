import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { internetarchive } from "../../src/providers/internetarchive.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("internetarchive (live)", () => {
  it("finds CC/PD 808 packs and lists downloadable files", async () => {
    const r = await internetarchive.search({ query: "808", limit: 5 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => s.license?.assertedBy === "uploader")).toBe(true);
    const d = await internetarchive.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d!.files.length).toBeGreaterThan(0);
    const f = d!.files.find((x) => x.role === "preview") ?? d!.files[0]!;
    const res = await ctx.fetch.raw(f.url, { headers: { range: "bytes=0-99" } });
    expect(res.status).toBeLessThan(300);
    await res.body?.cancel();
  });

  it("counts the filtered catalogue", async () => {
    const c = await internetarchive.census!(ctx);
    expect(c.total).toBeGreaterThan(500);
  });
});
