import { MCP_NAME, MCP_URL, SOURCE_COUNT } from "./site";

/** Shown on the home page and emitted as FAQPage JSON-LD (answers are plain text). */
export const FAQ = [
  {
    q: "What is Sound Server?",
    a: `Sound Server is a free search engine and API for music samples. One query searches ${SOURCE_COUNT} sites at once, including Freesound, Wikimedia Commons, Openverse, ccMixter, the Internet Archive and SampleRadar, and returns kicks, snares, hats, 808s, loops, vocals, FX, foley and instrument one-shots with a preview and a licence verdict. It works in the browser, over a REST API, and as an MCP server for AI agents.`,
  },
  {
    q: "Can I use these samples in a song I release?",
    a: "It depends on each sample's licence, which is why every result carries a verdict. Green means commercial use is fine (CC0, public domain, royalty-free), or fine with a credit line (CC BY). Amber means read the conditions first: share-alike, Sampling+, uploader-asserted licences or paid clearance. Red means non-commercial only (CC BY-NC, BBC RemArc). Turn on Commercial-safe to see only green results.",
  },
  {
    q: "Why does a Freesound download need an account?",
    a: "Freesound lets anyone stream its MP3 and Ogg previews, but the original WAV or AIFF files are only handed out to logged-in users. Sound Server plays the preview and links to the sound on Freesound, where you sign in (free) to get the original. Self-hosted servers can use your own Freesound OAuth token to fetch originals locally.",
  },
  {
    q: "Does Sound Server host the samples?",
    a: "No. It never re-hosts or resells sounds. Previews play from the source site, single-file downloads redirect to the source, and multi-file downloads are streamed from the source into a zip together with ATTRIBUTION.md and credits.json. The sounds stay with their creators and their licences.",
  },
  {
    q: "Is it free? Is it commercial?",
    a: "Sound Server is a free, non-commercial service: no account, no API key, no ads and no paid tier. It is open source (Apache-2.0), so you can also run your own copy. Paid packs from stores like Cymatics or Prime Loops show their price and link to the store; the purchase happens there.",
  },
  {
    q: "How do I connect Claude Code, Cursor or another AI agent?",
    a: `Add the MCP server URL ${MCP_URL}. In Claude Code run: claude mcp add --transport http ${MCP_NAME} ${MCP_URL}. Cursor, VS Code, Windsurf, Codex CLI and Gemini CLI take the same URL. The agent then gets search_samples, get_sample, build_kit, find_similar and list_sources, and is told to report each licence verdict and never to present a non-commercial sound as cleared.`,
  },
];
