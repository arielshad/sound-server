/**
 * BigSoundBank (https://bigsoundbank.com): about 3,600 sound effects, ambiences and atmospheres
 * recorded by Joseph Sardin since 2005 (the English twin of LaSonotheque.org), all released under
 * CC0 (the licence page also offers WTFPL / public domain: "Use, including for commercial
 * purposes. Without any restrictions"). Each sound has a UCS category.
 *
 * Checked 2026-10-23:
 * - robots.txt disallows `/UPLOAD/` (where every audio file, preview and waveform image lives) for
 *   all robots, plus contact/admin paths. `/search` and the sound pages are allowed.
 * - /ai.txt: "Real-time fetching to answer a user's question is welcome across the whole site,
 *   except /UPLOAD/", and the audio must not be used for training.
 * So this provider is search-only: one request to the search page per search, mapped to metadata
 * and page links. It never returns `/UPLOAD/` URLs (no `previewUrl`, no files): users listen and
 * download on the sound page.
 */
import * as cheerio from "cheerio";
import { parseCount } from "../core/census.js";
import { HttpError } from "../core/http.js";
import { license } from "../core/licence.js";
import type { Provider, ProviderContext, Sample, SampleDetails, SampleQuery, SourceCensus } from "../core/types.js";
import { cleanText, makeSample, qs, uniq, wantsCategory } from "../core/util.js";

const SITE = "https://bigsoundbank.com";
const SOURCE_NAME = "BigSoundBank";
const AUTHOR = "Joseph Sardin";
const PAGE_SIZE = 40;
const CACHE_MS = 60 * 60_000;

export const bigsoundbankLicense = license(
  "CC0-1.0",
  "site",
  "BigSoundBank releases its sounds under CC0 (public-domain equivalent): free for any use, commercial included, no credit required (a credit is appreciated).",
);

/**
 * UCS category prefixes → a word our classifier knows. The UCS code is reliable (the site sets it
 * per sound), so it steers the category; the title still picks the sub-category.
 */
const UCS: Record<string, string> = {
  AMB: "ambience",
  CRWD: "ambience",
  WIND: "wind",
  RAIN: "rain",
  WTHR: "ambience",
  BIRD: "birds",
  WATR: "water",
  DOOR: "foley",
  DRWR: "foley",
  FOOT: "footsteps",
  FOLY: "foley",
  CLOTH: "cloth",
  GLAS: "glass",
  PAPR: "paper",
  FURN: "foley",
  FOOD: "kitchen",
  LEAT: "foley",
  PLAS: "foley",
  RUBR: "foley",
  WOOD: "foley",
  METL: "foley",
  OBJ: "foley",
  TOOL: "foley",
  ROPE: "foley",
  CERM: "foley",
  LIQ: "water",
  CLOK: "foley",
  SWSH: "whoosh",
  WHSH: "whoosh",
  EXPL: "explosion",
  GUNS: "gunshot",
  WEAP: "impact",
  FGHT: "punch",
  ALRM: "alarm",
  LASR: "laser",
  SCFI: "fx",
  DSGN: "fx",
  MAGC: "fx",
  TOON: "fx",
  UI: "click",
  GAME: "fx",
  ROBO: "fx",
  MACH: "fx",
  MECH: "fx",
  MOTR: "fx",
  VEH: "fx",
  AIR: "fx",
  BOAT: "fx",
  TRAN: "fx",
  ELEC: "fx",
  COMP: "fx",
  COMM: "fx",
  ANML: "fx",
  FIRE: "fx",
  FIRW: "explosion",
  VOX: "voice",
  HUMN: "voice",
};

/** "DOORWood" → "DOOR", "UIClick" → "UI", "AMBForst" → "AMB". */
export function ucsPrefix(catId: string): string | undefined {
  return /^([A-Z]+?)(?=[A-Z][a-z]|$)/.exec(catId)?.[1];
}

/** "00:05" → 5, "01:02:03" → 3723. */
function seconds(text: string | undefined): number | undefined {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text ?? "");
  if (!m) return undefined;
  const parts = [m[1], m[2], m[3]].filter((p): p is string => p !== undefined).map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0) || undefined;
}

/** ISO 8601 "PT5S", "PT1M30S" → seconds. */
function isoSeconds(text: string | undefined): number | undefined {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(text ?? "");
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) || undefined;
}

interface Row {
  id: string;
  title: string;
  description?: string;
  ucs?: string;
  durationSec?: number;
}

function sampleOf(r: Row & { tags?: string[]; formats?: string[]; createdAt?: string }): Sample {
  const prefix = r.ucs ? ucsPrefix(r.ucs) : undefined;
  const hint = prefix ? UCS[prefix] : undefined;
  return makeSample({
    provider: "bigsoundbank",
    nativeId: r.id,
    title: r.title,
    description: r.description,
    url: `${SITE}/s${r.id}.html`,
    author: AUTHOR,
    tags: [...(r.tags ?? []), ...(r.ucs ? [r.ucs] : [])],
    sourceCategories: hint ? [hint] : undefined,
    durationSec: r.durationSec,
    formats: r.formats,
    license: bigsoundbankLicense,
    price: { free: true },
    // Files live under /UPLOAD/, which robots.txt closes to every robot: link to the page instead.
    downloadable: false,
    createdAt: r.createdAt,
    sourceName: SOURCE_NAME,
  });
}

