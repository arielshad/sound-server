/**
 * Shared domain model for every sample source.
 *
 * Providers translate their native data into these shapes so the aggregator,
 * HTTP API and MCP server never need to know which site a sample came from.
 */
import type { Category, PitchClass, SampleForm } from "./vocab.js";

export type { Category, PitchClass, SampleForm } from "./vocab.js";

/**
 * How a provider is reached.
 * - api:    official/public JSON API, structured metadata and often direct files
 * - static: curated catalogue built from manifest files (JSON/zip lists), filtered locally
 * - scrape: HTML/WordPress/Shopify pages parsed into samples
 * - link:   site blocks automated access or forbids it; we only build deep search links
 */
export type AccessMethod = "api" | "static" | "scrape" | "link";

/** Pricing model of a source as a whole. */
export type Pricing = "free" | "freemium" | "paid";

/**
 * Can this be used in a commercially released track?
 * - yes:                 no conditions (CC0, public domain, royalty-free without credit)
 * - yes-with-credit:     yes, if you credit the author (CC-BY, some royalty-free sites)
 * - restricted:          conditions that usually rule out a normal release (share-alike, Sampling+)
 * - clearance-required:  a real recording that needs a paid clearance per release (Tracklib)
 * - check-terms:         unknown, uploader-asserted or subscription terms: read them first
 * - no:                  non-commercial only (CC-BY-NC, BBC RemArc, personal-use licences)
 */
export const COMMERCIAL_VERDICTS = ["yes", "yes-with-credit", "restricted", "clearance-required", "check-terms", "no"] as const;
export type CommercialVerdict = (typeof COMMERCIAL_VERDICTS)[number];

export interface License {
  /** SPDX id where one exists (CC0-1.0, CC-BY-4.0, CC-BY-NC-4.0…), else a `LicenseRef-*` id. */
  id: string;
  /** Short human name, e.g. "CC BY 4.0", "Royalty free (Mixkit licence)". */
  name: string;
  url?: string;
  commercialUse?: boolean;
  attributionRequired?: boolean;
  shareAlike?: boolean;
  /** May the sample itself be passed on (in a pack, a repo, a dataset)? Almost always false. */
  redistribution?: boolean;
  /**
   * Who states the licence:
   * - source:   the site records it per item (Freesound, Wikimedia)
   * - site:     one licence for the whole site (Mixkit, Kenney)
   * - uploader: an anonymous uploader asserted it, unverified (Internet Archive)
   */
  assertedBy: "source" | "site" | "uploader";
  verdict: CommercialVerdict;
  /** One line on why the verdict is what it is. */
  note?: string;
}

export interface Price {
  free: boolean;
  amount?: number;
  currency?: string;
}

export interface MusicalKey {
  tonic: PitchClass;
  mode: "major" | "minor";
}

export interface Sample {
  /** Globally unique id: `${provider}:${nativeId}`. */
  id: string;
  provider: string;
  nativeId: string;
  title: string;
  description?: string;
  /** Human-facing page for the sample on the source site. */
  url: string;
  author?: string;
  /** Link to the author's page on the source site. */
  authorUrl?: string;
  tags: string[];
  genres?: string[];
  /** Dot-path category ("drums.kick", "fx.riser"). Filled by the classifier when the source has none. */
  category: Category;
  /** How the category was decided and how sure we are (0..1). */
  categoryEvidence?: { by: "source" | "file" | "rules" | "model"; confidence: number };
  form?: SampleForm;
  /** What one listing is: one sound, a pack of many, or a playable instrument. */
  unit: "sample" | "pack" | "instrument";
  /** Number of sounds when unit is "pack" or "instrument". */
  packSize?: number;
  bpm?: number;
  key?: MusicalKey;
  /** MIDI note number of a pitched one-shot (60 = C4). */
  rootNote?: number;
  durationSec?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  loudnessLufs?: number;
  /** Always-playable lower quality file (mp3/ogg), for auditioning. */
  previewUrl?: string;
  /** True when the preview must be fetched with a Referer, so clients use /v1/samples/:id/preview. */
  previewNeedsReferer?: boolean;
  /** Pack artwork or a waveform image, when there is one. */
  thumbnailUrl?: string;
  /** File formats known to be available (lowercase, no dot): wav, aiff, flac, ogg, mp3, mid, zip… */
  formats?: string[];
  license?: License;
  /** Ready-to-paste credit line when the licence asks for attribution. */
  attribution?: string;
  price?: Price;
  /** True when getting the full-quality file needs an account on the source site. */
  requiresAccount?: boolean;
  /** True when `getSample` can return direct file URLs that `download` can fetch. */
  downloadable: boolean;
  createdAt?: string;
  /** Downloads or plays on the source, when published. */
  popularity?: number;
  /** Ids of the same sound on other providers (e.g. an Openverse item that mirrors Freesound). */
  sameAs?: string[];
  /** Relevance score assigned by the aggregator (0..1). */
  score?: number;
}

export interface SampleFile {
  url: string;
  filename: string;
  /** Lowercase extension without the dot: wav, aiff, flac, ogg, mp3, zip, mid… */
  format: string;
  /**
   * - original: the full-quality file as uploaded
   * - preview:  lower quality version for listening
   * - pack:     an archive of many samples
   * - stem / midi: parts of a construction kit
   */
  role: "original" | "preview" | "pack" | "stem" | "midi";
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  sizeBytes?: number;
  /** True when the URL needs the user to be logged in / pay / hold a token on the source site. */
  requiresAuth?: boolean;
  /**
   * Extra request headers the download needs (e.g. Referer). May carry an
   * Authorization header only when it came from the caller's own credentials
   * (ctx.credentials or a local env token). The HTTP API and MCP never return
   * `headers` to clients; they are used server-side to fetch the file.
   */
  headers?: Record<string, string>;
}

