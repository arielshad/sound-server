import * as cheerio from "cheerio";
import { parseCount } from "../core/census.js";
import { customLicense, license, parseLicense } from "../core/licence.js";
import type { License, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleQuery, SourceCensus } from "../core/types.js";
import { absoluteUrl, cleanText, filenameFromUrl, formatFromFilename, isKnownFormat, makeSample, uniq, wantsCategory } from "../core/util.js";
import { ARCHIVE_FORMATS, AUDIO_FORMATS } from "../core/vocab.js";

/**
 * OpenGameArt.org audio: community game sound effects and music, each entry under its own free
 * licence (CC0, CC-BY 3.0/4.0, CC-BY-SA 3.0/4.0, GPL 2.0/3.0, OGA-BY 3.0/4.0, often several).
 *
 * Search is the server-rendered Drupal view `/art-search-advanced` with `keys`,
 * `field_art_type_tid[]` (12 = Music, 13 = Sound Effect, checked against the site's own menu and
 * form), `field_art_licenses_tid[]`, `items_per_page` (24…144) and a 0-based `page`; the header says
 * "Displaying 1 - 24 of N". Cards carry the title, the waveform image and the preview
 * (`data-mp3-url` / `data-ogg-url`), but neither the licence nor the art type. Detail pages
 * (`/content/<slug>`) have the licences, tags, author and plain-GET files under
 * `/sites/default/files/`.
 *
 * robots.txt asks for `Crawl-delay: 10` (and disallows `/search/`, not this view), so a search is
 * exactly one request (the page size is chosen to cover offset+limit), results are cached, and
 * `getSample` is one request.
 */

const SITE = "https://opengameart.org";
const SOURCE_NAME = "OpenGameArt";
const SEARCH_CACHE_MS = 6 * 60 * 60_000;
const DETAIL_CACHE_MS = 24 * 60 * 60_000;
const PAGE_SIZES = [24, 48, 72, 96, 120, 144] as const;

/** Waits between census requests (the crawl delay). Tests set it to 0. */
export const opengameartTiming = { crawlDelayMs: 10_000 };

const ART_TYPES = {
  sfx: { tid: 13, label: "Sound Effect" },
  music: { tid: 12, label: "Music" },
} as const;

/** Licence taxonomy ids (from the search form) of the licences that allow commercial use without share-alike. */
const COMMERCIAL_LICENSE_TIDS = [4 /* CC0 */, 2 /* CC-BY 3.0 */, 17981 /* CC-BY 4.0 */, 10310 /* OGA-BY 3.0 */, 31772 /* OGA-BY 4.0 */];

/** Listing cards never say which licence an entry has. */
const PER_ITEM_LICENSE = customLicense("OpenGameArt per-item licence", {
  url: `${SITE}/content/faq`,
  verdict: "check-terms",
  note: "Every OpenGameArt entry has its own licence (CC0, CC-BY, CC-BY-SA, GPL or OGA-BY); open the sample to see which.",
  assertedBy: "source",
});

/** What a `commercialOnly` search returns: the site filtered to CC0 / CC-BY / OGA-BY. */
const COMMERCIAL_LICENSES = customLicense("CC0, CC-BY or OGA-BY (per item)", {
  url: `${SITE}/content/faq`,
  verdict: "yes-with-credit",
  commercialUse: true,
  attributionRequired: true,
  note: "Filtered at the source to CC0, CC-BY or OGA-BY entries: commercial use is allowed; credit the author unless the entry is CC0 (open the sample to see which).",
  assertedBy: "source",
});

/** OGA-BY: CC-BY without the anti-DRM clause. */
function ogaBy(version: string): License {
  return customLicense(`OGA-BY ${version}`, {
    url: `${SITE}/content/oga-by-30-faq`,
    verdict: "yes-with-credit",
    commercialUse: true,
    attributionRequired: true,
    note: "OpenGameArt's CC-BY variant without the anti-DRM clause: commercial use OK, credit the author.",
    assertedBy: "source",
  });
}

function gpl(name: string, url?: string): License {
  return customLicense(name, {
    url,
    verdict: "check-terms",
    commercialUse: true,
    attributionRequired: true,
    note: "Copyleft software licence applied to media: commercial use is allowed, but a work that includes it may have to be released under the GPL too. Read the terms or ask the author.",
    assertedBy: "source",
  });
}

