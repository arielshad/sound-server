import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { FEEDS, freepacks, type FeedId } from "../../src/providers/freepacks.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("freepacks (live)", () => {
  it("every feed answers and parses", async () => {
    for (const id of Object.keys(FEEDS) as FeedId[]) {
      const items = FEEDS[id].parse(await ctx.fetch.text(FEEDS[id].url));
      // BPB's main feed holds the latest 10 posts, which may include no free soundware this week.
      if (id !== "bpb") expect(items.length, id).toBeGreaterThan(0);
      expect(items.every((i) => i.url.startsWith("https://")), id).toBe(true);
    }
  }, 60_000);

  it("searches all feeds", async () => {
    const r = await freepacks.search({ query: "", limit: 100 }, ctx);
    expect(r.samples.length).toBeGreaterThan(10);
    expect(r.samples.every((s) => s.unit === "pack" && !s.downloadable && s.price?.free)).toBe(true);
    const d = await freepacks.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d!.title).toBe(r.samples[0]!.title);
  }, 60_000);
});
