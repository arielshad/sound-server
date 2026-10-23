import { describe, expect, it } from "vitest";
import { mapLimit } from "../../src/core/census.js";
import { createHttpClient } from "../../src/core/http.js";
import { zenodo } from "../../src/providers/zenodo.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("zenodo (live)", () => {
  it("every allow-listed file answers a plain ranged GET with the recorded size", async () => {
    const all = await zenodo.search({ query: "", limit: 1000 }, ctx);
    const files = (await Promise.all(all.samples.map((s) => zenodo.getSample!(s.nativeId, ctx)))).flatMap((d) => d!.files);
    expect(files.length).toBeGreaterThan(15);
    const broken = (
      await mapLimit(files, 2, async (f) => {
        try {
          const res = await ctx.fetch.raw(f.url, { headers: { range: "bytes=0-0" } });
          await res.body?.cancel().catch(() => undefined);
          const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1] ?? res.headers.get("content-length"));
          if (/text\/html/.test(res.headers.get("content-type") ?? "")) return `${f.url}: HTML`;
          return f.sizeBytes && total && total !== f.sizeBytes ? `${f.url}: size ${total} != ${f.sizeBytes}` : undefined;
        } catch (e) {
          return `${f.url}: ${(e as Error).message}`;
        }
      })
    ).filter(Boolean);
    expect(broken).toEqual([]);
  }, 180_000);
});
