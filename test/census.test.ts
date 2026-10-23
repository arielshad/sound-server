import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/api/app.js";
import { addedSince, appendHistory, catalogueCensus, countBy, mapLimit, parseCount, runCensus, tallySamples, top, wpTotal, type Catalog } from "../src/core/census.js";
import { creativeCommons, license } from "../src/core/licence.js";
import { SampleService } from "../src/core/service.js";
import type { Category, HttpClient, Provider, SourceCensus } from "../src/core/types.js";
import { makeSample } from "../src/core/util.js";
import { allProviders } from "../src/providers/index.js";
import { bytesHttp, fakeProvider } from "./fakes.js";

const SITE = fileURLToPath(new URL("./fixtures/site", import.meta.url));

/** HttpClient answering by URL: a string body, or { body, headers }. */
function routeHttp(route: (url: string) => string | { body: string; headers?: Record<string, string> } | undefined): HttpClient & { urls: string[] } {
  const urls: string[] = [];
  const answer = (url: string) => {
    urls.push(url);
    const r = route(url);
    if (r === undefined) throw new Error(`unexpected ${url}`);
    return typeof r === "string" ? { body: r, headers: {} } : r;
  };
  return {
    urls,
    async text(url) {
      return answer(url).body;
    },
    async json<T>(url: string) {
      return JSON.parse(answer(url).body) as T;
    },
    async raw(url) {
      const r = answer(url);
      return new Response(r.body, { headers: r.headers });
    },
  };
}

describe("census helpers", () => {
  it("counts, ranks and dates", () => {
    expect(countBy([{ t: "a" }, { t: "b" }, { t: "a" }, { t: undefined }], (x) => x.t)).toEqual({ a: 2, b: 1 });
    expect(countBy([{ c: ["x", "y"] }, { c: ["x"] }], (x) => x.c)).toEqual({ x: 2, y: 1 });
    expect(top({ a: 1, b: 5, c: 3, d: 0 }, 2)).toEqual({ b: 5, c: 3 });
    const now = Date.parse("2026-10-05T00:00:00Z");
    expect(addedSince(["2026-10-01", "2026-08-01", Date.parse("2026-09-20") / 1000, undefined, "nonsense"], now)).toBe(2);
    expect(parseCount("Browse (118,384 results)", /\(?([\d,]+) results\)?/)).toBe(118384);
    expect(parseCount("nothing", /([\d,]+) results/)).toBeUndefined();
  });

  it("limits concurrency and keeps order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  it("tallies a full catalogue by top-level category, licence and category", () => {
    let n = 0;
    const a = (category: Category, cc0: boolean, createdAt?: string) =>
      makeSample({
        provider: "x",
        nativeId: String(n++),
        title: "t",
        category,
        tags: [],
        url: "https://x",
        license: cc0 ? license("CC0-1.0") : creativeCommons({}),
        price: { free: true },
        downloadable: true,
        createdAt,
      });
    const c = tallySamples([a("drums.kick", true, "2026-10-01"), a("drums.snare", false), a("fx.riser", true)], "m", { now: Date.parse("2026-10-05") });
    expect(c).toMatchObject({
      total: 3,
      free: 3,
      byCategory: { drums: 2, fx: 1 },
      byLicense: { "CC0-1.0": 2, "CC-BY-4.0": 1 },
      categories: { "drums.kick": 1, "drums.snare": 1, "fx.riser": 1 },
      addedLast30Days: 1,
      method: "m",
    });
    // One licence and no prices or dates: those fields are left out.
    const plain = tallySamples([makeSample({ provider: "x", nativeId: "1", title: "t", tags: [], url: "https://x", license: license("CC0-1.0"), downloadable: false })], "m");
    expect(plain.byLicense).toBeUndefined();
    expect(plain.free).toBeUndefined();
    expect(plain.addedLast30Days).toBeUndefined();
  });

  it("reads X-WP-Total", async () => {
    const http = routeHttp(() => ({ body: "[]", headers: { "x-wp-total": "1498" } }));
    expect(await wpTotal(http, "https://x/wp-json/wp/v2/posts")).toBe(1498);
    await expect(wpTotal(routeHttp(() => "[]"), "https://x")).rejects.toThrow(/X-WP-Total/);
  });
});