export interface SampleDetails extends Sample {
  files: SampleFile[];
}

export interface BpmRange {
  min?: number;
  max?: number;
}

export interface SampleFilters {
  /** Restrict to these categories; a parent ("drums") matches its children. */
  categories?: Category[];
  forms?: SampleForm[];
  bpm?: BpmRange;
  key?: { tonic: PitchClass; mode?: "major" | "minor" };
  maxDurationSec?: number;
  minDurationSec?: number;
  /** Only samples whose licence verdict is yes or yes-with-credit. */
  commercialOnly?: boolean;
  /** Exclude paid samples. */
  freeOnly?: boolean;
}

export interface SampleQuery extends SampleFilters {
  /** Free-text query, with BPM/key/form words already parsed out. May be empty to browse. */
  query: string;
  /** Category hints from the query words (used to steer native category filters, not to drop results). */
  hints?: Category[];
  /** Max results per provider. */
  limit: number;
  /** Page offset per provider (0-based item offset). */
  offset?: number;
}

export interface ProviderSearchResult {
  samples: Sample[];
  /** Total hits reported by the source if known. */
  total?: number;
  /** Link to the same search on the source website. */
  searchUrl?: string;
}

/** Filters a provider applies itself; the aggregator applies the rest locally. */
export type NativeFilter = "categories" | "forms" | "bpm" | "key" | "duration" | "commercialOnly" | "freeOnly";

export interface ProviderInfo {
  id: string;
  name: string;
  homepage: string;
  description: string;
  /** Top-level categories the source carries (drums, vocals, fx…). */
  categories: Category[];
  /** Forms it carries. Undefined = any. */
  forms?: SampleForm[];
  access: AccessMethod;
  pricing: Pricing;
  /** Default licence for the source's samples, if uniform. */
  license?: License;
  /** Env var holding an optional/required API key. */
  apiKeyEnv?: string;
  /** Whether this server can fetch the files for samples of this provider. */
  supportsDownload: boolean;
  /** Filters the provider applies at the source. */
  nativeFilters?: NativeFilter[];
}

/** One "notable" sample a census can point at (most downloaded, newest…). */
export interface CensusHighlight {
  label: string;
  title: string;
  url: string;
  value?: number;
}

/**
 * What a source holds, counted by `Provider.census` (run daily, see
 * scripts/census.mjs). Every count is the source's own number of listings.
 */
export interface SourceCensus {
  /** Every listing on the source (free and paid). */
  total: number;
  /** True when a number is a lower bound (the source caps its counts). */
  atLeast?: boolean;
  /** Free listings, when known. */
  free?: number;
  /** Listings per top-level category; each listing counts once. */
  byCategory: Partial<Record<Category, number>>;
  /** Listings per licence id, when the source mixes licences. */
  byLicense?: Record<string, number>;
  /** The source's own categories or tags (may overlap). */
  categories?: Record<string, number>;
  /** What a listing is on this source. */
  unit?: "samples" | "packs";
  /** Listings released in the 30 days before the count, when the source dates them. */
  addedLast30Days?: number;
  /** Total downloads, when the source publishes them. */
  downloads?: number;
  highlights?: CensusHighlight[];
  /** One line on how this was counted. */
  method: string;
}

export interface ProviderContext {
  fetch: HttpClient;
  signal?: AbortSignal;
  /** Per-request credentials a caller passed in (e.g. a user's own Freesound OAuth token). Never logged. */
  credentials?: Record<string, string>;
}

export interface Provider extends ProviderInfo {
  /** Search the source. Link-only providers return an empty list plus `searchUrl`. */
  search(query: SampleQuery, ctx: ProviderContext): Promise<ProviderSearchResult>;
  /** Fetch full details, including downloadable files when possible. */
  getSample?(nativeId: string, ctx: ProviderContext): Promise<SampleDetails | null>;
  /** Deep link to run the query on the source website. */
  buildSearchUrl(query: SampleQuery): string;
  /** Count what the source holds (a few requests; run daily, not per search). */
  census?(ctx: ProviderContext): Promise<SourceCensus>;
  /** Whether the provider is usable right now (e.g. API key configured). */
  isEnabled?(): boolean;
}

export interface HttpClient {
  json<T = unknown>(url: string, init?: HttpRequestInit): Promise<T>;
  text(url: string, init?: HttpRequestInit): Promise<string>;
  raw(url: string, init?: HttpRequestInit): Promise<Response>;
}

export interface HttpRequestInit {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  signal?: AbortSignal;
  /** Cache TTL in ms for GET/POST-JSON responses (text/json only). 0 disables. */
  cacheTtlMs?: number;
  /**
   * For `raw` downloads: abort when no bytes arrive for this long (ms), instead of
   * capping the whole transfer. Large packs on slow CDNs need this.
   */
  idleTimeoutMs?: number;
  /** Override the client's request timeout (ms) for a slow source. */
  timeoutMs?: number;
  /** "manual" returns 3xx responses instead of following them (downloads re-check every hop). */
  redirect?: "follow" | "manual";
}
