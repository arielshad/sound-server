// Markdown twin of /kit (the kit builder is an interactive island; this says what it does and how to call it).
import type { APIRoute } from "astro";
import { MCP_URL, SITE } from "@/lib/site";

export const GET: APIRoute = () =>
  new Response(
    [
      "# Drum kit builder",
      "",
      "> Build a matching drum kit in one step: a kick, snare, clap, closed and open hi-hat and 808 for a style, tempo and key, each with alternatives, a licence verdict and the credit line, plus a Strudel snippet and a General MIDI / SFZ map.",
      "",
      `The page at ${SITE.url}/kit is an interactive front end to one API call. Agents and scripts should call the API directly:`,
      "",
      "```bash",
      `curl -X POST ${SITE.url}/v1/kits \\`,
      '  -H "content-type: application/json" \\',
      `  -d '{"style":"dark trap","bpm":140,"key":"F minor","slots":["kick","snare","clap","hat.closed","hat.open","808"]}'`,
      "```",
      "",
      "## What you get",
      "",
      "- One pick per slot, with alternatives (`perSlot`, 0-5) and the reason each was chosen.",
      "- A licence summary (picks per verdict) and the credit lines to paste into a release. `commercialOnly` defaults to `true`.",
      "- A Strudel sample map and snippet pointing at the preview proxy, so the kit plays in https://strudel.cc as is.",
      "- A General MIDI / SFZ drum map: kick 36, snare 38, clap 39, closed hat 42, open hat 46.",
      "",
      "## From an AI agent",
      "",
      `Connect the MCP server ${MCP_URL} and call \`build_kit\` (style, bpm, key, slots). Run locally, \`download=true\` saves the files with an SFZ file and ATTRIBUTION.md.`,
      "",
      `Guide: ${SITE.url}/guides/build-a-drum-kit-from-free-samples.md`,
      "",
      "---",
      `Source: ${SITE.url}/kit`,
      "",
    ].join("\n"),
    { headers: { "content-type": "text/markdown; charset=utf-8" } },
  );
