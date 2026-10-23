import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { sampleradar } from "../../src/providers/sampleradar.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("sampleradar (live)", () => {
  it("lists ~270 packs from the hub article and finds a direct zip", async () => {
    const all = await sampleradar.search({ query: "", limit: 1000 }, ctx);
    expect(all.total).toBeGreaterThan(200);
    const r = await sampleradar.search({ query: "vocal", limit: 5 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    const d = await sampleradar.getSample!(r.samples[0]!.nativeId, ctx);
    const zip = d!.files.find((f) => f.role === "pack");
    expect(zip?.url).toMatch(/^https:\/\/cdn\.mos\.musicradar\.com\/.+\.zip$/);
    expect(zip?.sizeBytes).toBeGreaterThan(1_000_000);
  }, 60_000);
});
