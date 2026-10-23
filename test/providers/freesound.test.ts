import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freesound, freesoundFilter, freesoundSimilar } from "../../src/providers/freesound.js";
import type { HttpRequestInit, ProviderContext, SampleQuery } from "../../src/core/types.js";
import { fixtureHttp } from "../helpers.js";

type Route = [string | RegExp, string];

const routes: Route[] = [
  [/apiv2\/search\/\?.*filter=license%3A%22Creative\+Commons\+0%22/, "freesound/count_cc0.json"],
  [/apiv2\/search\/\?.*filter=license%3A%22Attribution%22&/, "freesound/count_by.json"],
  [/apiv2\/search\/\?.*filter=license%3A%22Attribution\+NonCommercial%22/, "freesound/count_bync.json"],
  [/apiv2\/search\/\?.*filter=created/, "freesound/count_recent.json"],
  [/apiv2\/search\/\?sort=downloads_desc/, "freesound/count_all.json"],
  [/apiv2\/search\/\?query=zzqx/, "freesound/empty.json"],
  [/apiv2\/search\/\?query=kick/, "freesound/search_kick.json"],
  ["/apiv2/sounds/331589/similar/", "freesound/similar_331589.json"],
  ["/apiv2/sounds/331589/?", "freesound/sound_331589.json"],
];

/** fixtureHttp plus a record of each request's headers. */
function ctxWith(r: Route[] = routes, credentials?: Record<string, string>) {
  const http = fixtureHttp(r);
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const rec = (url: string, init?: HttpRequestInit) => calls.push({ url, headers: init?.headers ?? {} });
  const ctx: ProviderContext = {
    credentials,
    fetch: {
      json: async <T>(url: string, init?: HttpRequestInit) => (rec(url, init), http.json<T>(url, init)),
      text: async (url, init) => (rec(url, init), http.text(url, init)),
      raw: async (url, init) => (rec(url, init), http.raw(url, init)),
    },
  };
  return { ctx, calls, requests: http.requests };
}

const q = (over: Partial<SampleQuery> = {}): SampleQuery => ({ query: "kick", limit: 6, ...over });
const decoded = (url: string) => decodeURIComponent(url.replace(/\+/g, " "));

