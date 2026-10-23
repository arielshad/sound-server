import { license, parseLicense } from "../core/licence.js";
import type { License, Provider, Sample, SampleDetails, SampleFile, SampleQuery } from "../core/types.js";
import { cleanText, formatFromFilename, makeSample, qs, wantsCategory } from "../core/util.js";

/**
 * ccMixter: a Creative Commons remix community and the best open source of a cappellas
 * (~6,000) plus sample/stem uploads (~16,000). Its public Query API answers in one request:
 * `https://ccmixter.org/api/query?f=json&tags=acappella&search=<words>&sort=rank&limit=&offset=`
 * (`f=count` gives counts, `ids=<upload_id>` one upload, `lic=` a licence family:
 * by | nc | sa | splus | zero | pd | open (= by + sa + zero) | safe (= open + splus)).
 *
 * Licences are per upload (CC BY, BY-NC, BY-SA, CC0, Sampling+…). Files are on
 * `ccmixter.org/content/<user>/…` and answer 403 without a Referer (206 with
 * `Referer: https://ccmixter.org/`), so files carry that header and previews are proxied.
 */

const SITE = "https://ccmixter.org";
const API = `${SITE}/api/query`;
const MAX_PAGE_SIZE = 50;
const SOURCE_NAME = "ccMixter";
const REFERER = { Referer: `${SITE}/` };

interface CcFile {
  file_name?: string;
  file_nicname?: string;
  download_url?: string;
  file_rawsize?: number;
  file_format_info?: { "media-type"?: string; "default-ext"?: string; sr?: string; ch?: string; ps?: string };
}

interface CcUpload {
  upload_id: number;
  upload_name?: string;
  user_name?: string;
  user_real_name?: string;
  file_page_url?: string;
  artist_page_url?: string;
  license_url?: string;
  license_name?: string;
  upload_tags?: string;
  upload_date_format?: string;
  upload_description_plain?: string;
  upload_extra?: { usertags?: string; ccud?: string; bpm?: string | number };
  files?: CcFile[];
}

const ARCHIVES = new Set(["zip", "rar", "7z"]);

function splitTags(s: string | undefined): string[] {
  return (s ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** "3:22" → 202 */
function seconds(ps: string | undefined): number | undefined {
  const m = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(ps ?? "");
  if (!m) return undefined;
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return s > 0 ? s : undefined;
}

function sampleRate(sr: string | undefined): number | undefined {
  const m = /^(\d+(?:\.\d+)?)k$/i.exec(sr ?? "");
  if (!m) return undefined;
  const k = Number(m[1]);
  return k === 44 ? 44100 : k === 22 ? 22050 : k === 11 ? 11025 : Math.round(k * 1000);
}

/** "Fri, Oct 9, 2026 @ 3:47 PM" → Date (site time, read as UTC). */
function parseDate(s: string | undefined): Date | undefined {
  const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?: @ (\d{1,2}):(\d{2}) ([AP]M))?/.exec(s ?? "");
  if (!m) return undefined;
  const month = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(m[1]!) / 3;
  if (month < 0 || !Number.isInteger(month)) return undefined;
  let hour = Number(m[4] ?? 0) % 12;
  if (m[6] === "PM") hour += 12;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5] ?? 0)));
}

function formatOf(f: CcFile): string {
  return (f.file_format_info?.["default-ext"] ?? formatFromFilename(f.file_name ?? f.download_url ?? "")).toLowerCase();
}

function licenseOf(u: CcUpload): License {
  return parseLicense(u.license_url) ?? parseLicense(u.license_name) ?? license("LicenseRef-Unknown");
}

function isAcappella(tags: string[]): boolean {
  return tags.includes("acappella");
}

function toSample(u: CcUpload): Sample {
  const tags = splitTags(u.upload_tags);
  const userTags = splitTags(u.upload_extra?.usertags);
  const files = (u.files ?? []).filter((f) => f.download_url);
  const audio = files.filter((f) => f.file_format_info?.["media-type"] === "audio" || ["mp3", "wav", "flac", "ogg", "aiff"].includes(formatOf(f)));
  const mp3 = audio.find((f) => formatOf(f) === "mp3");
  const main = audio[0];
  const bpmRaw = Number(u.upload_extra?.bpm);
  const acappella = isAcappella(tags);
  const hasArchive = files.some((f) => ARCHIVES.has(formatOf(f)));
  // Sample uploads are stem sets: several audio files, or a zip of them.
  const stems = !acappella && (audio.length >= 3 || hasArchive);
  const title = cleanText(u.upload_name) || `Upload ${u.upload_id}`;
  const date = parseDate(u.upload_date_format);
  const description = cleanText(u.upload_description_plain).slice(0, 300) || undefined;
  return makeSample({
    provider: "ccmixter",
    nativeId: String(u.upload_id),
    title,
    description,
    url: u.file_page_url || `${SITE}/files/${encodeURIComponent(u.user_name ?? "")}/${u.upload_id}`,
    author: cleanText(u.user_real_name || u.user_name) || undefined,
    authorUrl: u.artist_page_url,
    tags: userTags,
    sourceCategories: acappella ? ["acappella"] : tags.filter((t) => ["sample", "loops", "stem", "drums", "bass"].includes(t)),
    category: acappella ? "vocals.acapella" : undefined,
    form: acappella ? "phrase" : stems ? "pack" : undefined,
    unit: stems ? "pack" : undefined,
    packSize: stems && !hasArchive ? audio.length : undefined,
    bpm: Number.isFinite(bpmRaw) && bpmRaw >= 40 && bpmRaw <= 300 ? bpmRaw : undefined,
    durationSec: seconds(main?.file_format_info?.ps),
    sampleRate: sampleRate(main?.file_format_info?.sr),
    channels: main?.file_format_info?.ch === "stereo" ? 2 : main?.file_format_info?.ch === "mono" ? 1 : undefined,
    previewUrl: (mp3 ?? main)?.download_url,
    previewNeedsReferer: mp3 || main ? true : undefined,
    formats: [...new Set(files.map(formatOf).filter(Boolean))],
    license: licenseOf(u),
    price: { free: true },
    downloadable: files.length > 0,
    createdAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined,
    filename: main?.file_name,
    sourceName: SOURCE_NAME,
  });
}

