import { describe, expect, it } from "vitest";
import { ccmixter } from "../../src/providers/ccmixter.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  [/f=count&tags=acappella&lic=open/, "ccmixter/count_open.json"],
  [/f=count&tags=acappella/, "ccmixter/count_acappella.json"],
  [/f=count&tags=sample/, "ccmixter/count_sample.json"],
  ["ids=71262", "ccmixter/upload.json"],
  ["ids=31607", "ccmixter/upload_stems.json"],
  ["ids=", "ccmixter/empty.json"],
  ["search=xqzzyv", "ccmixter/empty.json"],
  ["lic=splus", "ccmixter/search_splus.json"],
  ["tags=sample", "ccmixter/search_sample.json"],
  ["tags=acappella", "ccmixter/search_acappella.json"],
];

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("ccmixter", () => {
  it("searches a cappellas in one request: vocals.acapella phrases with per-upload licences", async () => {
    const ctx = fixtureCtx(routes);
    const r = await ccmixter.search({ query: "rap", limit: 5 }, ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    const p = params(ctx.fetch.requests[0]!);
    expect(ctx.fetch.requests[0]).toMatch(/^https:\/\/ccmixter\.org\/api\/query\?/);
    expect(Object.fromEntries(p)).toEqual({ f: "json", tags: "acappella", search: "rap", sort: "rank", limit: "5" });
    expect(r.samples).toHaveLength(5);
    const s = r.samples[0]!;
    expect(s).toMatchObject({
      id: "ccmixter:26747",
      title: "Inside Outside (the song)",
      category: "vocals.acapella",
      categoryEvidence: { by: "source", confidence: 1 },
      form: "phrase",
      bpm: 77,
      durationSec: 334,
      previewNeedsReferer: true,
      downloadable: true,
      url: "https://ccmixter.org/files/snowflake/26747",
    });
    expect(s.previewUrl).toMatch(/^https:\/\/ccmixter\.org\/content\/snowflake\/.+\.mp3$/);
    expect(s.license).toMatchObject({ id: "CC-BY-NC-3.0", verdict: "no" });
    const by = r.samples.find((x) => x.nativeId === "29407")!;
    expect(by.license).toMatchObject({ id: "CC-BY-3.0", verdict: "yes-with-credit" });
    expect(by.attribution).toContain("ccMixter");
  });

  it("maps Sampling+ to a restricted verdict", async () => {
    const r = await ccmixter.search({ query: "", limit: 2, commercialOnly: false }, fixtureCtx([["tags=acappella", "ccmixter/search_splus.json"]]));
    expect(r.samples.map((s) => s.license?.id)).toEqual(["LicenseRef-Sampling-Plus-1.0", "LicenseRef-Sampling-Plus-1.0"]);
    expect(r.samples[0]!.license?.verdict).toBe("restricted");
  });

  it("asks for commercial-friendly licences natively and paginates", async () => {
    const ctx = fixtureCtx(routes);
    await ccmixter.search({ query: "", limit: 10, offset: 20, commercialOnly: true }, ctx);
    const p = params(ctx.fetch.requests[0]!);
    expect(p.get("lic")).toBe("open");
    expect(p.get("limit")).toBe("10");
    expect(p.get("offset")).toBe("20");
    expect(p.has("search")).toBe(false);
    expect(ccmixter.nativeFilters).toEqual(expect.arrayContaining(["categories", "commercialOnly"]));
  });

  it("switches to sample (stem) uploads for instrument categories and skips FX", async () => {
    const ctx = fixtureCtx(routes);
    const r = await ccmixter.search({ query: "drum", limit: 5, categories: ["drums"] }, ctx);
    expect(params(ctx.fetch.requests[0]!).get("tags")).toBe("sample");
    const stems = r.samples.find((s) => s.nativeId === "30344")!;
    expect(stems).toMatchObject({ unit: "pack", form: "pack", packSize: 12, bpm: 125 });
    expect(stems.category).not.toBe("vocals.acapella");
    const zipped = r.samples.find((s) => s.nativeId === "31607")!;
    expect(zipped).toMatchObject({ unit: "pack", form: "pack" });
    expect(zipped.license?.verdict).toBe("restricted");

    const hinted = fixtureCtx(routes);
    await ccmixter.search({ query: "808", limit: 5, hints: ["bass.808"] }, hinted);
    expect(params(hinted.fetch.requests[0]!).get("tags")).toBe("sample");

    const fx = fixtureCtx(routes);
    expect((await ccmixter.search({ query: "riser", limit: 5, categories: ["fx.riser"] }, fx)).samples).toEqual([]);
    expect(fx.fetch.requests).toHaveLength(0);
  });

  it("returns an empty list for no hits", async () => {
    const r = await ccmixter.search({ query: "xqzzyv", limit: 5 }, fixtureCtx(routes));
    expect(r.samples).toEqual([]);
  });

  it("returns files with the Referer the hotlink guard wants", async () => {
    const ctx = fixtureCtx(routes);
    const d = await ccmixter.getSample!("71262", ctx);
    expect(ctx.fetch.requests).toEqual(["https://ccmixter.org/api/query?f=json&ids=71262"]);
    expect(d).toMatchObject({ title: "0 a.d. - Viriathus - Intro", category: "vocals.acapella", durationSec: 58, sampleRate: 48000, channels: 1 });
    expect(d!.license?.id).toBe("CC-BY-4.0");
    expect(d!.files).toEqual([
      {
        url: "https://ccmixter.org/content/eaterjolly/eaterjolly_-_0_a.d._-_Viriathus_-_Intro.flac",
        filename: "eaterjolly_-_0_a.d._-_Viriathus_-_Intro.flac",
        format: "flac",
        role: "original",
        sampleRate: 48000,
        channels: 1,
        sizeBytes: 5138662,
        headers: { Referer: "https://ccmixter.org/" },
      },
    ]);
    expect(d!.createdAt).toBe("2026-10-09T15:47:00.000Z");

    const stems = await ccmixter.getSample!("31607", fixtureCtx(routes));
    expect(stems!.files.map((f) => [f.format, f.role])).toEqual([
      ["mp3", "original"],
      ["zip", "pack"],
    ]);
  });

  it("returns null for unknown or malformed ids", async () => {
    const ctx = fixtureCtx(routes);
    expect(await ccmixter.getSample!("99999999", ctx)).toBeNull();
    expect(await ccmixter.getSample!("abc", ctx)).toBeNull();
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("builds the site search URL", () => {
    expect(ccmixter.buildSearchUrl({ query: "female rap", limit: 5 })).toBe(
      "https://ccmixter.org/search?search_text=female+rap&search_type=any&search_in=uploads",
    );
    expect(ccmixter.buildSearchUrl({ query: "", limit: 5 })).toBe("https://ccmixter.org/view/media/samples/acappellas");
  });

  it("counts a cappellas and sample uploads", async () => {
    const ctx = fixtureCtx(routes);
    const c = await ccmixter.census!(ctx);
    expect(ctx.fetch.requests).toHaveLength(3);
    expect(c.byCategory.vocals).toBe(5985);
    expect(c.total).toBe(5985 + 15957);
    expect(c.byLicense?.["CC BY / BY-SA / CC0 (a cappellas)"]).toBe(1515);
  });
});
