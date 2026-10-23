import { HttpError } from "../core/http.js";
import { license, parseLicense } from "../core/licence.js";
import { normalizePitch } from "../core/query.js";
import { secret } from "../core/secrets.js";
import type {
  Category,
  License,
  MusicalKey,
  Provider,
  ProviderContext,
  Sample,
  SampleDetails,
  SampleFile,
  SampleQuery,
  SourceCensus,
} from "../core/types.js";
import { cleanText, filenameFromUrl, formatFromFilename, makeSample, qs } from "../core/util.js";
import { PITCH_CLASSES, topCategory } from "../core/vocab.js";

/**
 * Freesound (freesound.org) APIv2: 700k+ Creative Commons sounds with per-sound
 * licences and Essentia analysis (bpm, tonality, loopable, single_event, note).
 *
 * - Search: `GET /apiv2/search/` with `query`, a Solr-style `filter`, `fields`,
 *   `page`/`page_size` (≤150). Authenticated with the API key as
 *   `Authorization: Token <key>` (env FREESOUND_API_KEY), so the key never sits
 *   in a URL.
 * - Category filter: Freesound's Broad Sound Taxonomy (`category` /
 *   `subcategory` names, mandatory on upload since 2025, back-filled for older
 *   sounds).
 * - Files: HQ mp3/ogg previews are plain GETs on cdn.freesound.org. The original
 *   (`/apiv2/sounds/<id>/download/`) needs the user's OAuth2 bearer token, taken
 *   from `ctx.credentials.freesoundToken` or env FREESOUND_OAUTH_TOKEN.
 *
 * API terms: proxy searches only, no catalogue mirroring, short-lived caching
 * (the default HTTP cache TTL, never a long one).
 */

const SITE = "https://freesound.org";
const API = `${SITE}/apiv2`;
const MAX_PAGE_SIZE = 150;
const KEY_ENV = "FREESOUND_API_KEY";
const OAUTH_ENV = "FREESOUND_OAUTH_TOKEN";

/** Fields requested from search, similar and instance calls (metadata + analysis descriptors). */
export const FREESOUND_FIELDS = [
  "id",
  "url",
  "name",
  "tags",
  "description",
  "category",
  "subcategory",
  "created",
  "license",
  "type",
  "channels",
  "filesize",
  "bitdepth",
  "duration",
  "samplerate",
  "username",
  "pack_name",
  "previews",
  "images",
  "num_downloads",
  "avg_rating",
  "bpm",
  "bpm_confidence",
  "tonality",
  "tonality_confidence",
  "loopable",
  "single_event",
  "note_midi",
  "note_confidence",
  "loudness",
].join(",");

export interface FsSound {
  id: number;
  url?: string;
  name?: string;
  tags?: string[];
  description?: string;
  category?: string | null;
  subcategory?: string | null;
  created?: string;
  license?: string;
  type?: string;
  channels?: number;
  filesize?: number;
  bitdepth?: number;
  duration?: number;
  samplerate?: number;
  username?: string;
  pack_name?: string | null;
  previews?: Partial<Record<"preview-hq-mp3" | "preview-hq-ogg" | "preview-lq-mp3" | "preview-lq-ogg", string>>;
  images?: Partial<Record<"waveform_m" | "waveform_l" | "spectral_m" | "spectral_l", string>>;
  num_downloads?: number;
  avg_rating?: number;
  bpm?: number | null;
  bpm_confidence?: number | null;
  tonality?: string | null;
  tonality_confidence?: number | null;
  loopable?: boolean | null;
  single_event?: boolean | null;
  note_midi?: number | null;
  note_confidence?: number | null;
  loudness?: number | null;
}

export interface FsList {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: FsSound[];
}

function apiKey(): string | undefined {
  // Env var, or a file in SOUND_SERVER_SECRETS_DIR (a mounted Secret that may arrive later).
  return secret(KEY_ENV);
}

function authHeaders(): Record<string, string> {
  const key = apiKey();
  if (!key) throw new Error(`Freesound needs an API key: set ${KEY_ENV} (free at ${API}/apply)`);
  return { authorization: `Token ${key}` };
}

