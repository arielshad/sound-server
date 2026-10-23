import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { STRUDEL_MANIFESTS, strudel } from "../../src/providers/strudel.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("strudel (live)", () => {
  it("indexes every allow-listed manifest and serves a playable wav", async () => {
    const all = await strudel.search({ query: "", limit: 100_000 }, ctx);
    expect(all.total).toBeGreaterThan(5000);
    for (const m of STRUDEL_MANIFESTS) expect(all.samples.some((s) => s.nativeId.startsWith(`${m.key}/`)), m.key).toBe(true);

    const r = await strudel.search({ query: "808 kick", limit: 5 }, ctx);
    expect(r.samples[0]!.category).toBe("drums.kick");
    const d = await strudel.getSample!(r.samples[0]!.nativeId, ctx);
    const res = await ctx.fetch.raw(d!.files[0]!.url, { headers: { range: "bytes=0-15" } });
    expect([200, 206]).toContain(res.status);
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, 4);
    expect(String.fromCharCode(...head)).toBe("RIFF");
  }, 60_000);
});
