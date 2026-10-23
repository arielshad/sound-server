// Markdown twin of /search: how to search, as URLs and API calls.
import type { APIRoute } from "astro";
import { SEARCHED, SITE, SOURCE_COUNT } from "@/lib/site";
import { CATEGORY_DEFS, SAMPLE_FORMS } from "@/lib/vocab";

export const GET: APIRoute = () =>
  new Response(
    [
      "# Search free music samples",
      "",
      `> One search across ${SOURCE_COUNT} sample sites (${SEARCHED.slice(0, 6).map((p) => p.name).join(", ")} and more) for drums, 808s, loops, vocals, FX, foley, ambience and instruments, with previews, BPM, key and a licence verdict on every result.`,
      "",
      `The search page (${SITE.url}/search) is an interactive app. Every search is a URL, and the same parameters work on the JSON API:`,
      "",
      `- Web: ${SITE.url}/search?q=punchy+kick&category=drums.kick&commercial=true`,
      `- API: \`curl "${SITE.url}/v1/search?q=punchy+kick&category=drums.kick&commercial=true"\``,
      "",
      "## Parameters",
      "",
      "| Parameter | Meaning |",
      "| --- | --- |",
      "| `q` | Free text in producer language: `dusty snare`, `vocal chop 140 bpm`, `808 in F minor`. |",
      "| `category` | Comma-separated categories (below). A parent matches its children. |",
      `| \`form\` | ${SAMPLE_FORMS.map((f) => `\`${f}\``).join(", ")}. |`,
      "| `bpm` | `140` or `120-128`; half and double time match. |",
      "| `key` | `F minor`, `F#m`, `Eb`; the relative key matches. |",
      "| `commercial` | `true`: only samples cleared for a commercial release. |",
      "| `free` | `true`: no paid samples or packs. |",
      "| `downloadable` | `true`: only samples this server can download directly. |",
      "| `providers` | Source ids, e.g. `freesound,openverse`. |",
      "| `sample` | Opens one sample's details, e.g. `sample=freesound:2086`. |",
      "",
      "## Categories",
      "",
      ...CATEGORY_DEFS.map((c) => `- \`${c.id}\`: ${c.label}`),
      "",
      `Full API: ${SITE.url}/docs/api.md · OpenAPI: ${SITE.url}/openapi.json · Agent guide: ${SITE.url}/AGENTS.md`,
      "",
      "---",
      `Source: ${SITE.url}/search`,
      "",
    ].join("\n"),
    { headers: { "content-type": "text/markdown; charset=utf-8" } },
  );
