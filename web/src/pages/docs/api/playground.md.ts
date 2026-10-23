// Markdown twin of /docs/api/playground (an interactive client): points agents at the static reference.
import type { APIRoute } from "astro";
import { SITE } from "@/lib/site";

export const GET: APIRoute = () =>
  new Response(
    [
      "# API playground",
      "",
      "> An interactive client for sending live requests to the Sound Server API from the browser. Agents don't need it: read the reference and call the API directly.",
      "",
      `- API reference (Markdown): ${SITE.url}/docs/api/reference.md`,
      `- OpenAPI 3.1: ${SITE.url}/openapi.json`,
      `- REST guide: ${SITE.url}/docs/api.md`,
      "",
      "---",
      `Source: ${SITE.url}/docs/api/playground`,
      "",
    ].join("\n"),
    { headers: { "content-type": "text/markdown; charset=utf-8" } },
  );
