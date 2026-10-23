import { classify } from "../core/classify.js";
import { license } from "../core/licence.js";
import type { Category, ProviderContext, Provider, Sample, SampleDetails, SampleFile, SampleQuery } from "../core/types.js";
import { cleanText, makeSample, qs, wantsCategory } from "../core/util.js";

/**
 * BBC Sound Effects (RemArc): about 33,000 BBC archive and Natural History Unit recordings.
 * The web app talks to an undocumented JSON API (found in its bundle):
 * `POST https://sound-effects-api.bbcrewind.co.uk/api/sfx/search` with
 * `{"criteria":{from,size,query,tags,categories,durations:[{min,max}],continents,sortBy,source,recordist,habitat}}`.
 * `durations` are whole seconds; `size` is capped at 300 by the app; `sortBy` is
 * "relevance" | "duration-asc" | "duration-desc". Files are plain GETs on
 * `sound-effects-media.bbcrewind.co.uk`: `/mp3/<id>.mp3` (128k) and `/zip/<id>.wav.zip`.
 *
 * Every item is under the RemArc licence: personal, educational and research use only.
 * Results are still shown (with a non-commercial badge); `commercialOnly` searches skip it.
 */

const SITE = "https://sound-effects.bbcrewind.co.uk";
const API = "https://sound-effects-api.bbcrewind.co.uk/api/sfx";
const MEDIA = "https://sound-effects-media.bbcrewind.co.uk";
const MAX_PAGE_SIZE = 100;
const CACHE_MS = 10 * 60_000;
const SOURCE_NAME = "BBC Sound Effects";

const REMARC = license("LicenseRef-BBC-RemArc", "site");

interface BbcCategory {
  className?: string;
}

interface BbcResult {
  id: string;
  description?: string;
  /** Milliseconds. */
  duration?: number;
  recordedDate?: string | null;
  categories?: BbcCategory[];
  tags?: string[];
  source?: string;
  technicalMetadata?: { file_name?: string; sample_rate?: string | number; bits_per_sample?: number; channels?: number };
  additionalMetadata?: {
    cdName?: string;
    originalCategory?: string;
    additionalCategory?: string;
    recordist?: string;
    habitat?: string;
    locationText?: string;
  };
  fileSizes?: { wavFileSize?: string; mp3FileSize?: string };
}

interface BbcSearch {
  total?: number;
  results?: BbcResult[];
}

interface Criteria {
  from: number;
  size: number;
  query?: string;
  durations?: { min: number; max: number }[];
  sortBy?: string;
}

/** BBC's own top categories → the closest of ours, used when the words say nothing. */
const BBC_TOP: Record<string, Category> = {
  nature: "ambience",
  birds: "ambience",
  animals: "ambience",
  atmosphere: "ambience",
  crowds: "ambience",
  applause: "ambience",
  events: "ambience",
  sport: "ambience",
  transport: "ambience",
  aircraft: "ambience",
  industry: "ambience",
  footsteps: "foley",
  "daily life": "foley",
  "creaks, bangs and rattles": "foley",
  household: "foley",
  toys: "foley",
  clocks: "foley",
  medical: "foley",
  fire: "foley",
  bells: "foley",
  destruction: "fx.impact",
  military: "fx",
  machines: "fx",
  electronics: "fx",
  comedy: "fx",
};

const label = (s: string | undefined): string => cleanText((s ?? "").replace(/_/g, " "));

function bbcCategories(r: BbcResult): string[] {
  const own = (r.categories ?? []).map((c) => label(c.className)).filter(Boolean);
  const extra = [label(r.additionalMetadata?.additionalCategory), label(r.additionalMetadata?.originalCategory)].filter(Boolean);
  return [...new Set([...own, ...extra])];
}

function num(v: string | number | undefined): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function itemUrl(id: string): string {
  return `${SITE}/search${qs({ q: id })}`;
}

function toSample(r: BbcResult): Sample {
  const title = cleanText(r.description) || r.id;
  const cats = bbcCategories(r);
  const tags = (r.tags ?? []).filter((t) => !/^(sound|effects|news|tape)$/i.test(t));
  const durationSec = r.duration ? r.duration / 1000 : undefined;
  const tech = r.technicalMetadata ?? {};
  // Words first; when they say nothing, fall back on BBC's own category.
  const c = classify({ title, tags, sourceCategories: cats, durationSec });
  const fallback = cats.map((x) => BBC_TOP[x.toLowerCase()]).find(Boolean);
  // Long takes filed under an ambience-like BBC category are ambiences, whatever one word says
  // ("Interior, doors slam, moves off…" is a 90 s train recording, not an impact).
  const longAmbience = fallback === "ambience" && (durationSec ?? 0) > 30 && !c.category.startsWith("ambience");
  const useFallback = !!fallback && (c.category === "other" || longAmbience);
  const recorded = r.recordedDate && /^\d{4}-\d{2}-\d{2}/.test(r.recordedDate) ? r.recordedDate : undefined;
  return makeSample({
    provider: "bbc",
    nativeId: r.id,
    title,
    description: [r.additionalMetadata?.cdName, r.additionalMetadata?.locationText].map(cleanText).filter(Boolean).join(" · ") || undefined,
    url: itemUrl(r.id),
    author: cleanText(r.additionalMetadata?.recordist) || undefined,
    tags,
    sourceCategories: cats,
    category: useFallback ? fallback : undefined,
    categoryEvidence: useFallback ? { by: "source", confidence: 0.5 } : undefined,
    form: useFallback ? c.form ?? (durationSec !== undefined && durationSec <= 6 ? "one-shot" : "phrase") : undefined,
    durationSec,
    sampleRate: num(tech.sample_rate),
    bitDepth: num(tech.bits_per_sample),
    channels: num(tech.channels),
    previewUrl: `${MEDIA}/mp3/${encodeURIComponent(r.id)}.mp3`,
    formats: ["wav", "mp3"],
    license: REMARC,
    price: { free: true },
    downloadable: true,
    createdAt: recorded ? new Date(recorded).toISOString() : undefined,
    filename: tech.file_name,
    sourceName: SOURCE_NAME,
  });
}