/** Which ccMixter tag to search: a cappellas unless the query asks for instruments only. */
function nativeTag(q: SampleQuery): "acappella" | "sample" | undefined {
  const instruments = ["drums", "bass", "synth", "keys", "guitar"] as const;
  if (q.categories?.length) {
    if (wantsCategory(q, "vocals")) return "acappella";
    if (wantsCategory(q, ...instruments)) return "sample";
    return undefined;
  }
  const hints = q.hints ?? [];
  if (hints.length && !hints.some((h) => h.startsWith("vocals")) && hints.some((h) => instruments.some((i) => h === i || h.startsWith(`${i}.`)))) {
    return "sample";
  }
  return "acappella";
}

export const ccmixter: Provider = {
  id: "ccmixter",
  name: "ccMixter",
  homepage: SITE,
  description:
    "Creative Commons a cappellas (about 6,000) and remix stems from the ccMixter community; licence per upload (CC BY, BY-NC, CC0, Sampling+).",
  categories: ["vocals", "drums", "bass", "synth", "keys", "guitar"],
  forms: ["phrase", "loop", "pack"],
  access: "api",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["categories", "commercialOnly"],

  buildSearchUrl(q) {
    const text = q.query.trim();
    const tag = nativeTag(q) ?? "acappella";
    return text ? `${SITE}/search${qs({ search_text: text, search_type: "any", search_in: "uploads" })}` : `${SITE}/view/media/samples/${tag === "acappella" ? "acappellas" : "stems"}`;
  },

  async search(q, ctx) {
    const searchUrl = this.buildSearchUrl(q);
    const tag = nativeTag(q);
    if (!tag) return { samples: [], searchUrl };
    const limit = Math.max(1, Math.min(q.limit, MAX_PAGE_SIZE));
    const res = await ctx.fetch.json<CcUpload[]>(
      `${API}${qs({
        f: "json",
        tags: tag,
        search: q.query.trim() || undefined,
        // by + sa + zero; the aggregator drops the few share-alike ones locally.
        lic: q.commercialOnly ? "open" : undefined,
        sort: "rank",
        limit,
        offset: q.offset || undefined,
      })}`,
      { cacheTtlMs: 30 * 60_000, signal: ctx.signal },
    );
    const samples = (Array.isArray(res) ? res : []).filter((u) => u?.upload_id).map(toSample);
    return { samples, searchUrl };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    if (!/^\d{1,9}$/.test(nativeId)) return null;
    const res = await ctx.fetch.json<CcUpload[]>(`${API}${qs({ f: "json", ids: nativeId })}`, { cacheTtlMs: 60 * 60_000, signal: ctx.signal });
    const u = (Array.isArray(res) ? res : []).find((x) => String(x.upload_id) === nativeId);
    if (!u) return null;
    const sample = toSample(u);
    const files: SampleFile[] = (u.files ?? [])
      .filter((f) => f.download_url)
      .map((f) => {
        const format = formatOf(f);
        return {
          url: f.download_url!,
          filename: f.file_name ?? f.download_url!.split("/").pop()!,
          format,
          role: ARCHIVES.has(format) ? "pack" : "original",
          sampleRate: sampleRate(f.file_format_info?.sr),
          channels: f.file_format_info?.ch === "stereo" ? 2 : f.file_format_info?.ch === "mono" ? 1 : undefined,
          sizeBytes: f.file_rawsize || undefined,
          headers: { ...REFERER },
        } satisfies SampleFile;
      });
    return { ...sample, files };
  },

  async census(ctx) {
    const count = async (params: Record<string, string>): Promise<number> => {
      const r = await ctx.fetch.json<number[]>(`${API}${qs({ f: "count", ...params })}`, { cacheTtlMs: 60 * 60_000, signal: ctx.signal });
      const n = Array.isArray(r) ? Number(r[0]) : NaN;
      if (!Number.isFinite(n)) throw new Error("ccMixter count returned no number");
      return n;
    };
    const [acappella, sample, open] = await Promise.all([count({ tags: "acappella" }), count({ tags: "sample" }), count({ tags: "acappella", lic: "open" })]);
    return {
      total: acappella + sample,
      free: acappella + sample,
      byCategory: { vocals: acappella },
      byLicense: { "CC BY / BY-SA / CC0 (a cappellas)": open, "Other (a cappellas)": Math.max(0, acappella - open) },
      categories: { acappella, sample },
      unit: "samples",
      method: "ccMixter Query API f=count for tags=acappella and tags=sample (may overlap), and acappella with lic=open",
    };
  },
};
