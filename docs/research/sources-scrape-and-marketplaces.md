# sound-server — scrapable & commercial sample sources (live-verified 2026-10-22)

All checks used plain `curl` (Chrome 126 UA, `Accept: text/html`) through the session's HTTPS proxy from a datacenter IP. A site that blocks this IP may still work for a home user, but it will block our server in the same way, so the tiering below assumes **server-side fetching from cloud IPs**.

Legend — **Tier**: `API` = official/public JSON; `scrape` = cheerio on server-rendered HTML (or embedded JSON); `link-only` = return a deep link to the site's own search; `static` = curated hand-maintained entries (pack list), refreshed rarely; `skip`.
**Unit**: `ind` = individual samples are searchable; `pack` = results are packs/zips/products.
**DL**: `direct` = the full file comes from a plain GET; `login` = free account needed; `email` = email/Gumroad $0 checkout; `paid` = purchase/subscription/credits.

## Summary table

| Site | Live result (plain curl) | Tier | Unit | Free/Paid | Licence for music use | Preview | DL |
|---|---|---|---|---|---|---|---|
| **Free Wave Samples** | 200 HTML | **scrape** | ind | free | royalty-free freeware, credit appreciated, no re-hosting | WAV is the preview | **direct** `/files/X.wav` |
| **SampleSwap** | 200 HTML | **scrape** | ind | free | royalty-free for music | direct mp3 | login (WAV) |
| **Mixkit (SFX)** | 200 HTML | **scrape** (polite) | ind | free | Mixkit SFX Free License: commercial OK, no attribution | direct mp3 | **direct** WAV |
| **SoundBible** | 200 HTML | **scrape** | ind | free | per sound: CC-BY 3.0 / PD / Sampling+ / Personal-use | mp3 (relative URL) | direct |
| **Orange Free Sounds** | 200 HTML (WP) | **scrape** | ind | free | per post, often CC-BY 4.0 (some NC) | direct mp3 | direct |
| **BigSoundBank** | 200 HTML | scrape metadata | ind | free | "Free and Royalty Free" items: any use incl. commercial | mp3/ogg `/UPLOAD/` | direct, but robots blocks `/UPLOAD/` |
| **OpenGameArt (audio)** | 200 HTML | scrape (crawl-delay 10) | ind/pack | free | per item CC0 / CC-BY / CC-BY-SA / GPL | direct ogg | direct |
| **Ghosthack** | 200 HTML (Shopware) | scrape | pack | paid (+ some free) | royalty-free, no resale as samples | 1 demo/page | paid |
| **Black Octopus** | 200 HTML (WP/Woo) | scrape | pack | paid (+free cat.) | royalty-free | direct demo mp3 | paid |
| **Prime Loops** | 200 Shopify | scrape (`suggest.json`) | pack | paid | royalty-free | product demos | paid |
| **Cymatics** | 200 Shopify | scrape (`suggest.json`) | pack | paid (+ free via email) | royalty-free | product demos | paid/email |
| **Function Loops** | 200 HTML (Weebly) | scrape | pack | paid | royalty-free | — | paid |
| **Reverb Machine** | 200 HTML (Woo) | static/scrape | pack | paid + free | royalty-free | direct mp3 | paid/email |
| **Soundpacks.com** | 200 HTML (WP) | scrape | pack (links out) | free | varies per pack | — | external |
| **99Sounds** | 200 HTML (WP) | scrape / static | pack | free | royalty-free (99Sounds licence) | — | email (Gumroad $0) |
| **MusicRadar SampleRadar** | 200 HTML | **static** (index page) | pack | free | royalty-free for music | — | **direct zip** (cdn.mos.musicradar.com) |
| **Goldbaby free** | 200 HTML | static | pack | free | royalty-free | — | MediaFire link |
| **Pianobook** | 200 HTML (WP) | scrape / link | pack (instruments) | free | free for music; no resale | — | login |
| **Loopmasters** | 200 HTML (rich) | link-only (robots `Disallow: /search?*`) | pack | paid | royalty-free | direct demo mp3 (320k) | paid |
| **Splice Sounds** | 200 SvelteKit SSR, but `q` ignored server-side | link-only | ind | paid (credits) | royalty-free after licensing | scrambled mp3, signed S3 (403) | paid |
| **Producer Loops** | 200 HTML | link-only (robots blocks `/search.php`) | pack | paid | royalty-free | direct demo mp3 | paid |
| **ADSR Sounds** | 200 HTML, results via JS | link-only (robots blocks `?s=`, `?src=`) | pack | paid | royalty-free | — | paid |
| **Plugin Boutique** | 200 HTML | link-only (robots `Disallow: /search?*`) | pack | paid | royalty-free | — | paid |
| **Looperman** | 200 HTML (rich) | **link-only** (ToS bans scrapers) | ind | free | royalty-free for derivative works; acapellas carry uploader terms | mp3 needs Referer | login |
| **Gumroad** | 200 + Inertia `data-page` JSON | link-only (ToS bans scrapers) | pack | free(PWYW)/paid | per seller | — | checkout |
| **itch.io** | 200, `?format=json` on browse | link-only for search (robots `/search`); tag browse is optional | pack | free/paid | per creator | — | checkout/direct |
| **Soundsnap** | 200 HTML, Typesense key in page | link-only (robots `/search/`) | ind | paid sub | royalty-free | via Typesense | paid |
| **Epidemic Sound SFX** | 200 Next RSC, lq mp3 | link-only (robots `?term=`) | ind | paid sub | subscription licence (content creators) | lq mp3 | paid |
| **Artlist SFX** | 200 Next RSC | link-only (robots `/sfx/search`) | ind | paid sub | subscription licence | — | paid |
| **LANDR Samples** | 200 JS-only SPA shell | link-only | ind | paid (credits/sub) | royalty-free | — | paid |
| **Tracklib** | 200 SPA (TanStack) | link-only | ind (songs/stems) | paid + clearance fee | **sample clearance**, not royalty-free | — | paid |
| **Noiiz** | 200 Nuxt SPA | link-only | ind | paid sub | royalty-free | — | paid |
| **Loopcloud / "Beatport Sounds"** | 200 SPA (`sounds.beatport.com` → loopcloud.com) | link-only | ind | paid sub | royalty-free | — | paid |
| **WAVS** | 200 Nuxt (robots `/*?`) | link-only | ind/pack | free+paid | per pack | CDN mp3 | login |
| **BandLab Sounds** | 200 JS-only SPA; robots `/search/` | link-only | ind/pack | free with account | royalty-free | — | in-app |
| **Samplephonics** | 200 small HTML; robots `/*?*` | link-only | pack | paid | royalty-free | — | paid |
| **Big Fish Audio** | **403 Cloudflare challenge** | link-only | pack | paid | royalty-free | — | paid |
| **KVR Marketplace** | **403 Cloudflare challenge** | link-only | pack | paid | varies | — | paid |
| **Sample Focus** | **403 Cloudflare challenge** | link-only | ind | free | SampleFocus licence (royalty-free, no resale) | — | login |
| **Zapsplat** | **403 Cloudflare challenge** | link-only | ind | free (attrib) / paid | Standard licence: attribution required for free tier | — | login |
| **Pixabay sounds** | **403 Cloudflare challenge**; API has no audio | link-only | ind | free | Pixabay Content Licence | — | — |
| **Uppbeat SFX** | **429 Vercel Security Checkpoint** | link-only | ind | freemium | Uppbeat licence (creator content) | — | login |
| **AudioJungle** | **403 Cloudflare challenge** | link-only (or Envato API) | ind | paid | Envato Market licence | — | paid |
| **Bedroom Producers Blog** | **403 "Security Verification"** | link-only | pack (links out) | free | varies | — | external |
| **Sonniss GDC** | **403 Cloudflare challenge** | static | pack | free | Sonniss GDC licence: royalty-free, commercial, no attribution | — | torrent/direct |
| **Partners in Rhyme** | **403 Cloudflare** | link-only | ind/pack | free+paid | varies | — | — |
| **Bandcamp** | **"Client Challenge" JS page**; robots `/search` | link-only | pack | free/paid | per artist | — | checkout |
| **Freesound** | **403 empty body** to HTML | API (separate research) | ind | free | CC0 / CC-BY / CC-BY-NC / (legacy Sampling+) | API previews | API OAuth |
| **Legowelt** | 200 HTML | static/link | pack | free | free for productions | — | WeTransfer (links expire) |
| **Hip Hop Makers** | 200 HTML (listicles) | link-only | pack (links out) | free | varies | — | external |
| **Decent Samples** | 200 WP/Woo | link-only | pack (instruments) | free+paid | per product | — | checkout |
| **Unison / Samples From Mars** | 200 Shopify | static/link | pack | paid + email-gated free | royalty-free | S3 demo mp3 | email/paid |
| **Spitfire LABS** | redirects to `splice.com/instrument/labs-instrument` ("Labs is now INSTRUMENT") | skip | — | — | — | — | — |
| **Sounds.com (NI)** | 301 → native-instruments.com (shut down) | skip | — | — | — | — | — |
| **Soundtrap** | redirects to `/musicmakers`; library only inside the app | skip | — | — | — | — | — |
| **Output Arcade** | product page, sounds only inside the plugin | skip | — | — | — | — | — |
| **Producer Spot** | HTTP/2 PROTOCOL_ERROR, then empty reply over HTTP/1.1 | link-only | pack | free+paid | varies | — | — |
| **Free-loops.com** | **TLS certificate expired** | skip (never bypass TLS) | — | — | — | — | — |
| **Samplelib** | 200, but it is a library of test files (not music) | skip | — | — | — | — | — |
| **r/Drumkits** | reddit `.json` 403 | skip | — | — | licence often unknown (leaked kits) | — | — |
| **BBC Sound Effects** | 200 SPA shell | skip / NC-only | ind | free | RemArc: personal/educational/research only | — | — |

