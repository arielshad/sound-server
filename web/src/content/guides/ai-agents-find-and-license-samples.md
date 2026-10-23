---
title: "How AI music agents can find and license samples with MCP"
seoTitle: "AI agents: find and license samples with MCP"
description: "Connect Claude, Cursor or another AI agent to Sound Server's MCP server so it searches 30+ sample sites, checks each licence and downloads sounds with credits."
answer: "Give the agent Sound Server's MCP server (https://sound.shep.bot/mcp, no key needed). It then has tools to search every sample source (search_samples), read a sample's licence, credit line and files (get_sample), assemble a drum kit (build_kit) and find similar sounds (find_similar). Searches are commercial-safe by default, and the agent is told to report each sample's licence verdict and never present a non-commercial sound as cleared."
section: AI agents
kind: howto
steps:
  - name: "Add the MCP server"
    text: "In Claude Code: claude mcp add --transport http sounds https://sound.shep.bot/mcp. In Cursor, VS Code, Windsurf, Codex CLI or Gemini CLI, add the same URL as a Streamable HTTP server."
  - name: "Ask in producer language"
    text: "For example: 'find a dark 808 in F minor I can use in a release' or 'build a 124 BPM house kit, commercial-safe'. The agent turns this into search_samples or build_kit calls with category, key and BPM filters."
  - name: "Let it vet the licences"
    text: "Each result carries a verdict. The agent should list the verdict for every suggestion and keep the credit line for any 'OK with credit' sound."
  - name: "Download with credits"
    text: "The agent downloads the chosen file from get_sample's selection.downloadUrl, or with bundle=true to receive ATTRIBUTION.md and credits.json alongside the audio."
  - name: "Keep the paper trail"
    text: "Commit ATTRIBUTION.md with the project so the credits travel with the files into your release."
faq:
  - q: "Does the agent need an API key?"
    a: "No. The hosted MCP server and REST API are free and keyless, with a rate limit of 120 requests per minute per client. Self-hosted servers can add your own Freesound credentials for original-quality downloads."
  - q: "Can an agent tell whether a sample is safe for a release?"
    a: "It can report the verdict Sound Server derives from the source's licence, which is what it is instructed to do. Final responsibility stays with the person releasing the music, especially for uploader-asserted licences, which are never rated better than 'check the terms'."
  - q: "Can the agent generate new sounds?"
    a: "No. Sound Server finds existing recordings and their licences. For generated audio use a different tool, and check that tool's terms for commercial use."
  - q: "Which agents work with it?"
    a: "Any client that supports MCP over Streamable HTTP, including Claude Code, Claude Desktop, Cursor, VS Code with Copilot, Windsurf, Codex CLI and Gemini CLI. Agents without MCP can read /AGENTS.md and call the REST API."
searches:
  - { label: "What the agent sees: 808s in F minor", href: "/search?q=808&category=bass.808&key=F+minor&commercial=true" }
collections: [free-808-samples, free-kick-samples, free-riser-sound-effects]
related: [build-a-drum-kit-from-free-samples, find-samples-by-bpm-and-key, credit-cc-by-samples, what-counts-as-commercial-use]
cites:
  - { name: "Model Context Protocol", url: "https://modelcontextprotocol.io/" }
  - { name: "Sound Server agent guide (AGENTS.md)", url: "https://sound.shep.bot/AGENTS.md" }
published: 2026-10-23
updated: 2026-10-23
order: 11
---

## Why an agent needs a sample search

AI coding and music agents are good at writing patterns, Strudel code, game logic or a DAW template, but they can't invent where a legal kick drum comes from. Without a search tool, they guess URLs, suggest sounds from memory or fetch whatever a web search returns, with no idea of the licence. Sound Server gives them one interface to many sample sites, with the licence already read and turned into a verdict.

## The tools

| Tool | What it does |
| --- | --- |
| `search_samples` | Searches every source; accepts music words ("vocal chop 140 bpm"), categories, forms, BPM, key, duration. `commercial_only` defaults to true. |
| `get_sample` | One sample's licence, verdict, credit line, files and preview; optional audio analysis for BPM, key and loudness. |
| `build_kit` | One sound per drum slot for a style, tempo and key, with alternatives, a Strudel snippet and an SFZ / General MIDI map. |
| `find_similar` | Sounds similar to a given sample (currently Freesound's audio similarity). |
| `list_sources` | The sites searched, with their licence models. |

See [Coding agents & MCP](/docs/mcp) for setup in each client.

## What the agent is told

The server's instructions, and the [agent guide](/AGENTS.md), set the licence rules:

- search commercial-safe unless the user says the project is personal or non-commercial;
- report the verdict of every suggested sound;
- never present a `no` or `check-terms` sound as cleared for release;
- pass on the credit line whenever one is required.

## A worked example

Asked "make me a lo-fi beat in Strudel at 80 BPM with sounds I can release", an agent would call `build_kit` with a lo-fi style, 80 BPM and commercial-safe on, paste the returned Strudel snippet, and list the kit with each sound's verdict and credit line. If the user later swaps the snare, `search_samples` with `categories=["drums.snare"]` returns alternatives with their verdicts.

## Without MCP

Agents that only browse can read [/AGENTS.md](/AGENTS.md) or [/llms.txt](/llms.txt) and call the REST API: `GET /v1/search?q=…&commercial=true`, then `GET /v1/samples/{id}`. Every page on this site is also available as Markdown, so an agent can read guides like this one directly.
