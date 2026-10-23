// Markdown twin of /docs/faq.
import type { APIRoute } from "astro";
import { FAQ_GROUPS } from "@/lib/faq";
import { SITE } from "@/lib/site";

export const GET: APIRoute = () =>
  new Response(
    [
      "# Frequently asked questions",
      "",
      "> Short answers about Sound Server: what it searches, licence verdicts, credits, downloads, rate limits, AI agents and self-hosting.",
      "",
      ...FAQ_GROUPS.flatMap((g) => [`## ${g.title}`, "", ...g.items.flatMap((f) => [`### ${f.q}`, "", f.a, ""])]),
      `More: ${SITE.url}/guides.md · ${SITE.url}/glossary.md · ${SITE.url}/docs/licences.md`,
      "",
      "---",
      `Source: ${SITE.url}/docs/faq`,
      "",
    ].join("\n"),
    { headers: { "content-type": "text/markdown; charset=utf-8" } },
  );
