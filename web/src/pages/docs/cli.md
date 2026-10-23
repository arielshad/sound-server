---
layout: ../../layouts/DocsLayout.astro
title: Sound Server CLI
crumb: CLI
description: Use the sound-server command line tool to search sample sites from a terminal, run the MCP server over stdio for local downloads, or start your own HTTP server.
---

# Sound Server CLI

The `sound-server` command searches every source from a terminal, runs the MCP server over stdio for desktop agents (with downloads to your disk), and starts the HTTP server. It is the same code that runs https://sound.shep.bot.

```bash
npx sound-server search "dark 808 in F minor" --commercial
```

## Commands

```text
sound-server search <query> [--category drums.kick] [--form one-shot] [--bpm 140] [--key "F minor"]
                     [--commercial] [--free] [--providers freesound,wikimediacommons] [--limit N]
sound-server mcp     # MCP server over stdio, with download_sample writing to ./samples
sound-server serve   # HTTP API + website + MCP at /mcp on port 8787
```

Queries understand music words, so `"vocal chop 140 bpm"` filters by tempo and `"808 in F minor"` by key, exactly like the flags. `--commercial` keeps only sounds whose licence allows a commercial release (verdict `yes` or `yes-with-credit`).

`search` prints the filters it read from your query, then ranked results (score, licence verdict and sample id, then the title with its category, form, BPM, key and length, and the preview URL), followed by one status line per source:

```text
Filters: {"key":{"tonic":"F","mode":"minor"}}

0.91  yes-with-credit freesound:123456
      Dark 808 F (bass.808 · one-shot · F minor · 2.1s)
      https://cdn.freesound.org/previews/123/123456_1234-hq.mp3

Sources:
  freesound          ok       12
  splice             link     0  https://splice.com/sounds/search?q=dark+808
```

Pass the sample id to the REST API (`/v1/samples/{id}/download`) or the MCP `get_sample` tool to fetch files.

## Run it with Docker (no install)

```bash
docker run --rm ghcr.io/arielshad/sound-server node dist/cli.js search "punchy kick" --commercial
```

As a local MCP server that writes downloads into your project:

```bash
docker run -i --rm --user "$(id -u):$(id -g)" -v "$PWD/samples:/app/samples" \
  ghcr.io/arielshad/sound-server node dist/cli.js mcp
```

## Run it from source

```bash
git clone https://github.com/arielshad/sound-server
cd sound-server && npm ci && npm run build:server
node dist/cli.js search "riser" --category fx.riser --commercial
```

Audio analysis (measured BPM, key, length and loudness) needs `ffmpeg` and `ffprobe` on your `PATH`, or set `FFMPEG_PATH` and `FFPROBE_PATH`.

## Environment

| Variable | Purpose |
| --- | --- |
| `FREESOUND_API_KEY` | Enables Freesound search and previews ([free key](https://freesound.org/apiv2/apply)). |
| `FREESOUND_OAUTH_TOKEN` | Local use only: your own Freesound OAuth2 token, to download originals from your account. |
| `OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET` | Optional Openverse app credentials for higher rate limits. |
| `SOUND_SERVER_PROVIDERS` | Comma list to search only some sources. |
| `SOUND_DOWNLOAD_DIR` | Where `mcp` downloads go (default `./samples`). |
| `NODE_USE_ENV_PROXY` | Set to `1` so the CLI honours `HTTPS_PROXY`. |

See [Self-hosting](/docs/self-hosting) for every server setting.
