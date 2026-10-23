import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { MIN_INDEXABLE, MIN_SOURCES, isIndexable, searchKey as coreSearchKey, selectSamples, snapshotCollection, toSnapshotSample, type CollectionSearch, type CollectionSnapshot, type SnapshotSample } from "../src/core/collections.js";
import { setHostResolver, assertPublicHost } from "../src/core/download.js";
import { creativeCommons, license } from "../src/core/licence.js";
import type { SearchResponse } from "../src/core/service.js";
import type { Pricing, Sample } from "../src/core/types.js";
import { makeSample } from "../src/core/util.js";
import { allProviders } from "../src/providers/index.js";
// @ts-expect-error plain .mjs module without type declarations
import { CATEGORIES, readHubs, readSnapshot, readTopics, searchKey, topicErrors } from "../scripts/lib/topics.mjs";
// @ts-expect-error plain .mjs module without type declarations
import { checkPreview, isAudioType, previewChecker } from "../scripts/snapshot-collections.mjs";

const pricing = new Map<string, Pricing>([
  ["freesound", "free"],
  ["cymatics", "freemium"],
  ["primeloops", "freemium"],
]);

const sample = (provider: string, n: number, over: Partial<Sample> = {}): Sample =>
  makeSample({
    provider,
    nativeId: `${provider}-${n}`,
    title: `Punchy kick ${provider} ${n}`,
    category: "drums.kick",
    form: "one-shot",
    tags: [],
    url: `https://${provider}.example/${n}`,
    previewUrl: `https://cdn.${provider}.example/${n}.mp3`,
    license: license("CC0-1.0"),
    downloadable: true,
    ...over,
  });

const search: CollectionSearch = { q: "kick", categories: ["drums.kick"], free: true };

describe("toSnapshotSample", () => {
  it("keeps what a page shows, with the licence verdict and musical facts", () => {
    const s = toSnapshotSample(sample("freesound", 1, { bpm: 140, key: { tonic: "F", mode: "minor" }, durationSec: 0.4, thumbnailUrl: "https://cdn.freesound.example/1.png", description: "the source's copy" }))!;
    expect(s).toMatchObject({
      id: "freesound:freesound-1",
      category: "drums.kick",
      form: "one-shot",
      previewUrl: "https://cdn.freesound.example/1.mp3",
      thumbnailUrl: "https://cdn.freesound.example/1.png",
      license: { id: "CC0-1.0", verdict: "yes" },
      bpm: 140,
      key: "F minor",
      durationSec: 0.4,
    });
    expect(s).not.toHaveProperty("description");
  });

  it("drops samples a static page can't play", () => {
    expect(toSnapshotSample(sample("freesound", 1, { previewUrl: undefined }))).toBeUndefined();
    expect(toSnapshotSample(sample("freesound", 1, { previewUrl: "http://insecure.example/1.mp3" }))).toBeUndefined();
    expect(toSnapshotSample(sample("freesound", 1, { previewNeedsReferer: true }))).toBeUndefined();
  });
});