---

## Recommended tiering for sound-server

### Tier A: scrape (individual samples, free, licence clear, direct or near-direct file)
1. **Free Wave Samples**: the cleanest source. `https://freewavesamples.com/search?q={q}` returns links to detail pages. A detail page has `<audio src="/files/{Name}.wav?nocount=1">` and `href="/files/{Name}.wav"`, and that GET returns the WAV (verified 200 `application/octet-stream`). Categories are kick, snare, hats, cymbals, percussion, synth one-shots and multisamples by MIDI note, which suits the drum and instrument use cases.
2. **SampleSwap**: `https://sampleswap.org/filebrowser-new.php?q={q}`. Results are `<ul class="playlist samples"><li><a href="/samples-ghost/<dir>/<kb>[kb]<name>.wav.mp3">`. The MP3 preview fetches directly (200 audio/mpeg). The WAV needs a free login, so return the preview plus a link. Categories: drum loops/breaks, single hits, full kits, vocals, SFX, instrument single samples.
3. **Mixkit SFX**: `https://mixkit.co/free-sound-effects/discover/{slug}/` (spaces become `-`). Each card has `data-audio-player-preview-url-value="https://assets.mixkit.co/active_storage/sfx/{id}/{id}-preview.mp3"`, and the full file is at `https://assets.mixkit.co/active_storage/sfx/{id}/{id}.wav` (verified 200 audio/wav). The catalogue is small and FX-oriented (risers, whooshes, glitches, impacts) with few drums ("snare" returned 0 results, "riser" returned 7). There is also a JSON autocomplete at `/free-sound-effects/search/autocomplete/?q=` that returns category slugs. The ToS bans "scripts or bots to mass download Items … scrape the entire library", so keep to per-query fetches with caching and no bulk crawl.
4. **SoundBible**: `https://soundbible.com/search.php?q={q}` (search is tag-based and loose). Each player is `data-source="mp3/<Name>-<id>.mp3"` (relative). The licence is printed per item (Attribution 3.0 / Public Domain / Sampling Plus / Personal Use Only), so it must be parsed per result. Content is mostly SFX/foley.
5. **Orange Free Sounds**: WordPress `https://orangefreesounds.com/?s={q}`. Direct `wp-content/uploads/...mp3` links appear on the results page. Licence is per post ("permitted for commercial use under CC BY 4.0"; some posts are NC or personal), so parse it per post. Has drum loops, breakbeats, FX.
6. **BigSoundBank**: `https://bigsoundbank.com/search?q={q}`, previews at `/UPLOAD/mp3/{id}.mp3` and `/UPLOAD/ogg/{id}.ogg`. robots.txt disallows `/UPLOAD/` for every bot, and `/ai.txt` forbids training on the audio. Scrape metadata and the preview URL, and download only on an explicit user click, or link out. The licence ("Free and Royalty Free") permits commercial use.
7. **OpenGameArt**: `https://opengameart.org/art-search-advanced?keys={q}&field_art_type_tid[]=13` (13 = audio). robots sets `Crawl-delay: 10` and disallows `/search/` (the advanced search path is not disallowed). Direct `.ogg`/`.wav` files under `/sites/default/files/`. The CC licence is per item. Good for chiptune and game FX.

