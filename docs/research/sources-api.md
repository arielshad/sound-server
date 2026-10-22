# sound-server: sample sources with a public API or machine-readable endpoint

Research date: 2026-10-22. Every endpoint below was called with `curl` from this sandbox unless it is marked otherwise. No credentials were used.

Status legend:
- **LIVE**: the call returned 200 with data.
- **LIVE-401**: the endpoint exists but needs a key.
- **BLOCKED**: a Cloudflare challenge or bot wall answered.
- **NOT-TESTED**: the claim comes from documentation or web search only.

> Sandbox caveat: everything on `freesound.org`, including `cdn.freesound.org`, returned a bare **403 with an empty body**. That includes the homepage, so it looks like a block of this egress IP, not an API answer. Checked through WebFetch on a different egress, `GET /apiv2/search/` returned **401**: the API is live and wants a token. Production egress from a residential or cloud IP should be fine, but test this early.

## 1. Summary table

| # | Source | Best for | Size (approx.) | Machine-readable access (verified?) | Auth | Direct audio without login | Formats | Licence / commercial / attribution | ToS on automation | v1? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Freesound** APIv2 | Everything: drums, FX, foley, synth hits, field recordings, some loops | 700k+ sounds (Wikipedia, Aug 2026) | REST `/apiv2/search/`: LIVE-401 via WebFetch; 403 from sandbox | Free API key (token). OAuth2 needed for the original file | Previews (mp3/ogg) **yes, with a token**. Original wav/flac/aiff **no** (OAuth2 user) | Original as uploaded; previews mp3/ogg 64–128k | Per sound: CC0 / CC BY 4.0(3.0) / CC BY-NC 4.0(3.0). Legacy Sampling+ still present | API ToS: no full DB copies, no scraping. Commercial apps need a deal with UPF. 60 req/min, 2000/day | **YES (core)** |
| 2 | **Openverse** API | Meta-index of Freesound, Wikimedia audio and Jamendo | Freesound 591,897 · Wikimedia 3,983,517 · Jamendo 644,709 (live `/stats`) | `api.openverse.org/v1/audio/`: **LIVE 200** | None (anonymous). Free OAuth client for more | Wikimedia files yes. Freesound only via preview URL (`cdn.freesound.org`). Jamendo stream | mp3 previews; `alt_files` lists the original wav | CC licence and ready-made attribution string per item | Anonymous: 20/min, 200/day, page_size ≤20, results capped at 240 per query | **YES** (fallback and discovery) |
| 3 | **Wikimedia Commons** | Instruments, field recordings, some drum hits (mostly not production samples) | ~4M audio files (incl. MIDI and pronunciations) | MediaWiki API: **LIVE 200**, but **frequent 429** without a descriptive UA | None. A descriptive User-Agent is mandatory. Auth gives higher limits | **Yes** (`upload.wikimedia.org`) | ogg/oga, wav, flac, mp3, opus, **mid** (filter out) | Per file: PD / CC0 / CC BY / CC BY-SA; `extmetadata.AttributionRequired` | Bot policy: descriptive UA, serial requests, `maxlag`. Allowed | **YES** |
| 4 | **Internet Archive** | Vintage drum machines, sampler CD-ROM dumps, Amiga packs, SFX libraries | 6,105 "sample-ish" audio items; 1,942 with a CC/PD `licenseurl` | `advancedsearch.php`, `services/search/v1/scrape`, `/metadata/{id}`: **LIVE 200** | None | **Yes** (`archive.org/download/{id}/{file}`) | wav, flac, mp3, aiff, zip (per-file list) | `licenseurl` is often **missing** and is uploader-asserted. Many items are pirated commercial libraries (Akai, Ueberschall, Zero-G, "Universal Studios SFX") | Automated access OK (polite). **Copyright risk is high** | **YES, CC/PD `licenseurl` only** |
| 5 | **Strudel / Tidal sample manifests** (GitHub raw JSON) | Drum machines (683 banks), Dirt-Samples, VCSL orchestral/percussion, piano | tidal-drum-machines 2,348 files · Dirt-Samples 2,038 · VCSL 1,908 · + others | `raw.githubusercontent.com/.../strudel.json`: **LIVE 200** | None | **Yes** (raw GitHub) | wav (mostly), mp3 (piano) | **Mixed**: VCSL CC0; Salamander piano CC BY 3.0; mridangam CC BY-SA 4.0; **Dirt-Samples and tidal-drum-machines: no licence** (drum machine ROM dumps); **clean-breaks: copyrighted breakbeats** | GitHub raw has rate limits; fine at low volume | **YES, per-manifest licence allow-list** |
| 6 | **BBC Sound Effects** (RemArc) | Foley, ambience, vehicles, nature, mechanical FX | 33,066 (live API total) | Undocumented JSON API: `POST sound-effects-api.bbcrewind.co.uk/api/sfx/search`: **LIVE 200** | None | **Yes**: mp3 + wav-in-zip on `sound-effects-media.bbcrewind.co.uk` | wav 44.1k/16-bit (zipped), mp3 128k | **RemArc: personal, educational or research only. Not commercial** (commercial via Pro Sound Effects). Attribution required. AI training/data-mining excluded | API is private/undocumented. Licence forbids commercial use | **YES, flag `commercial=false`** |
| 7 | **ccMixter** Query API | **A cappellas / vocals**, stems, loops | 5,985 acappella · 15,957 "sample" · 6,274 "loops" uploads | `ccmixter.org/api/query?f=json&tags=acappella`: **LIVE 200** | None | Yes, but needs a `Referer` header (hotlink guard: 403 without, 206 with) | mp3 mostly; some wav/flac/zip stems | CC BY / BY-NC / BY-SA / Sampling+ per upload (`license_url`) | Public query API, intended for reuse | **YES** (vocals) |
| 8 | **Zenodo** REST | Academic datasets: TinySOL (CC BY 4.0, 1 GB), freeDB drum kits, etc. | Dataset-level | `zenodo.org/api/records/?q=...`: **LIVE 200** | None (token for higher limits) | **Yes** (file links) | tar.gz/zip of wav | Per record (`metadata.license`) | Open API, rate-limited | Optional (bundle importer) |
| 9 | **Hugging Face Hub** | NSynth and other datasets | NSynth ~305k notes | `huggingface.co/api/datasets?search=`: **LIVE 200** | None for public | Yes | parquet/wav | NSynth CC BY 4.0 | OK | Optional |
| 10 | **NSynth** (Magenta) | Single-note instrument samples (4 s, 16 kHz) | 305,979 notes | Static tarballs: `download.magenta.tensorflow.org/datasets/nsynth/nsynth-test.jsonwav.tar.gz` **LIVE 200** (349 MB) | None | Yes (bulk tarball only) | wav 16 kHz + JSON metadata (pitch, velocity, instrument family/source, qualities) | CC BY 4.0 | OK | Optional (offline index) |
| 11 | **Kenney** audio | Game SFX: UI, impact, sci-fi, RPG, casino, voice-over, jingles | ~12 audio packs | HTML listing `kenney.nl/assets/category:Audio` (LIVE) + direct zip | None | **Yes** (zip, verified 206) | ogg/wav in zip | **CC0** | No API. Tiny static set: index by hand | **YES (static seed)** |
| 12 | **OpenGameArt** | Game SFX and music; some drum and synth packs | ~tens of thousands of audio entries | No API. `rss.xml` (LIVE) + HTML advanced search (LIVE) + direct `/sites/default/files/*.wav` (206) | None | **Yes** | wav/ogg/mp3/zip | Per entry: CC0, CC BY(-SA) 3/4, GPL, OGA-BY | No explicit ban. Polite scraping | YES (scraper) |
| 13 | **itch.io** game assets | Game SFX packs | 5,725 assets tagged sound-effects | RSS: `itch.io/game-assets/free/tag-sound-effects.xml` (**LIVE**, 36 items/feed). HTML 429 under load | None | No: download goes through itch's purchase or "no thanks" flow | zip | Free-text per page | Rate-limited (429 seen) | Link-only (RSS discovery) |
| 14 | **Philharmonia** samples | Orchestral single notes | ~13k notes | Static page with 5 S3 zips (`all-samples.zip` 260 MB, LIVE 200) | None | Yes | mp3 | Free incl. commercial works; **must not be redistributed "as is" as samples** | — | Static seed (link to zip) |
| 15 | **Univ. of Iowa MIS** | Orchestral and percussion notes, anechoic | Several thousand files | Static HTML pages with direct `.aiff` links (LIVE) | None | Yes | aiff 16/44.1 mono; 24/96 stereo zips | "Used for any projects, without restrictions" | — | Static seed |
| 16 | **VSCO 2 CE / VCSL** (Versilian) | Orchestral, percussion, world instruments | VCSL ~1.9k files (via manifest) | GitHub raw (LIVE). Use the Strudel `vcsl.json` | None | Yes | wav, sfz | **CC0** | — | **YES** (via manifest) |
| 17 | **Sonatina Symphonic Orchestra** | Orchestral multisamples | ~500 MB | GitHub `peastman/sso` (raw LIVE) | None | Yes (release zip) | wav + sfz | **CC Sampling Plus 1.0** (retired licence; sampling OK, no verbatim redistribution) | — | Static seed (flag licence) |
| 18 | **FreePats** | GM-style multisample instruments | ~30 instruments | Static HTML (LIVE) with direct tarballs | None | Yes | sfz/sf2/flac/wav in tar.xz | Per instrument: CC0, CC BY 3.0, GPL… | — | Static seed |
| 19 | **MusicRadar SampleRadar** | Big genre packs: loops, one-shots, multis | ~280+ packs, 100k+ samples | Sitemaps (`sitemap-YYYY-MM.xml`, LIVE) + article HTML → direct zip on `cdn.mos.musicradar.com` (LIVE 200, e.g. 60 MB) | None | **Yes** | wav in zip | Royalty-free for your music; no redistribution | Scraping not explicitly allowed; low volume | YES (crawler → pack-level) |
| 20 | **Free Wave Samples** | Synth/drum-machine one-shots (Casio, Korg…) | Few thousand | No API/sitemap. HTML category pages + `/files/*.wav` (LIVE) | None | **Yes** | wav 16/44.1 | Royalty-free; **don't re-host for download** (link to source). No attribution needed | "We don't prevent direct linking" | YES (scraper, link back) |
| 21 | **Mixkit** (Envato) | SFX (incl. some drums/risers) | ~2–3k SFX | HTML pages expose `assets.mixkit.co/active_storage/sfx/{id}/{id}.wav` (**LIVE**, wav 206) | None | **Yes** | wav, mp3 preview | Mixkit SFX Free Licence: commercial OK, no attribution, no standalone redistribution | Envato ToS forbids scraping (verify) | Maybe (HTML scraper) |
| 22 | **SoundBible** | Generic SFX | ~2k sounds (sitemap 4,995 URLs incl. tags) | `soundbible.com/sitemap.xml` (LIVE) + `grab.php?id=N&type=wav|mp3` | None | Yes | wav, mp3 | Per sound: CC BY 3.0 / PD / Sampling Plus / **personal use only** | — | Maybe |
| 23 | **Looperman** | **Loops and a cappellas** (user uploads) | 435k+ loop ids | No API. HTML listing has `data-mp3` previews + schema.org JSON-LD + sitemaps (LIVE). Preview mp3 needs a `Referer` | Login needed for WAV | Preview mp3 only | mp3 preview; wav after login | Loops: royalty-free in derivative works (registered users). A cappellas: default personal/non-commercial, uploader-specific | **ToS explicitly forbids scrapers, spiders and data mining** and ML training | **Link-only** |
| 24 | **SampleSwap** | Drum hits, loops, kits | ~10k+ samples, 2,042 songs | HTML file browser (LIVE). mp3 previews | **Login required for WAV** ("registration…to fight robots") | Preview only | wav (login), mp3 preview | Royalty-free samples | Anti-robot by design | Link-only |
| 25 | **Sample Focus** | Community one-shots and loops | ~? (100k+) | **BLOCKED** (Cloudflare 403). robots.txt disallows `/samples/*/download` and `/api/*?` | Account | No | wav/mp3 | Standard licence: commercial OK, no attribution, no resale | robots + licence bar AI crawlers | Link-only |
| 26 | **Splice** | Pro loops and one-shots | Millions | GraphQL `surfaces-graphql.splice.com/graphql` exists but is **BLOCKED** (Cloudflare) | Subscription + credits | No | wav | Royalty-free to subscribers | No public API; ToS forbids scraping | Link-only |
| 27 | **BandLab Sounds** | Free loops and one-shots | 100k+ | `/api/v3.0/sounds/*` → **401** (needs login). `/api/v4.3/soundbanks` is public (instrument banks for Studio) | BandLab account | No | m4a/wav | Royalty-free for account holders | Private API | Link-only |
| 28 | **Pixabay** SFX/music | SFX, music | 100k+ SFX | **Public API covers images and video only** (docs confirmed). Site pages are behind Cloudflare (403) | — | No | mp3 | Pixabay Content Licence (commercial OK, no attribution) | "Systematic mass downloads are not allowed" | Link-only |
| 29 | **Epidemic Sound** | SFX (90k–250k) + music | — | Partner API (`developers.epidemicsound.com`). Free tier: 50 downloads/100 streams lifetime, cannot go live | API key; paid partnership | No | — | Subscription | Partner-only | No |
| 30 | **Artlist** | Music + SFX | — | Enterprise Music API only (developer.artlist.io) | Enterprise | No | — | Subscription | — | No |
| 31 | **Soundsnap** | Pro SFX (~800k) | — | No public API. Data licensing at $100k+/yr (Datarade) | — | No | — | Subscription | — | No |
| 32 | **Envato Elements** | SFX (~500–780k) | — | No public search API for SFX found | Subscription | No | — | Subscription | — | No |
| 33 | **Zapsplat** | SFX (~150k), some music | — | **BLOCKED** (403 on everything) | Free account | No | wav/mp3 | Free tier needs attribution | — | Link-only |
| 34 | **Uppbeat** SFX | SFX, music | — | **BLOCKED** (429 on everything) | Account | No | — | Free tier needs credit | — | Link-only |
| 35 | **Sonniss GDC bundles** | Pro game SFX, huge (7–30 GB/yr) | 200+ GB cumulative | **BLOCKED** (403 Cloudflare). Historically torrent + 100 downloads/day | None | Bundle only | wav 24/96 | Royalty-free, commercial, no attribution. 2026 licence may bar AI/ML training (unverified) | — | Link-only |
| 36 | **99Sounds** | Free genre packs (loops/one-shots/cinematic) | 73 posts | **WP REST LIVE** (`/wp-json/wp/v2/posts`, X-WP-Total 73) | None | No: Gumroad "$0" checkout | wav | Royalty-free, commercial OK | — | Link-only (WP discovery) |
| 37 | **Bedroom Producers Blog** | News of freebies (aggregator) | 1,887 posts match "free samples" | **WP REST LIVE**. Categories "Free Samples", "bpb Samples" | None | No (links out) | — | Varies | Homepage 403 to curl, API OK | Discovery feed only |
| 38 | **Reverb Machine** | Synth presets/samples (some free) | — | WP REST LIVE | — | No (email/Gumroad) | — | Varies | — | Link-only |
| 39 | **Legowelt** | Drum machine / synth sample kits (excellent) | ~25 kits | WP REST LIVE. Downloads are **WeTransfer links (expire)** | None | No (stable) | wav 16-bit | "Free to use in your productions" | — | Link-only |
| 40 | **Goldbaby** freebies | Analog drum machine one-shots | ~20 packs | Static HTML. Downloads via MediaFire | None | No (MediaFire page) | wav | Royalty-free | — | Link-only |
| 41 | **Cymatics** | Free "VAULT" packs | Shopify catalog | `cymatics.fm/collections/free-downloads/products.json` **LIVE** (Shopify JSON) | Email gate for download | No | wav | Royalty-free | — | Link-only (catalog via JSON) |
| 42 | **LANDR Samples** | Pro loops/one-shots | — | Private API (`api3.landr.com`) behind an SPA | Account | No | — | Subscription | — | No |
| 43 | **Tracklib** | Sample clearance of real records | — | robots.txt `Disallow: /api` | Paid | No | — | Clearance licence | — | No |
| 44 | **Loopcloud** (Loopmasters) | Pro loops | — | No public API (app/plugin) | Subscription | No | — | — | — | No |
| 45 | **Hydrogen drumkit feed** | Drum kits (.h2drumkit) | ~100 kits | `hydrogen-music.org/feeds/drumkit_list.php`: **TLS cert mismatch** from sandbox | None | (SourceForge) | flac/wav | GPL / CC mixed | — | Later |

