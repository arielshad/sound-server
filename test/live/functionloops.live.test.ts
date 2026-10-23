import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { functionloops } from "../../src/providers/functionloops.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("functionloops (live)", () => {
  it("links to pages that exist", async () => {
    for (const url of [functionloops.buildSearchUrl({ query: "", limit: 1 }), functionloops.license!.url!]) {
      const res = await ctx.fetch.raw(url);
      await res.body?.cancel().catch(() => undefined);
      expect(res.status, url).toBe(200);
    }
  });
});