### Tier B: scrape (pack/product level, commercial or free packs, preview only)
- **Ghosthack** (Shopware): `https://www.ghosthack.de/search?search={q}`, cards are `a.product-name[title]`. Strong in vocals, FX, EDM. Note `?q=` is ignored, so use `search=`.
- **Black Octopus** (WP/Woo): `https://blackoctopus-sound.com/?s={q}`, demo mp3s in `wp-content/uploads`. The free category is `/product-category/free/`. robots blocks ClaudeBot/GPTBot by name and sets `Content-Signal: ai-train=no`. A generic UA is allowed.
- **Prime Loops** and **Cymatics** (Shopify): `GET https://{host}/search/suggest.json?q={q}&resources[type]=product` returns clean JSON (title, handle, price, image, body). Pass `curl -g`/encode the `[ ]`. Product page `/products/{handle}.json` also works on Shopify. Cymatics' free packs are email-gated, so link to them.
- **Function Loops** (Weebly): `https://www.functionloops.com/search?q={q}` returns server-rendered results.
- **99Sounds**, **Soundpacks.com** (both WordPress `/?s={q}`): free pack listings. 99Sounds downloads go through Gumroad $0 checkout and Soundpacks.com links out, so treat both as "free, not direct".
- **MusicRadar SampleRadar**: one index article links hundreds of pack articles (`/music-tech/samples/sampleradar-…`). Each pack article has a **direct zip** on `cdn.mos.musicradar.com/audio/samples/*.zip` (HEAD verified: 200, 60 MB `application/zip`). Build a static index by crawling the index daily, then keyword-match titles. robots only blocks `*searchTerm=*`.

