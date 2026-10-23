import { describe, expect, it } from "vitest";
import { functionloops } from "../../src/providers/functionloops.js";
import { fixtureCtx } from "../helpers.js";

describe("functionloops (link-only)", () => {
  it("makes no requests and links to the site's search", async () => {
    const ctx = fixtureCtx([]);
    const r = await functionloops.search({ query: "vocal chops", limit: 10 }, ctx);
    expect(r).toEqual({ samples: [], searchUrl: "https://www.functionloops.com/search?q=vocal+chops" });
    expect(ctx.fetch.requests).toEqual([]);
    expect(functionloops).toMatchObject({ access: "link", supportsDownload: false, pricing: "paid" });
    expect(functionloops.license).toMatchObject({ verdict: "yes", redistribution: false, url: "https://www.functionloops.com/license.html" });
  });

  it("puts BPM and key into the search text and browses the catalogue when empty", () => {
    expect(functionloops.buildSearchUrl({ query: "techno", limit: 1, bpm: { min: 128, max: 128 }, key: { tonic: "A", mode: "minor" } })).toBe(
      "https://www.functionloops.com/search?q=techno+128+bpm+A+minor",
    );
    expect(functionloops.buildSearchUrl({ query: "", limit: 1 })).toBe("https://www.functionloops.com/sounds.html");
  });
});
