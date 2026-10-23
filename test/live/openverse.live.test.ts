import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { openverse } from "../../src/providers/openverse.js";

// Openverse can take well over the default 15 s from some egress IPs.
const ctx = { fetch: createHttpClient({ timeoutMs: 60_000 }) };

describe.runIf(process.env.LIVE)("openverse (live)", () => {
  it("searches, resolves one sample and counts the sources", { timeout: 180_000 }, async () => {
    const r = await openverse.search({ query: "snare", limit: 5 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    const s = r.samples[0]!;
    expect(s.license).toBeDefined();
    expect(s.previewUrl).toMatch(/^https:\/\//);
    expect(s.sameAs?.[0]).toMatch(/^(freesound|wikimediacommons):/);

    const d = await openverse.getSample!(s.nativeId, ctx);
    expect(d?.files.length).toBeGreaterThan(0);

    const c = await openverse.census!(ctx);
    expect(c.total).toBeGreaterThan(100_000);
  });
});