### Tier C: link-only (deep link to the site's own search)
| Site | Search URL template | Why link-only |
|---|---|---|
| Splice | `https://splice.com/sounds/search/samples?q={q}` | SSR ignores `q` (same results for kick/snare); data comes from `surfaces-graphql.splice.com`; previews are "-scrambled" and on signed S3 (403); paid credits |
| Loopmasters | `https://www.loopmasters.com/search?q={q}` | HTML is excellent (product tiles + `data-track-url` demo mp3), but robots disallows `/search?*` |
| Loopcloud / Beatport Sounds | `https://www.loopcloud.com/cloud/` (app; no stable search URL verified) | SPA, subscription |
| Producer Loops | `https://www.producerloops.com/search.php?mode=search&substring={q}` | robots disallows `/search.php` and `/*mode=*` |
| ADSR | `https://www.adsrsounds.com/?fastwpac_s={q}` | robots disallows `?s=`, `?src=`, `?fastwpac_s=`; results JS-rendered |
| Plugin Boutique | `https://www.pluginboutique.com/search?q={q}` | robots disallows `/search?*` |
| Looperman loops | `https://www.looperman.com/loops?keys={q}` | ToS: "strictly prohibit … page scrapers, data mining, web scraping"; WAV needs login; mp3 previews 403 without Referer |
| Looperman acapellas | `https://www.looperman.com/acapellas?keys={q}` | same; plus per-uploader vocal terms |
| Gumroad | `https://gumroad.com/discover?query={q}` (filter: `&tags=sample%20pack`) | Inertia `data-page` holds `search_results.products[]` (name, price_cents, is_pay_what_you_want, url; total=2325 for "drum kit"), but ToS bans scrapers/spiders |
| itch.io | `https://itch.io/search?q={q}&classification=assets` | robots disallows `/search`. Tag browse `https://itch.io/game-assets/free/tag-sound-effects?format=json&page=N` returns `{content: html}` if a tag feed is wanted |
| Soundsnap | `https://www.soundsnap.com/search/audio?query={q}` | robots `/search/`; results via Typesense (scoped key embedded in page config); paid |
| Epidemic Sound | `https://www.epidemicsound.com/sound-effects/search/?term={q}` | robots `?term=`; paid |
| Artlist | `https://artlist.io/sfx/search?terms={q}` | robots `/sfx/search`; paid |
| LANDR Samples | `https://samples.landr.com/search?q={q}` (unverified param; robots `/*?*`) | JS-only SPA |
| Tracklib | `https://www.tracklib.com/discover` | SPA; clearance model |
| Noiiz | `https://www.noiiz.com/` | Nuxt SPA |
| WAVS | `https://wavs.com/samples?query={q}` | robots `/*?` |
| BandLab Sounds | `https://www.bandlab.com/sounds` | SPA; robots `/search/` |
| Samplephonics | `https://www.samplephonics.com/products?search={q}` | robots `/*?*` |
| Big Fish Audio | `https://www.bigfishaudio.com/search?q={q}` | Cloudflare challenge |
| KVR Marketplace | `https://www.kvraudio.com/marketplace` | Cloudflare challenge |
| Sample Focus | `https://samplefocus.com/samples?search={q}` | Cloudflare challenge; robots `/*search=` + `/samples/*/download` |
| Zapsplat | `https://www.zapsplat.com/?s={q}&post_type=music&sound-effect-category-id=` | Cloudflare challenge |
| Pixabay | `https://pixabay.com/sound-effects/search/{q}/` | Cloudflare; the public API covers images/videos only (no audio) |
| Uppbeat | `https://uppbeat.io/sfx/search?query={q}` | Vercel Security Checkpoint (429) |
| AudioJungle | `https://audiojungle.net/search/{q}` | Cloudflare (Envato Market API with a personal token is an alternative) |
| BPB | `https://bedroomproducersblog.com/?s={q}` | "Security Verification" 403 |
| Bandcamp | `https://bandcamp.com/search?q={q}&item_type=a` | JS client challenge; robots `/search` |
| Partners in Rhyme | `https://www.partnersinrhyme.com/` | Cloudflare 403 |
| Producer Spot | `https://www.producerspot.com/?s={q}` | unreachable from cloud IP |
| Pianobook | `https://www.pianobook.co.uk/?s={q}` | login needed for download (metadata scrape is possible) |
| Decent Samples | `https://www.decentsamples.com/?s={q}` | checkout flow |
| Hip Hop Makers | `https://hiphopmakers.com/?s={q}` | listicles linking out |

