import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { wikimediacommons } from "../../src/providers/wikimediacommons.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("wikimediacommons (live)", () => {
  // Commons rate-limits anonymous traffic hard (HTTP 429 after a few requests a minute).
  it("finds snare recordings with previews, no MIDI, and resolves the original", async () => {
    const r = await wikimediacommons.search({ query: "snare drum", limit: 5 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => !/\.midi?$/i.test(s.nativeId) && s.previewUrl)).toBe(true);
    const d = await wikimediacommons.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d!.files.find((f) => f.role === "original")?.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
  });
});
