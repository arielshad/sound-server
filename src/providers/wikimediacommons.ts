import { customLicense, parseLicense } from "../core/licence.js";
import type { License, Provider, Sample, SampleDetails, SampleFile, SampleQuery } from "../core/types.js";
import { cleanText, formatFromFilename, makeSample, qs } from "../core/util.js";

/**
 * Wikimedia Commons: Wikipedia's media archive holds ~4.4M audio files (instrument demos,
 * drum hits, field recordings, music, and a lot of pronunciations). Found with the public
 * MediaWiki API in one request:
 * `action=query&generator=search&gsrnamespace=6&gsrsearch=<q> filetype:audio -filemime:audio/midi …`
 * with `prop=imageinfo|videoinfo`: `imageinfo` gives the file, its duration and licence
 * (`extmetadata`), `videoinfo` lists the server transcodes (mp3/ogg) used as previews.
 *
 * nativeId is the file title without "File:" and with underscores for spaces, as in Commons
 * URLs ("Bass_drum.ogg"); Openverse emits `sameAs: wikimediacommons:<that id>` to de-duplicate.
 * getSample also accepts the spaced form and asks the API for "File:Bass drum.ogg".
 *
 * Rate limits: anonymous traffic gets HTTP 429 quickly (a few requests per minute from a shared
 * IP). The shared client retries once; keep it to one request per search and cache.
 */

const SITE = "https://commons.wikimedia.org";
const API = `${SITE}/w/api.php`;
const MAX_PAGE_SIZE = 50;
const METADATA = "ObjectName|ImageDescription|Artist|LicenseShortName|LicenseUrl|AttributionRequired|DateTime|Categories";
const SOURCE_NAME = "Wikimedia Commons";
/** Keep pronunciations (Lingua Libre and friends) and MIDI out at the source. */
const SEARCH_SUFFIX = 'filetype:audio -filemime:audio/midi -pronunciation -"Lingua Libre"';

interface Meta {
  value?: string;
}

interface Derivative {
  src?: string;
  type?: string;
  transcodekey?: string;
}

interface CommonsPage {
  title: string;
  index?: number;
  missing?: boolean;
  imageinfo?: {
    size?: number;
    duration?: number;
    url?: string;
    descriptionurl?: string;
    mime?: string;
    mediatype?: string;
    extmetadata?: Record<string, Meta | undefined>;
  }[];
  videoinfo?: { derivatives?: Derivative[] }[];
}

interface CommonsQuery {
  query?: { pages?: CommonsPage[]; searchinfo?: { totalhits?: number } };
}

