import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { freesound, freesoundSimilar } from "../../src/providers/freesound.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE && process.env.FREESOUND_API_KEY)("freesound (live)", () => {
  it("searches with filters, resolves one sample, finds similar and counts", { timeout: 60_000 }, async () => {
    const r = await freesound.search({ query: "kick", limit: 5, commercialOnly: true, forms: ["one-shot"] }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThan(0);
    const s = r.samples[0]!;
    expect(["yes", "yes-with-credit"]).toContain(s.license?.verdict);
    expect(s.previewUrl).toMatch(/^https:\/\/cdn\.freesound\.org\/previews\//);

    const d = await freesound.getSample!(s.nativeId, ctx);
    expect(d?.files.some((f) => f.role === "preview")).toBe(true);
    expect(d?.files.find((f) => f.role === "original")?.url).toContain(`/apiv2/sounds/${s.nativeId}/download/`);

    const similar = await freesoundSimilar(s.nativeId, ctx, 3);
    expect(similar.length).toBeGreaterThan(0);

    const loops = await freesound.search({ query: "drum loop", limit: 5, bpm: { min: 120, max: 130 }, forms: ["loop"] }, ctx);
    expect(loops.samples.length).toBeGreaterThan(0);

    const c = await freesound.census!(ctx);
    expect(c.total).toBeGreaterThan(500_000);
  });
});
