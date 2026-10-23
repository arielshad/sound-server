---
layout: ../../layouts/DocsLayout.astro
title: Self-hosting
crumb: Self-hosting
description: Run your own Sound Server with Docker or Node.js, add Freesound and Openverse keys, protect it with an API key, and expose Prometheus metrics.
---

# Self-hosting Sound Server

Sound Server is open source (Apache-2.0). Run your own copy to use your own Freesound key and account, put it behind an API key, let the MCP server write files to a shared disk, or keep searches on your own network.

## Docker

```bash
docker run -p 8787:8787 -e FREESOUND_API_KEY=... ghcr.io/arielshad/sound-server
```

Open http://localhost:8787 for the website, `/v1/*` for the API and `/mcp` for MCP. The image includes `ffmpeg`, which audio analysis needs.

## Node.js

```bash
git clone https://github.com/arielshad/sound-server
cd sound-server
npm ci && npm run build
npm start
```

Node 22 or newer. Install `ffmpeg` (with `ffprobe`) for measured BPM, key, length and loudness; without it everything else works and those fields come only from the sources.

## Source credentials

| Variable | Purpose |
| --- | --- |
| `FREESOUND_API_KEY` | Enables Freesound search and previews. Get a free key at [freesound.org/apiv2/apply](https://freesound.org/apiv2/apply). Freesound's API terms need a separate agreement for commercial apps. |
| `FREESOUND_OAUTH_TOKEN` | **Local use only.** Your own Freesound OAuth2 token, so `download_sample` and `/download` can fetch originals from your account. Never set it on a shared server: every visitor would download with your account. Callers of a shared server can pass their own token in the `x-freesound-token` header instead. |
| `OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET` | Optional Openverse app credentials for higher rate limits. |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | HTTP bind address. |
| `SOUND_SERVER_API_KEY` | none | Require `Authorization: Bearer <key>` or `x-api-key` on `/v1/*` and `/mcp`. Keys are accepted in headers only, never in the URL. The website asks for it and sends it as a header. |
| `SOUND_SERVER_PUBLIC_URL` | request origin | Base URL used in links handed to MCP clients and in kit maps. Set it behind a TLS proxy. |
| `SOUND_SERVER_PROVIDERS` | all | Comma list to enable only some sources. |
| `SOUND_DOWNLOAD_DIR` | `./samples` | Where MCP downloads go (`<dir>/<category>/…`, with `ATTRIBUTION.md` and `credits.json`). |
| `SOUND_SERVER_HTTP_DOWNLOADS` | `false` | Expose `download_sample` on the HTTP MCP endpoint (writes to the server's disk). |
| `SOUND_SERVER_HTTP_MCP` | `true` | Set to `false` to turn off MCP over HTTP at `/mcp`. The website and `/v1` API keep working, and the stdio MCP server is unaffected. |
| `SOUND_SERVER_PROVIDER_TIMEOUT_MS` | `12000` | Per-source search timeout. |
| `SOUND_SERVER_HTTP_TIMEOUT_MS` | `15000` | Timeout for each request to a source. |
| `SOUND_SERVER_CACHE_TTL_MS` | `600000` | How long source responses are cached in memory (10 minutes). |
| `SOUND_SERVER_MAX_DOWNLOAD_BYTES`, `SOUND_SERVER_MAX_ZIP_ENTRIES` | 2 GiB, `20000` | Caps for downloads and zip bundles. |
| `SOUND_SERVER_DOWNLOAD_IDLE_MS` | `30000` | Abort a download when no bytes arrive for this long. |
| `SOUND_SERVER_ANALYSIS_CONCURRENCY`, `SOUND_SERVER_ANALYSIS_CACHE` | 2-8 (by CPU), `1000` | How many ffmpeg analyses run at once, and how many results are cached. |
| `SOUND_SERVER_USER_AGENT` | built in | The User-Agent sent to sources. Keep it descriptive with a contact URL. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | from `PATH` | ffmpeg binaries for audio analysis. |
| `SOUND_SERVER_RATE_LIMIT` | `120` | Requests per client per window on `/v1/*` and `/mcp`, with RateLimit headers and `429` + `Retry-After` beyond it. `0` turns it off. |
| `SOUND_SERVER_RATE_LIMIT_WINDOW` | `60` | Rate-limit window in seconds. |
| `METRICS_PORT` | off | Serve Prometheus metrics on this port at `/metrics`, and log one JSON line per search, download and tool call. |
| `PROMETHEUS_URL` | off | Prometheus that scrapes `METRICS_PORT`. `/v1/stats` and the `/stats` page then show the last 24 hours and 7 days; without it they count since the server started. |
| `MAXMIND_ACCOUNT_ID`, `MAXMIND_LICENSE_KEY` | off | With `METRICS_PORT`: download MaxMind's free GeoLite2-ASN database (refreshed weekly) to label MCP callers by network (ISP, AWS, Google Cloud, Azure, other hosting). |
| `SOUND_SERVER_ASN_DB` | none | Path to a GeoLite2-ASN `.mmdb` file to use instead of downloading one. |
| `SOUND_SERVER_SESSION_SECRET` | random | Signs the MCP session IDs that carry each client's declared name. Set it so sessions keep their label across restarts. |
| `SOUND_SERVER_TELEMETRY` | off | `1` to send anonymous usage counts to the maintainers (see [Privacy](/privacy)). `DO_NOT_TRACK=1` always turns it off. |
| `UMAMI_WEBSITE_ID`, `UMAMI_HOST` | off | Add your own self-hosted Umami tracker to the website pages (cookieless page views). |
| `SOUND_SERVER_DATA_DIR` | none | Keep audio analyses and the embedding index in SQLite (`<dir>/sound-server.db`) across restarts. |
| `SOUND_SERVER_EMBEDDINGS` | off | `1` turns on CLAP audio embeddings (needs the `-ml` image and about 1.5 GB of memory). See [Audio embeddings](#audio-embeddings). |
| `SOUND_SERVER_INDEX_PER_MINUTE` | `20` | How many previews the background indexer embeds per minute. `0` stops it. |
| `SOUND_SERVER_DUPLICATE_COSINE` | `0.985` | How alike two sources' audio must be (with matching durations) to count as the same recording. |

## Audio embeddings

With `SOUND_SERVER_EMBEDDINGS=1` the server embeds sample previews with CLAP, a model that places sounds and
text descriptions in the same space. Previews of samples that appear in searches are embedded in the background,
a few per minute; `sound-server index --providers strudel` embeds a whole catalogue up front. Once samples are
indexed:

- **Sounds like this** (`find_similar`, `/v1/samples/{id}/similar`) works for every source, not only Freesound.
- **Search ranking** also weighs how well each indexed result *sounds* like the query.
- **Duplicates across sources merge.** When two sources carry the same recording (near-identical audio and the
  same duration), search shows it once, under the source listed first, with the other copy in `sameAs`.
- **Unsure categories** get a second opinion from the model.
- **The sound map** at [/map](/map) (and [`/v1/map`](/docs/api/reference#op-soundMap)) lays out the indexed sounds
  in 2-D so that sounds that sound alike sit close together. Click a dot to hear it.

The model files (about 200 MB) download on first use into `SOUND_SERVER_DATA_DIR`. Use the image tagged
`sha-<commit>-ml`: its Debian base runs the ONNX runtime the model needs.

## Analytics

With `METRICS_PORT` set, the server exports Prometheus metrics with bounded labels only (surface, client family, source, status, tool):

- `sound_server_searches_total`, `sound_server_search_duration_seconds`, `sound_server_search_results`
- `sound_server_provider_requests_total` and `sound_server_provider_duration_seconds` for each source's health and latency
- `sound_server_downloads_total`, `sound_server_sample_views_total`
- `sound_server_mcp_tool_calls_total` by tool, client family (Claude Code, Cursor, VS Code, …), network and consistency (whether the declared client, User-Agent and network agree)
- `sound_server_mcp_connects_total` and `sound_server_mcp_new_callers_total` (first tool call of the day per caller, counted from a hash with a daily salt)
- `sound_server_http_requests_total`, `sound_server_page_views_total`

The [/stats](/stats) page and `GET /v1/stats` read these counters back: from Prometheus when `PROMETHEUS_URL` is set, otherwise from this process since it started.

Each search also logs a JSON line (`{"event":"search","query":…,"results":…}`) for top-query and zero-result analysis. Nothing personal is recorded with it: no IP addresses, keys or cookies.

## Stdio MCP

```bash
node dist/cli.js mcp
```

Runs the MCP server over stdio with `download_sample` enabled and kit downloads (`build_kit` with `download=true`), for desktop clients that launch a local process. Downloads go to `SOUND_DOWNLOAD_DIR`.

## Content Security Policy

The website ships with a strict Content-Security-Policy (no inline scripts or styles except by hash or per-request nonce). Audio previews play from the sources' CDNs, so `media-src` and `connect-src` allow `https:` and `blob:`; keep that in mind if you put a proxy in front that rewrites headers.
