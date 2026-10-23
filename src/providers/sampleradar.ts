import * as cheerio from "cheerio";
import { catalogueCensus } from "../core/census.js";
import { classify } from "../core/classify.js";
import { royaltyFree } from "../core/licence.js";
import type { Category, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleQuery } from "../core/types.js";
import { cleanText, filenameFromUrl, filterLocal, makeSample, paginate, qs } from "../core/util.js";

/**
 * MusicRadar SampleRadar (https://www.musicradar.com): ~270 free sample packs (loops, hits and
 * multis by genre) that first came with Computer Music and Future Music magazines.
 *
 * One hub article lists every pack as "<N> free <name> samples" links; it is fetched once and
 * cached 12h, then searched locally (one request per search at most). Each pack article links a
 * direct zip on cdn.mos.musicradar.com (plain GET, no login), so getSample fetches the article
 * lazily to find the zip, an optional HEAD for its size, and any inline <audio> demo mp3s.
 * robots.txt allows these pages (it only blocks search-term URLs).
 */

const SITE = "https://www.musicradar.com";
export const SAMPLERADAR_INDEX_URL = `${SITE}/news/tech/free-music-samples-royalty-free-loops-hits-and-multis-to-download-sampleradar`;
const INDEX_TTL = 12 * 60 * 60_000;
const ARTICLE_TTL = 24 * 60 * 60_000;
const MAX_ZIPS = 4;

export const SAMPLERADAR_LICENSE = royaltyFree("MusicRadar SampleRadar licence", {
  url: SAMPLERADAR_INDEX_URL,
  note: "Royalty-free: use the samples in your music any way you like, but don't redistribute them (MusicRadar's own terms on the SampleRadar hub and each pack page).",
});

/** "1,338 free female vocal samples", "493 creative kick drum samples". */
const PACK_LINK = /^\s*([\d,]+)\s+(?:free\s+)?(.+?)\s+samples?\s*$/i;

interface IndexEntry {
  nativeId: string;
  url: string;
  /** Link text as published: "213 free wooden percussion samples". */
  text: string;
  name: string;
  count: number;
}

/** Pack article URL → native id (its path), or undefined for anything else. */
export function nativeIdFromUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;
  let u: URL;
  try {
    u = new URL(href, SITE);
  } catch {
    return undefined;
  }
  if (!/(^|\.)musicradar\.com$/.test(u.hostname)) return undefined;
  const path = u.pathname.replace(/^\/+|\/+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/i.test(path)) return undefined;
  if (/^(author|tag|how-to|tutorials|reviews)\//.test(path)) return undefined;
  return path;
}

/** Every pack link in the hub article body (A–Z index and latest updates), deduped. */
export function parseIndex(html: string): IndexEntry[] {
  const $ = cheerio.load(html);
  const out: IndexEntry[] = [];
  const seenId = new Set<string>();
  const seenName = new Set<string>();
  $("#article-body a[href]").each((_, a) => {
    const text = cleanText($(a).text());
    const m = PACK_LINK.exec(text);
    if (!m) return;
    const nativeId = nativeIdFromUrl($(a).attr("href"));
    if (!nativeId) return;
    const name = cleanText(m[2]!);
    const key = name.toLowerCase();
    if (seenId.has(nativeId) || seenName.has(key)) return;
    seenId.add(nativeId);
    seenName.add(key);
    out.push({ nativeId, url: `${SITE}/${nativeId}`, text, name, count: Number(m[1]!.replace(/,/g, "")) });
  });
  return out;
}