/** One licence block from a detail page ("CC0", "CC-BY 3.0", "OGA-BY 3.0", "GPL 2.0"…). */
export function toLicense(name: string, href?: string): License {
  const n = name.trim();
  const oga = /^OGA-BY\s*(\d\.\d)/i.exec(n);
  if (oga) return ogaBy(oga[1]!);
  if (/^L?GPL/i.test(n)) return gpl(n, href);
  return (
    parseLicense(href) ??
    parseLicense(n.replace(/^CC-BY/i, "CC BY")) ??
    customLicense(n || "Unnamed licence", { url: href, assertedBy: "source" })
  );
}

const VERDICT_RANK: Record<License["verdict"], number> = { yes: 0, "yes-with-credit": 1, restricted: 2, "check-terms": 3, "clearance-required": 4, no: 5 };

/** When an author offers several licences, the user may pick the most permissive. */
export function bestLicense(licenses: License[]): License | undefined {
  return [...licenses].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])[0];
}

interface ArtTypeChoice {
  tids: number[];
  only?: keyof typeof ART_TYPES;
}

function artTypesFor(q: Pick<SampleQuery, "categories">): ArtTypeChoice {
  if (!q.categories?.length) return { tids: [ART_TYPES.sfx.tid, ART_TYPES.music.tid] };
  const sfx = wantsCategory(q, "fx", "foley", "ambience", "vocals", "drums");
  const music = wantsCategory(q, "other", "synth", "keys", "strings", "guitar", "brass", "woodwind", "mallets", "bass", "drums");
  if (sfx && music) return { tids: [ART_TYPES.sfx.tid, ART_TYPES.music.tid] };
  if (sfx) return { tids: [ART_TYPES.sfx.tid], only: "sfx" };
  if (music) return { tids: [ART_TYPES.music.tid], only: "music" };
  return { tids: [] };
}

/** The smallest page size whose one page covers [offset, offset+limit). */
export function pageFor(offset: number, limit: number): { size: number; page: number } {
  for (const size of PAGE_SIZES) {
    if (Math.floor(offset / size) === Math.floor((offset + Math.max(limit, 1) - 1) / size)) return { size, page: Math.floor(offset / size) };
  }
  const size = PAGE_SIZES[PAGE_SIZES.length - 1]!;
  return { size, page: Math.floor(offset / size) };
}

function listUrl(query: string, tids: number[], opts: { licenses?: number[]; size?: number; page?: number } = {}): string {
  const sp = new URLSearchParams();
  sp.set("keys", query.trim());
  for (const tid of tids) sp.append("field_art_type_tid[]", String(tid));
  for (const tid of opts.licenses ?? []) sp.append("field_art_licenses_tid[]", String(tid));
  if (opts.size && opts.size !== PAGE_SIZES[0]) sp.set("items_per_page", String(opts.size));
  if (opts.page) sp.set("page", String(opts.page));
  return `${SITE}/art-search-advanced?${sp.toString()}`;
}

interface Card {
  nativeId: string;
  title: string;
  url: string;
  previewUrl?: string;
  oggUrl?: string;
  thumbnailUrl?: string;
}

