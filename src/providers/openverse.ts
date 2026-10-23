import { HttpError } from "../core/http.js";
import { license, parseLicense } from "../core/licence.js";
import { secret as readSecret } from "../core/secrets.js";
import type { License, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleQuery, SourceCensus } from "../core/types.js";
import { cleanText, filenameFromUrl, formatFromFilename, makeSample, qs } from "../core/util.js";

/**
 * Openverse (api.openverse.org): a keyless Creative Commons meta-index. Its audio
 * index covers Freesound, Wikimedia Commons and Jamendo.
 *
 * - We search `source=freesound,wikimedia_audio` only. Jamendo items are full songs,
 *   not samples. The `category` filter (sound_effect, music, podcast…) is not used:
 *   Freesound and Wikimedia items carry `category: null`, so any category filter
 *   returns nothing for them (checked live, Oct 2026).
 * - `filter_dead=false`: Openverse otherwise HEAD-checks every result link before
 *   answering, which took 20–40 s per search from our egress (4 s without).
 * - commercialOnly → `license=cc0,pdm,by` (not `license_type=commercial`, which also
 *   lets BY-SA and BY-ND through; those are restricted / no for a released track).
 * - Anonymous limits: 20 req/min, 200/day, page_size ≤ 20, 240 results per query.
 *   Optional OAuth client (OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET) raises them;
 *   the bearer token is cached in memory until shortly before it expires.
 * - nativeId is the Openverse uuid. `sameAs` links the item to the original provider:
 *   `freesound:<sound id>` and `wikimediacommons:<File_name.ext>` (the Commons file
 *   title without "File:", spaces as underscores, as in the upload URL).
 */

const API = "https://api.openverse.org/v1";
const SITE = "https://openverse.org";
const SOURCES = "freesound,wikimedia_audio";
const ANON_PAGE_SIZE = 20;
const AUTH_PAGE_SIZE = 50;
/** Anonymous requests can't page past this many results. */
const ANON_RESULT_CAP = 240;
const COMMERCIAL_LICENSES = "cc0,pdm,by";
const ID_ENV = "OPENVERSE_CLIENT_ID";
const SECRET_ENV = "OPENVERSE_CLIENT_SECRET";

interface OvAltFile {
  url: string;
  bit_rate?: number | null;
  filesize?: number | null;
  filetype?: string | null;
  sample_rate?: number | null;
}

export interface OvAudio {
  id: string;
  title?: string | null;
  foreign_landing_url?: string | null;
  url?: string | null;
  creator?: string | null;
  creator_url?: string | null;
  license?: string | null;
  license_version?: string | null;
  license_url?: string | null;
  provider?: string | null;
  source?: string | null;
  category?: string | null;
  genres?: string[] | null;
  filesize?: number | null;
  filetype?: string | null;
  tags?: { name: string }[] | null;
  alt_files?: OvAltFile[] | null;
  attribution?: string | null;
  audio_set?: { title?: string | null } | null;
  duration?: number | null;
  bit_rate?: number | null;
  sample_rate?: number | null;
  thumbnail?: string | null;
  mature?: boolean;
}

interface OvSearch {
  result_count?: number;
  page_count?: number;
  page_size?: number;
  page?: number;
  results?: OvAudio[];
}

interface OvStat {
  source_name: string;
  display_name?: string;
  media_count?: number;
}

// ---------------------------------------------------------------------------
// OAuth (client_credentials), optional

let cachedToken: { clientId: string; token: string; expiresAt: number } | undefined;

/** Forget the cached bearer token (tests). */
export function resetOpenverseToken(): void {
  cachedToken = undefined;
}

function clientCredentials(): { id: string; secret: string } | undefined {
  const id = readSecret(ID_ENV);
  const secret = readSecret(SECRET_ENV);
  return id && secret ? { id, secret } : undefined;
}

