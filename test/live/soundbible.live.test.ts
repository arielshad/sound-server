import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { soundbible } from "../../src/providers/soundbible.js";

const ctx = { fetch: createHttpClient() };
const crawlDelay = () => new Promise((r) => setTimeout(r, 2_500));

describe.runIf(process.env.LIVE)("soundbible (live)", () => {
  // robots.txt Crawl-delay: 2.
  it("searches, reads the licence and resolves the WAV", async () => {
    const r = await soundbible.search({ query: "glass", limit: 5 }, ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => s.license && s.previewUrl)).toBe(true);

    await crawlDelay();
    const d = await soundbible.getSample!(r.samples[0]!.nativeId, ctx);
    expect(d!.title).toBe(r.samples[0]!.title);
    const wav = d!.files.find((f) => f.format === "wav")!;
    await crawlDelay();
    const res = await ctx.fetch.raw(wav.url, { headers: { range: "bytes=0-11" } });
    const head = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(0, 12));
    expect(head.startsWith("RIFF")).toBe(true);
  }, 30_000);
});
