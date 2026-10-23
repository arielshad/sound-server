---
layout: ../../layouts/DocsLayout.astro
title: MCP server for AI agents
crumb: Coding agents & MCP
description: Connect Claude Code, Cursor, VS Code, Windsurf, Codex or Gemini CLI to the Sound Server MCP server so your agent finds, vets and downloads music samples.
---

# Sound Server MCP server for AI agents

Sound Server is a [Model Context Protocol](https://modelcontextprotocol.io) server. Connect it once and your agent can search every sample source, build drum kits, check licences and pull sounds into your project while it works on your track, game or app.

**MCP endpoint:** `https://sound.shep.bot/mcp` (Streamable HTTP, no authentication). Register it under the name **`sounds`**.

## Claude Code

```bash
claude mcp add --transport http sounds https://sound.shep.bot/mcp
```

Add `--scope user` to make it available in every project, or `--scope project` to share it with your team through `.mcp.json`. Check it with `claude mcp list`, or `/mcp` inside a session.

## Cursor

Add this to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json` for every project (the [home page](/#agents) has a one-click "Add to Cursor" button):

```json
{
  "mcpServers": {
    "sounds": { "url": "https://sound.shep.bot/mcp" }
  }
}
```

## VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`, then use Copilot Chat in **Agent** mode:

```json
{
  "servers": {
    "sounds": { "type": "http", "url": "https://sound.shep.bot/mcp" }
  }
}
```

Or from a terminal: `code --add-mcp '{"name":"sounds","type":"http","url":"https://sound.shep.bot/mcp"}'`

## Claude desktop app and claude.ai

Open **Settings → Connectors → Add custom connector**, name it *Sound Server* and paste `https://sound.shep.bot/mcp`.

## Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "sounds": { "serverUrl": "https://sound.shep.bot/mcp" }
  }
}
```

## OpenAI Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.sounds]
url = "https://sound.shep.bot/mcp"
```

## Gemini CLI

```bash
gemini mcp add --transport http sounds https://sound.shep.bot/mcp
```

## Any other client

Clients that only support stdio servers can bridge to the HTTP endpoint with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "sounds": { "command": "npx", "args": ["-y", "mcp-remote", "https://sound.shep.bot/mcp"] }
  }
}
```

## Tools your agent gets

| Tool | What it does |
| --- | --- |
| `search_samples` | Search every source. Arguments: `query` (music words work: "808 in F minor", "vocal chop 140 bpm"), `categories` (e.g. `drums.kick`, `bass.808`, `fx.riser`), `forms` (`one-shot`, `loop`, `phrase`…), `bpm` or `bpm_min`/`bpm_max`, `key`, `max_duration`, `commercial_only` (default **true**), `free_only`, `downloadable_only`, `strict`, `providers`, `limit`, `offset`. |
| `get_sample` | Details for one `id`: licence, verdict and credit line, files, preview, and with `analyze=true` the measured duration, BPM, key, root note and loudness. Returns `selection.downloadUrl` for the best file. |
| `download_sample` | Local servers only: writes the file into `./samples/<category>/` and keeps `ATTRIBUTION.md` and `credits.json` up to date. |
| `build_kit` | Picks one sound per slot (default kick, snare, clap, closed hat, open hat, 808) for a `style`, `bpm` and `key`, with alternatives, a licence summary, a Strudel snippet and a General MIDI / SFZ map. Locally, `download=true` saves the kit. |
| `find_similar` | Sounds that sound like a Freesound sample (Freesound's audio similarity). |
| `list_sources` | Every source with what it is best for, categories, pricing, licence and capabilities. |

The remote server never writes to its own disk, so agents with a shell download through the links it returns:

```bash
mkdir -p samples/drums
curl -L -o samples/drums/kick.zip "https://sound.shep.bot/v1/samples/freesound%3A2086/download?bundle=true"
unzip -o samples/drums/kick.zip -d samples/drums/
```

## Licence rules the agent follows

Music licences have more traps than most, so the server tells every agent the same rules, and you can expect them to be followed:

- Searches are **commercial-safe by default** (`commercial_only=true`). The agent turns that off only when you say the project is personal or non-commercial.
- It **reports the verdict** of every sound it suggests, and never presents a `no` (non-commercial) or `check-terms` (unclear) sound as cleared.
- When a sound needs credit (`yes-with-credit`), it gives you the exact `attribution` line, and local downloads collect them in `ATTRIBUTION.md`.
- Uploader-asserted licences (for example on the Internet Archive) are flagged as unverified.

Details: [Sample licences explained](/docs/licences).

## Prompts that work well

```text
Build me a dark trap kit at 140 BPM in F minor: kick, snare, hats, clap and an 808. Commercial-safe only. Show me the picks with their licences first.
```

```text
Find a riser and an impact for a drop at 128 BPM. Only CC0 or royalty free. Download them into ./samples/fx.
```

```text
I need a vocal chop in A minor for a house track. Give me five options with preview links and tell me which ones need a credit.
```

Tips for agents and the people prompting them:

- Write queries the way a producer talks: "punchy kick", "dusty snare", "open hat", "rain ambience".
- Filter by category when the word is ambiguous: "crash" is a cymbal, not a sound effect.
- Results with `downloadable: false` must be fetched from their `url` on the source site; `requiresAccount: true` means the original needs a (usually free) account there.

## Local mode: downloads straight to disk

For `download_sample` and kit downloads into your project, run the server locally over stdio:

```bash
claude mcp add sounds-local -- npx -y sound-server mcp
```

Or with Docker, mounting your samples folder:

```bash
claude mcp add sounds-local -- docker run -i --rm \
  --user "$(id -u):$(id -g)" -v "$PWD/samples:/app/samples" \
  ghcr.io/arielshad/sound-server node dist/cli.js mcp
```

Files land in `./samples/<category>/` (packs in `./samples/packs/<name>/`). Add `-e FREESOUND_API_KEY=...` for Freesound search, and `-e FREESOUND_OAUTH_TOKEN=...` to fetch Freesound originals with your own account.

## Agents without MCP

Any agent that can fetch URLs can use the REST API directly. Point it at [/AGENTS.md](/AGENTS.md); it has the whole workflow and the licence rules in a few lines. In Claude Code you can also install the ready-made skill:

```bash
mkdir -p ~/.claude/skills/sounds
curl -fsSL https://sound.shep.bot/skill/SKILL.md -o ~/.claude/skills/sounds/SKILL.md
```
