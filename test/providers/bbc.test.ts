import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/core/http.js";
import type { HttpClient, HttpRequestInit, ProviderContext } from "../../src/core/types.js";
import { bbc } from "../../src/providers/bbc.js";
import { fixture } from "../helpers.js";

interface Call {
  url: string;
  init?: HttpRequestInit;
  criteria?: Record<string, unknown>;
}

/** BBC searches are POSTs to one URL, so route on the JSON body instead of the URL. */
function bbcCtx(): ProviderContext & { calls: Call[] } {
  const calls: Call[] = [];
  const answer = (url: string, init?: HttpRequestInit): string => {
    const criteria = init?.body ? (JSON.parse(init.body) as { criteria: Record<string, unknown> }).criteria : undefined;
    calls.push({ url, init, criteria });
    if (url.endsWith("/cached/categoryaggregations")) return fixture("bbc/categories.json");
    if (!url.endsWith("/api/sfx/search") || init?.method !== "POST" || !criteria) throw new HttpError(404, url);
    const q = String(criteria.query ?? "");
    if (criteria.size === 0) return fixture("bbc/count.json");
    if (q === "door slam") return fixture("bbc/search_door.json");
    if (q === "rain") return fixture("bbc/search_rain.json");
    if (q === "07008124") return fixture("bbc/item.json");
    return fixture("bbc/empty.json");
  };
  const fetch: HttpClient = {
    async text(url, init) {
      return answer(url, init);
    },
    async json<T>(url: string, init?: HttpRequestInit) {
      return JSON.parse(answer(url, init)) as T;
    },
    async raw(url, init) {
      return new Response(answer(url, init));
    },
  };
  return { fetch, calls };
}

describe("bbc", () => {
  it("maps search results: RemArc licence, mp3 preview, duration in seconds", async () => {
    const ctx = bbcCtx();
    const r = await bbc.search({ query: "door slam", limit: 5 }, ctx);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]!.criteria).toEqual({ from: 0, size: 5, query: "door slam" });
    expect(ctx.calls[0]!.init?.cacheTtlMs).toBeGreaterThan(0);
    expect(r.total).toBe(512);
    expect(r.samples).toHaveLength(5);
    const s = r.samples[0]!;
    expect(s).toMatchObject({
      id: "bbc:07008124",
      provider: "bbc",
      title: "Interior, doors slam, moves off and gathers speed.",
      previewUrl: "https://sound-effects-media.bbcrewind.co.uk/mp3/07008124.mp3",
      durationSec: 91.44,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      downloadable: true,
      url: "https://sound-effects.bbcrewind.co.uk/search?q=07008124",
    });
    expect(s.license).toMatchObject({ id: "LicenseRef-BBC-RemArc", verdict: "no", commercialUse: false, attributionRequired: true });
    expect(s.attribution).toContain("BBC Sound Effects");
    expect(r.samples.every((x) => x.license?.verdict === "no")).toBe(true);
    // Words decide when they can ("door" → foley); BBC's category is only the fallback.
    expect(r.samples.find((x) => x.nativeId === "07037546")?.category).toBe("foley");
    // …but a 90 s train interior filed under Transport is an ambience, not an impact.
    expect(r.samples.find((x) => x.nativeId === "07008124")?.category).toBe("ambience");
    expect(r.searchUrl).toBe("https://sound-effects.bbcrewind.co.uk/search?q=door+slam");
  });

  it("passes duration as whole seconds, paging, and falls back on BBC's category", async () => {
    const ctx = bbcCtx();
    const r = await bbc.search({ query: "rain", limit: 4, offset: 8, maxDurationSec: 59.5 }, ctx);
    expect(ctx.calls[0]!.criteria).toEqual({ from: 8, size: 4, query: "rain", durations: [{ min: 0, max: 60 }] });
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((s) => s.category.startsWith("ambience"))).toBe(true);
    const nhu = r.samples.find((s) => s.nativeId.startsWith("NHU"));
    expect(nhu?.author).toBeTruthy();
  });

  it("lists duration as a native filter and carries the RemArc licence at provider level", () => {
    expect(bbc.nativeFilters).toContain("duration");
    expect(bbc.license?.verdict).toBe("no");
  });

  it("skips commercial-only searches and categories it does not carry without a request", async () => {
    const ctx = bbcCtx();
    expect((await bbc.search({ query: "door", limit: 5, commercialOnly: true }, ctx)).samples).toEqual([]);
    expect((await bbc.search({ query: "kick", limit: 5, categories: ["drums.kick"] }, ctx)).samples).toEqual([]);
    expect(ctx.calls).toHaveLength(0);
  });

  it("returns an empty list for no hits", async () => {
    const ctx = bbcCtx();
    const r = await bbc.search({ query: "xqzzyvvq", limit: 5 }, ctx);
    expect(r.samples).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("resolves a sample to its wav zip and mp3", async () => {
    const ctx = bbcCtx();
    const d = await bbc.getSample!("07008124", ctx);
    expect(ctx.calls).toHaveLength(1);
    expect(d?.files).toEqual([
      expect.objectContaining({
        url: "https://sound-effects-media.bbcrewind.co.uk/zip/07008124.wav.zip",
        format: "zip",
        role: "original",
        sizeBytes: 16130784,
      }),
      expect.objectContaining({ url: "https://sound-effects-media.bbcrewind.co.uk/mp3/07008124.mp3", format: "mp3", role: "preview" }),
    ]);
    expect(await bbc.getSample!("99999999", ctx)).toBeNull();
    expect(await bbc.getSample!("../etc", ctx)).toBeNull();
  });

  it("builds the site search URL", () => {
    expect(bbc.buildSearchUrl({ query: "dog bark", limit: 5 })).toBe("https://sound-effects.bbcrewind.co.uk/search?q=dog+bark");
  });

  it("counts the catalogue", async () => {
    const c = await bbc.census!(bbcCtx());
    expect(c.total).toBe(33066);
    expect(c.byLicense).toEqual({ "LicenseRef-BBC-RemArc": 33066 });
    expect(c.categories?.Nature).toBe(17630);
    expect(c.byCategory.ambience).toBeGreaterThan(17630);
  });
});
