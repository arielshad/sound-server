# 3d-asset-server: reuse map for a sibling "sound-server"

Repo: `/home/user/3d-asset-server` (read-only survey, nothing modified). 56 commits, most of them bot commits (deploy pins, census, integrations).
Size: `src/` about 10.6k lines of TS, `test/` about 4k, `web/src` about 4.1k (plus generated JSON), `scripts/` about 900, workflows about 700.
`node_modules` is not installed in the checkout, so the tests were **not** run. Every finding comes from reading the source.

Classification legend:
- **A**: domain-agnostic. Copy as is or nearly (rename the strings).
- **B**: reusable, with the audio changes listed next to it.
- **C**: 3D-specific. Replace entirely.

---

## 0. Classification at a glance

| Area | Files | Class | One-line reason |
|---|---|---|---|
| Domain model | `src/core/types.ts` | **B** | Provider contract is generic. Asset fields, AssetType and AssetFile are 3D-flavoured. |
| HTTP client | `src/core/http.ts` | **A** | LRU cache, in-flight dedupe, timeout, HttpError. |
| Text utils / ranking primitives | `src/core/util.ts` | **B** | tokenize, stem, matchScore, paginate and qs are generic. TYPE_KEYWORDS, KNOWN_FORMATS and RELATED_TYPES are 3D. |
| Aggregator | `src/core/service.ts` | **A/B** | Fan-out, timeouts, per-source status and rankResults are generic. Only the filter fields change. |
| Download pipeline | `src/core/download.ts` | **B** | Path safety, SSRF guard, streaming zip and extraction are generic. `selectFiles` and DEFAULT_FORMATS (glTF and resolution logic) must be rewritten. |
| Census | `src/core/census.ts` | **A** | Helpers plus aggregate. Only `byType` keys change. |
| Collections | `src/core/collections.ts` | **B** | Stable snapshot merge is generic. SnapshotAsset fields and the thumbnail requirement are 3D. |
| Analytics / Prometheus | `src/core/analytics.ts` | **A** | Rename metric prefix `asset_server_` and the `type` label. |
| Stats (/v1/stats) | `src/core/stats.ts` | **A** | PromQL uses metric names; rename them. |
| Network / ASN classifier | `src/core/network.ts` | **A** | Copy as is (change the cache dir name). |
| Install telemetry (Umami) | `src/core/telemetry.ts` | **A** (policy decision) | Hard-coded website ID and host. Decide whether to keep it on by default. |
| HTTP app | `src/api/app.ts` | **A/B** | Routes, middleware, MCP mount and site serving are generic. Search/file param schemas and the JSON index text are 3D. |
| Rate limit | `src/api/ratelimit.ts` | **A** | |
| Content negotiation | `src/api/negotiate.ts` | **A** | |
| Static site server + CSP | `src/api/site.ts` | **A** (+1 change) | Add `media-src` to the CSP for audio previews. The Markdown 404 text says "3D". |
| Share metadata | `src/api/search-meta.ts` | **B** | Type labels and copy are 3D. The mechanism is generic. |
| OG endpoints | `src/api/og.ts` | **A/B** | Cache and concurrency limiter are generic. Card content depends on the asset. |
| OG renderer | `src/og/render.ts` | **B** | satori/resvg/sharp pipeline is generic. Logo, brand and colours are 3D. Audio assets rarely have thumbnails, so add a waveform card. |
| OpenAPI | `src/api/openapi.ts` | **B** | Hand-written. All examples, params and Asset schema fields are 3D. |
| MCP server | `src/mcp/server.ts` | **B** | Tool plumbing is generic. Tool names, descriptions, params and summarizeAsset are 3D. |
| MCP attribution | `src/mcp/attribution.ts` | **A** | |
| CLI | `src/cli.ts` | **A/B** | Env var names, help text and the `search` output columns change. |
| Providers (25) | `src/providers/*` | **C** (mostly) | Replace. `link.ts` (factory) is **A**. Kenney, OpenGameArt, itch.io, Wikimedia Commons and Fab have audio sections and could become **B** sources. |
| Tests infra | `test/helpers.ts`, `test/fakes.ts`, `vitest.config.ts` | **A/B** | fixtureHttp is generic. The fake assets are 3D. |
| Core tests | `test/service, stats, telemetry, network, attribution, census, collections, *-gate, integrations, og, site-build` | **B** | Port with renamed types and fixtures. |
| Census / collections / export scripts | `scripts/*.mjs`, `scripts/lib/topics.mjs` | **A/B** | ASSET_TYPES and FILLER words are duplicated in there. Grafana/Loki URLs are hard-coded. |
| Agent prompts | `prompts/*.md` | **B** | Process is reusable. The content ("3D asset website", hub names) needs a rewrite. |
| Integrations registry | `integrations/registry.json` | **C** (data) | Start empty. Keep the schema. |
| Web (Astro) shell, layouts, UI kit, stats, docs plumbing | `web/` | **A/B** | Framework and plumbing are generic. Copy, hubs, collections and the search/detail UI are 3D. |
| Collection content | `web/src/content/collections/*`, `web/src/data/collections/*`, `collection-hubs.json` | **C** | |
| Generated data | `web/src/data/{providers,integrations,openapi,catalog,catalog-history}.json` | **C** (regenerated) | |
| CI / release / census / discovery / drafting workflows | `.github/workflows/*` | **A/B** | Mostly generic. Prompts, names and the `namespace="asset-server"` Loki selector change. |
| Docker | `Dockerfile`, `.dockerignore` | **A** | |
| Deploy (kustomize + ArgoCD) | `deploy/*` | **B** | Rename namespace, host, image, Umami ID and env. |
| Docs | `README.md`, `docs/PROVIDERS_GUIDE.md`, `docs/SEO-GEO-AUDIT.md`, `docs/images/*.svg`, `context7.json` | **B/C** | PROVIDERS_GUIDE is mostly generic. Do not copy the SEO audit or the SVGs. |

---

## 1. Stack and package.json

Root `package.json` (name `3d-asset-server`, v0.1.0, ESM, Apache-2.0, Node >=20, bin `3d-asset-server` → `dist/cli.js`, npm provenance).

Scripts:
- `build` = `build:server` (tsc via `tsconfig.build.json`, then copy `src/og/fonts` to `dist/og/fonts`) + `build:web` (`scripts/export-site-data.mjs`, then `npm --prefix web run build`, then copy `web/dist` to `dist/web`).
- `dev` = `tsx watch src/cli.ts serve`. `start` / `mcp` run `dist/cli.js`.
- `typecheck` = `tsc --noEmit && astro check`.
- `test` = `vitest run`. `test:live` = `LIVE=1 vitest run test/live`.

Runtime dependencies (locked versions):

| Package | Version | Used for |
|---|---|---|
| `hono` | ^4.13.13 | HTTP router/app (`src/api/app.ts`), `hono/compress`, `hono/cors` |
| `@hono/node-server` | ^2.1.3 | `serve()` in the CLI; `getConnInfo` for the client IP in ratelimit |
| `@modelcontextprotocol/sdk` | ^1.32.0 | `McpServer`, `StdioServerTransport`, `WebStandardStreamableHTTPServerTransport` |
| `zod` | ^4.6.5 | Query-param validation (API) and MCP tool input schemas; `z.prettifyError` |
| `lru-cache` | ^11.5.3 | HTTP response cache in `core/http.ts` |
| `cheerio` | ^1.2.0 | HTML parsing in scraped providers |
| `fflate` | ^0.8.3 | Streaming zip (`Zip`, `ZipPassThrough`) for bundles; `unzipSync` for extraction |
| `prom-client` | ^15.1.3 | Prometheus metrics registry |
| `mmdb-lib` | ^3.0.3 | Reads the MaxMind GeoLite2-ASN database for the caller-network label |
| `satori` | 0.35.0 (pinned exactly) | Lays out the OG card (JSX-like tree → SVG) |
| `@resvg/resvg-js` | ^2.6.2 | Rasterises the SVG to PNG |
| `sharp` | ^0.34.5 | Decodes and resizes thumbnails to JPEG for OG cards (native dependency, adds image weight) |

Dev dependencies: `typescript ^7.0.2` (the tsgo native compiler; note the web uses TS ^6.0.3), `tsx ^4.23.15`, `vitest ^5.0.3`, `@types/node ^26.6.4`, `yaml ^2.9.1` (used by `scripts/lib/topics.mjs` to parse topic frontmatter, so it is a runtime dependency of the scripts).

TS config: ES2022, NodeNext, strict, `noUncheckedIndexedAccess`, `resolveJsonModule`. `rootDir: .` for typecheck (src+test); the build uses `rootDir: src`.

Web `web/package.json` (`3d-asset-server-web`, private):

| Package | Version | Used for |
|---|---|---|
| astro | ^7.3.5 | Site framework |
| @astrojs/react | ^7.0.0 | React islands |
| @astrojs/sitemap | ^3.7.4 | Sitemap |
| @astrojs/check | ^0.9.10 | Type checking |
| react, react-dom | ^19.3.0 | Islands: SearchApp, AssetDetail, StatsDashboard, AgentSetup, CopyQuote |
| tailwindcss, @tailwindcss/vite | ^4.3.3 | Styling |
| @tailwindcss/typography | ^0.5.20 | Typography plugin |
| tw-animate-css | ^1.4.0 | Animations |
| radix-ui | ^1.6.7 | shadcn/ui primitives (`components.json`: new-york, zinc) |
| class-variance-authority, clsx, tailwind-merge | 0.7.1 / 2.1.1 / 3.7.0 | shadcn utilities |
| `cn` | ^0.4.0 | Looks spurious, since `lib/utils.ts` has its own `cn` |
| lucide-react | ^1.52.0 | Icons |
| motion | ^14.0.0 | Magic-UI style animations (animated grid, border beam, marquee, shiny text) |
| @fontsource-variable/geist, geist-mono | ^5.3.0 | Fonts |
| @scalar/api-reference | ^1.72.4 | API playground; self-hosted bundle copied by `agent-files.mjs` |
| get-nonce | ^1.0.1 | Passes the per-request CSP nonce to Radix's scroll-lock `<style>` |
| typescript | ^6.0.3 | |

---

## 2. Core types (`src/core/types.ts`), quoted in full

This file is the contract to adapt.

