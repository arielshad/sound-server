// Markdown twin of /map (the map is an interactive canvas; this says what it shows and how to get the data).
import type { APIRoute } from "astro";
import { SITE } from "@/lib/site";

export const GET: APIRoute = () =>
  new Response(
    [
      "# Sound map",
      "",
      "> The samples a Sound Server has listened to, laid out in 2-D so that sounds that sound alike sit close together. Each point carries its sample id, category, source, duration and licence verdict.",
      "",
      "The map needs audio embeddings (CLAP), which a server computes only when `SOUND_SERVER_EMBEDDINGS=1` is set. Without them the endpoint answers `{\"enabled\": false}`.",
      "",
      "```bash",
      `curl "${SITE.url}/v1/map?category=drums&limit=500"`,
      "```",
      "",
      "## The data",
      "",
      "- `points[]`: `id`, `x` and `y` (0..1), `provider`, `title`, `category`, `durationSec`, `verdict`.",
      "- `matching`: how many indexed samples matched the filters; at most `limit` (max 2500) are laid out, spread evenly.",
      "- Filters: `category` (a category and its children, e.g. `drums` or `fx.riser`) and `provider`.",
      "- One point per sound: the same recording on two sources appears once.",
      "",
      "## How it is made",
      "",
      "Each preview is embedded with CLAP (512 numbers per sound). The server finds every sound's nearest neighbours and lays the points out so that neighbours stay together, in the style of UMAP. Distances within a cluster mean more than distances between clusters.",
      "",
      `To hear a point, play \`${SITE.url}/v1/samples/{id}/preview\`; for sounds like it, call \`/v1/samples/{id}/similar\`.`,
      "",
      "---",
      `Source: ${SITE.url}/map`,
      "",
    ].join("\n"),
    { headers: { "content-type": "text/markdown; charset=utf-8" } },
  );