beforeEach(() => {
  vi.stubEnv("FREESOUND_API_KEY", "test-key");
  vi.stubEnv("FREESOUND_OAUTH_TOKEN", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("freesound", () => {
  it("is enabled only with an API key", () => {
    expect(freesound.isEnabled!()).toBe(true);
    vi.stubEnv("FREESOUND_API_KEY", "");
    expect(freesound.isEnabled!()).toBe(false);
    expect(freesound.apiKeyEnv).toBe("FREESOUND_API_KEY");
  });

  it("maps search results: licence verdicts, previews, analysis", async () => {
    const { ctx, calls } = ctxWith();
    const r = await freesound.search(q(), ctx);
    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url).toContain("https://freesound.org/apiv2/search/?query=kick");
    expect(url).toContain("page=1");
    expect(url).toContain("page_size=6");
    expect(url).toContain("sort=score");
    expect(decoded(url)).toContain("fields=id,url,name,tags,description,category,subcategory");
    expect(decoded(url)).toContain("previews");
    expect(decoded(url)).toContain("single_event");
    expect(url).not.toContain("test-key");
    expect(calls[0]!.headers).toEqual({ authorization: "Token test-key" });
    expect(r.total).toBe(18456);
    expect(r.samples).toHaveLength(6);

    const [kick, dnb, house, wump, loop, splus] = r.samples;
    expect(kick).toMatchObject({
      id: "freesound:331589",
      provider: "freesound",
      nativeId: "331589",
      title: "Kick J.Zealous Hard Club.aif",
      url: "https://freesound.org/people/J_Zealous/sounds/331589/",
      author: "J_Zealous",
      authorUrl: "https://freesound.org/people/J_Zealous/",
      category: "drums.kick",
      form: "one-shot",
      previewUrl: "https://cdn.freesound.org/previews/331/331589_5820980-hq.mp3",
      thumbnailUrl: "https://cdn.freesound.org/displays/331/331589_5820980_wave_M.png",
      formats: ["aiff"],
      license: { id: "CC0-1.0", verdict: "yes" },
      downloadable: true,
      requiresAccount: true,
      popularity: 15873,
      durationSec: 2.243,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 1,
      rootNote: 34,
      loudnessLufs: -9.6,
      price: { free: true },
    });
    // One-shots: the analysis bpm/key are meaningless (low confidence) and dropped.
    expect(kick!.bpm).toBeUndefined();
    expect(kick!.key).toBeUndefined();
    expect(kick!.description).toBe("A hard club kick drum, synthesised. Free to use.");

    expect(dnb!.license).toMatchObject({ id: "CC-BY-4.0", verdict: "yes-with-credit" });
    expect(dnb!.attribution).toContain("DNB KICK 008.wav");
    expect(dnb!.attribution).toContain("sandyrb");
    expect(dnb!.attribution).toContain("Freesound");
    expect(house!.license).toMatchObject({ id: "CC-BY-3.0", verdict: "yes-with-credit" });
    expect(wump!.license).toMatchObject({ id: "CC-BY-NC-4.0", verdict: "no" });
    expect(splus!.license).toMatchObject({ id: "LicenseRef-Sampling-Plus-1.0", verdict: "restricted" });

    expect(loop).toMatchObject({ form: "loop", bpm: 128, key: { tonic: "F", mode: "minor" }, bitDepth: 24, channels: 2 });
    expect(loop!.category.startsWith("drums")).toBe(true);
    expect(r.searchUrl).toBe("https://freesound.org/search/?q=kick");
  });

  it("passes filters natively in Freesound's filter syntax", async () => {
    const query = q({
      commercialOnly: true,
      categories: ["drums.kick"],
      forms: ["loop"],
      bpm: { min: 120, max: 130 },
      key: { tonic: "F#", mode: "minor" },
      maxDurationSec: 20,
    });
    expect(freesoundFilter(query)).toBe(
      'license:("Attribution" OR "Creative Commons 0") (subcategory:"Percussion" OR subcategory:"Solo percussion") ' +
        "(loopable:true OR tag:loop OR tag:loops) bpm:[118 TO 132] " +
        'tonality:("F# minor" OR "Gb minor") duration:[* TO 20]',
    );
    const { ctx, calls } = ctxWith();
    await freesound.search(query, ctx);
    expect(calls).toHaveLength(1);
    expect(decoded(calls[0]!.url)).toContain(`filter=${freesoundFilter(query)}`);
    expect(freesound.buildSearchUrl(query)).toContain("f=license");
    expect(freesound.nativeFilters).toEqual(expect.arrayContaining(["categories", "forms", "bpm", "key", "duration", "commercialOnly"]));
  });

  it("maps more filters: one-shots, key without mode, fx, unknown categories", () => {
    expect(freesoundFilter(q({ forms: ["one-shot"] }))).toBe("(single_event:true OR tag:\"one-shot\" OR tag:oneshot)");
    expect(freesoundFilter(q({ forms: ["phrase"] }))).toBe("");
    expect(freesoundFilter(q({ key: { tonic: "C" } }))).toBe('tonality:("C major" OR "C minor")');
    expect(freesoundFilter(q({ categories: ["fx.riser"] }))).toBe(
      '(category:"Sound effects" OR subcategory:"Synths / Electronic" OR subcategory:"Synthetic / Artificial")',
    );
    expect(freesoundFilter(q({ categories: ["ambience"] }))).toBe('(category:"Soundscapes" OR subcategory:"Natural elements and explosions")');
    // "other" can't be narrowed without dropping results: no native category clause.
    expect(freesoundFilter(q({ categories: ["drums", "other"] }))).toBe("");
    expect(freesoundFilter(q({ minDurationSec: 1, maxDurationSec: 4 }))).toBe("duration:[1 TO 4]");
    expect(freesoundFilter(q())).toBe("");
  });

  it("pages with page/page_size and caps the page size at 150", async () => {
    const a = ctxWith();
    await freesound.search(q({ limit: 500, offset: 300 }), a.ctx);
    expect(a.calls[0]!.url).toContain("page_size=150");
    expect(a.calls[0]!.url).toContain("page=3");
    const b = ctxWith();
    const r = await freesound.search(q({ limit: 3, offset: 4 }), b.ctx);
    expect(b.calls[0]!.url).toContain("page=2");
    expect(b.calls[0]!.url).toContain("page_size=3");
    expect(r.samples[0]!.nativeId).toBe("41155"); // page 2 starts at item 3; offset 4 skips one more
  });

  it("returns no samples for an empty result and for a page past the end (404)", async () => {
    const { ctx } = ctxWith();
    const r = await freesound.search(q({ query: "zzqx" }), ctx);
    expect(r.samples).toEqual([]);
    expect(r.total).toBe(0);
    const past = await freesound.search(q({ query: "nothing-routed" }), ctxWith([]).ctx);
    expect(past.samples).toEqual([]);
  });

  it("refuses to search without an API key", async () => {
    vi.stubEnv("FREESOUND_API_KEY", "");
    await expect(freesound.search(q(), ctxWith().ctx)).rejects.toThrow(/FREESOUND_API_KEY/);
  });

  it("getSample: original needs OAuth, previews are plain GETs", async () => {
    const { ctx, calls } = ctxWith();
    const d = await freesound.getSample!("331589", ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/^https:\/\/freesound\.org\/apiv2\/sounds\/331589\/\?fields=/);
    expect(d).toMatchObject({ id: "freesound:331589", license: { verdict: "yes" }, downloadable: true });
    expect(d!.files).toEqual([
      {
        url: "https://freesound.org/apiv2/sounds/331589/download/",
        filename: "Kick J.Zealous Hard Club.aif",
        format: "aiff",
        role: "original",
        sampleRate: 44100,
        bitDepth: 16,
        channels: 1,
        sizeBytes: 595066,
        requiresAuth: true,
      },
      { url: "https://cdn.freesound.org/previews/331/331589_5820980-hq.mp3", filename: "331589_5820980-hq.mp3", format: "mp3", role: "preview", channels: 1 },
      { url: "https://cdn.freesound.org/previews/331/331589_5820980-hq.ogg", filename: "331589_5820980-hq.ogg", format: "ogg", role: "preview", channels: 1 },
    ]);
    for (const f of d!.files) expect(f.headers).toBeUndefined();
  });

  it("getSample: a caller's OAuth token makes the original fetchable", async () => {
    const { ctx } = ctxWith(routes, { freesoundToken: "user-oauth" });
    const d = await freesound.getSample!("331589", ctx);
    const original = d!.files.find((f) => f.role === "original")!;
    expect(original.headers).toEqual({ authorization: "Bearer user-oauth" });
    expect(original.requiresAuth).toBeUndefined();
    expect(d!.files.filter((f) => f.role === "preview").every((f) => !f.headers)).toBe(true);

    vi.stubEnv("FREESOUND_OAUTH_TOKEN", "env-oauth");
    const e = await freesound.getSample!("331589", ctxWith().ctx);
    expect(e!.files[0]!.headers).toEqual({ authorization: "Bearer env-oauth" });
  });

  it("getSample returns null for bad or unknown ids", async () => {
    const { ctx, calls } = ctxWith([]);
    expect(await freesound.getSample!("abc", ctx)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await freesound.getSample!("1", ctx)).toBeNull();
  });

  it("finds similar sounds, without the sound itself", async () => {
    const { ctx, calls } = ctxWith();
    const s = await freesoundSimilar("331589", ctx, 2);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/apiv2/sounds/331589/similar/?fields=");
    expect(calls[0]!.url).toContain("page_size=3");
    expect(calls[0]!.headers.authorization).toBe("Token test-key");
    expect(s.map((x) => x.id)).toEqual(["freesound:41155", "freesound:147994"]);
    expect(await freesoundSimilar("nope", ctx)).toEqual([]);
  });

  it("counts the catalogue in five requests", async () => {
    const { ctx, calls } = ctxWith();
    const c = await freesound.census!(ctx);
    expect(calls).toHaveLength(5);
    expect(c).toMatchObject({
      total: 712408,
      free: 712408,
      addedLast30Days: 4120,
      byLicense: { "CC0-1.0": 310221, "CC-BY": 251043, "CC-BY-NC": 148870, "LicenseRef-Sampling-Plus-1.0": 2274 },
    });
    expect(c.highlights?.[0]).toMatchObject({ label: "Most downloaded", title: "Welcome to Freesound", value: 412000 });
  });
});