/** Wikimedia metadata values can hold HTML; keep the text. */
function plain(html: string | undefined): string {
  return cleanText(
    (html ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

/** "File:Bass_drum.ogg" / "Bass_drum.ogg" → "Bass drum.ogg" (MediaWiki's canonical title, for API calls). */
export function commonsTitle(title: string): string {
  return title.replace(/^File:/i, "").replace(/_/g, " ").trim();
}

/** "File:Bass drum.ogg" → "Bass_drum.ogg": the nativeId (and Openverse's sameAs form). */
export function commonsNativeId(title: string): string {
  return commonsTitle(title).replace(/ /g, "_");
}

/** Licence, maintenance and upload-bookkeeping categories say nothing about the sound. */
const NOISE_CATEGORY =
  /^(gfdl|cc[- ]|pd[- ]|public domain|self-published|license migration|files with|files by|files from|media (needing|with|missing)|uploaded|music files uploaded|pages with|attribution|all media)|license|licence/i;

function sourceCategoriesOf(meta: Record<string, Meta | undefined>): string[] {
  return (meta.Categories?.value ?? "")
    .split("|")
    .map(cleanText)
    .filter((c) => c && !NOISE_CATEGORY.test(c));
}

/** Artist is HTML; "No machine-readable author provided. <a>User</a> assumed (…)" → "User". */
function authorOf(html: string): string | undefined {
  const text = plain(html);
  if (/^no machine-readable author/i.test(text)) {
    const link = /<a [^>]*>([^<]+)<\/a>/.exec(html)?.[1];
    return link ? plain(link).replace(/~commonswiki$/, "") : undefined;
  }
  return text.slice(0, 120) || undefined;
}

function licenseOf(meta: Record<string, Meta | undefined>): License {
  const name = plain(meta.LicenseShortName?.value);
  const url = meta.LicenseUrl?.value || undefined;
  const parsed = parseLicense(name) ?? parseLicense(url);
  if (parsed) return parsed;
  if (name) {
    return customLicense(name, {
      url,
      assertedBy: "source",
      attributionRequired: meta.AttributionRequired?.value === "true" || undefined,
    });
  }
  return customLicense("No licence stated", { assertedBy: "source", note: "Commons lists no licence for this file; check its page." });
}

function isMidi(p: CommonsPage): boolean {
  const mime = p.imageinfo?.[0]?.mime ?? "";
  return /midi/i.test(mime) || /\.midi?$/i.test(p.title);
}

/** Pronunciation recordings that slip through the search filter. */
function isPronunciation(p: CommonsPage, description: string): boolean {
  const t = commonsTitle(p.title);
  return /^LL-Q\d+/.test(t) || (/^[A-Z][a-z]{1,2}(-[a-z]{2,4})?-/.test(t) && /pronunciation/i.test(description));
}

/** Strip the analytics query Commons now appends to upload URLs. */
function cleanUrl(u: string): string {
  return u.replace(/\?utm_[^#]*$/, "");
}

function transcodes(p: CommonsPage): SampleFile[] {
  const out: SampleFile[] = [];
  for (const d of p.videoinfo?.[0]?.derivatives ?? []) {
    if (!d.src || !d.transcodekey) continue;
    const format = d.transcodekey.startsWith("mp3") ? "mp3" : d.transcodekey.startsWith("ogg") ? "ogg" : formatFromFilename(d.src);
    if (format !== "mp3" && format !== "ogg") continue;
    out.push({ url: cleanUrl(d.src), filename: decodeURIComponent(d.src.split("/").pop() ?? `preview.${format}`), format, role: "preview" });
  }
  return out;
}

function toSample(p: CommonsPage): Sample | undefined {
  const info = p.imageinfo?.[0];
  if (!info?.url || isMidi(p)) return undefined;
  if (info.mediatype && info.mediatype !== "AUDIO") return undefined;
  const meta = info.extmetadata ?? {};
  const title = commonsTitle(p.title);
  const description = plain(meta.ImageDescription?.value);
  if (isPronunciation(p, description)) return undefined;
  const format = formatFromFilename(title);
  const previews = transcodes(p);
  const mp3 = previews.find((f) => f.format === "mp3")?.url;
  const ogg = previews.find((f) => f.format === "ogg")?.url;
  const original = cleanUrl(info.url);
  const previewUrl = format === "mp3" ? original : mp3 ?? (format === "ogg" || format === "oga" ? original : ogg ?? original);
  const artistHtml = meta.Artist?.value ?? "";
  const userHref = /href="([^"]*\/wiki\/User:[^"]+)"/.exec(artistHtml)?.[1];
  const date = meta.DateTime?.value;
  const created = date && /^\d{4}-\d{2}-\d{2}/.test(date) ? new Date(`${date.slice(0, 19).replace(" ", "T")}Z`) : undefined;
  const cats = sourceCategoriesOf(meta);
  return makeSample({
    provider: "wikimediacommons",
    nativeId: commonsNativeId(title),
    title: plain(meta.ObjectName?.value) || title.replace(/\.[^.]+$/, ""),
    description: description ? description.slice(0, 300) : undefined,
    url: info.descriptionurl || `${SITE}/wiki/${encodeURIComponent(`File:${title.replace(/ /g, "_")}`)}`,
    author: authorOf(artistHtml),
    authorUrl: userHref ? new URL(userHref, SITE).toString() : undefined,
    tags: cats.slice(0, 8),
    sourceCategories: cats,
    durationSec: typeof info.duration === "number" && info.duration > 0 ? info.duration : undefined,
    previewUrl,
    formats: [...new Set([format === "oga" ? "ogg" : format, ...previews.map((f) => f.format)].filter(Boolean))],
    license: licenseOf(meta),
    price: { free: true },
    downloadable: true,
    createdAt: created && !Number.isNaN(created.getTime()) ? created.toISOString() : undefined,
    filename: title,
    sourceName: SOURCE_NAME,
  });
}

const FILE_PARAMS = {
  prop: "imageinfo|videoinfo",
  iiprop: "url|size|mime|extmetadata|mediatype",
  iiextmetadatafilter: METADATA,
  viprop: "derivatives",
};

function searchText(q: SampleQuery): string {
  return `${q.query.trim()} ${SEARCH_SUFFIX}`.trim();
}

export const wikimediacommons: Provider = {
  id: "wikimediacommons",
  name: "Wikimedia Commons",
  homepage: SITE,
  description:
    "Free audio from Wikipedia's media archive: instrument demos, drum hits, field recordings and public-domain music; each file has its own CC0, public-domain or CC BY(-SA) licence.",
  categories: ["drums", "fx", "foley", "ambience", "vocals", "keys", "guitar", "strings", "brass", "woodwind", "mallets", "synth"],
  access: "api",
  pricing: "free",
  supportsDownload: true,

  buildSearchUrl(q) {
    return `${SITE}/w/index.php${qs({ search: q.query.trim() || undefined, title: "Special:MediaSearch", type: "audio" })}`;
  },

  async search(q, ctx) {
    const limit = Math.max(1, Math.min(q.limit, MAX_PAGE_SIZE));
    const res = await ctx.fetch.json<CommonsQuery>(
      `${API}${qs({
        action: "query",
        format: "json",
        formatversion: 2,
        maxlag: 5,
        generator: "search",
        gsrnamespace: 6,
        gsrlimit: limit,
        gsroffset: q.offset || undefined,
        gsrsearch: searchText(q),
        ...FILE_PARAMS,
      })}`,
      { cacheTtlMs: 30 * 60_000, signal: ctx.signal },
    );
    const pages = [...(res.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const samples = pages.map(toSample).filter((s): s is Sample => !!s);
    return { samples, searchUrl: this.buildSearchUrl(q) };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    const title = commonsTitle(nativeId);
    if (!title || /\.midi?$/i.test(title) || !/\.[a-z0-9]{2,5}$/i.test(title)) return null;
    const res = await ctx.fetch.json<CommonsQuery>(
      `${API}${qs({ action: "query", format: "json", formatversion: 2, maxlag: 5, titles: `File:${title}`, ...FILE_PARAMS })}`,
      { cacheTtlMs: 60 * 60_000, signal: ctx.signal },
    );
    const page = res.query?.pages?.[0];
    if (!page || page.missing) return null;
    const sample = toSample(page);
    const info = page.imageinfo?.[0];
    if (!sample || !info?.url) return null;
    const files: SampleFile[] = [
      {
        url: cleanUrl(info.url),
        filename: sample.nativeId,
        format: formatFromFilename(sample.nativeId),
        role: "original",
        sizeBytes: info.size,
      },
      ...transcodes(page),
    ];
    return { ...sample, files };
  },

  async census(ctx) {
    const res = await ctx.fetch.json<CommonsQuery>(
      `${API}${qs({
        action: "query",
        format: "json",
        formatversion: 2,
        maxlag: 5,
        list: "search",
        // Same exclusions as search (no MIDI, pronunciations or Lingua Libre word recordings).
        srsearch: SEARCH_SUFFIX,
        srnamespace: 6,
        srlimit: 1,
        srprop: "",
      })}`,
      { cacheTtlMs: 60 * 60_000, signal: ctx.signal },
    );
    const total = res.query?.searchinfo?.totalhits;
    if (typeof total !== "number") throw new Error("Commons search returned no totalhits");
    return {
      total,
      free: total,
      byCategory: {},
      unit: "samples",
      method: "MediaWiki search API: total hits in the File namespace for audio files, excluding MIDI, pronunciations and Lingua Libre recordings (still includes music and speech)",
    };
  },
};
