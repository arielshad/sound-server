import { LINKED, MCP_NAME, MCP_URL, SEARCHED, SOURCE_COUNT } from "./site";

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

/** The full FAQ (/docs/faq), grouped. The home page's questions come first. */
export const FAQ_GROUPS: { title: string; id: string; items: { q: string; a: string }[] }[] = [
  { title: "About Sound Server", id: "about", items: FAQ },
  {
    title: "Searching",
    id: "searching",
    items: [
      {
        q: "How do I search by tempo and key?",
        a: "Write them in the query, like \"vocal chop 140 bpm\" or \"808 in F minor\", or use the BPM and key filters. Half and double tempo and the relative major or minor also match, because they fit the same track. Sounds whose source doesn't label tempo or key stay in the results, ranked lower, unless you turn on strict matching.",
      },
      {
        q: "Why are some results links instead of sounds?",
        a: `Some sites, such as Splice, Looperman and most sample stores, don't allow automated search or have no public API. Sound Server doesn't scrape them: it shows a link that runs the same search on that site. Of the ${SOURCE_COUNT} sources, ${SEARCHED.length} are searched directly and return playable results, and ${LINKED.length} are links.`,
      },
      {
        q: "How fresh are the results?",
        a: "Searches run live against the sources each time, with short caching. The curated collections are saved searches refreshed daily, and the catalogue counts on the stats page are taken once a day.",
      },
      {
        q: "Can I search for sound effects, not just music samples?",
        a: "Yes. Foley, ambience and effects such as risers, impacts, whooshes and glitches are categories of their own, and many sources are sound-effect libraries. Video editors and game developers use the same search.",
      },
    ],
  },
  {
    title: "Licences",
    id: "licences",
    items: [
      {
        q: "What do the green, amber and red verdicts mean?",
        a: "Green: cleared for a commercial release, with or without a credit line. Amber: conditions apply (share-alike, Sampling+, paid clearance, or terms nobody verified), so read the licence first. Red: non-commercial only. The licence of every sample is linked so you can check it yourself.",
      },
      {
        q: "Why is an Internet Archive sound marked 'check the terms' even when it says CC0?",
        a: "On the Internet Archive, uploaders type in the licence themselves and nobody verifies they owned the recording. Sound Server never rates an uploader-asserted licence better than 'check the terms'. Licences recorded by the source per item, as on Freesound and Wikimedia Commons, are trusted more.",
      },
      {
        q: "Is the verdict legal advice?",
        a: "No. It is a consistent reading of the licence each source publishes, applied the same way everywhere, with a note explaining it. For a release that matters, read the licence itself; for anything large, ask a lawyer.",
      },
      {
        q: "Do I have to credit CC0 sounds?",
        a: "No. CC0 waives the creator's rights, so a credit is optional. CC BY sounds do need one, and Sound Server writes the credit line for you.",
      },
    ],
  },
  {
    title: "Downloads and credits",
    id: "downloads",
    items: [
      {
        q: "What do I get when I download a sample?",
        a: "A single file redirects to the source's download. Several files, or a download with the bundle option, arrive as one zip with the audio, ATTRIBUTION.md (human-readable credits) and credits.json (the same, machine-readable). Samples that need an account on the source link to its page instead.",
      },
      {
        q: "Can I download a whole drum kit at once?",
        a: "Yes. The kit builder picks one sound per slot and gives you the credits, a Strudel snippet and an SFZ / General MIDI map. Run locally, the MCP tool build_kit saves the files into your project.",
      },
    ],
  },
  {
    title: "API, agents and self-hosting",
    id: "api",
    items: [
      {
        q: "Is there a rate limit?",
        a: "The public server allows 120 requests per minute per client across the REST API and MCP. Every response carries RateLimit headers, and a 429 response says when to retry.",
      },
      {
        q: "Can I run my own copy?",
        a: "Yes. Sound Server is open source under Apache-2.0 and runs with Docker or Node.js. A self-hosted server can use your own Freesound credentials for original-quality downloads and run as a stdio MCP server for local agents.",
      },
      {
        q: "How can an AI agent read this site?",
        a: "Every page has a Markdown version: add .md to the address or send Accept: text/markdown. Agents can start from /llms.txt or /AGENTS.md, and the REST API is described in /openapi.json.",
      },
    ],
  },
];

/** Every question on /docs/faq, flat (for FAQPage JSON-LD and the Markdown twin). */
export const FAQ_ALL = FAQ_GROUPS.flatMap((g) => g.items);