## 2. Details per source

### 2.1 Freesound (freesound.org): core source
- **Docs:** https://freesound.org/docs/api/
- **Apply for a key:** https://freesound.org/apiv2/apply. It is free and gives an API key ("client secret" used as `token`) plus OAuth2 client credentials.
- **Search endpoint:** `GET https://freesound.org/apiv2/search/?query=kick&filter=...&fields=...&page_size=150&token=KEY`.
  - `/apiv2/search/text/` is the deprecated v1-style name. The docs now list a single `/search/`.
  - Params: `query`, `filter` (Solr syntax), `sort` (`score`, `duration_asc|desc`, `created_*`, `downloads_*`, `rating_*`, or a numeric target like `pitch:220`), `group_by_pack`, `fields`, `page`, and `page_size` (≤150).
  - `similar_to` (sound id or vector) with `similarity_space` (`laion_clap` 512-d or `freesound_classic` 100-d). This allows text-to-sound and audio-similarity search.
  - Verified live: WebFetch got **401 Unauthorized** without a token. From the sandbox, freesound.org gives 403 for everything (IP block).
- **Filters:**
  - Metadata: `tag`, `type` (wav/aiff/flac/mp3/ogg/m4a), `duration`, `samplerate`, `bitdepth`, `channels`, `license`, `pack`, `username`, `created`, `num_downloads`, `avg_rating`, `category`/`subcategory` (Freesound's Broad Sound Taxonomy, e.g. Instrument samples → Percussion), `is_remix`, `gen_ai_preference`.
  - Audio descriptors: `bpm`, `bpm_confidence`, `note_name`, `note_midi`, `note_confidence`, `tonality`, `loopable`, **`single_event`** (one-shot vs. not), `onset_count`, `pitch`, `brightness`, `hardness`, `warmth`, `reverbness`, and more.
  - The `ac_tempo` / `ac_note_name` names belong to the old Audio Commons descriptors. The current docs use `bpm` and `note_name`.
- **Sound fields:**
  - `previews` (`preview-hq-mp3` ~128k, `preview-lq-mp3`, `preview-hq-ogg`, `preview-lq-ogg`), `download` (original), `images` (waveform, spectrogram), `license`, `username`, `pack`, `tags`, `description`, `duration`, `samplerate`, `bitdepth`, `channels`, `filesize`, `type`, and analysis.
  - Similar sounds: `/apiv2/sounds/<id>/similar/`. Analysis: `/apiv2/sounds/<id>/analysis/`.
- **Download:**
  - The original file (`/sounds/<id>/download/`, `/packs/<id>/download/`) needs **OAuth2 Bearer**: an end user logs in through an authorization-code flow.
  - Previews need **no OAuth2**. A token is fine, and preview URLs on `cdn.freesound.org` are plain GETs.
  - So: v1 can offer preview mp3/ogg for free, and full-quality downloads after "Connect Freesound account".
- **Rate limits:**
  - 60 req/min and 2,000 req/day per user.
  - Original downloads: 30/min and 500/day.
  - `GET /apiv2/usage/` shows the remaining quota.
- **Licences:**
  - CC0, CC BY (3.0/4.0) and CC BY-NC (3.0/4.0) per sound. Some legacy Sampling+ sounds remain.
  - Commercial use in music is OK for CC0 and BY. Attribution is required for BY and BY-NC. Exclude NC from commercial results.
- **API ToS** (https://freesound.org/help/tos_api/):
  - No full copies of the database and no scraping.
  - Only temporary or intermediate caching.
  - Don't expose the API or content outside your app.
  - Commercial use of the API needs a case-by-case agreement with UPF.
  - An aggregator that *proxies search* fits the terms. Do not mirror the catalogue.

### 2.2 Openverse (api.openverse.org)
- **Endpoint:** `GET https://api.openverse.org/v1/audio/?q=snare&source=freesound&license=cc0&page_size=20`. Verified **LIVE 200**.
- **Sources** (from `GET /v1/audio/stats/`, live): `freesound` 591,897 · `wikimedia_audio` 3,983,517 · `jamendo` 644,709.
- **Fields per result:**
  - `title`, `url` (Freesound HQ mp3 preview), `alt_files` (original wav `.../apiv2/sounds/{id}/download/`, which needs OAuth), `license`, `license_version`, `license_url`, `creator`, `tags`, `duration` (ms), `filesize`, `filetype`, `bit_rate`, `sample_rate`, `foreign_landing_url`, and **`attribution`** (a ready string).
  - Filters: `license`, `license_type=commercial`, `source`, `extension`, `category`, `length`.
- **Limits** (from response headers): anonymous **20/min burst, 200/day sustained**, `page_size` ≤20, and about 240 results per query (12 pages).
- **Registered app:** free OAuth2 `client_credentials` via `POST /v1/auth_tokens/register/`. It raises the limits.
- **Why it's useful:** it gets Freesound metadata and licence **without a Freesound key**. It is also a fallback when the Freesound key is exhausted. Caveats:
  - Its Freesound index looks stale: items show `indexed_on` 2024.
  - It can't give Freesound originals.
  - Preview URLs point to cdn.freesound.org.

### 2.3 Wikimedia Commons
- **Endpoint:**
  ```
  https://commons.wikimedia.org/w/api.php?action=query&generator=search
    &gsrsearch=snare%20filetype:audio&gsrnamespace=6&gsrlimit=50
    &prop=imageinfo&iiprop=url|size|mime|extmetadata
    &iiextmetadatafilter=LicenseShortName|Artist|AttributionRequired|LicenseUrl
    &format=json&formatversion=2
  ```
  Verified **LIVE 200**: it returned `File:Snare spill.ogg`, CC BY-SA 3.0, `AttributionRequired: true`, and a direct `upload.wikimedia.org` URL.
- **Gotchas:**
  - `filetype:audio` includes **MIDI** files. Filter out `audio/midi`, or use `filemime:` (e.g. `filemime:audio/x-flac`; one count gave 51,808 for `audio/mpeg`).
  - Requests got **HTTP 429 "too many requests"** repeatedly, even at about 1 req/3 s. This is the 2025+ Wikimedia rate-limit regime for unauthenticated or shared IPs.
  - Required: a descriptive `User-Agent` with contact details, serial requests, `maxlag=5`, and exponential backoff. Authenticating (bot password or OAuth) raises the limits.
- **Content:** mostly pronunciations, field recordings and instrument demos. There are few production-ready one-shots. Use a low ranking weight.

### 2.4 Internet Archive
- **Endpoints** (all **LIVE 200**):
  - `https://archive.org/advancedsearch.php?q=<lucene>&fl[]=identifier&fl[]=title&fl[]=licenseurl&fl[]=downloads&sort[]=downloads+desc&rows=50&output=json`
  - `https://archive.org/services/search/v1/scrape?q=...&fields=identifier,title,licenseurl&count=100` (cursor paging; returned `total: 892` for a PD-licensed "samples" query)
  - `https://archive.org/metadata/{identifier}`: the file list with `name`, `format` (WAVE/Flac/VBR MP3), `size`, `length`, plus the `server`/`dir`
  - Download: `https://archive.org/download/{identifier}/{filename}`
- **Example:** `tempest-808-kick-03` (Dave Smith Tempest Drum Samples) has 190 files, each one-shot in wav, flac and mp3. It has **no licenseurl**.
- **Size:**
  - Sample-related audio items: 6,105.
  - Items with a CC/PD `licenseurl`: **1,942**. Examples: Amiga Soundtracker Sample Packs (CC0), Sound_Effects (CC0), Salamander Grand Piano (CC BY 3.0), OpenPathMusic samples (CC BY 3.0).
- **Big caveat:**
  - Many top results are uploads of **commercial sample CDs**: Akai CD-ROM Sound Library, Ueberschall packs, Zero-G Datafile, East West Joey Kramer, and the Magix LiveAct Pool. They usually have no licence.
  - Some items carry obviously false PD marks, e.g. "Universal Studios Sound Effects Library" marked PD Mark.
  - **Rule for v1:** include only items with `licenseurl` CC0, PD or CC BY(-SA). Add a denylist of known commercial publishers in the title. Label the results "uploader-asserted licence".
- **Etiquette:** a descriptive UA. One connection reset was seen on the first call; retry with backoff.

### 2.5 Strudel / TidalCycles sample manifests (GitHub raw JSON)
- **Format:** `{"_base": "<url prefix>", "<bank>": ["path1.wav", ...]}`, or `{"bank": {"C4": "file.mp3"}}` for pitched instruments.
  - Banks act as instrument and type tags: `RolandTR808_bd`, `AkaiMPC60_sd`, and so on.
  - In tidal-drum-machines, names follow the pattern `<Machine>_<bd|sd|hh|oh|cp|cb|rim|lt|mt|ht|cr|rd|perc|fx>`. That is excellent one-shot categorisation for free.
- **Manifests (all LIVE 200):**

| Manifest | Banks / files | Licence |
|---|---|---|
| `https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/strudel.json` | 218 / 2,038 | No LICENSE file. Mixed origins (breaks, amen cut-ups) |
| `https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json` | 683 / 2,348 | Points at `ritchse/tidal-drum-machines`. **No LICENSE** (ROM and machine recordings) |
| `.../felixroos/dough-samples/main/vcsl.json` | 128 / 1,908 | **CC0** (Versilian VCSL) |
| `.../dough-samples/main/piano.json` | Salamander piano, mp3 | **CC BY 3.0** (Alexander Holm) |
| `.../dough-samples/main/mridangam.json` | Mridangam | **CC BY-SA 4.0** |
| `.../dough-samples/main/EmuSP12.json` | E-mu SP-12 | Unlicensed |
| `yaxu/clean-breaks/main/strudel.json` | Breakbeats | **Copyrighted breakbeats** (Funky Drummer, Use Me…): **exclude** |
| `Bubobubobubobubo/Dough-Samples`, `Dough-Amiga`, `Dough-Fox`, `Dough-Amen`, `Dough-Waveforms`, `felixroos/samples`, `emptyflash/samples`, `yaxu/spicule` | Various | Check each |

- **Notes:**
  - The GitHub REST API (`api.github.com/repos/...`) was blocked in this sandbox. Raw content works.
  - jsDelivr's data API refuses repos over 50 MB (Dirt-Samples gave 403 "Package size exceeded").
- **Recommendation:**
  - Ship a curated allow-list of manifest URLs, each with an explicit licence field.
  - Index file names into one-shot categories.
  - Mark unlicensed drum-machine ROMs as `licence: unknown`, so they are shown but not offered for commercial use.

### 2.6 BBC Sound Effects (RemArc)
- **Discovery:** found in the SPA bundle `main.*.js`: `api: https://sound-effects-api.bbcrewind.co.uk`, `media: https://sound-effects-media.bbcrewind.co.uk`.
- **Search** (**LIVE 200**):
  ```
  curl -X POST https://sound-effects-api.bbcrewind.co.uk/api/sfx/search \
    -H 'Content-Type: application/json' \
    -d '{"criteria":{"from":0,"size":100,"query":"snare drum"}}'
  ```
  - With an empty query it returns `total: 33066`.
  - Other endpoints: `GET /api/sfx/cached/categoryaggregations` (Nature 17,630, Transport 3,930, Machines 2,963…), `/api/sfx/cached/categorysearch/{cat}`, and `POST /api/sfx/durationAggregations`.
- **Result fields:** `id`, `description`, `duration` (ms), `categories`, `tags`, `source`, `technicalMetadata` (sample_rate, bits_per_sample, channels), `fileSizes`, `recordedDate`, `location`, `additionalMetadata.recordist`.
- **Downloads** (all **200, no login**):
  - mp3: `https://sound-effects-media.bbcrewind.co.uk/mp3/{id}.mp3` (128k)
  - wav: `https://sound-effects-media.bbcrewind.co.uk/zip/{id}.wav.zip` (wav in zip)
  - Waveform: `/waveform/{id}.json`
- **Licence:**
  - RemArc Content Licence: **personal, educational and research use only**. Commercial use needs a licence from Pro Sound Effects.
  - "Research" excludes AI training and data mining. Attribution is required (e.g. "Sound effect courtesy of BBC Sound Effects, bbc.co.uk – © copyright 2026 BBC").
  - The API is undocumented and private. Use it gently, and flag every result `commercial=false`.

### 2.7 ccMixter
- **Endpoint** (**LIVE 200**):
  ```
  https://ccmixter.org/api/query?f=json&tags=acappella&sort=rank&limit=50
  ```
  `f=count` gives counts: acappella 5,985, sample 15,957, loops 6,274. Other formats are `f=rss` and `f=xspf`.
- **Fields:**
  - `upload_name`, `user_name`, `license_url`, `license_name`, `upload_extra.bpm`, `usertags`, and `files[]`.
  - Each file has `download_url`, `file_nicname` (e.g. "Lead Vox", "Back Vox", "Loop") and `file_format_info`.
- **Download:** the URL returns **403 without a Referer** and **206 with** `Referer: https://ccmixter.org/files/<user>/<id>`.
- **Licences:** CC BY, BY-NC, BY-SA, Sampling+ and so on. Use `license_url` to decide whether commercial use is OK. This is the best open source of **vocals and a cappellas**.

### 2.8 Zenodo / Hugging Face / NSynth (datasets)
- **Zenodo:** `https://zenodo.org/api/records/?q=drum%20samples&type=dataset`. **LIVE**.
  - `https://zenodo.org/api/records/3685367` is TinySOL: **CC BY 4.0**, 1.03 GB tar.gz plus a CSV with instrument, technique, pitch and dynamics.
  - Also "Drum and Percussion Kits" (freeDB.tar, id 3994999).
- **Hugging Face:** `https://huggingface.co/api/datasets?search=nsynth`. **LIVE** (e.g. `jg583/NSynth`).
- **NSynth tarballs:** `http://download.magenta.tensorflow.org/datasets/nsynth/nsynth-{train,valid,test}.jsonwav.tar.gz` (test = 349 MB, LIVE). **CC BY 4.0.**
  - 305,979 four-second notes at 16 kHz with JSON metadata (pitch, velocity, instrument_family, instrument_source, qualities).
  - 16 kHz is low quality for production. Treat it as a curiosity or a pre-built offline index.

### 2.9 Game-audio sites
- **Kenney** (`kenney.nl/assets/category:Audio`, LIVE):
  - Packs: impact-sounds, interface-sounds, ui-audio, sci-fi-sounds, rpg-audio, casino-audio, digital-audio, music-jingles, voiceover-pack, voiceover-pack-fighter, and more.
  - Zips download directly, e.g. `kenney.nl/media/pages/assets/impact-sounds/.../kenney_impact-sounds.zip` (206 OK).
  - **CC0.** Hard-code it as a static source.
- **OpenGameArt:**
  - No API. `https://opengameart.org/rss.xml` is LIVE.
  - Advanced search: `https://opengameart.org/art-search-advanced?keys=kick&field_art_type_tid[]=13` (13 = Sound Effect, 12 = Music). LIVE.
  - File links: `https://opengameart.org/sites/default/files/<name>.wav` (206 OK).
  - The licence is in the page (CC0, CC BY 3/4, CC BY-SA, GPL, OGA-BY).
- **itch.io:**
  - RSS works: `https://itch.io/game-assets/free/tag-sound-effects.xml` gives 36 items per feed with `<price>`.
  - 5,725 assets are tagged sound-effects.
  - Downloads need the interactive "download / name your price" flow, and HTML hits 429 quickly. Treat it as **link-only**.
- **Sonniss** (`sonniss.com`, `gdc.sonniss.com`):
  - Cloudflare **403**.
  - GDC 2026 bundle: 7.47 GB from 17 vendors, royalty-free, commercial, no attribution. The no-AI-training clause is unverified.
  - **Link-only.**

### 2.10 WordPress-based free-pack blogs (discovery, link-only)
- **99Sounds:** `https://99sounds.org/wp-json/wp/v2/posts?search=drum&_fields=id,link,title,date`. LIVE, X-WP-Total 73 posts.
  - Downloads are Gumroad $0 checkouts (`99sounds.gumroad.com/l/...`), so link-only.
  - Licence: royalty-free, commercial OK.
- **Bedroom Producers Blog:** `https://bedroomproducersblog.com/wp-json/wp/v2/posts?search=free%20samples`. LIVE (1,887 hits).
  - Categories: `/wp-json/wp/v2/categories?search=sample` gives "bpb Samples" (id 14), "Free Sample Shootout" (17) and "Free Samples" (30679).
  - The homepage returns 403 to curl, but the API is open. Good for a "new freebies" discovery feed.
- **Reverb Machine:** WP REST LIVE. Mostly blog content; freebies are behind email or Gumroad.
- **Legowelt:** WP REST LIVE (`legowelt.org/wp-json/wp/v2/posts`).
  - `/samples/` has ~25 kits, but the downloads are **WeTransfer links that expire**. Link to the page only.
  - Terms: "free to download and use in your productions".
- **Goldbaby:** `goldbaby.co.nz/freestuff.html` links to MediaFire pages. Link-only.

### 2.11 Static / scrapeable direct-download sites
- **MusicRadar SampleRadar:**
  - The index article lists ~280 SampleRadar posts.
  - Monthly sitemaps: `https://www.musicradar.com/sitemap-2026-10.xml`, and so on.
  - Each article links a direct zip, e.g. `https://cdn.mos.musicradar.com/audio/samples/musicradar-808-weight-samples.zip` (200, 60 MB).
  - Royalty-free for use in music; no redistribution. Good pack-level source.
- **Free Wave Samples:**
  - HTML categories (`/sample-type/drums/kick`, …) and direct `https://freewavesamples.com/files/<Name>.wav`. All 16/44.1.
  - Licence: royalty-free, attribution appreciated but not required. **Don't host copies for download.** Proxy-download and link back.
- **Mixkit:** HTML pages embed `data-audio-player-preview-url-value="https://assets.mixkit.co/active_storage/sfx/{id}/{id}-preview.mp3"`. The full wav is at `.../sfx/{id}/{id}.wav` (206 audio/wav, no login). Mixkit SFX licence: free commercial use, no attribution.
- **SoundBible:**
  - Sitemap LIVE.
  - Items: `/{id}-{slug}.html`. Downloads: `http://soundbible.com/grab.php?id={id}&type=wav|mp3`.
  - The per-item licence varies: CC BY 3.0, PD, Sampling Plus, **Personal Use Only**. Parse it from the page.

### 2.12 Orchestral / instrument libraries
- **Philharmonia:**
  - `philharmonia.co.uk/resources/sound-samples/` has 5 S3 zips (all-samples.zip 260 MB, LIVE). mp3 notes.
  - "Free to use … including as part of a commercial work. Must not be sold or made available 'as is' (as samples or a sampler instrument)."
  - IA mirror `orchestral_samples` claims CC BY 2.5. Trust the publisher's terms.
- **University of Iowa MIS:** static HTML pages (`MISflute.html`, …) with direct `.aiff` links. "May be downloaded and used for any projects, without restrictions."
- **VSCO 2 CE / VCSL:** CC0 on GitHub (`sgossner/VSCO-2-CE`, `sgossner/VCSL`). The VCSL file list is already in the Strudel manifest.
- **Sonatina Symphonic Orchestra:** `peastman/sso`. Licence is **CC Sampling Plus 1.0**: sampling and transforming are OK, the licence is retired, and verbatim redistribution is restricted.
- **FreePats:** per-instrument HTML with direct tar.xz (SFZ+FLAC, SF2). Licences: CC0, CC BY 3.0, GPL.
- **sfzinstruments** (GitHub org): e.g. SplendidGrandPiano (Akai PD samples), FLAC + SFZ.

### 2.13 Commercial / bot-walled: link-only or skip
- **Looperman:**
  - HTML has `data-mp3` previews (needs `Referer`), JSON-LD ItemList and a sitemap index (`sitemap-loops-N.xml`).
  - WAV needs login.
  - **The ToS explicitly prohibits "downloaders, page scrapers, data mining, web scraping", robots and spiders, and ML training.** Link-only: deep-link searches as `https://www.looperman.com/loops?keys=<q>`.
- **SampleSwap:** WAV needs login ("registration is required to help us fight robots"); mp3 previews only. Link-only.
- **Sample Focus:** Cloudflare 403. robots disallows `/samples/*/download`, `/api/*?` and all AI crawlers. Licence: commercial OK, no attribution. Link-only.
- **Splice:** GraphQL `surfaces-graphql.splice.com/graphql` sits behind a Cloudflare challenge. No public API; subscription and credits. Link-only.
- **BandLab Sounds:** `/api/v3.0/sounds/*` returns 401 (login). `/api/v4.3/soundbanks` is public but meant for the BandLab Studio instruments. Link-only.
- **Pixabay:** the official API is **images and videos only** (confirmed in the docs). The SFX and music pages are Cloudflare 403. The docs ban "systematic mass downloads". Link-only.
- **Zapsplat** (403), **Uppbeat** (429), **Envato Elements** (403), **Soundsnap**, **Epidemic Sound**, **Artlist**, **LANDR**, **Tracklib**, **Loopcloud**:
  - None has a usable public search API.
  - Epidemic has a self-serve API key, but it is limited to 50 downloads lifetime and cannot go live without a partnership.
  - Artlist's API covers music, enterprise only.
  - Soundsnap sells data licences at $100k+.
  - Treat them all as link-only search URLs.
- **Cymatics:** Shopify `products.json` is LIVE (`/collections/free-downloads/products.json`) and lists free "VAULT" packs. The actual download needs an email gate. Link-only, but the catalog JSON is machine-readable.

## 3. Recommendations for v1

**Tier A: full API connectors (search + metadata + direct download)**
1. **Freesound APIv2.** Use a token for search and preview download. Add OAuth2 "connect account" for original wav.
   - Map filters: `bpm`, `note_name`, `tonality`, `single_event`/`loopable` (one-shot vs. loop), `duration`, `license`, `category`.
   - Exclude `license:"Attribution NonCommercial"` when the user wants "commercial OK".
2. **Openverse audio.** Keyless fallback and discovery for Freesound and Wikimedia CC audio, with ready attribution strings. Register an OAuth client for limits above 200/day.
3. **Wikimedia Commons.** MediaWiki API with a descriptive UA, backoff and MIDI filtered out.
4. **Internet Archive.** advancedsearch/scrape plus metadata, **restricted to items with a CC/PD `licenseurl`**, with a publisher denylist.
5. **BBC Sound Effects.** POST search API with direct wav/mp3. Always flag "RemArc: non-commercial".
6. **ccMixter.** Query API for a cappellas and stems (send a Referer on download).

**Tier B: static or curated manifests (index once, refresh weekly)**

7. **Strudel/Tidal manifests**, with a per-manifest licence allow-list:
   - VCSL: CC0.
   - Salamander: CC BY.
   - mridangam: BY-SA.
   - tidal-drum-machines and Dirt-Samples: `licence: unknown`.
   - **Exclude clean-breaks.**
8. **Kenney audio packs** (CC0, direct zip).
9. **MusicRadar SampleRadar.** Sitemap crawler → pack-level zip results.
10. **Free Wave Samples** and **OpenGameArt.** Polite HTML scrapers with direct files, per-item licence, and link-back.
11. Orchestral seeds: **Philharmonia, UIowa MIS, VSCO2/VCSL, Sonatina, FreePats** as static pack entries.

**Tier C: link-only (search URL templates, no fetching beyond maybe an RSS or WP-REST "new" feed)**
- Looperman, SampleSwap, Sample Focus, Splice, BandLab, Pixabay SFX, Zapsplat, Uppbeat, Mixkit (direct wav works technically, but check Envato ToS first), SoundBible, Sonniss, 99Sounds, BPB, Legowelt, Goldbaby, Cymatics, LANDR, Loopcloud, Tracklib, Soundsnap, Epidemic, Artlist, Envato Elements, itch.io.

**Implementation notes**
- Licence model: `{spdx|cc-id, commercial_ok, attribution_required, attribution_text, nc, sampling_plus, uploader_asserted}`. Freesound, Openverse and Commons give this per item. For IA, mark `uploader_asserted=true`.
- One-shot vs. loop:
  - Freesound: `single_event`/`loopable`/`bpm`.
  - Strudel: the bank suffix (`_bd`, `_sd`, `_hh`).
  - Looperman and ccMixter: everything is a loop or stem.
  - BBC, Kenney, Mixkit: FX.
- Rate etiquette:
  - Freesound: 60/min, 2,000/day.
  - Openverse: 20/min, 200/day anonymous.
  - Wikimedia: serial requests with backoff; expect 429s.
  - IA: polite and serial.
  - Every request: a descriptive UA with contact details.
- Sandbox egress: freesound.org and cdn.freesound.org returned 403 here, and api.github.com is blocked. Check production egress.