/** A bearer token when a client is configured; undefined (anonymous) otherwise or when the token call fails. */
async function bearer(ctx: ProviderContext): Promise<string | undefined> {
  const creds = clientCredentials();
  if (!creds) return undefined;
  if (cachedToken && cachedToken.clientId === creds.id && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  try {
    const res = await ctx.fetch.json<{ access_token?: string; expires_in?: number }>(`${API}/auth_tokens/token/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: creds.id, client_secret: creds.secret }).toString(),
      cacheTtlMs: 0,
      signal: ctx.signal,
    });
    if (!res.access_token) return undefined;
    // Refresh a minute early; Openverse tokens last 12 h.
    const ttlMs = Math.max(60, (res.expires_in ?? 3600) - 60) * 1000;
    cachedToken = { clientId: creds.id, token: res.access_token, expiresAt: Date.now() + ttlMs };
    return res.access_token;
  } catch {
    return undefined; // anonymous still works
  }
}

async function get<T>(url: string, ctx: ProviderContext, token: string | undefined): Promise<T> {
  return ctx.fetch.json<T>(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined, signal: ctx.signal });
}

// ---------------------------------------------------------------------------
// Mapping

function normFormat(t: string | null | undefined): string | undefined {
  const f = t?.toLowerCase().replace(/^\./, "");
  if (!f) return undefined;
  if (f === "ogx" || f === "oga") return "ogg";
  if (f === "aif") return "aiff";
  return f;
}

const PLAYABLE = new Set(["mp3", "ogg", "opus", "m4a"]);

function isWikimedia(a: OvAudio): boolean {
  return a.source === "wikimedia_audio" || a.provider === "wikimedia_audio";
}

function isFreesound(a: OvAudio): boolean {
  return a.source === "freesound" || a.provider === "freesound";
}

/** Commons file URLs carry utm_* tracking params; the bare URL is the file. */
function cleanFileUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname === "upload.wikimedia.org") u.search = "";
    return u.toString();
  } catch {
    return undefined;
  }
}

/** "Foo_bar.wav" from https://upload.wikimedia.org/wikipedia/commons/5/5d/Foo_bar.wav */
function commonsFileName(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = /upload\.wikimedia\.org\/wikipedia\/commons\/(?:[0-9a-f]\/[0-9a-f]{2}\/)([^/?#]+)/.exec(url);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1];
  }
}

/** Commons serves an mp3 transcode of wav/flac uploads next to the original. */
function commonsMp3Transcode(url: string): string | undefined {
  const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)$/.exec(url);
  return m ? `${m[1]}/transcoded/${m[2]}/${m[3]}/${m[3]}.mp3` : undefined;
}

function freesoundId(a: OvAudio): string | undefined {
  const fromLanding = /freesound\.org\/people\/[^/]+\/sounds\/(\d+)/.exec(a.foreign_landing_url ?? "")?.[1];
  if (fromLanding) return fromLanding;
  for (const f of a.alt_files ?? []) {
    const m = /freesound\.org\/apiv2\/sounds\/(\d+)\//.exec(f.url);
    if (m) return m[1];
  }
  return undefined;
}

function sameAs(a: OvAudio): string[] | undefined {
  if (isFreesound(a)) {
    const id = freesoundId(a);
    return id ? [`freesound:${id}`] : undefined;
  }
  if (isWikimedia(a)) {
    const name = commonsFileName(a.url ?? undefined);
    return name ? [`wikimediacommons:${name}`] : undefined;
  }
  return undefined;
}

function licenseOf(a: OvAudio): License {
  const code = a.license?.toLowerCase();
  return (
    parseLicense(a.license_url) ??
    (code ? parseLicense(code === "cc0" || code === "pdm" ? code : `${code} ${a.license_version ?? ""}`) : undefined) ??
    license("LicenseRef-Unknown")
  );
}

function previewOf(a: OvAudio): string | undefined {
  const url = cleanFileUrl(a.url);
  if (!url) return undefined;
  const fmt = normFormat(a.filetype) ?? formatFromFilename(url);
  if (PLAYABLE.has(fmt)) return url;
  if (isWikimedia(a)) return commonsMp3Transcode(url) ?? url;
  return url;
}

export function toSample(a: OvAudio): Sample {
  const url = cleanFileUrl(a.url);
  const fileName = isWikimedia(a) ? commonsFileName(url) : undefined;
  const formats = [normFormat(a.filetype), ...(a.alt_files ?? []).map((f) => normFormat(f.filetype))].filter((f): f is string => !!f);
  const title = cleanText(a.title) || fileName || a.id;
  return makeSample({
    provider: "openverse",
    sourceName: "Openverse",
    nativeId: a.id,
    title,
    // Freesound titles are the uploaded file name; Commons gives it in the URL.
    filename: fileName ?? (isFreesound(a) ? title : undefined),
    url: a.foreign_landing_url || `${SITE}/audio/${a.id}`,
    author: a.creator || undefined,
    authorUrl: a.creator_url || undefined,
    tags: (a.tags ?? []).map((t) => t.name).filter(Boolean),
    genres: a.genres?.length ? a.genres : undefined,
    sourceCategories: a.audio_set?.title ? [a.audio_set.title] : undefined,
    durationSec: a.duration ? a.duration / 1000 : undefined,
    sampleRate: a.sample_rate || a.alt_files?.find((f) => f.sample_rate)?.sample_rate || undefined,
    previewUrl: previewOf(a),
    thumbnailUrl: a.thumbnail || undefined,
    formats: formats.length ? [...new Set(formats)] : undefined,
    license: licenseOf(a),
    attribution: a.attribution || undefined,
    price: { free: true },
    // Freesound originals need a Freesound login (OAuth); Commons files are public.
    requiresAccount: isFreesound(a),
    downloadable: !!url,
    sameAs: sameAs(a),
  });
}

function files(a: OvAudio): SampleFile[] {
  const out: SampleFile[] = [];
  const url = cleanFileUrl(a.url);
  if (url) {
    const fmt = normFormat(a.filetype) ?? formatFromFilename(url);
    // Freesound items point at Freesound's HQ mp3 preview; Commons items at the uploaded file.
    const role = isFreesound(a) ? "preview" : "original";
    out.push({
      url,
      filename: commonsFileName(url) ?? filenameFromUrl(url),
      format: fmt,
      role,
      sampleRate: a.sample_rate || undefined,
      sizeBytes: a.filesize || undefined,
    });
    if (role === "original" && !PLAYABLE.has(fmt)) {
      const mp3 = commonsMp3Transcode(url);
      if (mp3) out.push({ url: mp3, filename: filenameFromUrl(mp3), format: "mp3", role: "preview" });
    }
  }
  for (const f of a.alt_files ?? []) {
    if (!f.url) continue;
    const freesoundOriginal = /freesound\.org\/apiv2\/sounds\/\d+\/download\/?$/.test(f.url);
    const fmt = normFormat(f.filetype) ?? formatFromFilename(f.url);
    out.push({
      url: f.url,
      filename: freesoundOriginal && a.title ? cleanText(a.title) : filenameFromUrl(f.url),
      format: fmt,
      role: "original",
      sampleRate: f.sample_rate || undefined,
      sizeBytes: f.filesize || undefined,
      // Freesound's download endpoint needs the user's Freesound OAuth token: use the freesound:<id> sample instead.
      ...(freesoundOriginal ? { requiresAuth: true } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

function wantsShort(q: SampleQuery): boolean {
  if (q.maxDurationSec !== undefined && q.maxDurationSec <= 30) return true;
  return !!q.forms?.length && q.forms.every((f) => f === "one-shot");
}

function searchParams(q: SampleQuery, pageSize: number, page: number) {
  return {
    q: q.query.trim() || undefined,
    source: SOURCES,
    license: q.commercialOnly ? COMMERCIAL_LICENSES : undefined,
    length: wantsShort(q) ? "shortest" : undefined,
    filter_dead: "false",
    page_size: pageSize,
    page,
  };
}

export const openverse: Provider = {
  id: "openverse",
  name: "Openverse",
  homepage: SITE,
  description:
    "Keyless Creative Commons search over Freesound and Wikimedia Commons audio: licence and credit line per sound, Freesound previews without a Freesound key.",
  categories: ["drums", "bass", "vocals", "fx", "foley", "ambience", "keys", "guitar", "synth", "strings", "brass", "woodwind", "mallets", "other"],
  forms: ["one-shot", "loop", "phrase"],
  access: "api",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["commercialOnly", "freeOnly"],

  buildSearchUrl(q: SampleQuery) {
    return `${SITE}/search/audio${qs({
      q: q.query.trim(),
      source: SOURCES,
      license: q.commercialOnly ? COMMERCIAL_LICENSES : undefined,
      length: wantsShort(q) ? "shortest" : undefined,
    })}`;
  },

  async search(q, ctx) {
    const token = await bearer(ctx);
    const maxPage = token ? AUTH_PAGE_SIZE : ANON_PAGE_SIZE;
    const pageSize = Math.max(1, Math.min(q.limit, maxPage));
    const offset = Math.max(0, q.offset ?? 0);
    if (!token && offset >= ANON_RESULT_CAP) return { samples: [], searchUrl: this.buildSearchUrl(q) };
    const page = Math.floor(offset / pageSize) + 1;
    const skip = offset - (page - 1) * pageSize;
    let res: OvSearch;
    try {
      res = await get<OvSearch>(`${API}/audio/${qs(searchParams(q, pageSize, page))}`, ctx, token);
    } catch (e) {
      // Past the last page (or past the anonymous cap) Openverse answers 400/401/404.
      if (e instanceof HttpError && [400, 401, 404].includes(e.status) && page > 1) return { samples: [], searchUrl: this.buildSearchUrl(q) };
      throw e;
    }
    const samples = (res.results ?? [])
      .filter((a) => a?.id && !a.mature && (isFreesound(a) || isWikimedia(a)))
      .slice(skip, skip + q.limit)
      .map(toSample);
    return { samples, total: res.result_count, searchUrl: this.buildSearchUrl(q) };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nativeId)) return null;
    const token = await bearer(ctx);
    let a: OvAudio;
    try {
      a = await get<OvAudio>(`${API}/audio/${nativeId}/`, ctx, token);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
    if (!a?.id) return null;
    return { ...toSample(a), files: files(a) };
  },

  async census(ctx): Promise<SourceCensus> {
    const token = await bearer(ctx);
    const stats = await ctx.fetch.json<OvStat[]>(`${API}/audio/stats/`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      cacheTtlMs: 60 * 60_000,
      signal: ctx.signal,
    });
    const searched = new Set(SOURCES.split(","));
    const categories: Record<string, number> = {};
    let total = 0;
    for (const s of stats ?? []) {
      if (typeof s.media_count !== "number") continue;
      categories[s.display_name || s.source_name] = s.media_count;
      if (searched.has(s.source_name)) total += s.media_count;
    }
    return {
      total,
      free: total,
      byCategory: {},
      categories,
      mirror: true,
      unit: "samples",
      method:
        "Openverse /v1/audio/stats/: media counts of the sources we search (Freesound + Wikimedia Commons audio; Jamendo songs listed but not searched)",
    };
  },
};