/** Listing: `.view-art .art-previews-inline` cards plus the "Displaying 1 - 24 of N" header. */
export function parseListing(html: string): { cards: Card[]; total?: number } {
  const $ = cheerio.load(html);
  const cards: Card[] = [];
  $(".view-art .art-previews-inline").each((_, el) => {
    const a = $(el).find(".art-preview-title a").first();
    const href = a.attr("href");
    const m = href ? /^\/content\/([^/?#]+)$/.exec(href) : null;
    if (!m) return;
    const play = $(el).find(".play-button").first();
    cards.push({
      nativeId: m[1]!,
      title: cleanText(a.text()),
      url: absoluteUrl(href, SITE)!,
      previewUrl: absoluteUrl(play.attr("data-mp3-url"), SITE),
      oggUrl: absoluteUrl(play.attr("data-ogg-url"), SITE),
      thumbnailUrl: absoluteUrl($(el).find("img").first().attr("src"), SITE),
    });
  });
  const header = cleanText($(".view-art .view-header").first().text());
  const total = cards.length === 0 && !header ? 0 : parseCount(header, /of\s+([\d,]+)/);
  return { cards, total };
}

function cardToSample(c: Card, choice: ArtTypeChoice, licence: License): Sample {
  const sample = makeSample({
    provider: "opengameart",
    nativeId: c.nativeId,
    title: c.title,
    url: c.url,
    tags: [],
    previewUrl: c.previewUrl ?? c.oggUrl,
    thumbnailUrl: c.thumbnailUrl,
    license: licence,
    price: { free: true },
    downloadable: true,
    sourceName: SOURCE_NAME,
  });
  return withArtTypeFallback(sample, choice.only);
}

/**
 * The art type only decides when the words say nothing: an unclassified Sound Effect is FX, and a
 * Music track is never FX. (Passing "Sound Effect" to the classifier would outweigh specific words
 * like "footsteps".)
 */
function withArtTypeFallback<T extends Sample>(sample: T, kind: keyof typeof ART_TYPES | undefined): T {
  if (kind === "sfx" && sample.category === "other") return { ...sample, category: "fx", categoryEvidence: { by: "source", confidence: 0.4 } };
  if (kind === "music" && sample.category.startsWith("fx")) return { ...sample, category: "other", categoryEvidence: { by: "source", confidence: 0.4 } };
  return sample;
}

function meta($: cheerio.CheerioAPI, name: string): string | undefined {
  return $(`meta[name="${name}"]`).attr("content") ?? $(`meta[property="${name}"]`).attr("content") ?? undefined;
}

const AUDIO = new Set<string>(AUDIO_FORMATS);
const ARCHIVES = new Set<string>(ARCHIVE_FORMATS);

/** Detail page: dcterms/og meta plus the `field-art-*` blocks (type, tags, licences, files). */
export function parseDetails(html: string, nativeId: string): SampleDetails | null {
  const $ = cheerio.load(html);
  const title = cleanText(meta($, "og:title") ?? meta($, "dcterms.title"));
  const artType = cleanText($(".field-name-field-art-type .field-item").first().text());
  // Other art types (sprites, models) and non-art nodes (forum topics, collections) are not ours.
  const kind = artType === ART_TYPES.music.label ? "music" : artType === ART_TYPES.sfx.label ? "sfx" : undefined;
  if (!title || !kind) return null;

  const licenses = $(".field-name-field-art-licenses .license-icon")
    .map((_, el) => toLicense(cleanText($(el).find(".license-name").text()), $(el).find("a").attr("href")))
    .get();
  const licence = bestLicense(licenses) ?? license("LicenseRef-Unknown");

  const files: SampleFile[] = [];
  $(".field-name-field-art-files a[href]").each((_, el) => {
    const url = absoluteUrl($(el).attr("href"), SITE);
    if (!url || !url.includes("/sites/default/files/")) return;
    const filename = filenameFromUrl(url);
    const format = formatFromFilename(filename);
    const length = /length=(\d+)/.exec($(el).attr("type") ?? "")?.[1];
    const role: SampleFile["role"] = ARCHIVES.has(format) ? "pack" : format === "mid" || format === "midi" ? "midi" : "original";
    files.push({ url, filename, format, role, sizeBytes: length ? Number(length) : undefined });
  });
  const play = $(".field-name-field-art-preview .play-button").first();
  const previewUrl = absoluteUrl(play.attr("data-mp3-url"), SITE) ?? absoluteUrl(play.attr("data-ogg-url"), SITE);
  if (previewUrl && !files.some((f) => f.url === previewUrl)) {
    const filename = filenameFromUrl(previewUrl);
    files.push({ url: previewUrl, filename, format: formatFromFilename(filename), role: "preview" });
  }

  const audioFiles = files.filter((f) => f.role === "original" && AUDIO.has(f.format));
  const isPack = files.some((f) => f.role === "pack") || audioFiles.length > 1;
  const tags = $(".field-name-field-art-tags a").map((_, el) => cleanText($(el).text())).get();
  const date = meta($, "article:published_time") ?? meta($, "dcterms.date");
  const description = cleanText($(".field-name-body .field-item").first().text()) || cleanText(meta($, "og:description")) || undefined;
  const author = cleanText($(".field-name-author-submitter .username a").first().text()) || cleanText(meta($, "dcterms.creator")) || undefined;
  const authorHref = $(".field-name-author-submitter .username a").first().attr("href");

  const sample = makeSample({
    provider: "opengameart",
    nativeId,
    title,
    description: description?.slice(0, 1000),
    url: `${SITE}/content/${nativeId}`,
    author,
    authorUrl: absoluteUrl(authorHref, SITE),
    tags,
    filename: audioFiles[0]?.filename,
    form: isPack ? "pack" : kind === "music" && !/\bloop/i.test([title, ...tags].join(" ")) ? "phrase" : undefined,
    unit: isPack ? "pack" : "sample",
    packSize: isPack && audioFiles.length > 1 ? audioFiles.length : undefined,
    previewUrl,
    thumbnailUrl: meta($, "og:image"),
    formats: uniq(files.filter((f) => f.role !== "preview" && isKnownFormat(f.format)).map((f) => f.format)),
    license: licence,
    price: { free: true },
    downloadable: files.some((f) => f.role !== "preview"),
    createdAt: date?.slice(0, 10),
    popularity: Number($(".field-name-favorites .field-item").first().text().replace(/\D/g, "")) || undefined,
    sourceName: SOURCE_NAME,
  });
  return { ...withArtTypeFallback(sample, kind), files };
}

export const opengameart: Provider = {
  id: "opengameart",
  name: SOURCE_NAME,
  homepage: SITE,
  description: "Community game audio: free sound effects, chiptune and game music, each entry with its own licence (mostly CC0, CC-BY and CC-BY-SA).",
  categories: ["fx", "foley", "ambience", "drums", "synth", "vocals", "other"],
  forms: ["one-shot", "loop", "phrase", "pack"],
  access: "scrape",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["categories", "commercialOnly"],

  buildSearchUrl(q: SampleQuery) {
    const choice = artTypesFor(q);
    const tids = choice.tids.length ? choice.tids : [ART_TYPES.sfx.tid, ART_TYPES.music.tid];
    return listUrl(q.query, tids, { licenses: q.commercialOnly ? COMMERCIAL_LICENSE_TIDS : undefined });
  },

  async search(q, ctx) {
    const choice = artTypesFor(q);
    const searchUrl = this.buildSearchUrl(q);
    if (!choice.tids.length) return { samples: [], searchUrl };
    const offset = q.offset ?? 0;
    const { size, page } = pageFor(offset, q.limit);
    const licenses = q.commercialOnly ? COMMERCIAL_LICENSE_TIDS : undefined;
    // Exactly one request per search (crawl delay 10 s).
    const html = await ctx.fetch.text(listUrl(q.query, choice.tids, { licenses, size, page }), { signal: ctx.signal, cacheTtlMs: SEARCH_CACHE_MS });
    const { cards, total } = parseListing(html);
    const licence = q.commercialOnly ? COMMERCIAL_LICENSES : PER_ITEM_LICENSE;
    const start = offset - page * size;
    const samples = cards.slice(start, start + q.limit).map((c) => cardToSample(c, choice, licence));
    return { samples, total, searchUrl };
  },

  async getSample(nativeId: string, ctx: ProviderContext): Promise<SampleDetails | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${SITE}/content/${nativeId}`, { signal: ctx.signal, cacheTtlMs: DETAIL_CACHE_MS });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parseDetails(html, nativeId);
  },

  async census(ctx): Promise<SourceCensus> {
    const count = async (tid: number, label: string) => {
      const total = parseListing(await ctx.fetch.text(listUrl("", [tid]), { signal: ctx.signal })).total;
      if (total === undefined) throw new Error(`no result count for ${label}`);
      return total;
    };
    const sfx = await count(ART_TYPES.sfx.tid, ART_TYPES.sfx.label);
    await delay(opengameartTiming.crawlDelayMs, ctx.signal);
    const music = await count(ART_TYPES.music.tid, ART_TYPES.music.label);
    return {
      total: sfx + music,
      free: sfx + music,
      byCategory: { fx: sfx, other: music },
      categories: { [ART_TYPES.sfx.label]: sfx, [ART_TYPES.music.label]: music },
      method: "Result counts of the Sound Effect and Music listings (\"Displaying 1 - 24 of N\"), 10 s apart",
    };
  },
};

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
