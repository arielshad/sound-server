import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { kenney } from "../../src/providers/kenney.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("kenney (live)", () => {
  it("lists the audio packs and resolves a direct zip and preview", async () => {
    const all = await kenney.search({ query: "", limit: 50 }, ctx);
    expect(all.total).toBeGreaterThanOrEqual(8);
    const d = await kenney.getSample!("impact-sounds", ctx);
    const zip = d!.files.find((f) => f.role === "pack");
    expect(zip?.url).toMatch(/^https:\/\/kenney\.nl\/.+\.zip$/);
    const head = await ctx.fetch.raw(zip!.url, { method: "HEAD" });
    expect(head.headers.get("content-type")).toContain("zip");
    expect(d!.previewUrl).toMatch(/\.ogg$/);
  }, 60_000);
});
