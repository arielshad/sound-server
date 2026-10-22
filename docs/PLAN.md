# sound-server: plan to production

**Goal:** search many sample sites at once and download what you pick, for music production and AI
music generation. That covers kicks, snares, hats, claps, 808s, loops, vocals, FX (zaps, risers,
impacts), foley and instrument one-shots. It should work the same way
[3d-asset-server](https://github.com/arielshad/3d-asset-server) does for 3D: an HTTP API, an MCP
server, a CLI and a web UI.

The research behind this plan (all live-checked on 2026-10-22) is in [`docs/research/`](research/):

| File | What it covers |
|---|---|
| [`sources-api.md`](research/sources-api.md) | About 45 sources that have an API or a machine-readable feed: endpoints, limits, licences, terms |
| [`sources-scrape-and-marketplaces.md`](research/sources-scrape-and-marketplaces.md) | About 50 scrapable sites and marketplaces: bot walls, robots.txt, search URL templates, how sample licences work |
| [`audio-tech.md`](research/audio-tech.md) | Category list, audio analysis in Node (BPM, key, loudness, one-shot vs loop), CLAP models, previews, licence model, existing MCP projects |
| [`3d-asset-server-reuse-map.md`](research/3d-asset-server-reuse-map.md) | Every module of 3d-asset-server, marked copy as is, adapt, or replace |

---

## 1. Decisions in one screen

1. **Start from a copy of 3d-asset-server, not a shared library.**
   - About 70% of it is unrelated to 3D and carries straight over: parallel search with a status per site, the cached HTTP client, rate limits, the MCP-over-HTTP setup, the agent files (AGENTS.md, llms.txt), metrics, Docker, CI and GitOps deploy.
   - Copying keeps both services free to move fast. Once both are stable, pull the common core out into a shared package (see §9).
2. **New data model: a sample is not an asset.**
   - Split *what it is* (category, such as `drums.kick` or `fx.riser`) from *its form* (one-shot, loop, phrase, multisample, pack, midi).
   - Add `bpm`, `key`, `durationSec`, sample rate, bit depth, `previewUrl`, and a **licence verdict** that answers "can I put this in a commercial release?".
3. **Licence-first and commercial-safe by default for agents.**
   - Music sample licences have traps that 3D licences don't: royalty-free but no redistribution, CC-BY-NC, CC-BY-SA forcing the whole track under the same licence, the retired Sampling+ licence, BBC's non-commercial terms, and uploader-asserted licences on Internet Archive.
   - Every result gets one of `yes | yes-with-credit | restricted | clearance-required | check-terms | no`.
   - Every download writes `ATTRIBUTION.md` and `credits.json`.
4. **Freesound is the core source, and it has two blockers to clear first** (§8):
   - Its API terms require a separate agreement with UPF (the university that runs Freesound) for commercial apps.
   - Our cloud IP got 403 from freesound.org.
5. **Stay stateless in v1, like 3d-asset-server.**
   - Static sources (Strudel manifests, SampleRadar, curated packs) are small catalogues fetched and cached in memory, the way Poly Haven is today.
   - No database until v2, when we add audio embeddings.
6. **Node 22 (Node 20 is end of life), ffmpeg in the image, no AGPL or GPL audio libraries** (no essentia.js or aubio). Analysis uses ffprobe, music-metadata, our own ACID/`smpl` WAV-chunk parser, music-tempo, meyda and pitchy.
7. **The difference from 3d-asset-server is the agent workflow, not just search.**
   - A `build_kit` MCP tool picks a matching kick, snare, hat, clap and 808 for "140 BPM dark trap in F minor".
   - It downloads them and writes a Strudel sample map, a General MIDI drum map and the credits.

---

## 2. Sources

Tiers work as in 3d-asset-server: **api**, **scrape**, **link** (deep link to the site's own search),
plus a new **static** tier for curated catalogues indexed from manifests.

### v1 launch set (16 searchable + about 15 link-only)

| # | Source | Tier | Best for | Downloads | Licence verdict |
|---|---|---|---|---|---|
| 1 | **Freesound** | api (key) | Everything, 700k+ sounds; native filters for BPM, key, one-shot, loopable and duration | Previews with server key; original WAV needs the user's own OAuth token | per sound: CC0 / BY / BY-NC |
| 2 | **Openverse** | api (no key) | Fallback for Freesound and Wikimedia audio; ready-made attribution strings | Wikimedia files; Freesound previews | per item |
| 3 | **Wikimedia Commons** | api | Instruments, field recordings | yes | per file (filter out MIDI) |
| 4 | **Internet Archive** | api | Vintage drum machines, sample CDs, SFX | yes | **CC/PD `licenseurl` only**, publisher denylist, labelled "uploader-asserted" |
| 5 | **ccMixter** | api | **A cappellas** (about 6k), stems | yes (needs a `Referer` header) | per upload |
| 6 | **BBC Sound Effects** | api (undocumented) | Foley, ambience, 33k sounds | yes | **always `no`** (RemArc licence: personal, education or research only) |
| 7 | **Strudel/Tidal manifests** | static | Drum-machine kits, VCSL orchestral, piano | yes (raw GitHub) | **allow-list per manifest**: VCSL CC0 yes; Dirt-Samples and drum-machine sets have no licence (`check-terms`); clean-breaks excluded |
| 8 | **MusicRadar SampleRadar** | static | About 280 genre packs | yes (zip) | royalty-free, no redistribution |
| 9 | **Kenney** (audio packs) | scrape | Game SFX, UI sounds | yes (zip) | CC0 |
| 10 | **Free Wave Samples** | scrape | Synth and drum one-shots, multisamples | yes (wav) | royalty-free, don't re-host |
| 11 | **Mixkit SFX** | scrape | FX, transitions, whooshes | yes (wav) | commercial OK, no credit; search only, no bulk download |
| 12 | **OpenGameArt** (audio) | scrape | Game SFX, loops | yes | per item CC; 1 request per search |
| 13 | **SoundBible** | scrape | Classic SFX | yes (mp3/wav) | per sound (some personal-use-only, so `no`) |
| 14 | **Orange Free Sounds** | scrape | SFX, loops | yes | per post, often CC-BY |
| 15 | **Cymatics / Prime Loops** | scrape (Shopify `suggest.json`) | Commercial packs, demo MP3s | no (buy or free checkout) | royalty-free |
| 16 | **Curated packs** | static | Philharmonia, Iowa MIS, VSCO 2 CE, Goldbaby, Sonniss GDC, Reverb Machine… | some (direct zips) | per pack, hand-checked |

**Link-only at launch.** These are behind bot walls, or their robots.txt or terms forbid scraping:
Splice, Loopcloud/Loopmasters, Looperman (loops and a cappellas), Sample Focus, Zapsplat, Pixabay
SFX, Producer Loops, ADSR, Plugin Boutique, LANDR, Tracklib (flag `clearance-required`), Soundsnap,
Sonniss, Uppbeat, Bandcamp. Each one still appears in every search as a link to the same query on
its own site.

**Skipped:** Sounds.com (shut down), Spitfire LABS (now a Splice redirect), Soundtrap and Output
Arcade (sounds only live inside the app), Epidemic, Artlist and Envato (licences scoped to
video/content, no usable API), and r/Drumkits (sources of the samples unknown).

**v1.1 candidates:** Ghosthack, Black Octopus and Function Loops (pack previews); BigSoundBank
(search only, robots.txt blocks `/UPLOAD/`); Zenodo and Hugging Face datasets (TinySOL, NSynth) as
bulk "instrument" sources; and a WordPress feed watcher for 99Sounds, Bedroom Producers Blog and
Reverb Machine to discover free packs.

**Rules from the research:**
- One or two requests per search, nothing fetched per result inside `search`.
- Honour robots.txt and terms. A source whose terms forbid scraping is link-only, even when scraping would work technically.
- Never mirror or re-host samples (this is required by Freesound, Free Wave Samples, Philharmonia and every royalty-free licence). Download from the source on behalf of the user, cache only briefly, and stream through.
- Back off on Wikimedia 429s. Send a descriptive User-Agent with contact details everywhere.

---

## 3. Data model (replaces `src/core/types.ts`)

```ts
export type SampleForm = "one-shot" | "loop" | "phrase" | "multisample" | "pack" | "midi" | "preset";

/** Dot-path category, e.g. "drums.kick", "drums.hat.closed", "bass.808", "vocals.chop", "fx.riser". */
export type Category = (typeof CATEGORIES)[number]; // full list in research/audio-tech.md §1

export type CommercialVerdict =
  | "yes" | "yes-with-credit" | "restricted" | "clearance-required" | "check-terms" | "no";

export interface License {
  id: string;                 // SPDX where it exists: CC0-1.0, CC-BY-4.0, CC-BY-NC-4.0 … else LicenseRef-*
  name: string;
  url?: string;
  commercialUse?: boolean;
  attributionRequired?: boolean;
  shareAlike?: boolean;
  /** Can the sample itself be passed on (in a pack, a repo, a dataset)? Almost always false. */
  redistribution?: boolean;
  /** "source" = the site states it per item; "site" = site-wide terms; "uploader" = asserted by an uploader. */
  assertedBy: "source" | "site" | "uploader";
  verdict: CommercialVerdict;
  /** Ready-to-paste credit line when attribution is required. */
  attribution?: string;
}

export interface Sample {
  id: string;                 // `${provider}:${nativeId}`
  provider: string;
  nativeId: string;
  title: string;
  description?: string;
  url: string;                // page on the source site
  author?: string;
  tags: string[];
  genres?: string[];
  category?: Category;
  categoryEvidence?: { by: "source" | "file" | "rules" | "model"; confidence: number };
  form?: SampleForm;
  unit: "sample" | "pack" | "instrument";
  packSize?: number;          // number of files when unit = "pack"
  bpm?: number;
  key?: { tonic: string; mode: "major" | "minor" };   // e.g. F minor
  rootNote?: number;          // MIDI note for pitched one-shots
  durationSec?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  loudnessLufs?: number;
  previewUrl?: string;        // always playable (mp3/ogg), may be lower quality
  previewNeedsReferer?: boolean;   // served through our /v1/preview proxy when true
  thumbnailUrl?: string;      // pack artwork when there is one
  formats?: string[];         // wav, aiff, flac, ogg, mp3, mid, zip
  license?: License;
  price?: { free: boolean; amount?: number; currency?: string };
  requiresAccount?: boolean;
  downloadable: boolean;
  createdAt?: string;
  score?: number;
}

export interface SampleFile {
  url: string;
  filename: string;
  format: string;
  role: "original" | "preview" | "pack" | "stem" | "midi";
  sampleRate?: number;
  bitDepth?: number;
  sizeBytes?: number;
  requiresAuth?: boolean;
  headers?: Record<string, string>;   // e.g. Referer for ccMixter
}

export interface SampleQuery {
  query: string;                 // free text; "140 bpm dark 808 in F minor" is parsed into the filters below
  categories?: Category[];       // prefix match: "drums" matches "drums.kick"
  forms?: SampleForm[];
  bpm?: { min?: number; max?: number };      // or exact ± tolerance, with half/double-time matching
  key?: { tonic: string; mode?: "major" | "minor"; compatible?: boolean };
  maxDurationSec?: number;
  commercialOnly?: boolean;      // verdict in yes / yes-with-credit (agent default: true)
  freeOnly?: boolean;
  limit: number;
  offset?: number;
}
```

The `Provider` interface (`search`, `getAsset`, `buildSearchUrl`, `census`, `isEnabled`) and
`HttpClient` stay **as they are**, with Asset renamed to Sample. Each provider declares which
filters it handles natively (Freesound handles all of them). The service then applies the rest
locally, and the per-site status report says which filters a site couldn't apply.

---

## 4. What we take from 3d-asset-server

Full module-by-module map: [`research/3d-asset-server-reuse-map.md`](research/3d-asset-server-reuse-map.md).

| Keep (copy, rename) | Adapt | Replace / write new |
|---|---|---|
| `core/http.ts` (cache, deduplication of identical in-flight requests, timeouts) | `core/types.ts` → the model above | 24 of the 25 providers, their fixtures and collections |
| `core/census.ts`, `analytics.ts`, `stats.ts`, `network.ts` | `core/service.ts`: new filters, deduplication across sites, ranking boosts for BPM/key/category | `core/download.ts` file picker: lossless first (wav > aiff > flac > ogg > mp3), never a preview unless asked |
| `api/ratelimit.ts`, `negotiate.ts`, `site.ts`, `mcp/attribution.ts` | `core/util.ts`: licence table becomes SPDX ids plus verdicts; keyword list becomes the category alias file | **new** `core/classify.ts`: tags, filename, file chunks, duration → category, form, confidence |
| `providers/link.ts`, `test/helpers.ts` (`fixtureHttp`), test fakes | `api/app.ts`, `openapi.ts`, `mcp/server.ts`, `cli.ts`: new tools and filters | **new** `core/analyze.ts`: ffprobe, ACID/`smpl` parser, ebur128, music-tempo, meyda key, pitchy |
| Dockerfile, CI and release workflows, `deploy/` | `collections.ts` and OG cards: waveform image instead of thumbnail | **new** `core/licence.ts`: verdict and attribution text |
| census, collections, discovery and review automation (scripts, prompts, gates) | `web/`: same shell and design system; a search UI with waveform player, BPM/key filters and licence badges | **new** `core/export.ts`: Strudel map, GM drum map, credits (SFZ/Decent Sampler later) |

**Fix on the way in.** These are issues in 3d-asset-server that matter more for audio:
- The HTTP timeout covers the whole response body. That will cut off large sample packs, so stream downloads with an idle timeout instead.
- Cap the size of zip bundles and of zip extraction, and extract by streaming rather than in memory.
- Re-check the address after DNS lookup and after every redirect when guarding against requests to internal hosts.
- Compare the API key in constant time, and stop accepting it as `?api_key=`.
- Trust `X-Forwarded-For` only from the edge proxy.
- Add `media-src 'self' https:` to the CSP, or no preview will play.
- Make telemetry opt-in.
- Centralise the type and category lists; they are copied in about four places today.
- Generate the OpenAPI spec from the zod schemas instead of writing it by hand.
- 3d-asset-server's OpenAPI text says results are de-duplicated, but they are not. Make it true here, since Openverse returns Freesound items again.

Applying these back to 3d-asset-server is worth a separate PR there.

---

## 5. Agent surface (MCP, HTTP API, CLI)

**MCP tools:**

| Tool | What it does |
|---|---|
| `search_samples` | Free text plus filters. Returns results with category, form, BPM, key, duration, licence verdict, preview URL, and a status line per site. |
| `get_sample` | Full detail and files. Fills in missing BPM, key, duration and loudness by analysing the preview (cached). |
| `download_sample` | Writes the original into `SOUND_DOWNLOAD_DIR/<category>/`, plus ATTRIBUTION.md and credits.json. |
| `build_kit` | Inputs: "kick, snare, clap, closed hat, open hat, 808", BPM, key, genre, `commercialOnly`. Picks one per slot, downloads them, writes `strudel.json`, a GM drum map and the credits. |
| `find_similar` | v1 uses Freesound's similarity search; v2 uses our own embeddings. |
| `list_sources` | Same as 3d-asset-server. |

**HTTP API** (`/v1`):
- Same shape as 3d-asset-server: `/v1/search`, `/v1/samples/:id`, `/v1/samples/:id/download` (zip bundle with credits), and `/v1/sources`.
- New `/v1/samples/:id/preview`: a proxy for previews that need a `Referer` header, with CORS so Strudel and browser DAWs can load them.
- New `/v1/kits` (POST).

**CLI:** `sound-server search "dusty snare" --category drums.snare --commercial`, `sound-server kit --bpm 140 --key "F minor" --genre trap`.

**Agent files:** copied from 3d-asset-server (AGENTS.md, llms.txt, SKILL.md, a Markdown copy of every docs page). They gain a "licensing for music" section that agents must follow: report the verdict, and never present `no` or `check-terms` results as cleared.

Integrations worth testing against (from the research): ableton-mcp, the Strudel MCPs (they need a
sample map plus CORS), and the REAPER MCPs.

---

## 6. Web UI

- Reuse the 3d-asset-server Astro + React + Tailwind + shadcn/ui shell, layouts and docs pages.
- **Search page:**
  - Category chips (Drums ▸ Kick/Snare/…, Bass, Vocals, FX, Foley, Instruments).
  - Form toggle (one-shot / loop).
  - BPM range and key picker.
  - "Commercial-safe" switch.
  - Results as rows with a waveform (wavesurfer.js v8, BSD), click or hover to play, keyboard navigation (↑↓ to audition, like Splice), and verdict badges (green / amber / red).
- **Detail sheet:** licence explanation, credit line to copy, format and sample-rate picker, curl and agent snippets.
- **Collections/SEO hubs:** "free 808 samples", "free trap drum kits", "free vocal chops", "free riser FX", "free vinyl crackle"… built by the same daily census and weekly drafting jobs.

---

## 7. Milestones

Each milestone ends with green CI and something running.

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Scaffold** (≈1 day): copy the reusable parts of 3d-asset-server, rename everything (package, env prefix `SOUND_SERVER_*`, metric prefix, image, domain), Node 22, remove 3D providers, data, collections and SVGs. Keep one link provider. | `npm test`, build and typecheck pass; `serve` shows an empty search page; Docker image builds. |
| **M1** | **Core model + 4 API sources:** new types, query parser ("140 bpm F minor 808"), `classify.ts` with the category alias YAML, `licence.ts` verdicts, de-duplication and ranking. Sources: Freesound, Openverse, Wikimedia, ccMixter. Offline fixture tests for each, plus live tests behind `LIVE=1`. | `search_samples "punchy kick"` returns ranked, categorised results with verdicts from at least 3 sources. |
| **M2** | **Download pipeline:** file picker, streaming with idle timeout, zip limits, preview proxy, ATTRIBUTION.md and credits.json, the security fixes from §4. | Downloads of a Freesound original (with a user token), a Wikimedia OGG and a SampleRadar zip all work end to end, with credits. |
| **M3** | **Remaining v1 sources:** Internet Archive (filtered), BBC, Strudel manifests, SampleRadar, Kenney, Free Wave Samples, Mixkit, OpenGameArt, SoundBible, Orange Free Sounds, Shopify packs, curated packs, the link-only set, and `integrations/registry.json`. | Every source has fixture tests; `npm run test:live` is green from the production network. |
| **M4** | **Analysis + kits:** ffmpeg in the image, `analyze.ts`, `build_kit`, Strudel and GM exports, waveform peaks. | An agent builds a playable 140 BPM trap kit in Strudel from one prompt. |
| **M5** | **Web UI:** search page, player, detail sheet, docs, agent files, OpenAPI reference, collections. | Lighthouse ≥ 90; previews play; works at phone width. |
| **M6** | **Production:** GHCR image, `deploy/` for `sound.shep.bot` (namespace `sound-server`), ArgoCD app in `shep-ai/shep-infra`, `sound-server-env` Secret (`FREESOUND_API_KEY`, session secret), ServiceMonitor and Grafana panels, npm release `npx sound-server`, `claude mcp add --transport http sounds https://sound.shep.bot/mcp`. | Public URL serves search, MCP and downloads; alerts on per-source error rate. |
| **M7** | **Automation:** daily census, collection drafting and review, daily source discovery (prompts adapted to audio and the licence rules). | First automated collection PR merged. |

**v2:**
- CLAP embeddings (`@huggingface/transformers` + `Xenova/larger_clap_music_and_speech`, Apache-2.0) stored in sqlite-vec. That enables "find similar", text-to-sound re-ranking, cross-site de-duplication and a 2-D sound map.
- CLAP as a fallback classifier when the keyword rules aren't sure.
- MIDI from melodic loops (basic-pitch).
- SFZ / Decent Sampler multisample export.
- Persistent analysis cache.

---

## 8. Risks and open questions

| Risk | Plan |
|---|---|
| **Freesound terms:** commercial use of the API needs a case-by-case agreement with UPF; no mirroring; only temporary caching. | Before M6, email Freesound/UPF describing a free public aggregator. Until then: hosted search uses previews only, no catalogue copies, and only a short-lived cache; local MCP/CLI users bring their own key and OAuth token. |
| **Freesound blocked our cloud IP** (403 from this sandbox). | Test from the production cluster's outbound IP in M1. Fallback: Openverse (no key, but its Freesound index is from 2024). |
| Openverse has a low anonymous limit (200 requests/day). | Register a free OAuth client before launch. |
| Licence mistakes cost far more than in 3D (Content ID claims, takedowns). | Verdicts are computed in one module with table tests. Uploader-asserted and no-licence items are never marked `yes`. Agents default to `commercialOnly`. |
| Internet Archive contains pirated commercial libraries. | CC/PD-only filter, publisher denylist, "uploader-asserted" label, takedown contact on `/contact`. |
| Scraped HTML changes. | As in 3d-asset-server: the failure stays in that site's status line, live tests run nightly, and the census flags drops. |
| Docker image grows (ffmpeg about +60 MB; CLAP model about 300 MB in v2). | ffmpeg from the Alpine package; in v2 download the CLAP model on first use into a volume, not into the image. |

**Questions for you:**
1. **Domain:** `sound.shep.bot` (my default) or something else?
2. **Hosting model:** is the hosted service free and non-commercial? That decides how the Freesound agreement goes.
3. **BBC, and other non-commercial sources:** include them in default results with a red badge (my default), or hide them unless asked?
4. **Code sharing:** copy now and extract a shared core later (my recommendation), or extract the shared package first?

---

## 9. Later: shared core

Once both services are in production, the parts marked "Keep" in §4 can become a package used by
both: HTTP client, aggregator, rate limit, MCP over HTTP, agent site, analytics. Each service would
then hold only its domain types, providers and web UI. Doing that first would hold up the sound
launch for little gain; doing it after M6 is mostly moving files.