/** Rows of a search page, and the total from its heading ("90 Free Door Sound Effects", "3579 results"). */
export function parseSearch(html: string): { rows: Row[]; total: number } {
  const $ = cheerio.load(html);
  const rows: Row[] = [];
  $(".resultat_0").each((_, el) => {
    const box = $(el);
    const link = box.find("h2 a[href]").first();
    const id = /-s(\d+)\.html$|^\/s(\d+)\.html$/.exec(link.attr("href") ?? "");
    const num = id?.[1] ?? id?.[2];
    if (!num) return;
    const titleEl = link.clone();
    const n = cleanText(titleEl.find(".numero").text());
    titleEl.find(".numero").remove();
    const title = cleanText([cleanText(titleEl.text()), n].filter(Boolean).join(" "));
    // The text block: "<description> UCS Category: DOORWood. Length: 00:05."
    const block = box.children("div").filter((_, d) => /Length:|UCS Category/i.test($(d).text())).first();
    const ucs = cleanText(block.find('a[href*="CatID="]').first().text()) || undefined;
    const text = cleanText(block.text());
    const description = cleanText(text.replace(/\s*UCS Category:.*$/i, "").replace(/\s*Length:.*$/i, "")) || undefined;
    rows.push({ id: num, title: title || `Sound ${num}`, description, ucs, durationSec: seconds(/Length:\s*([\d:]+)/i.exec(text)?.[1]) });
  });
  const total = parseCount(cleanText($("h1").first().text()), /^(\d[\d,]*)\s/) ?? rows.length;
  return { rows, total };
}

const MIME_FORMAT: Record<string, string> = {
  "audio/wav": "wav",
  "audio/aiff": "aiff",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
};

interface AudioObject {
  "@type"?: string;
  name?: string;
  description?: string;
  duration?: string;
  datePublished?: string;
  keywords?: string;
  encoding?: { encodingFormat?: string }[];
}

export const bigsoundbank: Provider = {
  id: "bigsoundbank",
  name: SOURCE_NAME,
  homepage: SITE,
  description:
    "About 3,600 CC0 sound effects, ambiences and foley recorded by Joseph Sardin, each with a UCS category; search and page links only (the audio folder is closed to robots).",
  categories: ["foley", "ambience", "fx", "vocals", "drums", "mallets", "keys", "other"],
  forms: ["one-shot", "loop", "phrase"],
  access: "scrape",
  pricing: "free",
  license: bigsoundbankLicense,
  supportsDownload: false,

  buildSearchUrl(q: SampleQuery) {
    const text = q.query.trim();
    return text ? `${SITE}/search${qs({ q: text })}` : `${SITE}/search`;
  },

  async search(q, ctx) {
    const searchUrl = this.buildSearchUrl(q);
    if (!wantsCategory(q, ...this.categories)) return { samples: [], searchUrl };
    const offset = q.offset ?? 0;
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const text = q.query.trim();
    const url = `${SITE}/search${qs({ q: text || undefined, page: page > 1 ? page : undefined })}`;
    const html = await ctx.fetch.text(url, { signal: ctx.signal, cacheTtlMs: CACHE_MS });
    const { rows, total } = parseSearch(html);
    const start = offset % PAGE_SIZE;
    return { samples: rows.slice(start, start + q.limit).map((r) => sampleOf(r)), total, searchUrl };
  },

  async getSample(nativeId: string, ctx: ProviderContext): Promise<SampleDetails | null> {
    if (!/^\d{1,7}$/.test(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${SITE}/s${nativeId}.html`, { signal: ctx.signal, cacheTtlMs: CACHE_MS });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
    const $ = cheerio.load(html);
    let audio: AudioObject | undefined;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).text()) as AudioObject;
        if (data["@type"] === "AudioObject") audio = data;
      } catch {
        // Ignore malformed blocks.
      }
    });
    if (!audio?.name) return null;
    const title = cleanText(audio.name.replace(/\s+—\s+Free Download.*$/i, ""));
    const formats = uniq((audio.encoding ?? []).map((e) => MIME_FORMAT[e.encodingFormat ?? ""]).filter((f): f is string => !!f));
    const sample = sampleOf({
      id: nativeId,
      title,
      description: cleanText(audio.description) || undefined,
      durationSec: isoSeconds(audio.duration),
      tags: (audio.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
      formats: formats.length ? formats : undefined,
      createdAt: audio.datePublished?.slice(0, 10),
    });
    return { ...sample, files: [] };
  },

  async census(ctx): Promise<SourceCensus> {
    const html = await ctx.fetch.text(`${SITE}/search`, { signal: ctx.signal, cacheTtlMs: CACHE_MS });
    const { total } = parseSearch(html);
    if (!total) throw new Error("BigSoundBank: no total on the search page");
    return {
      total,
      free: total,
      byCategory: {},
      unit: "samples",
      method: "Result count of the site's search with an empty query (every sound)",
    };
  },
};