/** The user's own OAuth2 token for original downloads, if the caller passed one. */
function oauthToken(ctx: ProviderContext): string | undefined {
  return ctx.credentials?.freesoundToken?.trim() || process.env[OAUTH_ENV]?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Filters

/** A Broad Sound Taxonomy node: a top-level category, or a (globally unique) subcategory name. */
type Bst = { category: string } | { subcategory: string };
const cat = (category: string): Bst => ({ category });
const sub = (subcategory: string): Bst => ({ subcategory });

const SOLO_INSTRUMENT = sub("Solo instrument");
const MULTI = sub("Multiple instruments");

/** Our top-level categories → BST nodes that hold them. "other" has no mapping (no native filter). */
const BST_FOR: Partial<Record<Category, Bst[]>> = {
  drums: [sub("Percussion"), sub("Solo percussion")],
  bass: [sub("Synths / Electronic"), sub("String"), SOLO_INSTRUMENT],
  vocals: [cat("Speech"), cat("Music"), sub("Human sounds and actions")],
  fx: [cat("Sound effects"), sub("Synths / Electronic"), sub("Synthetic / Artificial")],
  foley: [cat("Sound effects")],
  ambience: [cat("Soundscapes"), sub("Natural elements and explosions")],
  keys: [sub("Piano / Keyboard instruments"), SOLO_INSTRUMENT],
  guitar: [sub("String"), SOLO_INSTRUMENT],
  synth: [sub("Synths / Electronic"), SOLO_INSTRUMENT, MULTI],
  strings: [sub("String"), SOLO_INSTRUMENT, MULTI],
  brass: [sub("Wind"), SOLO_INSTRUMENT, MULTI],
  woodwind: [sub("Wind"), SOLO_INSTRUMENT, MULTI],
  mallets: [sub("Percussion"), SOLO_INSTRUMENT, sub("Solo percussion")],
};

function quote(v: string): string {
  return `"${v.replace(/(["\\])/g, "\\$1")}"`;
}

function categoryFilter(categories: readonly Category[] | undefined): string | undefined {
  if (!categories?.length) return undefined;
  const nodes = new Map<string, string>();
  for (const c of categories) {
    const bst = BST_FOR[topCategory(c)];
    if (!bst) return undefined; // "other" or unknown: can't narrow without dropping results
    for (const n of bst) {
      const clause = "category" in n ? `category:${quote(n.category)}` : `subcategory:${quote(n.subcategory)}`;
      nodes.set(clause, clause);
    }
  }
  const clauses = [...nodes.values()];
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
}

function formFilter(forms: SampleQuery["forms"]): string | undefined {
  if (!forms?.length) return undefined;
  const clauses: string[] = [];
  for (const f of forms) {
    if (f === "one-shot") clauses.push("single_event:true", `tag:"one-shot"`, "tag:oneshot");
    else if (f === "loop") clauses.push("loopable:true", "tag:loop", "tag:loops");
    else return undefined; // phrase etc.: no descriptor for it, leave it to the classifier
  }
  return `(${clauses.join(" OR ")})`;
}

/** Freesound's tonality strings use sharps ("F# major") but accept both spellings to be safe. */
const FLAT_SPELLING: Partial<Record<string, string>> = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" };

function keyFilter(key: SampleQuery["key"]): string | undefined {
  if (!key) return undefined;
  const tonics = [key.tonic, FLAT_SPELLING[key.tonic]].filter(Boolean) as string[];
  const modes = key.mode ? [key.mode] : ["major", "minor"];
  const values = tonics.flatMap((t) => modes.map((m) => quote(`${t} ${m}`)));
  return `tonality:(${values.join(" OR ")})`;
}

function range(field: string, min: number | undefined, max: number | undefined): string | undefined {
  if (min === undefined && max === undefined) return undefined;
  return `${field}:[${min ?? "*"} TO ${max ?? "*"}]`;
}

/** The commercial-safe licence names (BY and CC0; NC and Sampling+ are left out). */
export const FREESOUND_COMMERCIAL_FILTER = `license:("Attribution" OR "Creative Commons 0")`;

/** Map the query's filters to Freesound's `filter` syntax (space-separated clauses are ANDed). */
export function freesoundFilter(q: SampleQuery): string {
  const bpmTol = 2; // the aggregator matches BPM ±2 too; the analysis bpm is an integer estimate
  return [
    q.commercialOnly ? FREESOUND_COMMERCIAL_FILTER : undefined,
    categoryFilter(q.categories),
    formFilter(q.forms),
    q.bpm ? range("bpm", q.bpm.min !== undefined ? Math.floor(q.bpm.min - bpmTol) : undefined, q.bpm.max !== undefined ? Math.ceil(q.bpm.max + bpmTol) : undefined) : undefined,
    keyFilter(q.key),
    range("duration", q.minDurationSec, q.maxDurationSec),
  ]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Mapping

const TONALITY = /^\s*([A-Ga-g])\s*(#|♯|b|♭)?\s*(major|minor|maj|min)\b/i;

function keyOf(s: FsSound): MusicalKey | undefined {
  if (!s.tonality || s.single_event) return undefined;
  if (s.tonality_confidence != null && s.tonality_confidence < 0.5) return undefined;
  const m = TONALITY.exec(s.tonality);
  if (!m) return undefined;
  const tonic = normalizePitch(m[1]!, m[2]);
  if (!tonic || !PITCH_CLASSES.includes(tonic)) return undefined;
  return { tonic, mode: m[3]!.toLowerCase().startsWith("maj") ? "major" : "minor" };
}

function bpmOf(s: FsSound): number | undefined {
  if (!s.bpm || s.bpm <= 0 || s.single_event) return undefined;
  if (s.bpm_confidence != null && s.bpm_confidence < 0.5) return undefined;
  return s.bpm;
}

function formOf(s: FsSound): Sample["form"] {
  if (s.loopable) return "loop";
  if (s.single_event && (s.duration === undefined || s.duration <= 10)) return "one-shot";
  return undefined;
}

function licenseOf(s: FsSound): License {
  return parseLicense(s.license) ?? license("LicenseRef-Unknown");
}

function plain(html: string | undefined): string {
  return cleanText((html ?? "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'"));
}

function format(s: FsSound): string | undefined {
  const t = s.type?.toLowerCase();
  return t ? (t === "aif" ? "aiff" : t) : undefined;
}

function soundUrl(s: FsSound): string {
  return s.url || (s.username ? `${SITE}/people/${encodeURIComponent(s.username)}/sounds/${s.id}/` : `${SITE}/s/${s.id}/`);
}

export function toSample(s: FsSound): Sample {
  const description = plain(s.description);
  const fmt = format(s);
  const name = cleanText(s.name) || `Freesound ${s.id}`;
  return makeSample({
    provider: "freesound",
    sourceName: "Freesound",
    nativeId: String(s.id),
    title: name,
    filename: name,
    description: description ? description.slice(0, 500) : undefined,
    url: soundUrl(s),
    author: s.username,
    authorUrl: s.username ? `${SITE}/people/${encodeURIComponent(s.username)}/` : undefined,
    tags: s.tags ?? [],
    sourceCategories: [s.category, s.subcategory].filter((c): c is string => !!c),
    form: formOf(s),
    bpm: bpmOf(s),
    key: keyOf(s),
    rootNote:
      s.single_event && s.note_midi != null && (s.note_confidence == null || s.note_confidence >= 0.5) ? s.note_midi : undefined,
    durationSec: s.duration,
    sampleRate: s.samplerate || undefined,
    bitDepth: s.bitdepth || undefined,
    channels: s.channels || undefined,
    loudnessLufs: s.loudness ?? undefined,
    previewUrl: s.previews?.["preview-hq-mp3"] ?? s.previews?.["preview-hq-ogg"],
    thumbnailUrl: s.images?.waveform_m,
    formats: fmt ? [fmt] : undefined,
    license: licenseOf(s),
    price: { free: true },
    requiresAccount: true,
    downloadable: !!(s.previews?.["preview-hq-mp3"] || s.previews?.["preview-hq-ogg"]),
    createdAt: s.created,
    popularity: s.num_downloads,
  });
}

function originalFilename(s: FsSound): string {
  const name = cleanText(s.name) || String(s.id);
  const fmt = format(s);
  if (!fmt) return name;
  const ext = formatFromFilename(name);
  const same = ext === fmt || (fmt === "aiff" && ext === "aif");
  return same ? name : `${name}.${fmt}`;
}

function files(s: FsSound, ctx: ProviderContext): SampleFile[] {
  const token = oauthToken(ctx);
  const out: SampleFile[] = [
    {
      url: `${API}/sounds/${s.id}/download/`,
      filename: originalFilename(s),
      format: format(s) ?? "wav",
      role: "original",
      sampleRate: s.samplerate || undefined,
      bitDepth: s.bitdepth || undefined,
      channels: s.channels || undefined,
      sizeBytes: s.filesize || undefined,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : { requiresAuth: true }),
    },
  ];
  for (const [key, fmt] of [
    ["preview-hq-mp3", "mp3"],
    ["preview-hq-ogg", "ogg"],
  ] as const) {
    const url = s.previews?.[key];
    if (url) out.push({ url, filename: filenameFromUrl(url), format: fmt, role: "preview", channels: s.channels || undefined });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Requests

function pageOf(q: Pick<SampleQuery, "limit" | "offset">): { page: number; pageSize: number; skip: number } {
  const pageSize = Math.max(1, Math.min(q.limit, MAX_PAGE_SIZE));
  const offset = Math.max(0, q.offset ?? 0);
  const page = Math.floor(offset / pageSize) + 1;
  return { page, pageSize, skip: offset - (page - 1) * pageSize };
}

/** Freesound answers 404 for a page past the end. */
async function list(url: string, ctx: ProviderContext): Promise<FsList> {
  try {
    return await ctx.fetch.json<FsList>(url, { headers: authHeaders(), signal: ctx.signal });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { count: undefined, results: [] };
    throw e;
  }
}

async function count(ctx: ProviderContext, filter?: string, sort?: string): Promise<FsList> {
  return ctx.fetch.json<FsList>(
    `${API}/search/${qs({ query: "", filter, sort, fields: "id,name,url,username,num_downloads", page_size: 1 })}`,
    { headers: authHeaders(), signal: ctx.signal },
  );
}

/**
 * Sounds similar to one Freesound sound (`GET /apiv2/sounds/<id>/similar/`),
 * for the find_similar MCP tool. Returns [] for an unknown id.
 */
export async function freesoundSimilar(nativeId: string, ctx: ProviderContext, limit = 12): Promise<Sample[]> {
  if (!/^\d+$/.test(nativeId)) return [];
  const pageSize = Math.max(1, Math.min(limit + 1, MAX_PAGE_SIZE));
  const res = await list(`${API}/sounds/${nativeId}/similar/${qs({ fields: FREESOUND_FIELDS, page_size: pageSize })}`, ctx);
  return (res.results ?? [])
    .filter((s) => s?.id !== undefined && String(s.id) !== nativeId)
    .slice(0, limit)
    .map(toSample);
}

export const freesound: Provider = {
  id: "freesound",
  name: "Freesound",
  homepage: SITE,
  description:
    "The big Creative Commons sound library (700k+): drums, FX, foley, field recordings, synth hits and loops, with per-sound licence, BPM and key analysis.",
  categories: ["drums", "bass", "vocals", "fx", "foley", "ambience", "keys", "guitar", "synth", "strings", "brass", "woodwind", "mallets", "other"],
  forms: ["one-shot", "loop", "phrase"],
  access: "api",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["categories", "forms", "bpm", "key", "duration", "commercialOnly", "freeOnly"],
  apiKeyEnv: KEY_ENV,

  isEnabled() {
    return !!apiKey();
  },

  buildSearchUrl(q: SampleQuery) {
    return `${SITE}/search/${qs({ q: q.query.trim(), f: q.commercialOnly ? FREESOUND_COMMERCIAL_FILTER : undefined })}`;
  },

  async search(q, ctx) {
    const { page, pageSize, skip } = pageOf(q);
    const url = `${API}/search/${qs({
      query: q.query.trim(),
      filter: freesoundFilter(q) || undefined,
      sort: "score",
      fields: FREESOUND_FIELDS,
      page,
      page_size: pageSize,
    })}`;
    const res = await list(url, ctx);
    const samples = (res.results ?? [])
      .filter((s) => s?.id !== undefined)
      .slice(skip, skip + q.limit)
      .map(toSample);
    return { samples, total: res.count, searchUrl: this.buildSearchUrl(q) };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    if (!/^\d+$/.test(nativeId)) return null;
    let s: FsSound;
    try {
      s = await ctx.fetch.json<FsSound>(`${API}/sounds/${nativeId}/${qs({ fields: FREESOUND_FIELDS })}`, {
        headers: authHeaders(),
        signal: ctx.signal,
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
    if (!s || s.id === undefined) return null;
    return { ...toSample(s), files: files(s, ctx) };
  },

  async census(ctx): Promise<SourceCensus> {
    // 5 requests: total (sorted by downloads for a highlight), 3 licences, last 30 days.
    const all = await count(ctx, undefined, "downloads_desc");
    const [cc0, by, bync, recent] = await Promise.all([
      count(ctx, `license:"Creative Commons 0"`),
      count(ctx, `license:"Attribution"`),
      count(ctx, `license:"Attribution NonCommercial"`),
      count(ctx, "created:[NOW-30DAYS TO NOW]"),
    ]);
    const total = all.count ?? 0;
    const byLicense: Record<string, number> = {};
    if (cc0.count !== undefined) byLicense["CC0-1.0"] = cc0.count;
    if (by.count !== undefined) byLicense["CC-BY"] = by.count;
    if (bync.count !== undefined) byLicense["CC-BY-NC"] = bync.count;
    const rest = total - (cc0.count ?? 0) - (by.count ?? 0) - (bync.count ?? 0);
    if (rest > 0 && cc0.count !== undefined && by.count !== undefined && bync.count !== undefined) byLicense["LicenseRef-Sampling-Plus-1.0"] = rest;
    const top = all.results?.[0];
    return {
      total,
      free: total,
      byCategory: {},
      byLicense,
      unit: "samples",
      addedLast30Days: recent.count,
      highlights: top?.name
        ? [{ label: "Most downloaded", title: top.name, url: soundUrl(top), value: top.num_downloads }]
        : undefined,
      method: "Freesound APIv2 search counts: all sounds, per licence name (BY counts 3.0 and 4.0; the rest is Sampling+), and created in the last 30 days",
    };
  },
};
