import { describe, expect, it } from "vitest";
import { mapLimit } from "../../src/core/census.js";
import { createHttpClient } from "../../src/core/http.js";
import { curated } from "../../src/providers/curated.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("curated (live)", () => {
  it("every direct file still answers a plain ranged GET with the recorded size", async () => {
    const all = await curated.search({ query: "", limit: 1000 }, ctx);
    const files = (await Promise.all(all.samples.filter((s) => s.downloadable).map((s) => curated.getSample!(s.nativeId, ctx)))).flatMap((d) => d!.files);
    expect(files.length).toBeGreaterThan(25);
    const broken = (
      await mapLimit(files, 4, async (f) => {
        try {
          const res = await ctx.fetch.raw(f.url, { headers: { range: "bytes=0-0" } });
          await res.body?.cancel().catch(() => undefined);
          const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1] ?? res.headers.get("content-length"));
          return f.sizeBytes && total && total !== f.sizeBytes ? `${f.url}: size ${total} != ${f.sizeBytes}` : undefined;
        } catch (e) {
          return `${f.url}: ${(e as Error).message}`;
        }
      })
    ).filter(Boolean);
    expect(broken).toEqual([]);
  }, 180_000);
});
