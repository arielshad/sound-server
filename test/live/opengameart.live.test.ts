import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { opengameart } from "../../src/providers/opengameart.js";

const ctx = { fetch: createHttpClient() };
const crawlDelay = () => new Promise((r) => setTimeout(r, 10_500));

describe.runIf(process.env.LIVE)("opengameart (live)", () => {
  // One request at a time, 10 s apart (robots.txt Crawl-delay: 10).
  it("searches audio and resolves a plain-GET file", async () => {
    const r = await opengameart.search({ query: "laser", categories: ["fx"], limit: 3 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThan(0);
    expect(r.samples[0]!.previewUrl).toMatch(/^https:\/\/opengameart\.org\/sites\/default\/files\/.+\.(mp3|ogg)$/);

    await crawlDelay();
    const d = await opengameart.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d!.license).toBeDefined();
    expect(d!.license!.id).not.toBe("LicenseRef-OpenGameArt-per-item-licence");
    const file = d!.files.find((f) => f.role !== "preview")!;
    expect(file.url).toContain("/sites/default/files/");

    await crawlDelay();
    const res = await ctx.fetch.raw(file.url, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).not.toMatch(/text\/html/);
  }, 60_000);
});