```ts
/**
 * Shared domain model for every asset source.
 *
 * Providers translate their native data into these shapes so the aggregator,
 * HTTP API and MCP server never need to know which site an asset came from.
 */

export const ASSET_TYPES = [
  "model",
  "texture",
  "material",
  "hdri",
  "sprite",
  "ui",
  "audio",
  "font",
  "pack",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/**
 * How a provider is reached.
 * - api:    official/public JSON API, structured metadata and often direct files
 * - scrape: HTML/WordPress pages parsed into assets
 * - link:   site blocks automated access; we only build deep search links
 */
export type AccessMethod = "api" | "scrape" | "link";

/** Pricing model of a source as a whole. */
export type Pricing = "free" | "freemium" | "paid";

export interface License {
  /** Short identifier, e.g. "CC0", "CC-BY-4.0", "Royalty Free", "Custom". */
  name: string;
  url?: string;
  commercialUse?: boolean;
  attributionRequired?: boolean;
}

export interface Price {
  free: boolean;
  amount?: number;
  currency?: string;
}

export interface Asset {
  /** Globally unique id: `${provider}:${nativeId}`. */
  id: string;
  provider: string;
  nativeId: string;
  title: string;
  description?: string;
  type: AssetType;
  tags: string[];
  categories?: string[];
  /** Human-facing page for the asset on the source site. */
  url: string;
  thumbnailUrl?: string;
  author?: string;
  license?: License;
  price?: Price;
  /** File formats known to be available (lowercase, no dot): glb, fbx, blend, png, exr... */
  formats?: string[];
  /** Max texture resolutions available, e.g. ["1k","2k","4k"]. */
  resolutions?: string[];
  polyCount?: number;
  animated?: boolean;
  rigged?: boolean;
  /** True when `getAsset` can return direct file URLs that `download` can fetch. */
  downloadable: boolean;
  createdAt?: string;
  /** Relevance score assigned by the aggregator (0..1). */
  score?: number;
}

export interface AssetFile {
  url: string;
  filename: string;
  /** Lowercase extension without the dot: glb, gltf, fbx, blend, zip, png, jpg, exr, hdr... */
  format: string;
  /** e.g. "1k", "2k", "4k", "8k". */
  resolution?: string;
  /** Texture map role when the file is a single map: diffuse, normal, roughness, ... */
  mapType?: string;
  sizeBytes?: number;
  /** Optional free-form grouping, e.g. "gltf", "blend", "textures", "archive". */
  group?: string;
  /**
   * Companion files that must sit next to this one (e.g. a .gltf's .bin and textures).
   * `path` is relative to the main file's directory.
   */
  includes?: { path: string; url: string; sizeBytes?: number }[];
  /** True when the URL needs the user to be logged in / pay on the source site. */
  requiresAuth?: boolean;
}

export interface AssetDetails extends Asset {
  files: AssetFile[];
}

export interface SearchQuery {
  /** Free-text query. May be empty to browse. */
  query: string;
  /** Restrict to these asset types. Empty/undefined = any. */
  types?: AssetType[];
  /** Exclude paid assets. */
  freeOnly?: boolean;
  /** Max results per provider. */
  limit: number;
  /** Page offset per provider (0-based item offset). */
  offset?: number;
}

export interface ProviderSearchResult {
  assets: Asset[];
  /** Total hits reported by the source if known. */
  total?: number;
  /** Link to the same search on the source website. */
  searchUrl?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  homepage: string;
  description: string;
  assetTypes: AssetType[];
  access: AccessMethod;
  pricing: Pricing;
  /** Default license for the source's assets, if uniform. */
  license?: License;
  /** Env var holding an optional/required API key. */
  apiKeyEnv?: string;
  /** Whether this server can fetch the files for assets of this provider. */
  supportsDownload: boolean;
}

/** One "notable" asset a census can point at (most downloaded, newest…). */
export interface CensusHighlight {
  label: string;
  title: string;
  url: string;
  value?: number;
}

/**
 * What a source holds, counted by `Provider.census` (run daily, see
 * scripts/census.mjs). Every count is the source's own number of listings:
 * single assets on most sites, packs on Kenney, Quaternius and itch.io.
 */
export interface SourceCensus {
  /** Every listing on the source (free and paid). */
  total: number;
  /** True when a number is a lower bound (the source caps its counts, e.g. 10,000). */
  atLeast?: boolean;
  /** Free listings, when known. */
  free?: number;
  /** Listings per asset type; each listing counts once. */
  byType: Partial<Record<AssetType, number>>;
  /** Listings per licence, when the source mixes licences. */
  byLicense?: Record<string, number>;
  /** The source's own categories or tags (may overlap). */
  categories?: Record<string, number>;
  /** What a listing is on this source. */
  unit?: "assets" | "packs";
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
}

export interface Provider extends ProviderInfo {
  /** Search the source. Link-only providers return an empty list plus `searchUrl`. */
  search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderSearchResult>;
  /** Fetch full details, including downloadable files when possible. */
  getAsset?(nativeId: string, ctx: ProviderContext): Promise<AssetDetails | null>;
  /** Deep link to run the query on the source website. */
  buildSearchUrl(query: SearchQuery): string;
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
  /** Cache TTL in ms for GET responses (text/json only). 0 disables. */
  cacheTtlMs?: number;
}
```

Related types defined elsewhere that are part of the effective contract:
- `service.ts`: `SearchRequest`, `ProviderStatus = "ok"|"error"|"timeout"|"skipped"|"link"`, `ProviderSearchReport`, `SearchResponse`.
- `download.ts`: `FileSelection`, `DownloadOptions`, `DownloadResult`.
- `census.ts`: `Catalog`, `CatalogSource`, `CountWithBound`, `CatalogHistoryPoint`.
- `collections.ts`: `CollectionSearch`, `SnapshotAsset`, `CollectionSnapshot`.

```ts
// service.ts
export interface SearchRequest {
  query: string; types?: AssetType[]; providers?: string[]; freeOnly?: boolean;
  downloadableOnly?: boolean; limit?: number; offset?: number; timeoutMs?: number;
}
export type ProviderStatus = "ok" | "error" | "timeout" | "skipped" | "link";
export interface ProviderSearchReport {
  provider: string; name: string; status: ProviderStatus; count: number;
  total?: number; searchUrl?: string; error?: string; tookMs: number;
}
export interface SearchResponse { query: string; types?: AssetType[]; results: Asset[]; providers: ProviderSearchReport[]; }

// download.ts
export interface FileSelection { resolution?: string; format?: string; mapTypes?: string[]; all?: boolean; }
export interface DownloadOptions { extract?: boolean; maxBytes?: number; overwrite?: boolean; }
export interface DownloadResult { directory: string; files: string[]; bytes: number; }
```

### Proposed audio adaptation of the contract (B)

- **`AssetType`**: replace with sample-oriented kinds. Keep `kind` and `instrument` orthogonal; one flat enum mixing "loop" and "kick" will not filter well. For example:
  - `ASSET_TYPES = ["one-shot","loop","pack","midi","preset","stem","track","ambience","sfx","other"]` (the "what kind of file" dimension).
  - A separate `INSTRUMENTS` vocabulary: `kick, snare, clap, hihat, cymbal, perc, tom, 808, bass, synth, pad, lead, keys, piano, guitar, strings, brass, vocal, chop, fx, riser, impact, foley, texture, drum-loop, top-loop, ...`.
  - `RELATED_TYPES` (texture↔material today) becomes e.g. `sfx↔one-shot`, `ambience↔sfx`.
- **`Asset`**:
  - Drop `resolutions`, `polyCount`, `animated` and `rigged`.
  - Add `bpm?: number`, `key?: string` (normalised, e.g. "C#m" / "F major"), `durationSec?: number`, `sampleRate?: number`, `bitDepth?: number`, `channels?: 1|2`, `loop?: boolean`, `instrument?: string[]`, `genres?: string[]`, `previewUrl?: string` (mp3/ogg to play in the browser), `waveformUrl?: string`, and `fileCount?: number` (packs).
  - Keep `thumbnailUrl`: it is optional and many audio sources only have pack art.
- **`AssetFile`**:
  - Drop `resolution`, `mapType` and (mostly) `includes`. `includes` is still handy for a sample plus its `.mid`, or a stem set.
  - Add `sampleRate?`, `bitDepth?`, `channels?`, `durationSec?`, `bpm?`, `key?` and a `role?: "original"|"preview"|"stem"|"midi"|"pack"`.
  - Keep `format` and `group` (e.g. "wav-24", "mp3-preview", "archive"), `sizeBytes` and `requiresAuth`.
