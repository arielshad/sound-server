import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { mixkit } from "../../src/providers/mixkit.js";

const ctx = { fetch: createHttpClient() };

// Link only: Mixkit's terms forbid automated access, so even the live test makes no request.
describe.runIf(process.env.LIVE)("mixkit (live)", () => {
  it("returns only a deep link", async () => {
    const r = await mixkit.search({ query: "cinematic riser", limit: 5 }, ctx);
    expect(r).toEqual({ samples: [], searchUrl: "https://mixkit.co/free-sound-effects/discover/cinematic-riser/" });
  });
});
