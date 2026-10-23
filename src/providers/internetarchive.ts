import { license, parseLicense } from "../core/licence.js";
import type { License, Provider, Sample, SampleDetails, SampleFile, SampleQuery } from "../core/types.js";
import { cleanText, formatFromFilename, makeSample, qs, tokenize } from "../core/util.js";

/**
 * Internet Archive: thousands of uploaded sample packs, drum-machine dumps and sound-effect
 * collections. Search is `advancedsearch.php` (Lucene syntax, JSON output); an item's files come
 * from `/metadata/<identifier>` and download from `/download/<identifier>/<file>` with a plain GET.
 *
 * Copyright risk is high (many items are uploads of commercial sample CDs, some with false PD
 * marks), so search is restricted to:
 * - items whose uploader set a CC0 / public-domain / CC BY / CC BY-SA `licenseurl`
 *   (`licenseurl:*creativecommons.org* AND NOT licenseurl:*nc* AND NOT licenseurl:*nd*
 *   AND NOT licenseurl:*sampling*`),
 * - and titles outside a denylist of commercial publishers ("Akai", "Best Service", "Hollywood
 *   Edge"…), applied in the query and again locally.
 * Licences are uploader-asserted, so they are capped at "check-terms".
 *
 * The query is biased towards samples: each word must hit the title, subject or description, and
 * the item must be tagged or titled as samples / sound effects / loops / a drum kit. Without the
 * bias, "kick" or "snare" return radio dramas and audiobooks; with it, "kick" returns drum packs.
 * Results sort by downloads (IA relevance ranking surfaces DJ mixes first).
 */

const SITE = "https://archive.org";
const SEARCH = `${SITE}/advancedsearch.php`;
const MAX_ROWS = 100;
const MAX_FILES = 200;
const SOURCE_NAME = "Internet Archive";

const FIELDS = ["identifier", "title", "creator", "licenseurl", "subject", "date", "downloads", "format", "files_count"];

const LICENCE_CLAUSE =
  "mediatype:audio AND licenseurl:*creativecommons.org* AND NOT licenseurl:*nc* AND NOT licenseurl:*nd* AND NOT licenseurl:*sampling*";

const SAMPLE_BIAS =
  '(subject:(sample OR samples OR "sample pack" OR "sound effects" OR sfx OR "drum kit" OR loops OR "one shot" OR foley) OR title:(sample OR samples OR "sound effects" OR sfx OR loops OR "drum kit"))';

/** Commercial publishers and sample-CD words: their IA uploads are almost always unlicensed copies. */
const DENY_TERMS = [
  "akai",
  "ueberschall",
  "zero-g",
  "best service",
  "big fish audio",
  "spectrasonics",
  "eastwest",
  "east west",
  "sony",
  "universal",
  "loopmasters",
  "vengeance",
  "native instruments",
  "sound ideas",
  "hollywood edge",
  "hollywoodedge",
  "sample cd",
  "cd-rom",
  "cdrom",
  "magix",
];

const DENY_CLAUSE = `NOT title:(${DENY_TERMS.map((t) => (/[\s-]/.test(t) ? `"${t}"` : t)).join(" OR ")})`;
const DENY_RE = new RegExp(
  `(^|[^a-z0-9])(${DENY_TERMS.map((t) => t.replace(/[-\s]/g, "[-\\s]?")).join("|")}|prosonus|time\\s*\\+\\s*space|sounds? of the universe|producer loops|cdda)([^a-z0-9]|$)`,
  "i",
);

/** True when a title or creator names a commercial sample publisher. */
export function isDenylisted(...texts: (string | string[] | undefined)[]): boolean {
  return texts.flat().some((t) => !!t && DENY_RE.test(t));
}

interface IaDoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  licenseurl?: string;
  subject?: string | string[];
  date?: string;
  downloads?: number;
  format?: string[];
  files_count?: number;
}

interface IaSearch {
  response?: { numFound?: number; docs?: IaDoc[] };
}

interface IaFile {
  name: string;
  source?: string;
  format?: string;
  size?: string;
  length?: string;
  original?: string;
}

interface IaMetadata {
  metadata?: {
    identifier?: string;
    title?: string | string[];
    creator?: string | string[];
    description?: string | string[];
    licenseurl?: string;
    subject?: string | string[];
    date?: string;
    mediatype?: string;
  };
  files?: IaFile[];
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? v.split(/[;,]/) : []).map(cleanText).filter(Boolean);