### Tier D: static curated entries (refresh monthly)
Goldbaby free packs (`/freestuff.html`, MediaFire links), Legowelt samples (WeTransfer links that expire), Sonniss GDC bundles, Adobe Audition SFX downloads, Reverb Machine free packs, Unison/Cymatics/Samples From Mars free packs (email-gated), Philharmonia orchestra samples, Univ. of Iowa MIS, VSCO 2 CE (CC0, GitHub). These are "packs" and should be surfaced as pack results with `directDownload` true/false.

### Skip
Sounds.com (shut down, redirects to NI), Spitfire LABS (now Splice INSTRUMENT), Soundtrap (in-app only), Output Arcade (plugin-only), free-loops.com (expired TLS cert), Samplelib (test files), r/Drumkits (403, many kits of unknown provenance), BBC Sound Effects (non-commercial RemArc licence; at most an NC-flagged link).

---

## Per-site notes (details & gotchas)

### Commercial marketplaces / subscriptions
- **Splice Sounds**: `splice.com/sounds/search?q=` 301s to `/sounds/search/samples` and drops `q`. `/sounds/search/samples?q={q}` returns 200 SvelteKit SSR with `<script type="application/json" data-sveltekit-fetched data-url="https://surfaces-graphql.splice.com/graphql">` blocks containing `assetsSearch.items[]` (uuid, name = pack path/filename, tags, `files[].asset_file_type_slug: preview_mp3`). SSR returns the same default results regardless of `q`; the real search happens client-side against GraphQL. Preview URLs are `audio_samples/<hash>-scrambled/<hash>.mp3` on S3 and returned 403 to a direct GET. The files are obfuscated and descrambled in-browser. Downloads cost credits. robots disallows `/sounds/*?*tags=`. Use **link-only**.
- **Loopmasters**: `/search?q=kick` SSR returns product tiles with GA ecommerce JSON in `data-layer` (name, id, brand/label, genre, price) and `data-track-url="https://demos.loopmasters.com/<id>%2F<file>.mp3"` (verified 320 kbps MP3, 200). This would be an ideal scrape target, but robots has `Disallow: /search?*` (only `/search?q=midi` allowed). Link-only, or scrape genre/label listing pages, which are allowed.
- **Loopcloud** (Loopmasters/Beatport): `sounds.beatport.com` now redirects to `loopcloud.com/cloud/`. The web app is an SPA. Link-only.
- **ADSR Sounds**: the search box `name="src"` submits to `/?fastwpac_s={q}`. That page returned 200 with only a handful of product links (results load via JS). robots disallows all three search params. Link-only.
- **Producer Loops**: the search form is POST-driven JS. The GET form `search.php?mode=search&substring={q}` works (32 demo mp3s on `cdn.producerloops.com/files/audio/...`), but robots disallows `/search.php` and `/*mode=*`. Link-only.
- **Prime Loops**: Shopify; `/search?q=` 200; `/search/suggest.json` JSON works. Hip-hop/trap kits, 808s, vocals.
- **Function Loops**: Weebly store; `/search?q={q}` server-rendered; EDM/psytrance packs.
- **Cymatics**: Shopify; `/search?q=` and `suggest.json` work. Free packs at `/pages/free-download-vault` are email-gated. robots only blocks Shopify filter/sort paths.
- **Native Instruments Sounds.com**: `www.sounds.com` returns 301 to native-instruments.com. The service is closed.
- **LANDR Samples**: `samples.landr.com/search?q=` returns a 2.8 KB SPA shell ("You need to enable JavaScript"). robots `Disallow: /*?*`.
- **Tracklib**: TanStack Start SPA; `/search` 404, `/discover` 200. This is licensed *original recordings* with a clearance fee per release, not royalty-free samples. Flag it as a different licence class.
- **Noiiz**: still live (Nuxt SPA, subscription).
- **Output Arcade**: content lives in the plugin; product page only. Skip.
- **Black Octopus**: WP `?s=` 200 with demo mp3s. AI-crawler UAs blocked by name in robots.
- **Ghosthack**: Shopware; `search?search=` returns 24 product cards. Free samples are linked from the site (no `/free-samples` path, which returned 404).
- **Sample Magic**: homepage 200, `/search?q=` 404. Low priority, link to homepage.
- **Big Fish Audio**: Cloudflare challenge even on `/`.
- **Samplephonics**: minimal HTML; robots `/*?*`.
- **BandLab Sounds**: SPA (redirects no-module browsers). Sounds are royalty-free but used inside BandLab.
- **Soundtrap**: library only inside the editor.
- **Plugin Boutique**: search 200, but robots `Disallow: /search?*`.
- **Producer Spot**: connection broken from cloud IP (HTTP/2 PROTOCOL_ERROR; HTTP/1.1 empty reply).
- **KVR Marketplace**: Cloudflare challenge.
- **Unison** (Shopify, S3-hosted demo mp3), **Samples From Mars** (Shopify `/collections/free`), **WAVS** (Nuxt, `api.wavs.com`, free + paid packs, robots `/*?`): link or static.