function criteria(q: SampleQuery, from: number, size: number): Criteria {
  const c: Criteria = { from, size };
  const text = q.query.trim();
  if (text) c.query = text;
  if (q.maxDurationSec !== undefined || q.minDurationSec !== undefined) {
    // Whole seconds; the API drops a range whose min >= max.
    const min = Math.max(0, Math.floor(q.minDurationSec ?? 0));
    const max = Math.max(min + 1, Math.ceil(q.maxDurationSec ?? 3600 * 10));
    c.durations = [{ min, max }];
  }
  return c;
}

async function post(criteria: Criteria, ctx: ProviderContext): Promise<BbcSearch> {
  return ctx.fetch.json<BbcSearch>(`${API}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ criteria }),
    cacheTtlMs: CACHE_MS,
    signal: ctx.signal,
  });
}

export const bbc: Provider = {
  id: "bbc",
  name: "BBC Sound Effects",
  homepage: SITE,
  description:
    "33,000 BBC archive and Natural History Unit recordings (nature, ambience, transport, machines, foley) as WAV and MP3; RemArc licence: personal, educational and research use only.",
  categories: ["ambience", "foley", "fx"],
  forms: ["one-shot", "phrase"],
  access: "api",
  pricing: "free",
  license: REMARC,
  supportsDownload: true,
  nativeFilters: ["duration"],

  buildSearchUrl(q) {
    return `${SITE}/search${qs({ q: q.query.trim() || undefined })}`;
  },

  async search(q, ctx) {
    const searchUrl = this.buildSearchUrl(q);
    // Every item is non-commercial, so a commercial-only search has nothing here.
    if (q.commercialOnly || !wantsCategory(q, "ambience", "foley", "fx")) return { samples: [], searchUrl };
    const size = Math.max(1, Math.min(q.limit, MAX_PAGE_SIZE));
    const res = await post(criteria(q, q.offset ?? 0, size), ctx);
    const samples = (res.results ?? []).filter((r) => r?.id).map(toSample);
    return { samples, total: res.total, searchUrl };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(nativeId)) return null;
    const res = await post({ from: 0, size: 5, query: nativeId }, ctx);
    const r = (res.results ?? []).find((x) => x.id === nativeId);
    if (!r) return null;
    const sample = toSample(r);
    const id = encodeURIComponent(r.id);
    const tech = r.technicalMetadata ?? {};
    const files: SampleFile[] = [
      {
        url: `${MEDIA}/zip/${id}.wav.zip`,
        filename: `${r.id}.wav.zip`,
        format: "zip",
        role: "original",
        sampleRate: num(tech.sample_rate),
        bitDepth: num(tech.bits_per_sample),
        channels: num(tech.channels),
        sizeBytes: num(r.fileSizes?.wavFileSize),
      },
      { url: `${MEDIA}/mp3/${id}.mp3`, filename: `${r.id}.mp3`, format: "mp3", role: "preview", sizeBytes: num(r.fileSizes?.mp3FileSize) },
    ];
    return { ...sample, files };
  },

  async census(ctx) {
    const [all, cats] = await Promise.all([
      post({ from: 0, size: 0 }, ctx),
      ctx.fetch.json<{ aggregations?: Record<string, { doc_count?: number }> }>(`${API}/cached/categoryaggregations`, {
        cacheTtlMs: 60 * 60_000,
        signal: ctx.signal,
      }),
    ]);
    if (typeof all.total !== "number") throw new Error("BBC search returned no total");
    const categories: Record<string, number> = {};
    const byCategory: Partial<Record<Category, number>> = {};
    for (const [name, v] of Object.entries(cats.aggregations ?? {})) {
      const n = v?.doc_count ?? 0;
      categories[label(name)] = n;
      const top = (BBC_TOP[label(name).toLowerCase()] ?? "fx").split(".")[0] as Category;
      byCategory[top] = (byCategory[top] ?? 0) + n;
    }
    return {
      total: all.total,
      free: all.total,
      byCategory,
      byLicense: { [REMARC.id]: all.total },
      categories,
      unit: "samples",
      method: "BBC RemArc search API: total of an empty search; categories from /api/sfx/cached/categoryaggregations (mapped to ours)",
    };
  },
};