- **`SearchQuery` / `SearchRequest`**: add `bpm?: {min?, max?}` (with half and double-time tolerance), `key?: string` (with compatible-keys matching), `maxDurationSec?`, `loop?: boolean` / `oneShot?`, `instruments?: string[]`, `genres?: string[]`, `minSampleRate?` and `license?: "cc0"|"commercial"` (audio licences such as CC-BY-NC matter much more).
  - Providers must translate these into native filters where the source supports them (Freesound's `filter=` syntax does). Otherwise filter locally.
  - Also add a query parser for "120 bpm", "C minor" and "one shot" phrases.
- **`License`**: add `nonCommercial?: boolean` and `noRedistribution?: boolean` (or `notes?`). Sample libraries typically allow use inside music but forbid redistributing the raw samples. `freestylized.ts` already stuffs an untyped `notes` field into a License object, which only compiles because of how the object is typed.
- **`SourceCensus.unit`**: add `"samples"` alongside `"assets"|"packs"`.
- **Provider interface, HttpClient, ProviderContext, AccessMethod, Pricing, census and `isEnabled`**: keep unchanged. `isEnabled` is declared but no 3D provider implements it. Freesound (API key required) would be its first user.

---

## 3. `src/core/*`

### 3.1 `core/http.ts` (A)
**What it does**: one `HttpClient` used by every provider: `raw` / `text` / `json`. It sets a UA (`ASSET_SERVER_USER_AGENT`, default `Mozilla/5.0 (compatible; 3d-asset-server/0.1; +https://github.com/arielshad/3d-asset-server)`), browser-ish Accept headers and `redirect: follow`. Each request gets a timeout `AbortSignal.timeout(ASSET_SERVER_HTTP_TIMEOUT_MS ?? 15000)`, merged with the caller's signal via `AbortSignal.any`. On a non-2xx response it drains the body and throws `HttpError(status,url)`.

**Caching**:
- An LRU (`max 500`, `maxSize 64 MB` by string length) caches GET bodies for `text`/`json` only (never `raw`).
- TTL is `cacheTtlMs` per call, default `ASSET_SERVER_CACHE_TTL_MS ?? 10 min`. 0 disables it.
- Cache key = url + JSON(headers), so an `authorization` header partitions the cache.
- An **in-flight map** dedupes concurrent identical GETs, which matters when many searches hit one catalogue.

**Exports**: `USER_AGENT`, `HttpError`, `createHttpClient({timeoutMs,cacheTtlMs,cacheSize,fetchImpl})`.

**For audio**: rename the UA and env prefix. Consider a separate, smaller cache for detail calls. **Never cache signed download URLs**: BlenderKit passes `cacheTtlMs: 0`, and Freesound OAuth download URLs need the same.

### 3.2 `core/util.ts` (B)
**Exports**:
- `LICENSES.CC0` / `CC_BY_4`
- `assetId`, `parseAssetId` (splits on the first `:`)
- `tokenize` (NFKD, unicode letters/digits), `stem` (crude plural stripping)
- `matchScore(item, query)`. Per query token: title hit 1, tag/category 0.7, description 0.35, title prefix/substring 0.5, tag prefix 0.3. The sum is divided by the number of tokens. An empty query returns 1.
- `filterLocal(items,q,minScore=0.34)` (type filter, score, sort), `paginate`
- `typeMatches`/`wantsType` with `RELATED_TYPES` (texture↔material)
- `inferType` from regex `TYPE_KEYWORDS`
- `KNOWN_FORMATS`, `formatFromFilename` (jpeg→jpg), `isKnownFormat`, `filenameFromUrl`, `absoluteUrl`, `cleanText`, `uniq`, `compact`
- `makeAsset` (adds id, lowercases and dedupes tags, drops undefined), `qs` (skips empty values)

**For audio**:
- Rewrite `TYPE_KEYWORDS` (kick|snare|hat|clap|loop|one[- ]?shot|vocal|chop|riser|impact|whoosh|foley|ambience|pad|bass|808|midi|preset).
- `KNOWN_FORMATS` becomes wav, aif/aiff, flac, mp3, ogg, opus, m4a, mid/midi, rx2/rex, sfz, zip, rar, 7z, plus preset formats as needed. Map `aif`→`aiff`, `midi`→`mid` in `formatFromFilename`.
- Add LICENSES for CC-BY-NC-4.0, CC-BY-3.0 and the Sampling+ legacy licence (Freesound has older CC licences).
- `stem()` is English-only, fine. Add music-term normalisation ("hi-hat"/"hihat"/"hh", "drum loop", "fx"/"sfx").

### 3.3 `core/service.ts` (A/B): the aggregator
**What it does**: `AssetService` holds providers (a Map keeps the registration order) and a shared `HttpClient`. `search()` does the following:
1. Clamps `limit` to 1..100 (default 24). Each provider is asked for `min(limit,50)` items so the merge has candidates to choose from.
2. Throws `UnknownProviderError` for unknown ids in `providers`.
3. For each provider, in parallel:
   - **skip** with a reason if: not in the allow-list (silently omitted, no report), `isEnabled()` is false ("disabled (set KEY)"), it has none of the requested types, `downloadableOnly` is set and it doesn't support downloads, or `freeOnly` is set and it is a paid-only source.
   - Otherwise calls `p.search(q, {fetch, signal: AbortSignal.timeout(timeoutMs)})` wrapped in `withTimeout` (rejects when the signal aborts, even if the provider ignores the signal).
   - Default timeout per provider is `ASSET_SERVER_PROVIDER_TIMEOUT_MS ?? 12000`.
   - Post-filters `downloadable` / `free`.
   - Writes a `ProviderSearchReport`: status `ok`, `link` (for access=link), `timeout` or `error` (with message), plus `count`, `total`, `searchUrl` and `tookMs`.
4. Sorts reports into registration order. Ranks the results with `rankResults` and slices them to `limit`.

`getAsset(id)` parses `provider:nativeId`. It throws `InvalidAssetIdError`, `UnknownProviderError`, or `UnsupportedError` (no getAsset, which becomes HTTP 501). The timeout is 2× the default.

**Ranking algorithm `rankResults`** (exported, tested):
```
score = 0.6*matchScore(asset, query) + 0.2*(1/(1+rank*0.15)) + 0.1*ACCESS_WEIGHT[access] (api 1, scrape .8, link 0)
      + 0.05*(free?1:0) + 0.05*(downloadable?1:0)
```
Then a **diversity penalty** is applied: the n-th result from the same provider is multiplied by 0.93^n, and the list is re-sorted. The score is rounded to 3 decimals.

There is **no cross-provider de-duplication**, even though the OpenAPI doc says "Merged, ranked and de-duplicated". The web UI dedupes by id across pages.

**Pagination**: `offset` is *per provider* ("page deeper into every source"), not a global cursor. Page 2 of a merged list is therefore approximate. The UI keeps a `seen` set and shows "Load more" while any source returned a full page.

**For audio**: unchanged mechanics. Add the new filters to `SearchRequest` and the skip rules (e.g. skip providers that can't filter bpm when a bpm filter is set, or filter locally). Consider adding metadata-match terms (bpm/key closeness) to the score, and a de-dupe step: the same sample is often mirrored, e.g. Freesound content re-hosted.

### 3.4 `core/download.ts` (B): download pipeline
**`selectFiles(asset, {format,resolution,mapTypes,all})`**:
- Drops `requiresAuth` files and returns everything if `all` is set or there is ≤1 file.
- **Format**: an explicit format matches `format` or `group`. Otherwise it picks the first format from `DEFAULT_FORMATS[asset.type]` that is present: model: glb>gltf>fbx>obj>blend>zip>usd; hdri: hdr>exr>zip>jpg; texture: jpg>png>zip>exr; **audio: zip>ogg>wav>mp3**; and so on.
- **Map filter**: by `mapTypes` substrings.
- **Resolution**: picks the closest to the requested value (default **2k**; ties go to the smaller one). Then it keeps only the first package group when several groups share a format, and keeps a single zip when only zips remain.

**`expandFiles`** flattens main files and their `includes` into `{path,url}` items, de-duplicated by path.

**Path safety**:
- `safeRelative()` normalises `\`→`/`, drops `.` and empty segments, and **throws on `..`** or empty paths.
- `downloadFiles` additionally checks that `resolve(root,path)` stays under the root.
- `extractZip` silently skips zip-slip entries and `__MACOSX/`.
- `assetFolderName` = `<provider>-<basename(nativeId) sanitised to [\w.-], max 80>`.

**SSRF guard `assertPublicUrl`**: only http/https. It refuses localhost/`.local`/`.internal`/GCP metadata hostnames and literal private IPv4/IPv6 addresses. It does **not** resolve DNS, so a hostname that resolves to a private IP passes. Redirects are followed by `http.raw` without re-checking each hop. Only `og/render.ts fetchImage` re-checks every redirect.

**`downloadFiles(http, files, dest, {extract,maxBytes,overwrite})`**:
- Pre-checks the known total size against `maxBytes` (`ASSET_SERVER_MAX_DOWNLOAD_BYTES`, default 2 GiB).
- Streams each file through a counting `TransformStream` that errors once the running total exceeds the limit.
- Deletes a partial file on failure and skips existing files unless `overwrite` is set.
- If `extract` is set and the file is a `.zip`, it extracts next to it into a folder named after the zip, then deletes the zip.
- Extraction is **`unzipSync` of the whole file in memory**: no streaming, no decompressed-size cap and no entry-count cap, so a zip bomb is possible.

**`zipStream(http, files, folder)`**: builds a `ReadableStream` zip with fflate `Zip` + `ZipPassThrough` (store, no recompression). It fetches the entries **sequentially** and pipes each body chunk by chunk. It has **no byte cap** and no per-file timeout beyond the HTTP client's 15 s (which only covers time to headers in practice, since `AbortSignal.timeout` also aborts the body read after 15 s). Large files can therefore fail mid-stream after 15 s, which is a likely latent bug for big HDRIs and sample packs. The ingress allows 600 s.

**Helpers**: `totalBytes` (undefined if any size is unknown), `formatBytes`.

**For audio**: replace `DEFAULT_FORMATS` and the resolution logic with a **quality picker**:
- Prefer lossless: wav > aiff > flac, then ogg > mp3. Closest to 44.1/48 kHz and 24-bit unless asked otherwise. Never pick `role: "preview"` unless it is the only file.
- Add `sampleRate` / `bitDepth` / `channels` fields to `FileSelection`.
- Pack handling matters more than for 3D. Sample packs are commonly one big zip (100 MB–2 GB). Consider:
  - streaming unzip to disk (yauzl / fflate streaming `Unzip`) with decompressed-size and entry-count caps;
  - an optional "only audio and licence files" filter;
  - folder flattening options.
- Fix the 15 s body timeout for big files: use a separate long timeout for `raw` downloads.

### 3.5 `core/census.ts` (A)
**What it does**: shared helpers plus the daily aggregate.
- Helpers:
  - `mapLimit` (bounded concurrency, keeps order)
  - `countBy`, `top(record,n)`, `addedSince(dates, now, 30)` (accepts unix seconds or ms, or ISO)
  - `tallyAssets` / `catalogueCensus(p,ctx,unit)` (runs `p.search({query:"",limit:100000})` for catalogue-based sources)
  - `wpTotal` (reads the `X-WP-Total` header)
  - `parseCount(text, re)` ("118,384 results")
- `runCensus(providers, ctx, {previous, now, timeoutMs=90s, log})` calls every provider's `census` in parallel. A failure keeps the previous count, marked `stale: {since,error}`.
- Totals: `listings`, `free`, `cc0`, `directDownload` (free on downloadable sources), `addedLast30Days`, `sourcesCounted`, `sourcesLinked`. Also `byType`, `byLicense` (top 20) and `CountWithBound` with `atLeast` lower bounds. `linked[]` = providers without a census.
- `appendHistory` keeps one point per UTC day, up to 730.

**For audio**: unchanged apart from the type keys. Optionally add duration totals (hours of audio) and a "samples" unit.

### 3.6 `core/collections.ts` (B)
**What it does**: curated SEO landing pages, each backed by a saved search.
- `selectAssets` merges a fresh search into the previous snapshot **stably**:
  - Fresh candidates must be relevant (`matchScore ≥ 0.7`), have an https thumbnail and a title, be free if asked and downloadable if asked, and not be excluded (title phrase or id). One per id and per provider+title.
  - Previous assets keep their order while still candidates, or while their source failed this run.
  - New ones fill the free slots in rank order. Max 36 per page, and **no source over 40%**.
- `isIndexable`: ≥12 assets from ≥2 sources, otherwise the page is noindex.
- `snapshotCollection(run, slug, search, {previous, pricing, now, checkImage})`: up to 5 rounds that replace broken thumbnails. `updatedAt` moves only when the list changes, which keeps the sitemap lastmod honest.
- `searchKey` normalises a search for duplicate detection. `searchRequest` asks for limit 100.

**For audio**: `toSnapshotAsset` **requires `thumbnailUrl`**. For audio, require `previewUrl` instead (or a waveform), and `checkImage` becomes `checkPreview` (HEAD with audio/* content type). Replace the SnapshotAsset fields (maxResolution/polyCount/animated/rigged become bpm/key/duration/loop). The thresholds can stay.

### 3.7 `core/analytics.ts` (A)
**What it does**: defines the `Analytics` interface (`search`, `assetView`, `download`, `toolCall`, `mcpConnect`, `httpRequest`, `pageView`), `noopAnalytics`, and `PrometheusAnalytics`.

**Metrics** (all `asset_server_*`, bounded labels only):
- `searches_total{surface,client,type,free_only,has_results}`
- `search_duration_seconds`, `search_results`
- `provider_requests_total{provider,status}`, `provider_duration_seconds`
- `asset_views_total`, `downloads_total{kind=redirect|zip|local}`
- `mcp_tool_calls_total{tool,client,outcome,network,consistency}`, `mcp_tool_duration_seconds`
- `mcp_connects_total{client,client_version,network}`, `mcp_new_callers_total`
- `http_requests_total{route,method,status class}`, `http_request_duration_seconds`
- `page_views_total`
- plus default process metrics

It also writes one JSON log line per event (`{"event":"search", query (lowercased, ≤200 chars), ...}`), which Loki ingests. `clientFamily(ua)` maps a UA or MCP client name to a fixed set (claude-code, claude-ai, cursor, windsurf, vscode, codex, gemini, zed, cline, openai, continue, goose, inspector, mcp-sdk, python, curl, node, bot, browser, other). `typeLabel`.

**For audio**: rename the metric prefix (e.g. `sound_server_`). The `type` label stays bounded as long as the new enum is small. **Do not** put bpm or key values into labels.

### 3.8 `core/stats.ts` (A)
**What it does**:
- `LocalStats` (in-process tallies; also an Analytics sink) and `PrometheusStats` (PromQL over 24h and 7d windows, rankings over 7d, provider health over 24h with p50/p95 from histogram buckets). It falls back to LocalStats on any error.
- `cachedStats` (60 s, shared in-flight promise), and `teeAnalytics(...sinks)`.

**For audio**: rename the metric names in the PromQL strings (they are hard-coded: `asset_server_searches_total`, ...).

### 3.9 `core/network.ts` (A)
**What it does**: labels the caller's network for MCP analytics only.
- Checks private ranges, then Anthropic (`160.79.104.0/21`, `2607:6bc0::/48`, hard-coded), then OpenAI ranges (fetched daily from `openai.com/chatgpt-connectors.json` and `chatgpt-user.json`).
- Then a MaxMind GeoLite2-ASN lookup (`mmdb-lib`). Big-cloud ASNs map to aws/gcp/azure, a hosting ASN set or a "hosting|cloud|vps..." org-name regex maps to `cloud`, everything else is `isp`.
- The database is loaded from `ASSET_SERVER_ASN_DB` or downloaded with `MAXMIND_ACCOUNT_ID`/`LICENSE_KEY` (tar.gz parsed by the hand-written `mmdbFromTar`). It is cached at `$TMP/3d-asset-server/GeoLite2-ASN.mmdb` for a week and refreshed in the background with `setInterval().unref()`.
- The IP is never stored.

**For audio**: copy as is. Rename the cache dir.

### 3.10 `core/telemetry.ts` (A, policy decision)
**What it does**: `UmamiTelemetry` provides **opt-out** anonymous usage telemetry for local and self-hosted installs.
- Off with `ASSET_SERVER_TELEMETRY=0|false|off|no` or `DO_NOT_TRACK` (anything but 0/false).
- Fire-and-forget POSTs to `https://stats.shep.bot/api/send` with **hard-coded** `TELEMETRY_WEBSITE_ID = 41538cf4-...`.
- Uses a browser-shaped UA because Umami drops bot UAs. It stops after 3 consecutive failures.
- Sends only bounded labels. A notice goes to stderr. When telemetry is on and no `UMAMI_*` is set, the CLI also injects the Umami tracker into the bundled website in "anonymous" mode.

**For audio**: needs a new Umami website ID. Decide whether opt-out telemetry is wanted at all (see tech debt).

---

## 4. Providers: how they are built and registered

### 4.1 Registration
- `src/providers/index.ts` imports every provider object and exports `allProviders: Provider[]` **in reporting order**. That order is the order of the `providers[]` reports and of the web source list.
- Anything that needs the list imports `allProviders`: `cli.ts` `buildService()` (optionally filtered by `ASSET_SERVER_PROVIDERS=id,id`), `api/og.ts`, `api/search-meta.ts`, `api/openapi.ts`, `scripts/*`.
- A provider is a **plain object literal** typed `Provider`. There are no classes and no DI. Methods use `this` for `buildSearchUrl` / `census`.
- Adding a provider also requires:
  - an entry in `integrations/registry.json` (`test/integrations.test.ts` enforces the exact set and that name/homepage/access match);
  - a `census` method for any non-link provider (`test/census.test.ts`: "every searchable source can count itself");
  - offline and live tests for agent-added ones;
  - README rows and "N sites" counts. `test/site-build.test.ts` checks that the source count is consistent everywhere.

### 4.2 Conventions (`docs/PROVIDERS_GUIDE.md`, generic and worth copying)
- All HTTP goes through `ctx.fetch` with `signal: ctx.signal`. Catalogues use `cacheTtlMs` (usually 1 h) plus `filterLocal`/`paginate`.
- Return `{assets: []}` early when `!wantsType(q, ...)`. Respect `freeOnly`, `limit` and `offset`.
- Build assets with `makeAsset`. `nativeId` must be resolvable by `getAsset` on its own, and `getAsset` validates it with a regex (e.g. `^[a-z0-9][a-z0-9-]*$`) before building URLs, which prevents path injection.
- `downloadable: true` only for plain-GET files. Otherwise list files with `requiresAuth: true` or return no files.
- Never throw for "no results". Throw for network or parse failures (the service records them). `getAsset` returns `null` on 404.
- Use cheerio and prefer stable hooks (JSON-LD, `__NEXT_DATA__`, WP REST, sitemaps, data attributes, CSS-module class *prefixes*).
- At most 2 requests per search. No per-result detail fetches.
- Bot walls: CGTrader detects an AWS WAF challenge (`x-amzn-waf-action`, HTTP 202 with an empty body, or marker strings) and throws a descriptive `CgtraderBlockedError`.

### 4.3 Walkthrough: API provider (`polyhaven.ts`, the reference)
- Metadata: `id:"polyhaven"`, `access:"api"`, `pricing:"free"`, `license: LICENSES.CC0`, `supportsDownload: true`, `assetTypes: [hdri, material, texture, model]`.
- `search`:
  1. Returns early if `!wantsType`.
  2. Fetches the **entire catalogue** `GET api.polyhaven.com/assets?t=all` with `cacheTtlMs: 1h` (about 1 MB of JSON; this is why the LRU has a 64 MB cap).
  3. Maps each entry with `toAsset`: numeric type → AssetType; thumbnail from the CDN pattern; `resolutions` derived from `max_resolution` (1k, 2k, 4k...); formats by type.
  4. Sorts by `download_count` for browsing, then `filterLocal` re-ranks when there is a text query.
  5. `paginate`. Returns `total` and `searchUrl`.
- `getAsset`: `GET /info/{id}` (404 → null), then `GET /files/{id}`, a nested `{group:{res:{format:leaf}}}` structure. `flattenFiles` turns that into `AssetFile[]`:
  - `group` (gltf/blend/fbx/usd... or "maps" for texture maps with `mapType`);
  - `resolution`;
  - `includes` for glTF companions (`.bin` + textures with relative paths).
- `census`: one request for the whole catalogue. Totals, byType, top categories, `addedLast30Days` from `date_published`, total downloads, and "most downloaded per type" highlights.
- Test (`test/providers/polyhaven.test.ts` with fixtures `assets.json`, `info_ArmChair_01.json`, `files_ArmChair_01.json`).

Other API styles worth knowing:
- **ambientcg**: v3 API with server-side type, sort and paging. Census via `totalResults` per type using `mapLimit(3)`.
- **blenderkit**: Elasticsearch-style query string. Pages straddle when an offset is not a multiple of the page size. Optional `BLENDERKIT_API_KEY` as a Bearer token. Two-step signed download resolution with `cacheTtlMs:0`. 401/403 → `requiresAuth`.
- **wikimediacommons**: MediaWiki `generator=search` with `filetype:3d`. Per-file licence from `extmetadata`.
- **hdrmaps**: WooCommerce Store API. **freestylized / threedtextures**: WP REST. Census via `wpTotal`.

### 4.4 Walkthrough: scraped provider (`kenney.ts`)
- `access:"scrape"`, `pricing:"free"`, CC0, `supportsDownload:true`, `assetTypes` include **audio**.
- `parseListing(html)` (exported for tests) uses cheerio on `.asset` cards: slug from the `h2 a` href, cover URL from the inline `style` `url(...)`, plus category and series links. `lastPage` comes from the pagination links.
- `loadCatalogue`: page 1 first, then pages 2..min(last, 40) **in parallel**, all cached 1 h, then de-duplicated by slug.
- `search`:
  - Strips STOPWORDS ("pack", "kit", "low", "poly", "3d", ...). A bare "low poly" query is treated as a 3D browse.
  - Runs the site's own `?search=` (which matches tags that only exist on detail pages) in parallel with the catalogue load, and **boosts** those hits: `max(score,0.5)+0.2*(1-rank/n)`. A failed site search is swallowed unless the request was aborted.
  - Filters at score ≥ 0.34, then paginates.
- `getAsset`:
  - Validates the slug and scrapes the detail page: title, tags (`a.tag`), file count, update history (dd/mm/yyyy dates), and the direct zip from `#donate-text` (the "continue without donating" link).
  - Lists preview screenshots **and `<audio source>` previews** as `group:"preview"` files.
- `census`: `catalogueCensus(this, ctx, "packs")`.
- Tests: `test/providers/kenney.test.ts` routes regexes to `fixtures/kenney/*.html`, asserts the request count (4), type mapping, pagination and skip-by-type. Live test: `test/live/kenney.live.test.ts` HEADs the zip.

### 4.5 Walkthrough: link-only provider (`link.ts` + `linked.ts`): **A**
- `linkProvider(spec)` returns a Provider with `access:"link"`, `supportsDownload:false` and `search() → {assets:[], searchUrl: spec.buildSearchUrl(q)}`. There is no getAsset and no census.
- `linked.ts` defines `fab`, `poliigon` and `turbosquid` with deep-link URL builders (Fab also lists `audio`).
- The service reports these as `status:"link"` with `searchUrl`. MCP surfaces them as `also_search_on`, and the census lists them under `linked`.
- **For audio**: same pattern for Splice, Loopmasters, Native Instruments, ADSR, Sounds.com, Zapsplat and BBC Sound Effects (check terms).

### 4.6 Per-provider inventory (all **C** for the sound server unless noted)

| id | access | pricing | DL | Notes / audio relevance |
|---|---|---|---|---|
| polyhaven | api | free | yes | CC0 catalogue, reference implementation |
| ambientcg | api | free | yes | v3 API |
| cgbookcase | api | free | no | CDN hotlink protection, so links go to the site's thanks page |
| sharetextures | api | free | no | Licence forbids automated downloads; tag-slug matching |
| blenderkit | api | freemium | yes | Optional API key; signed URLs |
| fab | link | freemium | no | Includes audio. **B**: keep as a link source |
| kenney | scrape | free | yes | Has an **audio** category (CC0 SFX packs). **B** candidate (filter to audio) |
| poliigon | link | freemium | no | |
| quaternius | scrape | free | no | Google Drive / itch download targets |
| polyfork | api | freemium | yes | Redirect-only (licence forbids repackaging) |
| threedassets | api | free | yes | |
| grab3d | scrape | free | yes | Sitemap + JSON-LD `3DModel` |
| sketchfab | api | free | no | CC0 only; census is a lower bound |
| threedtextures | api | free | no | WP REST |
| freestylized | api | free | no | WP REST; custom licence with `notes` |
| wikimediacommons | api | free | yes | Per-file licences. **B** candidate: switch `filetype:3d` to `filetype:audio` |
| threedtexel | api | free | no | Public API, 120 rpm |
| texturecan | scrape | free | yes | |
| opengameart | scrape | free | yes | Per-asset licences; Drupal search with `field_art_type_tid`. **B** candidate: add the Music / Sound Effect art types |
| texturescom | api | freemium | no | |
| hdrmaps | api | freemium | yes | WooCommerce Store API |
| hdrihub | scrape | freemium | no | Next.js; JSON-LD |
| cgtrader | scrape | freemium | no | AWS WAF detection |
| turbosquid | link | freemium | no | |
| itchio | scrape | freemium | no | Has **audio** in TYPES and browse tags. **B** candidate (`/game-assets/tag-sound-effects`, `tag-music`) |

Useful scraping/API patterns to reuse for audio sources:
- whole-catalogue JSON cached 1 h and filtered locally;
- WP REST with `_embed` and `X-WP-Total`;
- WooCommerce Store API;
- sitemap-as-catalogue;
- JSON-LD extraction;
- site search used as a ranking boost;
- straddling pagination;
- WAF detection.

Likely audio sources (not verified, ToS to be checked by the discovery agent):
- **Freesound** (APIv2; token required for search, OAuth2 for original-quality downloads; previews are public mp3/ogg; rich bpm/key/duration/samplerate filters; per-sound CC0 / CC-BY / CC-BY-NC). It would be the "polyhaven" of the sound server and the first provider to use `isEnabled`/`apiKeyEnv`.
- Wikimedia Commons audio, OpenGameArt audio, Kenney audio, itch.io sound assets, Sonniss GDC bundles, 99Sounds, Looperman (free loops; check ToS), BBC Sound Effects (RemArc, non-commercial).
- Commercial marketplaces as link-only.

---

## 5. `src/api/*`

### 5.1 `api/app.ts` (A/B): `createApp(service, AppOptions)` → Hono
**Options**: `apiKey`, `publicBaseUrl`, `allowServerDownloads`, `httpMcpDisabled`, `downloadDir`, `analytics`, `siteRoot`, `rateLimit`, `prometheus`, `umami`, `networks`, `mcpSessionSecret`.

**Middleware order**:
1. Per-request metrics with a bounded `routeLabel()` (skips `/health`).
2. HSTS when the public URL is https or `x-forwarded-proto` is https.
3. `compress()`.
4. CORS `*` only on machine paths (`/v1/*`, `/mcp`, `/health`, `*.json|md|txt|xml`), exposing `mcp-session-id` and the RateLimit headers.
5. Rate limiter on `/v1/*`, `/mcp` and the dynamic OG routes.
6. **API key auth**: when `apiKey` is set, a guard on `/v1/*` and `/mcp` accepts `Authorization: Bearer`, `x-api-key` or `?api_key=` (the query form exists so the UI's download link works). The comparison is a plain `!==`.

**Error mapping** (`onError`):
- Unknown provider, invalid id or Zod error → 400 (zod `prettifyError`).
- `UnsupportedError` → 501.
- `HttpError` → 404 if the upstream said 404, else 502.
- Otherwise 500.

**Routes**:
- `GET /`: the HTML page or the Markdown twin when the Accept header asks for one. Otherwise a **JSON index** (name, description, agent links, endpoints, the `claude mcp add` command) with `Vary: Accept`.
- `/health`, `/openapi.json` (`openApiSpec(publicBaseUrl)`).
- `/v1/providers`.
- `/v1/catalog`: serves the built `catalog.json` from the site, cached 1 h.
- `/v1/stats`: usage snapshot plus a catalog summary by access and pricing; `max-age=60`.
- `/v1/search`: zod `searchParams` (`q`, `type` csv enum, `providers` csv, `free`/`downloadable` as bool strings, `limit` 1..100, `offset`). Records an analytics event (surface `web` if `x-asset-client: web`, else `api`).
- `/v1/assets/:id`: asset plus `shareUrl`.
- `/v1/assets/:id/files?format&resolution&maps&all`: the `selectFiles` result plus `totalBytes` and the licence.
- `/v1/assets/:id/download`:
  - 409 + `url` if the asset has no files;
  - 404 if nothing matches;
  - **302 redirect** (after `assertPublicUrl`) when there is a single self-contained file;
  - otherwise a **streamed zip** (`content-disposition: <provider>-<slug>.zip`).
- `/mcp`:
  - A browser GET without `text/event-stream` is redirected to `/docs/mcp`.
  - Otherwise MCP is **stateless**: a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})` per request.
  - On `initialize`, it records `mcpConnect` and **replaces the `mcp-session-id` header with a signed token** that carries the client name and version (`SessionTokens`). Later calls are attributed by verifying it.
  - With `httpMcpDisabled`, `/mcp` returns 404 JSON.
- `/og/query.png`, `/og/asset.png?id=`: dynamic OG cards.
- Catch-all GET/HEAD:
  - `/v1/*` → 404 JSON.
  - `ALIASES` (`/api`→`/docs/api`, `/reference`, `/developers`, ...) → 301.
  - `/search?asset=` pre-looks-up the asset with a 3.5 s race to fill the share metadata.
  - Everything else is served from the site. `notFound` does the same.
- `pageRewrite`: `/search` gets a **CSP nonce** (`<meta property="csp-nonce">`) and per-query title/description/OG tags. `/docs/api/playground` gets `inlineStyles` because Scalar injects styles. There is a duplicated JSDoc block here.

**For audio**:
- Rename strings: the JSON index, the `name`, the `claude mcp add ... 3d-assets` command, the example endpoints (`format=gltf&resolution=2k`).
- Change the `fileParams` schema (format, sampleRate, bitDepth, all) and the `searchParams` schema (bpm_min, bpm_max, key, loop, instrument, max_duration).
- Maybe add `/v1/assets/:id/preview`, a proxied preview stream if CORS or hotlink rules block direct `<audio>` playback. Proxying needs a size limit and the same SSRF rules.

### 5.2 `api/ratelimit.ts` (A)
Fixed window per client IP, in memory (per process; the deploy runs 1 replica). Emits the IETF draft `RateLimit-Policy: "default";q=120;w=60` and `RateLimit: "default";r=..;t=..`, plus `RateLimit-Limit/Remaining/Reset`. A 429 response is JSON with `retryAfter` and a `Retry-After` header. Expired entries are swept once per window.

`clientIp` takes the **leftmost `X-Forwarded-For`**, then `X-Real-IP`, then the socket address. This is safe only because the shep.bot edge Caddy overwrites XFF; on other deployments it is spoofable. Defaults: `ASSET_SERVER_RATE_LIMIT=120`, `_WINDOW=60` (0 = off).

### 5.3 `api/negotiate.ts` (A)
`prefersMarkdown(accept)`: Markdown wins only if `text/markdown` (or `text/x-markdown`) has q ≥ the best of `text/html`, `text/*` and `*/*`. Browsers therefore always get HTML.

### 5.4 `api/site.ts` (A, with one audio change)
**What it does**: `Site.load(root, {umami})` indexes every file under `dist/web` **once at startup**. A request can therefore only resolve to an existing file: there is no path traversal. Astro directory format: `/docs/mcp` maps to `docs/mcp/index.html`. It also keeps a case-folded lookup (`/agents.md` → `/AGENTS.md`).
- Trailing-slash variants 301 to the canonical form. There is a 404 page and a **Markdown 404** for agents (it links AGENTS.md, llms.txt, docs, sitemap and OpenAPI; the text is 3D-branded).
- `markdownFor(route)`: `/` → `/AGENTS.md`, otherwise `route.md`.
- Pages get a `Link: <twin.md>; rel="alternate"; type="text/markdown"` header and `Vary: Accept`.
- **Strict per-page CSP** built from the HTML: SHA-256 hashes of every inline script, `<style>` and `style=""` attribute (`'unsafe-hashes'`), no `'unsafe-inline'` (except the playground). It includes `img-src 'self' https: data:`, `connect-src 'self'` (+ the Umami origin) and `frame-ancestors 'none'`.
- Other security headers: Referrer-Policy, X-Frame-Options DENY, Permissions-Policy, COOP and CORP.
- ETags are weak (size-mtime, plus a hash of the injected head when Umami is on). 304 support.
- **Brotli**: quality 11 cached for static files, quality 5 for rewritten pages.
- Cache-Control: `_astro/*` immutable for 1 year, pages `max-age=0, must-revalidate`, other files 1 day.
- Umami injection with a privacy helper: strips every query parameter except `utm_*`, blanks the title of any page that had a query, counts one view per path, tracks outbound clicks by domain, and an `anonymous` mode for self-hosted installs.
- `rewriteHead` replaces the title, description, robots and OG/Twitter tags.

**For audio**: **the CSP has no `media-src`, so it falls back to `default-src 'self'` and `<audio src="https://freesound...">` would be blocked.** Add `media-src 'self' https:` (or a source allow-list). Rename the Markdown 404 text.

### 5.5 `api/search-meta.ts` (B)
`searchShare(params)` normalises `/search` params into a card key, kicker, title, subtitle and chips. `searchMeta` gives title and description, `noindex, follow` and `/og/query.png?...`. `assetMeta(asset)` builds title and description from the licence, free flag, formats and max resolution. `shareableAssetId` validates against the running provider ids and caps length at 300.

`TYPE_LABELS`, `ASSET_TYPE_LABEL` and `ASSET_TYPE_NOUN` are 3D. The default chips "Poly Haven, ambientCG, Kenney" are hard-coded. **Audio**: new labels; add bpm, key and duration to `assetMeta` facts.

### 5.6 `api/og.ts` (A/B)
`OgImages` keeps an LRU of render promises (300 entries; misses and failures are not cached), allows **2 concurrent renders**, and serves PNGs cached for a day. `asset(id)` → `service.getAsset` → `fetchImage(thumbnail)` → `assetCard`. The site host printed on cards defaults to `3d.shep.bot`.

### 5.7 `og/render.ts` (B)
satori (flexbox → SVG, text as paths) plus resvg → 1200×630 PNG. The Geist TTF fonts are vendored (OFL) because satori can't read WOFF2. Exports `pageCard` (kicker, title, highlight gradient, subtitle, chips) and `assetCard` (with a 420 px thumbnail).

`fetchImage` is a good SSRF-safe image fetcher:
- manual redirects, up to 4 hops, `assertPublicUrl` on each hop;
- `image/*` only, SVG refused, 4 MB cap and 4 s timeout;
- sharp `limitInputPixels` and re-encode to JPEG.

Also used at build time by `web/integrations/og-images.mjs` (imports `dist/og/render.js`). The logo SVG, the "3D Asset Server" brand and the palette are hard-coded.

**For audio**: new logo and brand. Add a **waveform card**: render peaks from the provider's waveform image or from precomputed peaks (Freesound offers waveform PNGs). Generating peaks from audio would need a decoder (ffmpeg or wasm), which is heavy. Keep it optional.

### 5.8 `api/openapi.ts` (B)
A **hand-written** OpenAPI 3.1 object (559 lines):
- info (description with rate limits, auth and versioning policy), servers = base URL;
- security schemes bearer and apiKey (optional);
- RateLimit header components and a TooManyRequests response;
- schemas: AssetType, CountWithBound, SourceCensus, Catalog, UsageWindow, Stats..., Asset, AssetFile, AssetDetails, ProviderReport, SearchResponse, Provider, FileSelection, Error;
- paths: `/v1/search`, `/v1/assets/{id}`, `/files`, `/download`, `/v1/providers`, `/v1/catalog`, `/v1/stats`, `/mcp`, `/health`, `/openapi.json`;
- a loop that adds 429 and RateLimit headers to every `/v1` and `/mcp` operation;
- `x-api-lifecycle`.

It is not generated from the zod schemas, so drift is guarded only by tests. **For audio**: rewrite the examples and fields. Consider generating it from zod (`zod-openapi` or zod v4's `toJSONSchema`) to avoid the drift.

---

## 6. `src/mcp/*`

### 6.1 `mcp/server.ts` (B)
`createMcpServer(service, {allowLocalDownload, downloadDir, publicBaseUrl, analytics, client, attribution})`. Server name `3d-asset-server`, `VERSION="0.1.0"` (hard-coded, separate from package.json). The **instructions** string varies with `allowLocalDownload`. Over HTTP the server can't write to disk, so it tells the agent to `curl -L` the `selection.bundleUrl`.

Tools, each wrapped in `timed()` for analytics:
- `search_assets(query, types?, providers?, free_only?, downloadable_only?, limit≤50 (default 12), offset?)` returns compact results (`summarizeAsset`), a `sources` summary string, `also_search_on` (link providers) and `unavailable` (error/timeout). Annotations `readOnlyHint`, `openWorldHint`.
- `get_asset(id, format?, resolution?)` returns the summary, description, `available` (formats, resolutions, packages, fileCount) and `selection` {files, totalSize, **bundleUrl** (the `/v1/.../download` URL), bundleFilename}. It also returns a note and a shareUrl.
- `download_asset(id, dest_dir?, format?, resolution?, map_types?, extract? (default true), all_files?)`: **only when `allowLocalDownload`** (stdio, or HTTP with `ASSET_SERVER_HTTP_DOWNLOADS=true`). Writes to `<dest>/<provider>-<slug>` and returns the paths, licence and an **attribution line** when `attributionRequired`.
- `list_providers()`.

Errors are returned as `isError` tool results, not thrown. stdio `oninitialized` records `mcpConnect`.

**For audio**:
- Rename the tools (`search_samples`, `get_sample`, `download_sample`, `list_sources`) or keep generic names.
- Rewrite the descriptions and examples.
- Add bpm, key, instrument, loop and duration params.
- `summarizeAsset` gets bpm, key, duration and previewUrl.
- `download_asset` takes `sample_rate` / `format` instead of `resolution` / `map_types`.
- The attribution line logic is generic and important for CC-BY audio.

### 6.2 `mcp/attribution.ts` (A)
- `SessionTokens`: HMAC-SHA256-signed `base64url(JSON{n,v,r}).sig` session IDs (16-byte signature, `timingSafeEqual`, secret from `ASSET_SERVER_SESSION_SECRET` or random per process).
- `pickClient`, `checkConsistency` (consistent | mismatch | no_session | bad_session; for example a UA claiming claude-ai from a non-Anthropic network is a mismatch).
- `versionLabel` (bounded), and `DailyCallers` (salted daily hash of IP + UA, capped at 200k).

Analytics only; never affects responses.

---

## 7. `src/cli.ts`, `src/index.ts` (A/B)
- `cli.ts` commands: `serve` (Hono on `PORT` 8787 / `HOST` 0.0.0.0), `mcp` (stdio, `allowLocalDownload: true`), and `search <q> [--type --free --limit --providers]` (prints score/type/price/id and a per-source status table). It has a hand-rolled flag parser and a HELP text listing every env var.
- `startMetrics`: only when `METRICS_PORT` is set. Prometheus is served on a **separate port** (never public), the network classifier is wired up, and two gauges are exported (ASN db build time, OpenAI range count).
- `startTelemetry` and `umamiFromEnv`.
- Env vars (all prefixed `ASSET_SERVER_` or `ASSET_`):

  | Group | Variables |
  |---|---|
  | Server | `ASSET_SERVER_API_KEY`, `_PUBLIC_URL`, `_PROVIDERS`, `ASSET_DOWNLOAD_DIR` |
  | HTTP MCP | `ASSET_SERVER_HTTP_DOWNLOADS`, `_HTTP_MCP` |
  | Rate limiting | `ASSET_SERVER_RATE_LIMIT`, `_RATE_LIMIT_WINDOW` |
  | Metrics and attribution | `METRICS_PORT`, `PROMETHEUS_URL`, `MAXMIND_ACCOUNT_ID`/`_LICENSE_KEY`, `ASSET_SERVER_ASN_DB`, `ASSET_SERVER_SESSION_SECRET` |
  | Telemetry and analytics | `ASSET_SERVER_TELEMETRY`, `DO_NOT_TRACK`, `UMAMI_WEBSITE_ID`, `UMAMI_HOST` |
  | Networking | `ASSET_SERVER_USER_AGENT`, `_HTTP_TIMEOUT_MS`, `_CACHE_TTL_MS`, `_PROVIDER_TIMEOUT_MS`, `_MAX_DOWNLOAD_BYTES` |
  | Providers | `BLENDERKIT_API_KEY` |

- `index.ts`: library exports (types, util, `createHttpClient`, `AssetService`, `rankResults`, download helpers, `createApp`, `createMcpServer`, `allProviders`).

**For audio**: rename the env prefix (e.g. `SOUND_SERVER_`), the bin and the help text. Add `FREESOUND_API_KEY`.

---

## 8. Tests

Vitest config: `test/**/*.test.ts`, 30 s timeout. `test/live/**` is excluded unless `LIVE` is set.

**Helpers** (`test/helpers.ts`, A):
- `FIXTURES` dir and `fixture(path)`.
- **`fixtureHttp(routes)`**: an offline `HttpClient`. Each `[substring|RegExp, fixturePath]` route is matched in order. It records `requests`, and an unmatched URL throws `HttpError(404)` so unexpected requests fail the test. `raw` returns `new Response(fixture)`.
- `fixtureCtx(routes)` → `{fetch}`.

**Fakes** (`test/fakes.ts`, B):
- `CRATE` (an AssetDetails with gltf 1k/2k + includes, blend and fbx) and `SKY`.
- `fakeProvider` (filterLocal over the two), `brokenProvider` (search throws, no getAsset), `slowProvider` (never resolves).
- `bytesHttp()` returns `data:<filename>` bytes for any URL. Used for download and zip tests.

**Provider tests**: 22 offline tests in `test/providers/<id>.test.ts` with trimmed fixtures in `test/fixtures/<id>/` (JSON, HTML, XML; ≤100–200 KB). 20 live smoke tests in `test/live/<id>.live.test.ts` guarded by `describe.runIf(process.env.LIVE)`, using the real `createHttpClient()` and HEAD-checking a download URL.

**Core and system tests**:
- `service.test.ts` (652 lines): merge, skip reasons, allow-lists, bad ids, `selectFiles` rules, download safety (traversal, internal URLs), `downloadFiles` with includes and the size limit. HTTP API via `app.request()`: search, validation, zip vs redirect, site vs JSON, Markdown negotiation, the Markdown 404, aliases, analytics, MCP over Streamable HTTP (initialize then a tool call with the signed session), API key, MCP disabled, MCP tools (stdio-style through an in-memory client), rate limiting, CSP hashes and nonces, Umami injection and stripping, HSTS, CORS scoping, Brotli, cache headers, `/search` meta variants. It uses `test/fixtures/site/` as a fake built site.
- `stats.test.ts`: LocalStats, PrometheusStats with a fake PromQL fetch, fallback, cachedStats, `/v1/stats`.
- `telemetry.test.ts`, `network.test.ts` (with a real `GeoLite2-ASN-Test.mmdb` fixture), `attribution.test.ts`, `util.test.ts`.
- `census.test.ts`: helpers, "every searchable source can count itself", plus per-provider census against fixtures.
- `collections.test.ts`, `collection-gate.test.ts`, `integration-gate.test.ts` (they import the `.mjs` scripts with `@ts-expect-error`).
- `integrations.test.ts`: zod schema of `registry.json`; the registry equals `allProviders`; name, homepage and access match; agent-added providers have offline and live tests.
- `og.test.ts`: renders a PNG, `fetchImage` refuses internal hosts, share meta, OG endpoints.
- `site-build.test.ts`: runs against the real `dist/web` after `npm run build` (skipped if not built). It checks sitemap entries, llms.txt layout, AGENTS.md, Organization JSON-LD, versioning docs, no duplicate ids, labelled form controls, AVIF/WebP images, the playground being noindex, the /stats twin, **the same source count everywhere**, a per-page OG card with alt text, and the catalog published in four places.

**For audio**: copy the helpers as is. Rewrite the fakes (a WAV one-shot plus a zip pack). Port the core tests with renamed fields. Keep the "registry equals providers" and "source count consistent" invariants: they are what keep the agent-driven automation honest.

---

## 9. Scripts, prompts and integrations (the automation pipelines)

All scripts import the **compiled** server from `dist/`, so `npm run build:server` must run first.

### 9.1 `scripts/export-site-data.mjs` (A/B)
Runs before `astro build`:
- Writes `web/src/data/providers.json` (id, name, homepage, description, assetTypes, access, pricing, license name, supportsDownload) from `allProviders`.
- Writes `web/src/data/integrations.json` (integrated providers that are live, sorted by `addedAt`, plus the rejected count) from `integrations/registry.json`.
- Writes `web/src/data/openapi.json` from `openApiSpec(SITE_URL ?? "https://3d.shep.bot")`, used for the server-rendered reference page.

These files are committed, and the discovery and drafting workflows check that they are regenerated (`git diff --exit-code`).

### 9.2 Census pipeline (A)
`scripts/census.mjs` runs `runCensus(allProviders, {fetch: createHttpClient()}, {previous})`:
- writes `web/src/data/catalog.json` and appends to `catalog-history.json`;
- exits 1 only if every source failed;
- writes a summary to `GITHUB_STEP_SUMMARY`.

The data surfaces on `/stats`, the homepage, llms.txt, `/catalog.json`, `/catalog-history.json` and `/v1/catalog`.

### 9.3 Collections pipeline (B)
- `scripts/lib/topics.mjs`:
  - parses topic files (YAML frontmatter via `yaml` plus a Markdown body);
  - reads hubs and snapshots;
  - `wordCount`, `searchKey`;
  - **`topicErrors`**, the editorial rules: slug format; title 10–60 chars; description 110–160; a valid hub; search.q 2–60; valid types and providers; exclude ≤30; related 2–6 existing slugs; 2–5 FAQs (question ending in "?", answer 40–450 chars); `addedBy` human|agent; `addedAt` date; body 80–350 words; no script/iframe/style; no unknown fields.
  - It holds a **duplicated `ASSET_TYPES`** list.
- `scripts/snapshot-collections.mjs [slug...]`:
  - runs each topic's search through a real `AssetService` (20 s timeout per provider) and `snapshotCollection`;
  - `checkImage`: HEAD, falling back to a ranged GET on 403/405, max 8 concurrent, cached per URL. Only 404/410 or a non-image content type count as broken;
  - writes changed snapshots and deletes snapshots of removed topics (full runs only).
- `scripts/collection-ideas.mjs`:
  - reads the last 7 days of `"event":"search"` log lines from **Loki via Grafana's datasource proxy** (`GRAFANA_URL` default `https://grafana.shep.bot`, `LOKI_UID` default `P8E80F9AEF21F6940`, selector `{namespace="asset-server"}`);
  - keeps queries made ≥3 times that look like plain topics (`sanitizeQuery` drops URLs, e-mails, digits-only and long queries) and that no existing or pending collection covers (`coreTerms` drops FILLER words: "free", "3d", "texture", "hdri", ...);
  - prints JSON for the agent. Only counts reach the public log.
- `scripts/collection-gate.mjs`:
  - `checkChanges`: the staged diff may only **add** `web/src/content/collections/<slug>.md`, at most 3, `addedBy: agent`, editorial rules met, no duplicate search, `related` must point at existing pages. Writes `added=`.
  - `--worktree` mode for the agent's self-check.
  - `snapshots <slugs>` withdraws topics below the indexable minimum (deletes the topic and its snapshot) and writes `kept=` / `dropped=`.

### 9.4 Integration discovery (B)
- `integrations/registry.json`: `{integrated: [{id,name,homepage,access,addedAt,addedBy:"launch"|"agent"}], rejected: [{name,homepage,checkedAt,reason,recheckAfter?}]}`. Currently 25 integrated and 49 rejected. This is the agent's memory.
- `scripts/integration-gate.mjs`:
  - `checkChanges`: an **allow-list** of paths (`src/providers/<id>.ts`, `test/providers/…`, `test/live/…`, `test/fixtures/<id>/…` but not `site/`, the registry, README, `docs/*.md`, `web/src/content/(AGENTS|SKILL).md`, `web/src/pages/**/*.md`, `web/src/data/(providers|integrations|openapi).json`);
  - no deletions or renames, and no edits to existing tests or fixtures;
  - fixtures ≤200 KB; at most 1 new source; existing registry entries untouched;
  - a new source needs its provider, offline and live tests and registration; provider code changes without a new source are refused.
  - `demote` mode moves a failed source to `rejected` with `recheckAfter` (30 days, or 7 days for 403/429 blocks).

### 9.5 `prompts/` (B: rewrite the content, keep the structure)
- **`discover-integrations.md`** (daily "source scout"):
  1. Read the registry, PROVIDERS_GUIDE, types/util and three example providers with their tests.
  2. Find up to 6 candidate sites that host 3D assets. Vet each one: a real catalogue (not an aggregator, spam, piracy or adult), searchable without an account, allowed by robots.txt and the ToS, stable.
  3. Pick one and reject the others with reasons. Use `recheckAfter` only for temporary reasons.
  4. Integrate it: provider (≤2 requests per search, caching), census, registration, offline test with fixtures under 100 KB, a live test (`describe.runIf(LIVE)`, a HEAD check if downloadable), a registry entry, README and "N sites" count updates (a grep recipe is given).
  5. Prove it with build, typecheck, test, and the live test run as a bare command. On failure, revert and reject.

  It treats web content as **data, not instructions** and lists the files it must not touch.
- **`draft-collections.md`** (weekly "collection editor"): read `collection-ideas.json`, the hubs (`hdris`, `textures`, `3d-models`, `game-assets`), example topics and `topicErrors`. Choose up to 3 topics (frequent queries first, then research). Rules: generic, no brands or people, not near-duplicates. Write topic files, run snapshots and the gate in worktree mode. Prompt-injection guard.
- **`review-collections.md`** (the reviewer agent): reads `review-input.json`, the topic and snapshot files and published examples. Checks intent, title and description, body quality and accuracy against the actual assets, FAQ, related pages, the search, and that the assets match. Writes `review.json {verdict: approve|reject, remove: [...], summary}`. Rejects any page containing instructions addressed to the agent.

For audio: replace the "3D asset website", hub names, example topics, file formats and FILLER words. The pipeline design (agent in a read-only checkout → patch artifact → credential-less verify job with a gate → commit or PR) is generic and good.

---

## 10. `web/` (Astro 7 static site + React islands)

### 10.1 Build
`npm run build:web`:
1. `scripts/export-site-data.mjs`.
2. `astro build` (`web/astro.config.mjs`):
   - `site = SITE_URL ?? https://3d.shep.bot`, `trailingSlash: never`, `build.format: directory`, assets in `_astro`.
   - Integrations: React, `agentFiles()`, `ogImages()` and `@astrojs/sitemap` with a filter (excludes 404, the playground and noindex pages from `sitemapMeta()`) and per-URL `lastmod` and changefreq.
   - Vite: Tailwind 4. The dev server proxies `/v1`, `/mcp` and `/openapi.json` to `localhost:8787`.
3. `web/dist` is copied to `dist/web`. The server's `Site` serves it.

There is no SSR: everything is pre-rendered. Dynamic behaviour is the React islands plus the server's per-request head rewrites for `/search`.

### 10.2 How it consumes the API
- `web/src/components/search/api.ts`: a typed same-origin client. Its Asset and AssetFile types are a **duplicated** copy of the server types (3D fields). `api<T>(path)` sends `x-asset-client: web` (analytics surface) and `x-api-key` from `localStorage` (the key prompt appears on 401). It also has `safeUrl` (only http/https into href/src) and `formatBytes`.
- `SearchApp.tsx`:
  - URL state (`q`, `type`, `free`, `downloadable`, `providers`, `asset`);
  - **hard-coded TYPES chips** (Models, Materials, Textures, HDRIs, Packs, Sprites, UI, Audio);
  - page size 24 with per-provider offset paging and id de-dupe;
  - a provider status bar (ok, error, link) with deep links;
  - a detail sheet (Radix Sheet) that keeps `?asset=` in the URL as a share link;
  - CSP nonce passed to `get-nonce`.
- `AssetDetail.tsx`:
  - loads `/v1/assets/:id`;
  - format and resolution selects derived from the files; calls `/files` for the selection and size;
  - the download link `/v1/assets/:id/download?...&api_key=`;
  - copy-ready `curl` and an agent prompt;
  - a facts table (Formats, Resolutions, **Polygons**, ...);
  - a licence line ("commercial use OK", "attribution required").
- `StatsDashboard.tsx`: fetches `/v1/stats` (generic). `CatalogStats.astro` renders `catalog.json` at build time.
- The homepage `AgentSetup.tsx` uses the `AGENT_CLIENTS` snippets from `lib/agents.ts` (Claude Code, Cursor deeplink, VS Code deeplink, Windsurf, Codex, Gemini...), all with the `3d-assets` server name.

### 10.3 Pages and components: generic vs 3D

| Path | Class | Notes |
|---|---|---|
| `layouts/BaseLayout.astro`, `DocsLayout.astro`, `PageLayout.astro` | A | Head meta, OG, JSON-LD, nav. Branding comes from `lib/site.ts`. |
| `components/SiteHeader/SiteFooter/ThemeToggle/Logo.astro` | A/B | Logo is a 3D cube SVG. |
| `components/ui/*` (shadcn + magic-ui) | A | |
| `components/search/SearchApp.tsx` | B | TYPES chips, placeholder "low poly tree, brick wall, sunset hdri", titles. Add bpm/key/duration filters, an inline **audio player** (play preview on hover or click) and a waveform instead of the 4:3 thumbnail grid. |
| `components/search/AssetDetail.tsx` | B | Format and resolution pickers become format and sample-rate pickers. Polygons fact becomes BPM/Key/Duration/SR. Preview player. |
| `components/search/api.ts` | B | Types. |
| `components/collections/AssetCard.astro`, `CollectionCard`, `Breadcrumbs` | B/A | AssetCard shows maxResolution, formats and Animated/Rigged. It needs a preview button. |
| `components/stats/*` | A | |
| `components/home/AgentSetup.tsx` | A | |
| `pages/index.astro` | C (copy) / A (structure) | Heavy 3D marketing copy. |
| `pages/search.astro` | A | Island host. |
| `pages/stats.astro`, `pages/sources/[id].astro` (+ `.md.ts`) | A | Per-source pages are noindex unless there is a census or ≥4 assets in collections. |
| `pages/assets/index.astro`, `assets/[slug].astro` (+ `.md.ts`), `assets.md.ts` | B | Hubs and collections; FAQ JSON-LD, ItemList. |
| `pages/docs/*.md`, `docs/api/reference.astro` (static render of `openapi.json` via `lib/openapi.ts`), `docs/api/playground.astro` (Scalar, noindex), `docs/sources.astro` | B | Docs text is 3D. The mechanism is generic. |
| `pages/about.md`, `contact.md`, `privacy.md`, `404.astro` | B | Privacy mentions telemetry, Umami and the ghcr image. |
| `lib/site.ts` | B | `SITE` constants (name, tagline, url, repo), NAV, DOCS_NAV, `ogImagePath`, `MCP_URL`. |
| `lib/schema.ts` | A/B | schema.org builders (Organization, WebSite, SoftwareApplication, WebAPI, FAQPage, TechArticle, BreadcrumbList, ItemList). |
| `lib/catalog.ts`, `lib/openapi.ts`, `lib/utils.ts` | A | |
| `lib/collections.ts`, `lib/collections-md.ts` | B | SnapshotAsset type, `typeNoun`, Markdown twins. |
| `lib/faq.ts`, `lib/agents.ts` | B | 3D text and the `3d-assets` server name. |
| `content.config.ts` | B | Collection schema with a **duplicated ASSET_TYPES**. |
| `content/collections/*.md` (31), `data/collections/*.json`, `data/collection-hubs.json` | C | |
| `data/organization.json` | B | |
| `public/*` (favicons, search-preview screenshot, robots.txt, webmanifest) | C/B | robots.txt is generic apart from the sitemap URL and name. |
| `integrations/sitemap-meta.mjs` | A | Duplicates MIN_INDEXABLE and MIN_SOURCES. |
| `integrations/og-images.mjs` | B | KICKERS/CHIPS per route, including hub names. |
| `integrations/agent-files.mjs` | B | See below. |

### 10.4 Agent-facing files
`web/integrations/agent-files.mjs` runs on `astro:build:done` and writes:
- `/AGENTS.md`, copied from `web/src/content/AGENTS.md`. This is the agent guide: when to use and when not to use, MCP setup and tools, the REST flow, format guidance, licence and attribution rules, a worked example, links. Also served for `/` with `Accept: text/markdown`.
- `/skill/SKILL.md`, from `web/src/content/SKILL.md`. A Claude Code skill (`name: 3d-assets`) with a curl-based search → files → download workflow and rules.
- **Markdown twins** of every `src/pages/**/*.md` page (`/docs/mcp.md`, ...), with absolute links and a "Source:" footer. Plus a generated `/docs/sources.md` table, `/stats.md` (from catalog.json and integrations), `/catalog.json` and `/catalog-history.json`.
- `/llms.txt` in llmstxt.org format: H1, a summary blockquote, when-to-use guidance, a catalog line, how to call it, then link-list sections (Docs, API, Collections, About, Optional).
- `/llms-full.txt` (everything concatenated).
- The **self-hosted Scalar bundle** (`/scalar/standalone.esm.js` + chunks, with the fonts.scalar.com `@font-face` rules stripped so the page stays same-origin).

The Astro routes `assets/[slug].md.ts` and `sources/[id].md.ts` add Markdown twins for collections and sources.

For audio, all of these files need new content. The generator is reusable once you edit the `TYPE_NAMES`, llms.txt copy and the "3D Asset Server" strings.

---

## 11. CI/CD and deployment

### 11.1 Workflows

| Workflow | Triggers | Steps | Secrets / permissions |
|---|---|---|---|
| `ci.yml` | push to main, pull_request, workflow_dispatch | **test**: Node 22, npm cache (both lockfiles), `npm ci`, `npm --prefix web ci`, `npm run build`, `npm run typecheck`, `npm test`. **image** (main, non-PR): buildx, login to ghcr with `GITHUB_TOKEN`, build-push `ghcr.io/${{github.repository}}:latest` and `:sha-<sha>` with OCI labels and GHA cache. **deploy**: `concurrency: deploy`, checks out main, `sed` sets `newTag: sha-<sha>` in `deploy/kustomization.yaml`, commits "chore(deploy): pin image to sha-…" as github-actions[bot], pushes with 3 rebase retries. | `GITHUB_TOKEN` only (`packages: write`, `contents: write`) |
| `release.yml` | push tag `v*` | Node 24, `npm ci`, web ci, build, test; check the tag equals the package.json version; `npm shrinkwrap` (publishes the locked tree); `npm pack` and **smoke test the packed CLI** (help, `serve` on 8799, curl `/health` and the HTML homepage containing "3D Asset Server"); `npm publish` (provenance); `gh release create --generate-notes`. | `NPM_TOKEN` (until npm trusted publishing via OIDC is configured), `id-token: write`, `contents: write` |
| `catalog-census.yml` | cron `41 4 * * *`, dispatch | `npm ci`, `build:server`, `node scripts/census.mjs`, `node scripts/snapshot-collections.mjs`; if catalog or collections data changed: commit "chore(catalog): census and collections <date>", push with retries, `gh workflow run ci.yml --ref main` (because pushes made with GITHUB_TOKEN don't trigger workflows). | `contents: write`, `actions: write`; no secrets |
| `discover-integrations.yml` | cron `17 5 * * *`, dispatch | **discover**: read-only checkout (`persist-credentials: false`), install, `anthropics/claude-code-action@v1` (max 300 turns, acceptEdits, allowed tools: WebSearch/WebFetch/Read/Write/Edit/Glob/Grep, npm/npx/node/curl/ls/cat/…, `git status/diff`), then `git diff --cached --binary` uploaded as an artifact. **verify**: no Claude credentials. Apply the patch, `integration-gate.mjs`, build, stage the regenerated data, typecheck, test, the live test of the new source (3 attempts with 60 s and 180 s back-off, JSON reporter), commit "feat(sources): add X" / "chore(integrations): record N evaluated site(s)", push, `gh workflow run ci.yml`. On a post-gate failure: `demote` to rejected (7 days if every failure was an HTTP 403/429, else 30), rebuild the server and site data, commit and push. | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`; `id-token: write` (action OIDC); verify: `contents: write`, `actions: write` |
| `draft-collections.yml` | cron `23 6 * * 1` (Mondays), dispatch | **draft**: build the server, list pending collection PRs (`gh pr list --label collections`), `collection-ideas.mjs` (Grafana/Loki), Claude agent (150 turns, restricted tools, `show_full_output: false` because it reads search terms), patch of `web/src/content/collections` only. **verify**: apply, `collection-gate.mjs`, build:server, snapshot the new slugs, withdraw thin ones, build, check the generated data is up to date, typecheck, test, open a PR `collections/<date>-<run>` labelled `collections` with a summary table. **review**: second Claude agent with read-only tools writes `review.json`, uploaded as an artifact. **merge**: anything but a well-formed approve → comment + `needs-editor` label; approve → `git rm` the removed slugs, `gh pr merge --squash --delete-branch --repo`, `gh workflow run ci.yml`. | Claude token as above; `GRAFANA_TOKEN` (optional, Viewer); repo setting "Allow GitHub Actions to create and approve pull requests" |

### 11.2 Docker image (`Dockerfile`, A)
Two stages on `node:22-alpine`:
- **build**: `npm ci` (root + web), copy `tsconfig*`, `src`, `scripts`, `integrations`, `web`. `ASTRO_TELEMETRY_DISABLED=1`, `npm run build && npm prune --omit=dev`.
- **runtime**: copies `node_modules`, `dist` and `package.json`. `NODE_ENV=production PORT=8787`, `USER node`, `EXPOSE 8787`, `HEALTHCHECK wget /health`, `CMD node dist/cli.js serve`.

`.dockerignore` excludes node_modules, dist, web/.astro, test, downloads, assets and .git. Note: `sharp` ships native binaries, so the alpine (musl) build works through prebuilt musl binaries.

### 11.3 Deploy manifests (`deploy/`, B)
GitOps with **kustomize + ArgoCD**. ArgoCD is registered in a separate repo, `shep-ai/shep-infra` (`bootstrap/apps/92-3d-asset-server.yaml`, which also creates the namespace). It syncs `deploy/` from `main`, so **the image-pin commit is the rollout**.
- `kustomization.yaml`: namespace `asset-server`; resources deployment, service, ingress and servicemonitor; `images: - name: ghcr.io/arielshad/3d-asset-server, newTag: sha-…` (rewritten by CI).
- `deployment.yaml`:
  - `asset-server`, 1 replica, RollingUpdate maxUnavailable 0 / maxSurge 1; `imagePullSecrets: ghcr-pull` (optional).
  - Pod security: non-root uid/gid 1000, seccomp RuntimeDefault, `readOnlyRootFilesystem`, drop ALL capabilities, `/tmp` as an emptyDir of 256Mi.
  - Env: `PORT=8787`, `ASSET_SERVER_PUBLIC_URL=https://3d.shep.bot`, `ASSET_SERVER_USER_AGENT="3d-asset-server/0.1 (+https://3d.shep.bot)"`, `METRICS_PORT=9464`, `PROMETHEUS_URL=http://kube-prometheus-stack-prometheus.monitoring.svc:9090`, `UMAMI_WEBSITE_ID=8f6824cb-f616-4a20-8f5c-79db417038b2`, `UMAMI_HOST=https://stats.shep.bot`, `ASSET_SERVER_TELEMETRY=0`.
  - `envFrom` an optional Secret `asset-server-env` (API key, BlenderKit key, session secret, MaxMind credentials).
  - Probes: readiness `/health` (delay 3 s, period 10 s), liveness (delay 15 s, period 30 s).
  - **Resources: requests 25m CPU / 128Mi, limits 1 CPU / 512Mi.**
- `service.yaml`: ports 80 → http and 9464 → metrics.
- `ingress.yaml`: nginx class, host **`3d.shep.bot`**, `proxy-buffering: off`, read and send timeouts 600 s (for streamed zips). There is **no TLS block**: TLS terminates at an edge Caddy (on-demand certs for hosts declared by an Ingress, `*.shep.bot` wildcard DNS), which forwards plain HTTP and rewrites XFF.
- `servicemonitor.yaml`: kube-prometheus-stack scrapes `metrics` every 30 s. A Grafana dashboard "3D Asset Server" lives in shep-infra.

**For audio**: new namespace (e.g. `sound-server`), host (e.g. `sound.shep.bot` or similar), image name, Umami website ID, user agent, a new ArgoCD app in shep-infra, and a dashboard. Consider raising the memory limit if zip packs are buffered: they currently stream, but `extractZip` for local MCP is in-memory.

---

## 12. Hard-coded names, domains and IDs to rename

| String | Where |
|---|---|
| `3d.shep.bot` | `package.json` (homepage), `context7.json`, `deploy/deployment.yaml`, `deploy/ingress.yaml`, `deploy/kustomization.yaml` (comment), `.github/workflows/ci.yml` (comment), `discover-integrations.yml`, `draft-collections.yml` (PR body links), `prompts/*.md`, `scripts/export-site-data.mjs` (OpenAPI default), `src/api/app.ts` (OG site default), `src/api/og.ts` (comment), `src/api/openapi.ts` (`DEFAULT_PUBLIC_URL`, description), `src/core/telemetry.ts` (notice), `src/og/render.ts` (comment), `web/astro.config.mjs`, `web/integrations/agent-files.mjs`, `web/public/robots.txt`, `web/src/lib/site.ts`, `web/src/lib/faq.ts`, `web/src/data/organization.json`, `web/src/components/stats/CatalogStats.astro`, `web/src/content/AGENTS.md`, `SKILL.md`, `web/src/pages/{about,privacy}.md`, `web/src/pages/docs/{index,mcp,api,cli}.md`, `docs/api/versioning.md`, tests (`og.test.ts`, `service.test.ts`, `site-build.test.ts`, `stats.test.ts`, `fixtures/site/search/index.html`), `docs/SEO-GEO-AUDIT.md`, `docs/images/architecture.svg` |
| `stats.shep.bot`, Umami IDs `41538cf4-1af1-45a6-a5e1-1002e8191af1` (install telemetry) and `8f6824cb-f616-4a20-8f5c-79db417038b2` (site) | `src/core/telemetry.ts`, `deploy/deployment.yaml`, `web/src/pages/privacy.md`, README |
| `grafana.shep.bot`, `LOKI_UID P8E80F9AEF21F6940`, Loki selector `{namespace="asset-server"}` | `scripts/collection-ideas.mjs` |
| `shep-ai/shep-infra`, `kube-prometheus-stack-prometheus.monitoring.svc` | `deploy/*`, `ci.yml` comments |
| `ghcr.io/arielshad/3d-asset-server` | `deploy/deployment.yaml`, `deploy/kustomization.yaml`, `web/src/pages/docs/{self-hosting,cli,mcp}.md`, `web/src/pages/privacy.md`, README. `ci.yml` derives it from `github.repository`. |
| `arielshad/3d-asset-server` (GitHub) | `package.json` (repository, bugs), `src/core/http.ts` (UA), `src/api/openapi.ts` (contact), `web/src/lib/site.ts` (repo), `web/src/data/organization.json` (issues and security URLs), `release.yml` (trusted-publisher comment), `web/src/pages/{about,contact,privacy}.md`, `docs/{cli,mcp,self-hosting}.md` |
| npm package / bin `3d-asset-server` | `package.json`, `release.yml` (pack/smoke/notes), `src/cli.ts` (help and log lines), `src/mcp/server.ts` (server name), `src/api/app.ts` (JSON index name), `src/core/network.ts` (tmp cache dir), `web/package.json` (`3d-asset-server-web`) |
| MCP server name in client config `3d-assets` | `src/api/app.ts` (`claude mcp add ... 3d-assets`), `web/src/lib/agents.ts`, `faq.ts`, `AssetDetail.tsx` (agent prompt), `web/src/content/AGENTS.md` / `SKILL.md` (`name: 3d-assets`), `agent-files.mjs`, `pages/docs/*.md`, `index.astro`, `docs/api/playground.astro`. Telemetry UA `3d-assets/<ver>`. |
| "3D Asset Server" display name | `src/og/render.ts` (brand), `src/api/{openapi,search-meta,site}.ts`, every web lib, page and integration, workflows and prompts ("You are the 3D Asset Server source scout"), `servicemonitor.yaml` comment, `site.webmanifest`, `release.yml` smoke-test grep |
| Metric prefix `asset_server_`, env prefix `ASSET_SERVER_` / `ASSET_DOWNLOAD_DIR`, header `x-asset-client`, localStorage `asset-server-key` | `src/core/analytics.ts`, `stats.ts`, `cli.ts`, `http.ts`, `download.ts`, `service.ts`, `telemetry.ts`, `src/api/app.ts`, `web/src/components/search/api.ts`, docs pages, README, deploy |
| k8s names `asset-server` (namespace, deployment, service, ingress, secret `asset-server-env`) | `deploy/*` |
| Hub ids `hdris`, `textures`, `3d-models`, `game-assets` | `web/src/data/collection-hubs.json`, `web/integrations/og-images.mjs` KICKERS, `prompts/draft-collections.md` |
| `VERSION = "0.1.0"` and UA `/0.1` | `src/mcp/server.ts`, `src/core/http.ts`, `src/api/openapi.ts` (info.version), `deploy` UA |

---

## 13. Tech debt and things not to copy

1. **SSRF guard is lexical only.** `assertPublicUrl` doesn't resolve DNS. `http.raw` follows redirects without re-checking hosts, so `zipStream`, `downloadFiles` and the 302 target all trust the first hop. Use a resolving guard (lookup + private-range check, ideally pinned to the socket) and manual redirects, like `fetchImage` already does.
2. **The 15 s request timeout covers whole download bodies.** `AbortSignal.timeout(15000)` in `http.raw` stays attached while the body streams, so large files on slow CDNs abort mid-zip. This matters for sample packs. Use a separate download client with an idle timeout.
3. **`zipStream` has no byte cap**, and fetches entries strictly sequentially. **`extractZip` is `unzipSync` in memory** with no decompressed-size or entry-count limit (zip-bomb risk, and up to 2 GiB in RAM).
4. **API key**: compared with `!==` (not constant-time), and accepted as a `?api_key=` query parameter, which leaks into logs, browser history and Referer headers. There is a single static key.
5. **`clientIp` trusts the leftmost X-Forwarded-For**. That is fine behind their Caddy but spoofable for self-hosters. The rate limiter is in-memory per pod.
6. **Duplicated vocabularies**:
   - ASSET_TYPES in `src/core/types.ts`, `scripts/lib/topics.mjs`, `web/src/content.config.ts` and `web/src/components/search/api.ts`;
   - type labels in `search-meta.ts`, `agent-files.mjs`, `web/src/lib/collections.ts` and `SearchApp.tsx`;
   - MIN_INDEXABLE and MIN_SOURCES in `core/collections.ts`, `collection-gate.mjs`, `web/src/lib/collections.ts` and `web/integrations/sitemap-meta.mjs`;
   - the web Asset types duplicate the server types.

   For the sound server, put the vocabulary in one shared JSON or TS module and import it everywhere, or generate the duplicates.
7. **Hand-written OpenAPI** (559 lines) that can drift from the zod schemas. It already claims "de-duplicated" results, which `rankResults` does not do.
8. `VERSION` and the UA version are hard-coded and separate from `package.json`.
9. The `isEnabled` hook is unused and untested by real providers.
10. Per-provider `offset` paging is approximate for merged results.
11. `License` lacks fields that freestylized's untyped `notes` papers over.
12. `pageRewrite` has a duplicated JSDoc block. The web depends on the `cn@0.4.0` package needlessly. The web uses TS 6 while the root uses TS 7 (tsgo).
13. **Opt-out telemetry by default** to a personal Umami host (`stats.shep.bot`), with hard-coded IDs, including injecting a tracker into self-hosted copies of the website. Reconsider: make it opt-in, or at least use a new project ID.
14. **Daily bot commits to main** (census data and deploy pins: most of the 56 commits) and a daily image rebuild just to ship data. Consider serving catalog and collections data from a volume, an object store or a separate data branch, or building data-only updates without a full image. The deploy pin uses `sed` on `newTag:`; `kustomize edit set image` would be more robust.
15. Do not copy: `docs/SEO-GEO-AUDIT.md` (history of this site), `docs/images/*.svg` (3D diagrams), `context7.json` (rewrite), `web/src/data/{catalog,catalog-history,collections/*,providers,integrations,openapi}.json` (generated or 3D data), `integrations/registry.json` contents, all `src/providers/*` except `link.ts`, `test/fixtures/<provider>/*`, `web/public/img/search-preview.*`, and the 37 KB `README.md` (rewrite from scratch using its section outline).
16. `og-images.mjs` imports `dist/og/render.js`, so the web build depends on the server having been built first. That ordering is documented but fragile. Keep the `build:server`-then-`build:web` order.
17. The OG and collection pipelines assume every asset has an image. Audio needs a preview-or-waveform equivalent: `toSnapshotAsset` drops assets without an https thumbnail, and `checkImage` only checks images.

---

## 14. Suggested port order for sound-server

1. Copy the A modules verbatim with renames: `http`, `census`, `analytics`, `stats`, `network`, `telemetry` (decide the policy), `ratelimit`, `negotiate`, `site` (add `media-src`), `attribution`, `link.ts`, test helpers, Dockerfile, ci/release workflows, deploy skeleton.
2. Write the new `types.ts` (section 2) and the vocabulary module. Adapt `util.ts` (keywords, formats, licences, a bpm/key query parser) and `service.ts` (new filters and skip rules).
3. Rewrite `download.ts` `selectFiles` (quality picker). Harden the downloads (DNS-aware SSRF guard, streaming unzip with caps, long-download timeout).
4. Build the first providers: Freesound (API + key, `isEnabled`), Wikimedia Commons audio, OpenGameArt audio, Kenney audio, plus link-only marketplaces. Port the fixture tests.
5. Adapt the API param schemas, MCP tools, OpenAPI, search-meta and the OG waveform card.
6. Web: rename `site.ts`/`faq.ts`/`agents.ts`, rewrite AGENTS.md / SKILL.md / docs, adapt SearchApp, AssetDetail and AssetCard with an audio player, define new hubs (drums, loops, vocals, fx, ambience...) and collections.
7. Census → collections → discovery → drafting workflows, with rewritten prompts and FILLER words, a new Loki namespace selector and a new registry.