describe("selectSamples", () => {
  it("keeps relevant, free samples with a preview, once per id and title", () => {
    const picked = selectSamples(
      [
        sample("freesound", 1),
        sample("freesound", 1), // same id again
        sample("freesound", 2, { title: "Punchy kick freesound 1" }), // same title on the same source
        sample("freesound", 3, { title: "Rain on a tin roof", category: "ambience" }), // not about kicks
        sample("freesound", 4, { previewUrl: undefined }),
        sample("freesound", 5, { previewUrl: "http://insecure.example/5.mp3" }),
        sample("cymatics", 1, { price: { free: false } }),
        sample("cymatics", 2), // freemium source, price unknown: not provably free
        sample("cymatics", 3, { price: { free: true } }),
      ],
      { search, pricing },
    );
    expect(picked.map((a) => a.id)).toEqual(["freesound:freesound-1", "cymatics:cymatics-3"]);
  });

  it("counts the category as a word, and ignores near misses that only start like the query", () => {
    const subs = selectSamples([sample("freesound", 1, { title: "Long Sub F", category: "bass.808" }), sample("freesound", 2, { title: "Clean 808s" }), sample("freesound", 3, { title: "Deep Sub", category: "bass.sub" })], {
      search: { q: "808" },
      pricing,
    });
    expect(subs.map((a) => a.title)).toEqual(["Long Sub F", "Clean 808s"]);
    const hats = selectSamples([sample("freesound", 1, { title: "Hatch Door Slam", category: "foley" }), sample("freesound", 2, { title: "Closed Hat 03", category: "drums.hat.closed" })], { search: { q: "hat" }, pricing });
    expect(hats.map((a) => a.title)).toEqual(["Closed Hat 03"]);
  });

  it("keeps only commercial-safe licences when the search asks for them", () => {
    const picked = selectSamples(
      [sample("freesound", 1), sample("freesound", 2, { license: creativeCommons({ nc: true }) }), sample("freesound", 3, { license: creativeCommons({}) }), sample("freesound", 4, { license: undefined })],
      { search: { ...search, commercial: true }, pricing },
    );
    expect(picked.map((a) => a.license?.verdict)).toEqual(["yes", "yes-with-credit"]);
  });

  it("drops excluded title phrases and ids", () => {
    const picked = selectSamples([sample("freesound", 1, { title: "Kick Drum Pedal Squeak" }), sample("freesound", 2), sample("freesound", 3)], {
      search: { ...search, exclude: ["pedal squeak", "freesound:freesound-3"] },
      pricing,
    });
    expect(picked.map((a) => a.id)).toEqual(["freesound:freesound-2"]);
  });

  it("caps one source at 40% of the page", () => {
    const fresh = [...Array.from({ length: 30 }, (_, i) => sample("freesound", i)), ...Array.from({ length: 5 }, (_, i) => sample("cymatics", i, { price: { free: true } }))];
    const picked = selectSamples(fresh, { search, pricing, max: 20 });
    expect(picked.filter((a) => a.provider === "freesound")).toHaveLength(8);
    expect(picked.filter((a) => a.provider === "cymatics")).toHaveLength(5);
  });

  it("keeps previous samples in place, fills gaps with new ones and keeps a failed source's samples", () => {
    const prev = selectSamples([sample("freesound", 1), sample("cymatics", 1, { price: { free: true } }), sample("freesound", 2)], { search, pricing });
    // This run: cymatics failed, freesound 2 is gone, freesound 9 is new and ranks first.
    const next = selectSamples([sample("freesound", 9), sample("freesound", 1)], { search, pricing, previous: prev, failed: new Set(["cymatics"]) });
    expect(next.map((a) => a.id)).toEqual(["freesound:freesound-1", "cymatics:cymatics-1", "freesound:freesound-9"]);
  });
});

describe("isIndexable", () => {
  const as = (n: number, sources: number) => Array.from({ length: n }, (_, i) => ({ id: `${i}`, provider: `p${i % sources}` }) as SnapshotSample);
  it("needs enough samples from more than one source", () => {
    expect(isIndexable(as(MIN_INDEXABLE, MIN_SOURCES))).toBe(true);
    expect(isIndexable(as(MIN_INDEXABLE - 1, MIN_SOURCES))).toBe(false);
    expect(isIndexable(as(40, 1))).toBe(false);
  });
});