/** IA format names → our lowercase extensions. */
const IA_FORMATS: Record<string, string> = {
  wave: "wav",
  flac: "flac",
  "24bit flac": "flac",
  aiff: "aiff",
  "vbr mp3": "mp3",
  "128kbps mp3": "mp3",
  "64kbps mp3": "mp3",
  mp3: "mp3",
  "ogg vorbis": "ogg",
  opus: "opus",
  "mpeg-4 audio": "m4a",
  zip: "zip",
  rar: "rar",
  "7z": "7z",
};

const AUDIO = new Set(["wav", "flac", "aiff", "aif", "mp3", "ogg", "opus"]);
const ARCHIVE = new Set(["zip", "rar", "7z"]);

function formatOf(f: { name: string; format?: string }): string {
  return IA_FORMATS[(f.format ?? "").toLowerCase()] ?? formatFromFilename(f.name);
}

function licenseOf(url: string | undefined): License {
  const l = url ? parseLicense(url, "uploader") : undefined;
  const base = l ?? license("LicenseRef-Unknown", "uploader");
  return { ...base, note: `Licence asserted by uploader. ${base.note ?? ""}`.trim() };
}

function downloadUrl(id: string, name: string): string {
  return `${SITE}/download/${encodeURIComponent(id)}/${name.split("/").map(encodeURIComponent).join("/")}`;
}

function toSample(d: {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  licenseurl?: string;
  subject?: string | string[];
  date?: string;
  downloads?: number;
  description?: string;
  formats?: string[];
  /** One sound rather than a pack. */
  single?: boolean;
  durationSec?: number;
}): Sample {
  const title = cleanText(first(d.title)) || d.identifier;
  const subjects = list(d.subject);
  const created = d.date && /^\d{4}(-\d{2}-\d{2})?/.test(d.date) ? new Date(d.date) : undefined;
  return makeSample({
    provider: "internetarchive",
    nativeId: d.identifier,
    title,
    description: d.description,
    url: `${SITE}/details/${encodeURIComponent(d.identifier)}`,
    author: cleanText(first(d.creator)) || undefined,
    tags: subjects.slice(0, 12),
    sourceCategories: subjects,
    form: d.single ? undefined : "pack",
    unit: d.single ? "sample" : "pack",
    durationSec: d.single ? d.durationSec : undefined,
    thumbnailUrl: `${SITE}/services/img/${encodeURIComponent(d.identifier)}`,
    formats: d.formats?.length ? d.formats : undefined,
    license: licenseOf(d.licenseurl),
    price: { free: true },
    downloadable: true,
    createdAt: created && !Number.isNaN(created.getTime()) ? created.toISOString() : undefined,
    popularity: d.downloads,
    sourceName: SOURCE_NAME,
  });
}

/** Words of the query as Lucene-safe tokens, each required in the title, subject or description. */
function textClause(q: SampleQuery): string | undefined {
  const words = tokenize(q.query).filter((w) => !/^(and|or|not|to)$/.test(w)).slice(0, 8);
  if (!words.length) return undefined;
  return words.map((w) => `(title:${w} OR subject:${w} OR description:${w})`).join(" AND ");
}

export function buildQuery(q: SampleQuery): string {
  return [textClause(q), SAMPLE_BIAS, LICENCE_CLAUSE, DENY_CLAUSE].filter(Boolean).join(" AND ");
}

function searchUrl(query: string, rows: number, page: number, withFields = true): string {
  const sp = new URLSearchParams();
  sp.set("q", query);
  if (withFields) for (const f of FIELDS) sp.append("fl[]", f);
  else sp.append("fl[]", "identifier");
  sp.set("rows", String(rows));
  sp.set("page", String(page));
  if (withFields) sp.append("sort[]", "downloads desc");
  sp.set("output", "json");
  return `${SEARCH}?${sp.toString()}`;
}