### Free sources
- **Looperman**: the best free community source for loops and acapellas, but the ToS explicitly prohibits scraping. `loops?keys={q}` redirects single words to tag pages (`/loops/tags/free-kick-loops-...`) and multi-word queries stay as search. Results include JSON-LD and mp3 URLs `https://www.looperman.com/media/loops/<uid>/looperman-l-<uid>-<id>-<slug>.mp3`, which return 403 without `Referer: https://www.looperman.com/` (hotlink protection). The download button says "You must be logged in before you can download". Loop licence: royalty-free for use in derivative works; no redistribution of raw loops. Acapellas: the uploader sets terms (often credit / contact required). Use **link-only**.
- **SampleSwap**: the site says "registration is required to help us fight robots", but previews are open. robots only disallows `song.php?id=`. Use **scrape**.
- **Sample Focus**: Cloudflare challenge. robots also disallows search and `/samples/*/download` and blocks AI bots. Link-only.
- **Free Wave Samples**: licence page: "distributed as freeware and may be used royalty-free … linked to us … not required … You may not place copies of samples … on your own website". So serve the file to the user and do not re-host or cache publicly. robots is empty.
- **MusicRadar SampleRadar**: see Tier B. Future plc site, very heavy pages (400 KB).
- **Reverb Machine**: `/sounds/` lists packs with demo mp3s on `media.reverbmachine.com`. A few packs are free.
- **Goldbaby**: `/freestuff.html` lists MediaFire zip links. MediaFire pages are interstitial, so the download is not direct.
- **Legowelt**: `/samples/` lists WeTransfer links that expire. Static/link.
- **Zapsplat**: Cloudflare challenge. Free tier requires attribution. Good FX library.
- **Mixkit**: see Tier A.
- **Uppbeat**: Vercel checkpoint (429).
- **Pixabay sounds**: Cloudflare challenge. The Pixabay API does not expose audio.
- **SoundBible**: see Tier A. Uses tag-based results; check the per-item licence.
- **Freesound**: HTML returns 403 to cloud IPs. Use APIv2 (token) instead, covered elsewhere.
- **Sonniss GDC**: Cloudflare. Large yearly bundles (tens of GB); static entries.
- **Hip Hop Makers**: listicles of free drum kits linking elsewhere; licence unknown per kit.
- **Samplelib**: not a music sample site (test media). Skip.
- **Free-loops.com**: expired certificate. Skip (do not bypass TLS).
- **Partners in Rhyme**: Cloudflare 403.
- **AudioJungle**: Cloudflare. Envato has an official API (personal token) if paid-catalogue search is wanted.
- **Soundsnap**: HTML 200, but results load from Typesense `ts231.search-soundsnap.com`. The page config exposes `typesenseSearchKey` (scoped search-only) and collection `prod-latest`. Technically queryable, but robots disallows `/search/` and `/audio/download/`, and downloads need a subscription. Link-only.
- **Epidemic Sound**: Next.js RSC with `audiocdn.epidemicsound.com/lqmp3/<id>.mp3` previews. robots disallows `?term=`. Link-only.
- **Artlist**: robots disallows `/sfx/search` for every listed bot. Link-only.
- **Adobe Audition SFX**: static zips; Adobe licence allows royalty-free use. Static entry.
- **WavBvkery**: homepage 200 (free sounds shop); `/free-sounds/` 404. Static/link.
- **Soundpacks.com**: WP `?s=`, posts at `/free-sound-packs/<slug>/` linking to the creator. Pack-level scrape.
- **Pianobook**: free Decent Sampler/Kontakt instruments. "Log in" is required to download; there is a live-search form (`term`, `format`, `has_demos`). Scrape metadata, link to download.
- **Decent Samples**: Woo shop with free and paid instruments; checkout needed.
- **Spitfire LABS**: `labs.spitfireaudio.com` now redirects to `splice.com/instrument/labs-instrument`: "Splice INSTRUMENT is the new home for LABS". Skip.
- **Bandcamp**: "Client Challenge" JS interstitial on search; robots `/search`. Link-only.
- **Gumroad**: see Tier C. Very rich JSON, but scraping is forbidden by ToS. Many "free drum kits" are PWYW with `price_cents` > 0 but `is_pay_what_you_want: true`; only price 0 means free.
- **itch.io**: browse pages support `?format=json` (returns `{"content": "<html cells>", ...}`). `/search` is robots-disallowed. Mostly game SFX/music packs.
- **Additional good finds**: **BigSoundBank** (Tier A, FR, royalty-free incl. commercial), **Orange Free Sounds** (Tier A, per-post CC-BY), **OpenGameArt** (Tier A, CC), **SoundGator** (direct mp3 in HTML; free SFX, attribution/terms per site), **SoundJay** (static category pages with relative mp3 links; free with no-redistribution terms), **Philharmonia** samples and **Iowa MIS** (instrument multisamples, static).