describe("snapshotCollection", () => {
  const response = (results: Sample[], failed: string[] = []): SearchResponse => ({
    query: "kick",
    filters: {},
    results,
    providers: failed.map((provider) => ({ provider, name: provider, status: "error" as const, count: 0, tookMs: 1 })),
  });
  const fresh = Array.from({ length: 3 }, (_, i) => sample("freesound", i));

  it("asks the service for the topic's filters", async () => {
    let asked: unknown;
    await snapshotCollection(async (req) => ((asked = req), response([])), "s", { q: "kick", categories: ["drums.kick"], forms: ["one-shot"], free: true, commercial: true, downloadable: true, providers: ["freesound"] }, { pricing });
    expect(asked).toMatchObject({ query: "kick", categories: ["drums.kick"], forms: ["one-shot"], freeOnly: true, commercialOnly: true, downloadableOnly: true, providers: ["freesound"], limit: 100 });
  });

  it("moves updatedAt only when the list changes", async () => {
    const first = await snapshotCollection(async () => response(fresh), "free-kick-samples", search, { pricing, now: new Date("2026-10-01T00:00:00Z") });
    expect(first.changed).toBe(true);
    const again = await snapshotCollection(async () => response(fresh), "free-kick-samples", search, { pricing, previous: first.snapshot, now: new Date("2026-10-02T00:00:00Z") });
    expect(again.changed).toBe(false);
    expect(again.snapshot.updatedAt).toBe("2026-10-01T00:00:00.000Z");
    const more = await snapshotCollection(async () => response([...fresh, sample("freesound", 7)]), "free-kick-samples", search, { pricing, previous: again.snapshot, now: new Date("2026-10-03T00:00:00Z") });
    expect(more).toMatchObject({ changed: true, added: 1, kept: 3, dropped: 0 });
    expect(more.snapshot.updatedAt).toBe("2026-10-03T00:00:00.000Z");
  });

  it("skips samples whose preview is gone and lets the next one take the slot", async () => {
    const results = Array.from({ length: 4 }, (_, i) => sample(i % 2 ? "freesound" : "cymatics", i, { price: { free: true } }));
    const checked: string[] = [];
    const r = await snapshotCollection(async () => response(results), "s", search, {
      pricing,
      checkMedia: async (url) => {
        checked.push(url);
        return !url.includes("/1.mp3");
      },
    });
    expect(r.snapshot.samples.map((a) => a.id)).toEqual(["cymatics:cymatics-0", "cymatics:cymatics-2", "freesound:freesound-3"]);
    expect(r.brokenMedia).toBe(1);
    expect(new Set(checked).size).toBe(checked.length); // each preview checked once
    expect(r.snapshot.search).toEqual(search); // broken ids are not saved into the search
  });

  it("starts over when the search itself changes", async () => {
    const previous: CollectionSnapshot = { slug: "s", search: { q: "snare" }, updatedAt: "2026-01-01T00:00:00.000Z", samples: [{ id: "freesound:old" } as SnapshotSample] };
    const r = await snapshotCollection(async () => response(fresh, ["freesound"]), "s", search, { pricing, previous });
    expect(r.snapshot.samples.map((a) => a.id)).not.toContain("freesound:old");
  });
});

describe("preview check (scripts/snapshot-collections.mjs)", () => {
  setHostResolver(async (host) => (host === "evil.example" ? ["10.0.0.5"] : ["93.184.216.34"]));
  type Reply = { status?: number; type?: string; location?: string };
  const fakeFetch = (routes: Record<string, Reply | ((method: string) => Reply)>) => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      const route = routes[url];
      const r = typeof route === "function" ? route(String(init.method)) : route;
      if (!r) throw new Error("network down");
      const headers: Record<string, string> = {};
      if (r.type) headers["content-type"] = r.type;
      if (r.location) headers.location = r.location;
      return new Response(null, { status: r.status ?? 200, headers });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };
  const check = (url: string, f: ReturnType<typeof fakeFetch>) => checkPreview(url, { assertHost: assertPublicHost, fetch: f.fetchImpl, timeoutMs: 1000 }) as Promise<boolean>;

  it("accepts audio and the generic binary types, refuses pages", () => {
    for (const t of ["audio/mpeg", "audio/ogg; codecs=vorbis", "application/ogg", "application/octet-stream"]) expect(isAudioType(t), t).toBe(true);
    for (const t of ["text/html; charset=utf-8", "image/png", "application/json"]) expect(isAudioType(t), t).toBe(false);
  });

  it("treats only definite answers as broken", async () => {
    const f = fakeFetch({
      "https://cdn.example/ok.mp3": { type: "audio/mpeg" },
      "https://cdn.example/gone.mp3": { status: 404 },
      "https://cdn.example/soft404.mp3": { type: "text/html" },
      "https://cdn.example/busy.mp3": { status: 503, type: "text/html" },
    });
    expect(await check("https://cdn.example/ok.mp3", f)).toBe(true);
    expect(await check("https://cdn.example/gone.mp3", f)).toBe(false);
    expect(await check("https://cdn.example/soft404.mp3", f)).toBe(false);
    expect(await check("https://cdn.example/busy.mp3", f)).toBe(true); // flaky CDN: keep
    expect(await check("https://cdn.example/offline.mp3", f)).toBe(true); // network error: keep
  });

  it("falls back to a ranged GET when HEAD is refused", async () => {
    const f = fakeFetch({ "https://cdn.example/a.ogg": (m) => (m === "HEAD" ? { status: 405 } : { status: 206, type: "audio/ogg" }) });
    expect(await check("https://cdn.example/a.ogg", f)).toBe(true);
    expect(f.calls).toEqual(["HEAD https://cdn.example/a.ogg", "GET https://cdn.example/a.ogg"]);
  });

  it("follows redirects by hand and refuses internal hosts on any hop", async () => {
    const f = fakeFetch({
      "https://cdn.example/r.mp3": { status: 302, location: "https://media.example/r.mp3" },
      "https://media.example/r.mp3": { type: "audio/mpeg" },
      "https://cdn.example/bad.mp3": { status: 302, location: "http://169.254.169.254/latest" },
      "https://evil.example/x.mp3": { type: "audio/mpeg" },
    });
    expect(await check("https://cdn.example/r.mp3", f)).toBe(true);
    expect(await check("https://cdn.example/bad.mp3", f)).toBe(false);
    expect(await check("https://evil.example/x.mp3", f)).toBe(false); // resolves to a private address
    expect(f.calls).not.toContain("HEAD http://169.254.169.254/latest");
    expect(f.calls.some((c) => c.includes("evil.example"))).toBe(false);
  });

  it("checks each URL once", async () => {
    const f = fakeFetch({ "https://cdn.example/ok.mp3": { type: "audio/mpeg" } });
    const checker = previewChecker({ assertHost: assertPublicHost, fetch: f.fetchImpl, timeoutMs: 1000 }, 2) as (u: string) => Promise<boolean>;
    await Promise.all([checker("https://cdn.example/ok.mp3"), checker("https://cdn.example/ok.mp3")]);
    expect(f.calls).toHaveLength(1);
  });
});

