---
layout: ../../layouts/DocsLayout.astro
title: Quick start
crumb: Docs
description: Get started with Sound Server in two minutes. Search sample sites in the browser, connect Claude Code or Cursor over MCP, or call the REST API.
---

# Sound Server quick start

**Sound Server** searches many free and paid sample sites at once and tells you, for every sound, whether you can use it in a track you release. Results cover drums (kicks, snares, claps, hats, percussion, breaks), 808s and bass, vocals and a cappellas, FX (risers, impacts, sweeps, zaps), foley, ambience and instrument one-shots, with BPM, key and length where known and a preview you can play.

The public server at **https://sound.shep.bot** is a free, non-commercial service and needs no account or API key. It never re-hosts sounds: previews and downloads come from the source sites.

## Pick how you want to use it

| You want to… | Use | Start here |
| --- | --- | --- |
| Browse, audition and download samples yourself | The web search | [/search](/search) |
| Get a matching drum kit for a style, tempo and key | The kit builder | [/kit](/kit) |
| Let Claude Code, Cursor, Copilot or another agent find sounds | The MCP server at `https://sound.shep.bot/mcp` | [Coding agents & MCP](/docs/mcp) |
| Call it from a script, a DAW extension or a backend | The REST API | [REST API guide](/docs/api) |
| Explore every endpoint and try requests | The interactive reference | [API reference](/docs/api/reference) |

## Connect your agent (30 seconds)

For **Claude Code**, run this once:

```bash
claude mcp add --transport http sounds https://sound.shep.bot/mcp
```

Then ask for what you need:

```text
Find three punchy kicks and a dark 808 in F minor that I can use in a released track.
Put them in ./samples and tell me any credit lines I need.
```

Cursor, VS Code, Windsurf, Codex CLI, Gemini CLI and the Claude apps take the same URL. See [Coding agents & MCP](/docs/mcp) for each one.

## Or call the API

```bash
# Kicks cleared for a commercial release
curl "https://sound.shep.bot/v1/search?q=punchy+kick&category=drums.kick&form=one-shot&commercial=true&limit=5"

# Details, files and the credit line for one result
curl "https://sound.shep.bot/v1/samples/freesound:2086"

# Download it as a zip with the audio, ATTRIBUTION.md and credits.json
# (without bundle=true a single file redirects straight to the source)
curl -L -o kick.zip "https://sound.shep.bot/v1/samples/freesound:2086/download?bundle=true"
```

## What a search returns

Every search returns two lists:

- **`results`**: samples merged from all sources and ranked by how well they match. Each has an `id` like `freesound:2086`, a `category` (`drums.kick`, `fx.riser`…), a `form` (`one-shot`, `loop`…), `bpm`, `key` and `durationSec` when known, a `previewUrl`, a `license` with a `verdict`, an `attribution` line when credit is required, and `downloadable`.
- **`providers`**: one status line per source (`ok`, `error`, `timeout`, `skipped` or `link`). Sites that don't allow automated search (Splice, Looperman and others) come back as `link` with a `searchUrl` that runs the same search on their site.

A slow or broken source never fails the search. Queries understand music words: "808 in F minor" filters by key, "vocal chop 140 bpm" by tempo, "loop" or "one shot" by form.

## Licences, in one line each

- **Commercial use OK** (`yes`): release it, no credit needed.
- **Commercial use OK with credit** (`yes-with-credit`): release it and credit the author with the `attribution` line.
- **Restricted**, **Needs paid clearance**, **Unclear** (`restricted`, `clearance-required`, `check-terms`): read the terms first.
- **Non-commercial only** (`no`): practice and personal projects, not releases.

`commercial=true` keeps only the first two. The full explanation is in [Sample licences explained](/docs/licences).

## For AI agents reading this

Machine-readable entry points:

- [/AGENTS.md](/AGENTS.md): how to use this service as an agent, including the licence rules
- [/llms.txt](/llms.txt) and [/llms-full.txt](/llms-full.txt): site index and full docs as plain text
- [/openapi.json](/openapi.json): OpenAPI 3.1 description of the REST API