describe("provider census", () => {
  // Per-source counts are tested next to each provider (test/providers/<id>.test.ts).
  it("every searchable source can count itself", () => {
    const missing = allProviders.filter((p) => p.access !== "link" && !p.census).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it("counts a catalogue-based source through its own browse", async () => {
    const c = await catalogueCensus(fakeProvider, { fetch: bytesHttp() }, "samples");
    expect(c).toMatchObject({ total: 3, free: 3, byCategory: { drums: 2, vocals: 1 }, unit: "samples" });
  });
});

describe("runCensus", () => {
  const source = (id: string, census: SourceCensus | Error, extra: Partial<Provider> = {}): Provider => ({
    ...fakeProvider,
    id,
    name: id.toUpperCase(),
    pricing: "free",
    license: license("CC0-1.0", "site"),
    census: async () => {
      if (census instanceof Error) throw census;
      return census;
    },
    ...extra,
  });

  it("aggregates totals, categories, licences and keeps stale counts", async () => {
    const previous = {
      sources: [{ id: "down", name: "DOWN", homepage: "", pricing: "paid", supportsDownload: false, total: 50, byCategory: { drums: 50 }, method: "m", countedAt: "2026-10-01T00:00:00.000Z" }],
    } as unknown as Catalog;
    const providers = [
      source("free", { total: 100, byCategory: { drums: 60, fx: 40 }, addedLast30Days: 3, method: "m" }),
      source("mixed", { total: 1000, free: 200, atLeast: true, byCategory: { drums: 400, vocals: 600 }, byLicense: { "CC0-1.0": 10, "CC-BY-NC-4.0": 990 }, method: "m" }, { pricing: "freemium", license: undefined, supportsDownload: false }),
      source("down", new Error("boom"), { pricing: "paid", license: undefined }),
      { ...fakeProvider, id: "link", census: undefined },
    ];
    const c = await runCensus(providers, { fetch: bytesHttp() }, { previous, now: new Date("2026-10-05T00:00:00Z") });
    expect(c.sources.map((s) => s.id)).toEqual(["mixed", "free", "down"]);
    expect(c.totals.listings).toEqual({ count: 1150, atLeast: true });
    expect(c.totals.free).toEqual({ count: 300, atLeast: true }); // "down" has no free count
    expect(c.totals.cc0).toEqual({ count: 110, atLeast: true });
    expect(c.totals.directDownload.count).toBe(100);
    expect(c.totals.addedLast30Days).toBe(3);
    expect(c.byCategory.drums).toEqual({ count: 510, atLeast: true }); // 60 + 400 + the stale 50
    expect(c.byCategory.fx).toEqual({ count: 40 });
    expect(c.byLicense).toMatchObject({ "CC0-1.0": 110, "CC-BY-NC-4.0": 990 });
    expect(c.sources.find((s) => s.id === "down")?.stale).toEqual({ since: "2026-10-01T00:00:00.000Z", error: "boom" });
    expect(c.linked.map((l) => l.id)).toEqual(["link"]);

    const h1 = appendHistory([], c);
    const h2 = appendHistory(h1, { ...c, totals: { ...c.totals, listings: { count: 9 } } });
    expect(h2).toHaveLength(1); // one point per day
    expect(h2[0]).toMatchObject({ date: "2026-10-05", listings: 9, byCategory: { drums: 510, vocals: 600 }, sources: { mixed: 1000 } });
  });
});

describe("GET /v1/catalog", () => {
  it("serves the census shipped with the site", async () => {
    const app = createApp(new SampleService({ providers: [fakeProvider], http: bytesHttp() }), { siteRoot: SITE });
    const res = await app.request("/v1/catalog");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = (await res.json()) as Catalog;
    expect(body.totals.listings.count).toBe(1234);
  });
});