describe("collection topics", () => {
  const topics = readTopics() as { slug: string; data: { search: CollectionSearch; hub: string } }[];
  const hubs = readHubs() as { id: string; title: string; description: string; intro: string; categories?: string[]; forms?: string[] }[];
  const ctx = { hubs: hubs.map((h) => h.id), slugs: topics.map((t) => t.slug), providers: allProviders.map((p) => p.id) };

  it("has hubs with copy and a valid category or form scope", () => {
    expect(hubs.length).toBeGreaterThanOrEqual(5);
    for (const h of hubs) {
      expect(h.id, h.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(h.title.length, h.id).toBeLessThanOrEqual(60);
      expect(h.description.length, h.id).toBeGreaterThanOrEqual(110);
      expect(h.description.length, h.id).toBeLessThanOrEqual(160);
      expect(h.intro.length, h.id).toBeGreaterThan(200);
      expect(h.categories?.length || h.forms?.length, h.id).toBeTruthy();
      for (const c of h.categories ?? []) expect(CATEGORIES, h.id).toContain(c);
    }
  });

  // Topic pages are added by people and by the weekly drafting workflow; the
  // repository may start with none.
  it.each(topics.map((t) => [t.slug, t]))("%s meets the editorial rules", (_, t) => {
    expect(topicErrors(t, ctx)).toEqual([]);
  });

  it("gives every topic its own search, with the same identity the server uses", () => {
    const keys = topics.map((t) => searchKey(t.data.search));
    expect(new Set(keys).size).toBe(keys.length);
    const s: CollectionSearch = { q: " Punchy  Kick ", categories: ["drums.kick", "drums"], forms: ["one-shot"], free: true, commercial: true, downloadable: true, providers: ["b", "a"] };
    expect(searchKey(s)).toBe(coreSearchKey(s));
  });

  // Only that a snapshot exists: how many samples it holds depends on the live
  // sources (a thin page is noindexed by the site), and the daily refresh must
  // never fail CI. New topics are held to the indexable minimum by the gate.
  it.each(topics.map((t) => [t.slug]))("%s has a snapshot", (slug) => {
    const snap = readSnapshot(slug) as CollectionSnapshot | undefined;
    expect(snap, `run: node scripts/snapshot-collections.mjs ${slug}`).toBeDefined();
    expect(snap!.slug).toBe(slug);
    for (const a of snap!.samples) {
      expect(a.previewUrl).toMatch(/^https:\/\//);
      expect(a.license?.verdict ?? "check-terms").toBeTruthy();
    }
  });

  it("has no snapshot without a topic", () => {
    const dir = new URL("../web/src/data/collections/", import.meta.url);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) expect(ctx.slugs, f).toContain(f.replace(/\.json$/, ""));
  });

  it("keeps the website's thresholds in step with the snapshot's", () => {
    for (const file of ["../web/src/lib/collections.ts", "../web/integrations/sitemap-meta.mjs"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).toContain(`MIN_INDEXABLE = ${MIN_INDEXABLE};`);
      expect(src, file).toContain(`MIN_SOURCES = ${MIN_SOURCES};`);
    }
  });
});
