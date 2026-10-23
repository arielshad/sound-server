import { describe, expect, it } from "vitest";
import { mixkit, mixkitSlug } from "../../src/providers/mixkit.js";
import { fixtureCtx } from "../helpers.js";

describe("mixkit (link only)", () => {
  it("never fetches: its terms forbid automated access", async () => {
    const ctx = fixtureCtx([]);
    const r = await mixkit.search({ query: "riser", limit: 10 }, ctx);
    expect(r).toEqual({ samples: [], searchUrl: "https://mixkit.co/free-sound-effects/discover/riser/" });
    expect(ctx.fetch.requests).toEqual([]);
    expect(mixkit).toMatchObject({ access: "link", supportsDownload: false, pricing: "free" });
    expect(mixkit.getSample).toBeUndefined();
  });

  it("states the site licence", () => {
    expect(mixkit.license).toMatchObject({
      name: "Mixkit Sound Effects Free License",
      url: "https://mixkit.co/license/#sfxFree",
      verdict: "yes",
      attributionRequired: false,
      redistribution: false,
      assertedBy: "site",
    });
  });

  it("builds the same deep link the site's search box uses", () => {
    expect(mixkit.buildSearchUrl({ query: "Door knock!", limit: 1 })).toBe("https://mixkit.co/free-sound-effects/discover/door-knock/");
    expect(mixkit.buildSearchUrl({ query: "riser", bpm: { min: 128, max: 128 }, limit: 1 })).toBe(
      "https://mixkit.co/free-sound-effects/discover/riser-128-bpm/",
    );
    expect(mixkit.buildSearchUrl({ query: "  ", limit: 1 })).toBe("https://mixkit.co/free-sound-effects/");
    expect(mixkitSlug("Sci-fi  whoosh")).toBe("sci-fi-whoosh");
  });
});
