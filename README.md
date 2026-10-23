# Sound Server

**sound-server** searches 35+ sample sites at once and downloads what you pick: kicks, snares,
hi-hats, claps, 808s, loops, vocals and a cappellas, risers, impacts, zaps, foley, ambience and
instrument one-shots. Use it from a browser, from `curl`, from the command line, or let your AI
assistant drive it over MCP to build a track.

> *"Build me a dark trap kit in F minor at 140 BPM."*
>
> Your assistant calls `build_kit`, gets a kick, snare, clap, hats and an 808 with their licences,
> and writes the files, a Strudel sample map, an SFZ / General MIDI drum map and the credits into
> your project.

- **One query, many sources.** Results are merged, de-duplicated and ranked, with a status line for every site.
- **Musical search.** "140 bpm vocal chop in F minor" becomes BPM and key filters; every result has
  a category (`drums.kick`, `bass.808`, `fx.riser`…), a form (one-shot, loop…), and BPM, key and
  duration when known.
- **Licence first.** Every result carries a **verdict for commercial releases**: `yes`, `yes-with-credit`,
  `restricted`, `clearance-required`, `check-terms` or `no`, plus a ready-to-paste credit line.
  Downloads write `ATTRIBUTION.md` and `credits.json` next to the files.
- **Honest about what's blocked.** Sites that block bots or forbid scraping come back as links to their own
  search, so you still know where else to look.
- **Never re-hosted.** Files come straight from the source; the server only proxies previews that need it.

Live at **<https://sound.shep.bot>** (free, non-commercial). Planning notes and research:
[docs/PLAN.md](docs/PLAN.md), [docs/research/](docs/research/).

---

## Contents