---

## Licensing realities for music samples (and how to surface them)

1. **"Royalty-free" sample licences (Splice, Loopmasters, Cymatics, Looperman, SampleSwap, Free Wave Samples, most packs)**: you may use the sound *inside a musical composition* (commercial release, sync, streaming) with no royalties. The universal exception is that you may **not redistribute the sample itself** in isolation or as part of another sample pack, construction kit, preset bank, or loop library. Some also forbid use in competing sample products, and some (Splice) forbid use in AI training data. Most do not require credit. The aggregator should not re-host or cache-serve full files publicly; it should proxy or pass through to the user.
2. **Content ID risk**: royalty-free loops (especially popular Splice/Looperman melodic loops) are often registered by others in YouTube Content ID / distributor fingerprinting, which causes false claims. Surface a soft warning for melodic loops from marketplaces.
3. **CC0 / Public Domain**: no conditions. Safe for commercial release, no credit needed.
4. **CC-BY (3.0/4.0)**: commercial release OK, but **attribution is required** (artist + licence + link) "reasonable to the medium". For music that means release notes, video description, Bandcamp credits or the liner notes. The aggregator should generate a ready-to-paste credit line.
5. **CC-BY-SA**: commercial OK with attribution, but the resulting work must be released under the same licence. That is practically incompatible with a normal label/distributor release. Flag it as "commercial: restricted (share-alike)".
6. **CC-BY-NC (and NC-SA)**: **not usable in a commercial release** (sales, monetized streams, sync). Only demos/non-commercial uses.
7. **CC Sampling+ 1.0 (retired 2011, still on old Freesound and SoundBible items)**: allows sampling/transforming the sound into a new work, *including commercially*, but forbids commercial redistribution of the whole original sound and forbids advertising use. For a producer chopping a sample into a song, it is effectively "commercial OK, transformed". Freesound migrated most Sampling+ uploads (users could relicense), but legacy items remain.
8. **Site-specific free licences**: Zapsplat free tier = attribution required (paid tier removes it). Pixabay Content Licence = commercial OK, no attribution, but no selling unaltered copies and no standalone redistribution. Mixkit SFX Free License = commercial OK, no attribution. Uppbeat = tied to creator accounts/credits. BBC RemArc = **non-commercial only**.
9. **Vocals/acapellas**: user-uploaded acapellas (Looperman) carry uploader-specific terms ("credit me", "contact me for commercial use", "non-profit only"). There is also a real risk of uploaded copyrighted stems. Default the commercial flag to `check-terms`.
10. **Tracklib** is a different model: you are licensing a *recording*, and commercial release requires paying a clearance fee per release. Flag it as `clearance-required`, not royalty-free.
11. **Subscription libraries (Epidemic, Artlist, Soundsnap, Envato)**: licences are tied to an active subscription and often scoped to "content creation" (video, podcast). Their terms frequently exclude or limit use in music for distribution, so treat them as `check-terms` for music releases.