export const internetarchive: Provider = {
  id: "internetarchive",
  name: "Internet Archive",
  homepage: SITE,
  description:
    "Uploaded sample packs, drum-machine recordings and sound-effect collections; only items whose uploader states CC0, public domain or CC BY(-SA) are listed, and commercial sample CDs are filtered out.",
  categories: ["drums", "bass", "fx", "foley", "ambience", "vocals", "synth", "keys"],
  forms: ["pack"],
  access: "api",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["commercialOnly"],

  buildSearchUrl(q) {
    const text = q.query.trim();
    return `${SITE}/search${qs({ query: text ? `${text} AND mediatype:audio` : "mediatype:audio AND subject:samples" })}`;
  },

  async search(q, ctx) {
    const url = this.buildSearchUrl(q);
    // Every licence here is uploader-asserted (verdict check-terms), so nothing is commercial-safe.
    if (q.commercialOnly) return { samples: [], searchUrl: url };
    const rows = Math.max(1, Math.min(q.limit, MAX_ROWS));
    const page = Math.floor((q.offset ?? 0) / rows) + 1;
    const res = await ctx.fetch.json<IaSearch>(searchUrl(buildQuery(q), rows, page), { cacheTtlMs: 30 * 60_000, signal: ctx.signal });
    const samples = (res.response?.docs ?? [])
      .filter((d) => d?.identifier && !isDenylisted(d.title, d.creator))
      .map((d) =>
        toSample({
          ...d,
          formats: [...new Set((d.format ?? []).map((f) => IA_FORMATS[f.toLowerCase()]).filter((f): f is string => !!f))],
          // An item is ~5 files per sound (original + flac/mp3/png/spectrogram) plus ~5 of metadata.
          single: typeof d.files_count === "number" && d.files_count <= 12 && !(d.format ?? []).some((f) => /zip/i.test(f)),
        }),
      );
    return { samples, total: res.response?.numFound, searchUrl: url };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    if (!/^[A-Za-z0-9._-]+$/.test(nativeId)) return null;
    const res = await ctx.fetch.json<IaMetadata>(`${SITE}/metadata/${encodeURIComponent(nativeId)}`, {
      cacheTtlMs: 60 * 60_000,
      signal: ctx.signal,
    });
    const m = res.metadata;
    if (!m?.identifier || !res.files?.length) return null;
    if (isDenylisted(m.title, m.creator)) return null;

    const files: SampleFile[] = [];
    const originals = res.files.filter((f) => f.source === "original");
    const audio = originals.filter((f) => AUDIO.has(formatOf(f)));
    const packs = originals.filter((f) => ARCHIVE.has(formatOf(f)));
    const previews = res.files.filter((f) => f.source === "derivative" && formatOf(f) === "mp3");
    for (const f of packs) {
      files.push({ url: downloadUrl(m.identifier, f.name), filename: f.name.split("/").pop()!, format: formatOf(f), role: "pack", sizeBytes: Number(f.size) || undefined });
    }
    for (const f of audio.slice(0, MAX_FILES)) {
      files.push({ url: downloadUrl(m.identifier, f.name), filename: f.name, format: formatOf(f), role: "original", sizeBytes: Number(f.size) || undefined });
    }
    for (const f of previews.slice(0, MAX_FILES)) {
      files.push({ url: downloadUrl(m.identifier, f.name), filename: f.name, format: "mp3", role: "preview", sizeBytes: Number(f.size) || undefined });
    }
    if (!files.length) return null;

    const description = cleanText(first(m.description)?.replace(/<[^>]*>/g, " ")).slice(0, 300) || undefined;
    const single = audio.length === 1 && packs.length === 0;
    const length = Number(audio[0]?.length);
    const sample = toSample({
      ...m,
      identifier: m.identifier,
      description,
      formats: [...new Set(files.map((f) => f.format))],
      single,
      durationSec: single && Number.isFinite(length) && length > 0 ? length : undefined,
    });
    const preview = previews[0] ?? audio.find((f) => formatOf(f) === "mp3");
    return {
      ...sample,
      packSize: single ? undefined : audio.length || undefined,
      previewUrl: preview ? downloadUrl(m.identifier, preview.name) : undefined,
      files,
    };
  },

  async census(ctx) {
    const base = [SAMPLE_BIAS, LICENCE_CLAUSE, DENY_CLAUSE].join(" AND ");
    const res = await ctx.fetch.json<IaSearch>(searchUrl(base, 0, 1, false), { cacheTtlMs: 60 * 60_000, signal: ctx.signal });
    const total = res.response?.numFound;
    if (typeof total !== "number") throw new Error("Internet Archive search returned no numFound");
    return {
      total,
      free: total,
      byCategory: {},
      unit: "packs",
      method: "advancedsearch.php numFound for audio items tagged as samples/SFX/loops with a CC0, PD, CC BY or CC BY-SA licenseurl, commercial publishers excluded",
    };
  },
};