- [Sources](#sources)
- [Licence verdicts](#licence-verdicts)
- [Quick start](#quick-start)
- [MCP: use it from an AI assistant](#mcp-use-it-from-an-ai-assistant)
- [HTTP API](#http-api)
- [CLI](#cli)
- [Downloads and kits](#downloads-and-kits)
- [Configuration](#configuration)
- [Deploying](#deploying)
- [Project layout](#project-layout)
- [Development](#development)
- [Etiquette](#etiquette)

---

## Sources

**Searched (16)**

| Source | Best for | Access | Downloads | Licence |
|---|---|---|---|---|
| [Freesound](https://freesound.org) | Everything: 700k+ CC sounds with BPM/key analysis | API (free key) | previews; originals with your own OAuth token | per sound: CC0 / CC BY / CC BY-NC |
| [Wikimedia Commons](https://commons.wikimedia.org) | Instruments, drum hits, field recordings | API | yes | per file |
| [ccMixter](https://ccmixter.org) | A cappellas, remix stems | API | yes | per upload |
| [Internet Archive](https://archive.org) | Drum machines, sample packs (CC/PD items only) | API | yes | uploader-asserted, capped at check-terms |
| [BBC Sound Effects](https://sound-effects.bbcrewind.co.uk) | 33k foley and ambience recordings | API | yes | RemArc: **non-commercial** |
| [Strudel sample banks](https://strudel.cc/learn/samples/) | ~70 drum machines, VCSL, piano | manifests | yes | per bank |
| [MusicRadar SampleRadar](https://www.musicradar.com) | ~280 genre packs | index | zip | royalty free |
| Curated free libraries | Philharmonia, Iowa MIS, VSCO 2, FreePats… | hand-checked list | where verified | per library |
| [Kenney](https://kenney.nl/assets/category:Audio) | Game UI, impacts, sci-fi | scrape | zip | CC0 |
| [Free Wave Samples](https://freewavesamples.com) | Vintage synth and drum one-shots | scrape | wav | royalty free |
| [OpenGameArt](https://opengameart.org) | Game SFX and loops | scrape | yes | per entry |
| [SoundBible](https://soundbible.com) | Classic SFX | scrape | wav/mp3 | per sound |
| [Orange Free Sounds](https://orangefreesounds.com) | SFX, loops | WordPress API | yes | per post |
| [Openverse](https://openverse.org) | Keyless fallback over Freesound + Wikimedia | API | where direct | per sound |

**Linked (deep link to the site's own search):** Splice, Loopmasters, Loopcloud, Looperman, SampleFocus,
Producer Loops, ADSR, Plugin Boutique, LANDR Samples, Tracklib, Zapsplat, Pixabay, Mixkit, Sonniss,
Uppbeat, Bandcamp, Soundsnap, Epidemic Sound, Artlist, Cymatics, Prime Loops. These block bots, or
their robots.txt or terms forbid automated access.

`GET /v1/providers` (or `list_sources` over MCP) lists every source with its access method and licence.

## Licence verdicts

| Verdict | Means | Examples |
|---|---|---|
| `yes` | Usable in a commercial release, no conditions | CC0, public domain, most royalty-free sites |
| `yes-with-credit` | Usable if you credit the author | CC BY, OGA-BY, Zapsplat free tier |
| `restricted` | Conditions that usually rule out a normal release | CC BY-SA (track must be CC BY-SA too), Sampling+ |
| `clearance-required` | A real recording that needs a paid clearance | Tracklib |
| `check-terms` | Unknown or unverified | no licence stated, uploader-asserted, subscription terms |
| `no` | Non-commercial only | CC BY-NC, CC BY-ND, BBC RemArc, personal use only |

Verdicts are a summary, not legal advice. AI agents search commercial-safe sounds by default.
See [/docs/licences](https://sound.shep.bot/docs/licences).

## Quick start

Needs Node.js 22 or newer, and ffmpeg for audio analysis.

```bash
git clone https://github.com/arielshad/sound-server.git
cd sound-server
npm install && npm --prefix web install
npm run build

npm start                                   # web UI + HTTP API + MCP on http://localhost:8787
node dist/cli.js mcp                        # MCP over stdio
node dist/cli.js search "dark 808 in F minor" --commercial
```

With Docker:

```bash
docker run -p 8787:8787 -e FREESOUND_API_KEY=... ghcr.io/arielshad/sound-server
```

## MCP: use it from an AI assistant

```bash
# Hosted
claude mcp add --transport http sounds https://sound.shep.bot/mcp

# Local (can write files into your project)
claude mcp add sounds -e SOUND_DOWNLOAD_DIR="$PWD/samples" -e FREESOUND_API_KEY=... -- node /path/to/sound-server/dist/cli.js mcp
```

| Tool | What it does |
|---|---|
| `search_samples` | Search every source; BPM/key words become filters; commercial-safe by default |
| `get_sample` | Licence, credit line, files; `analyze=true` fills in duration, BPM, key, root note, loudness |
| `download_sample` | Local only: files the sound by category and updates ATTRIBUTION.md / credits.json |
| `build_kit` | One pick per slot (kick, snare, clap, hats, 808…) with alternatives, a Strudel snippet and an SFZ/GM map |
| `find_similar` | Sounds like a given sample: audio embeddings (CLAP) when enabled, else Freesound's similarity |
| `extract_midi` | A melodic loop (bass, lead, vocal line) as a MIDI file, one note at a time |
| `export_instrument` | Local only: a multisample pack as a playable SFZ + Decent Sampler instrument |
| `list_sources` | Every source and what it is good for |

## HTTP API

```bash
curl "https://sound.shep.bot/v1/search?q=punchy+kick&category=drums.kick&form=one-shot&commercial=true"
curl "https://sound.shep.bot/v1/search?q=vocal+chop&bpm=140&key=F%20minor"
curl "https://sound.shep.bot/v1/samples/freesound:2086?analyze=true"
curl -L -o kick.wav "https://sound.shep.bot/v1/samples/strudel:tidal-drum-machines%2FRolandTR808_bd%2F3/download"
curl -o kit.zip "https://sound.shep.bot/v1/samples/<id>/download?bundle=true"      # with ATTRIBUTION.md
curl -X POST https://sound.shep.bot/v1/kits -H 'content-type: application/json' -d '{"style":"techno","bpm":130}'
```

Search parameters: `q`, `category` (comma list; a parent like `drums` matches its children), `form`,
`bpm` (`140` or `120-128`, half/double time match), `key` (`F minor`, `F#m`), `min_duration`,
`max_duration`, `commercial`, `free`, `downloadable`, `strict`, `providers`, `limit`, `offset`.

Other routes: `/v1/samples/:id/files`, `/v1/samples/:id/preview` (CORS-enabled proxy for previews
that need it), `/v1/samples/:id/peaks` (waveform for players), `/v1/providers`, `/v1/catalog`,
`/v1/stats`, `/openapi.json`. Full reference: [/docs/api/reference](https://sound.shep.bot/docs/api/reference).

To download Freesound originals, send your own Freesound OAuth2 token as `x-freesound-token`.

## CLI

```bash
sound-server search "dusty snare" --category drums.snare --commercial
sound-server search "lofi drum loop 80-90 bpm" --form loop
sound-server serve
sound-server mcp
```

## Search quality (optional)

With `SOUND_SERVER_DATA_DIR` set, analysis results are kept in SQLite (`node:sqlite`) across restarts.
With `SOUND_SERVER_EMBEDDINGS=1` as well, the server embeds previews with CLAP (transformers.js), so
`find_similar` works for every source, text queries re-rank indexed results by how they sound, and
uncertain categories get a model-based second opinion. It needs the `ml` image
(`ghcr.io/arielshad/sound-server:sha-<commit>-ml`, built by CI) and about 1.5 GiB of memory;
`sound-server index --providers strudel` pre-indexes a catalogue.

## Downloads and kits

- The file picker prefers the lossless original (wav > aiff > flac > ogg > mp3) and never picks a file that
  needs a login; when only a preview can be fetched, the result says so.
- Local downloads go to `SOUND_DOWNLOAD_DIR` (default `./samples`), filed by category
  (`samples/drums/kick/…wav`); packs go to `samples/packs/<name>/` and are extracted with size and entry
  caps. Every download merges its credits into `ATTRIBUTION.md` and `credits.json` in that folder.
- `build_kit` with `download=true` writes `samples/kits/<style>/` with the files, `strudel.json`,
  `kit.sfz`, `gm-map.json` and the credits. Over HTTP, the Strudel map points at this server's preview
  proxy, so the snippet plays in strudel.cc as is.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `8787`, `0.0.0.0` | HTTP listener |
| `SOUND_SERVER_PUBLIC_URL` | request origin | Public base URL for links |
| `FREESOUND_API_KEY` | none | Enables Freesound (free key at freesound.org/apiv2/apply) |
| `FREESOUND_OAUTH_TOKEN` | none | **Local use only**: your token, to download Freesound originals |
| `OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET` | none | Higher Openverse limits |
| `SOUND_DOWNLOAD_DIR` | `./samples` | Where local downloads go |
| `SOUND_SERVER_API_KEY` | none | Require a key on `/v1` and `/mcp` (header only) |
| `SOUND_SERVER_PROVIDERS` | all | Comma list to enable a subset |
| `SOUND_SERVER_HTTP_DOWNLOADS` | `false` | Expose `download_sample` on the HTTP MCP endpoint |
| `SOUND_SERVER_RATE_LIMIT` | `120` | Requests per client per minute on `/v1` and `/mcp` |
| `SOUND_SERVER_MAX_DOWNLOAD_BYTES` | 2 GiB | Cap per download / bundle / extracted pack |
| `FFMPEG_PATH`, `FFPROBE_PATH` | from `PATH` | Audio analysis |
| `METRICS_PORT`, `PROMETHEUS_URL` | off | Prometheus metrics and `/stats` |
| `SOUND_SERVER_DATA_DIR` | none | Persistent analysis cache and embedding index (SQLite) |
| `SOUND_SERVER_EMBEDDINGS` | off | `1` turns on CLAP audio embeddings (needs the `ml` image) |
| `SOUND_SERVER_TELEMETRY` | off | Opt-in anonymous install telemetry (needs `SOUND_SERVER_TELEMETRY_WEBSITE_ID`) |

`node dist/cli.js help` lists everything.

## Deploying

The production setup mirrors 3d-asset-server:

1. CI (`.github/workflows/ci.yml`) tests, builds `ghcr.io/arielshad/sound-server:{latest,sha-…}` on every
   push to `main`, and commits the new tag to `deploy/kustomization.yaml`.
2. ArgoCD syncs `deploy/` (kustomize) into the `sound-server` namespace. The app is registered in
   shep-ai/shep-infra (`bootstrap/apps/94-sound-server.yaml`).
3. `deploy/ingress.yaml` serves `sound.shep.bot` behind the edge Caddy (on-demand TLS).
4. Secrets come from Infisical (vault.shep.bot, project `shep-infra`, env `prod`, folder
   `/sound-server`) through External Secrets (`deploy/externalsecret.yaml`). Add `FREESOUND_API_KEY`
   there; the mounted Secret updates in the running pod, no restart needed. Never put a personal
   `FREESOUND_OAUTH_TOKEN` on a public server.

Releases to npm (`npx sound-server`) run from version tags (`.github/workflows/release.yml`).

## Project layout

```
src/core/       model (types, vocab), classify, query parsing, licences, search service,
                downloads, audio analysis, kits, credits, census, collections, analytics
src/providers/  one file per source; link.ts / linked.ts for deep-link-only sites
src/api/        Hono app: REST API, MCP over HTTP, website serving, OpenAPI, share cards
src/mcp/        MCP tools and kit export
web/            Astro website (search, kit builder, docs, collections)
scripts/        daily census, collection snapshots, quality gates
prompts/        instructions for the scheduled source-discovery and collection agents
deploy/         Kubernetes manifests (kustomize) and the ArgoCD app
test/           offline tests with fixtures; test/live/ runs against the real sites (LIVE=1)
```

## Development

```bash
npm test                 # offline tests
npm run typecheck        # server + website
LIVE=1 npm run test:live # hits the real sites
npm run dev              # watch mode
```

New source? Read [docs/PROVIDERS_GUIDE.md](docs/PROVIDERS_GUIDE.md).

## Etiquette

At most a couple of requests per search, a descriptive User-Agent, short caches, robots.txt and terms
respected (a site that forbids automated access is link-only), and no mirroring or re-hosting of
anyone's samples. Report problems at <https://github.com/arielshad/sound-server/issues>.

Code: Apache-2.0. Samples belong to their authors under their own licences.