**Suggested result schema fields** (extends the 3d-asset-server model):
```
licence: { id: 'cc0'|'cc-by-4.0'|'cc-by-nc-4.0'|'cc-by-sa'|'sampling+'|'royalty-free-sample'|'site-custom'|'clearance'|'subscription'|'unknown',
           url, attributionRequired: 'yes'|'appreciated'|'no', attributionText?: string }
commercialRelease: 'yes' | 'yes-with-credit' | 'restricted' (SA) | 'no' (NC) | 'clearance-required' | 'check-terms'
redistributionAsSample: false   // always false for every source; show it in the UI
free: boolean; priceHint?: string; requiresAccount: boolean
directDownload: boolean; previewUrl?: string; previewNeedsReferer?: boolean
unit: 'sample' | 'pack' | 'instrument'
```
The UI badge for "Can I use this in a commercial release?" should come from `commercialRelease`: green for `yes`/`yes-with-credit` (the latter with a copy-credit button), amber for `restricted`/`check-terms`/`clearance-required`, red for `no`.

## Implementation gotchas
- Always send a realistic UA plus `Accept-Language`. Looperman MP3s need `Referer`.
- Use `curl -g`/URL-encode brackets for Shopify `resources[type]`.
- Expect redirects that drop the query: Splice (`/sounds/search?q=` → `/sounds/search/samples`) and Looperman (keyword → tag page).
- Cache per-query results (≥24 h). Do not crawl whole catalogues: Mixkit's and Looperman's ToS ban bulk/bot downloading, and OpenGameArt asks for a 10 s crawl delay.
- Many robots.txt files now block AI crawler UAs by name (Black Octopus, Sample Focus, BandLab, Artlist) and some publish `Content-Signal: ai-train=no` or `/ai.txt` (BigSoundBank). Our server must not behave as a training crawler. A generic-UA allowance is not a licence to bulk-scrape: we should respect `Disallow` on search paths (Loopmasters, Plugin Boutique, Producer Loops, ADSR, Epidemic, Artlist, Soundsnap, itch.io, Bandcamp, Sample Focus all disallow their search URLs), which is why they are link-only above.