/** Drum'n'bass and friends name a genre, not the drums. */
const DNB = /\bdrum\s*(?:'n'|n|'n|and|&)\s*bass\b|\bdrum'?n'?bass\b|\bdnb\b/gi;
const VOCAL_WORDS = /\b(vocals?|vox|voices?|acapellas?|a cappella|choirs?|ad-libs?|singers?|spoken|rap)\b/i;
const DRUM_WORDS = /\b(drums?|drumkits?|beats?|percussion|kicks?|snares?|hats?|hi-hats?|breaks?|breakbeats?|grooves?|toms?|cymbals?|claps?)\b/i;

const GENRES: [RegExp, string][] = [
  [DNB, "drum and bass"], [/\bhip[- ]?hop\b/i, "hip hop"], [/\btrap\b/i, "trap"], [/\bhouse\b/i, "house"], [/\btechno\b/i, "techno"],
  [/\btrance\b/i, "trance"], [/\bdubstep\b/i, "dubstep"], [/\bgrime\b/i, "grime"], [/\bjungle\b/i, "jungle"], [/\bgarage\b/i, "garage"],
  [/\bdisco\b/i, "disco"], [/\bfunk(y)?\b/i, "funk"], [/\bsoul\b/i, "soul"], [/\bjazz\b/i, "jazz"], [/\brock\b/i, "rock"],
  [/\bmetal\b/i, "metal"], [/\bpunk\b/i, "punk"], [/\bambient\b/i, "ambient"], [/\bcinematic\b/i, "cinematic"], [/\blo-?fi\b/i, "lo-fi"],
  [/\breggae\b/i, "reggae"], [/\bdub\b/i, "dub"], [/\bdancehall\b/i, "dancehall"], [/\bafrobeat\b/i, "afrobeat"], [/\belectro\b/i, "electro"],
  [/\bsynthwave\b/i, "synthwave"], [/\bchillout\b/i, "chillout"], [/\bidm\b/i, "idm"], [/\brave\b/i, "rave"], [/\bpop\b/i, "pop"],
  [/\bedm\b/i, "edm"], [/\bacid\b/i, "acid"], [/\bbreakbeat\b/i, "breakbeat"], [/\bdowntempo\b/i, "downtempo"], [/\bhardcore\b/i, "hardcore"],
];

export function packGenres(name: string): string[] | undefined {
  const g = GENRES.filter(([re]) => {
    re.lastIndex = 0;
    return re.test(name);
  }).map(([, g]) => g);
  return g.length ? g : undefined;
}

/**
 * Category of a pack from its name: vocal and drum words win over the word rules' finer guesses
 * ("808 drum samples" is drums, not 808 bass), and drum'n'bass is a genre, not drums.
 */
export function packCategory(name: string): { category: Category; confidence: number } {
  const words = name.replace(DNB, " ");
  const c = classify({ title: words, sourceCategories: [words] });
  if (VOCAL_WORDS.test(words)) return c.category.startsWith("vocals") ? c : { category: "vocals", confidence: 0.8 };
  if (DRUM_WORDS.test(words)) return c.category.startsWith("drums") ? c : { category: "drums", confidence: 0.8 };
  return c;
}

function toSample(e: { nativeId: string; url: string; name: string; count?: number; title: string }, extra: Partial<Sample> = {}): Sample {
  const { category, confidence } = packCategory(e.name);
  return makeSample({
    provider: "sampleradar",
    nativeId: e.nativeId,
    title: e.title,
    url: e.url,
    author: "MusicRadar",
    authorUrl: SITE,
    tags: ["sampleradar", "musicradar", "computer music", "pack", "wav"],
    genres: packGenres(e.name),
    category,
    categoryEvidence: { by: "rules", confidence },
    form: "pack",
    unit: "pack",
    packSize: e.count,
    formats: ["zip", "wav"],
    license: SAMPLERADAR_LICENSE,
    price: { free: true },
    downloadable: true,
    sourceName: "MusicRadar SampleRadar",
    ...extra,
  });
}

const memo = { body: "", samples: [] as Sample[] };

async function loadIndex(ctx: ProviderContext): Promise<Sample[]> {
  const body = await ctx.fetch.text(SAMPLERADAR_INDEX_URL, { cacheTtlMs: INDEX_TTL, signal: ctx.signal });
  if (memo.body === body) return memo.samples;
  const entries = parseIndex(body);
  if (!entries.length) throw new Error("SampleRadar hub article: no pack links found (page layout changed?)");
  memo.body = body;
  memo.samples = entries.map((e) => toSample({ ...e, title: `SampleRadar: ${e.text}` }));
  return memo.samples;
}

/** Parse a pack article: title, zips, demo mp3s, artwork and date. */
export function parseArticle(html: string, nativeId: string): { sample: Sample; zips: string[] } | null {
  const $ = cheerio.load(html);
  const ogTitle = cleanText($("meta[property='og:title']").attr("content"));
  const title = ogTitle || cleanText($("title").text()).replace(/\s*\|\s*MusicRadar\s*$/i, "");
  if (!title) return null;
  const body = $("#article-body").length ? $("#article-body") : $("body");
  const zips = [
    ...new Set(
      body
        .find("a[href]")
        .map((_, a) => $(a).attr("href") ?? "")
        .get()
        .filter((h) => /^https?:\/\/cdn\.mos\.musicradar\.com\/.+\.zip$/i.test(h))
        .map((h) => h.replace(/^http:/, "https:")),
    ),
  ].slice(0, MAX_ZIPS);
  const previews = body
    .find("audio[src], audio source[src]")
    .map((_, el) => $(el).attr("src") ?? "")
    .get()
    .filter((s) => /^https?:\/\/cdn\.mos\.musicradar\.com\/.+\.mp3$/i.test(s))
    .map((s) => s.replace(/^http:/, "https:"));
  const count = /\b([\d,]+)\s+(?:free\s+)?/.exec(title.replace(/^SampleRadar:\s*/i, ""))?.[1];
  const name = title.replace(/^SampleRadar:\s*/i, "").replace(PACK_LINK, "$2");
  const published = $("meta[property='article:published_time']").attr("content");
  const sample = toSample(
    { nativeId, url: `${SITE}/${nativeId}`, name, title, count: count ? Number(count.replace(/,/g, "")) : undefined },
    {
      description: cleanText($("meta[property='og:description']").attr("content")) || undefined,
      thumbnailUrl: $("meta[property='og:image']").attr("content") || undefined,
      previewUrl: previews[0],
      createdAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : undefined,
      downloadable: zips.length > 0,
    },
  );
  return { sample, zips };
}

async function sizeOf(url: string, ctx: ProviderContext): Promise<number | undefined> {
  try {
    const res = await ctx.fetch.raw(url, { method: "HEAD", signal: ctx.signal });
    await res.body?.cancel().catch(() => undefined);
    const n = Number(res.headers.get("content-length"));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    return undefined;
  }
}

export const sampleradar: Provider = {
  id: "sampleradar",
  name: "MusicRadar SampleRadar",
  homepage: SAMPLERADAR_INDEX_URL,
  description: "Around 270 free, royalty-free genre sample packs (loops, hits and multis) from MusicRadar and Computer Music, each a direct zip download.",
  categories: ["drums", "bass", "synth", "keys", "guitar", "vocals", "fx", "ambience", "strings", "brass", "other"],
  forms: ["pack"],
  access: "static",
  pricing: "free",
  license: SAMPLERADAR_LICENSE,
  supportsDownload: true,
  nativeFilters: ["categories", "forms"],

  census(ctx) {
    return catalogueCensus(this, ctx, "packs");
  },

  buildSearchUrl(q: SampleQuery) {
    // A link for people to click (robots.txt keeps crawlers off `searchTerm=`; we never fetch it).
    const terms = q.query.trim();
    return terms ? `${SITE}/search${qs({ searchTerm: `sampleradar ${terms}` })}` : SAMPLERADAR_INDEX_URL;
  },

  async search(q, ctx) {
    const samples = filterLocal(await loadIndex(ctx), q);
    return { samples: paginate(samples, q), total: samples.length, searchUrl: this.buildSearchUrl(q) };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    if (!nativeIdFromUrl(`${SITE}/${nativeId}`)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${SITE}/${nativeId}`, { cacheTtlMs: ARTICLE_TTL, signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    const parsed = parseArticle(html, nativeId);
    if (!parsed) return null;
    const files: SampleFile[] = await Promise.all(
      parsed.zips.map(async (url): Promise<SampleFile> => {
        const sizeBytes = await sizeOf(url, ctx);
        return { url, filename: filenameFromUrl(url), format: "zip", role: "pack", ...(sizeBytes ? { sizeBytes } : {}) };
      }),
    );
    if (parsed.sample.previewUrl) {
      files.push({ url: parsed.sample.previewUrl, filename: filenameFromUrl(parsed.sample.previewUrl), format: "mp3", role: "preview" });
    }
    return { ...parsed.sample, files };
  },
};
