import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { ccmixter } from "../../src/providers/ccmixter.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("ccmixter (live)", () => {
  // ccmixter.org's TLS endpoint is flaky from some egress (resets mid-handshake); expect retries.
  it("finds a cappellas and fetches a file with the Referer", async () => {
    const r = await ccmixter.search({ query: "female", limit: 3 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => s.category === "vocals.acapella")).toBe(true);
    const d = await ccmixter.getSample!(r.samples[0]!.nativeId, ctx);
    const f = d!.files[0]!;
    expect(f.headers?.Referer).toBe("https://ccmixter.org/");
    const res = await ctx.fetch.raw(f.url, { headers: { ...f.headers, range: "bytes=0-99" } });
    expect(res.status).toBeLessThan(300);
    await res.body?.cancel();
  });
});
