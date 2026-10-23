// Markdown twin of /glossary.
import type { APIRoute } from "astro";
import { glossaryMarkdown } from "@/lib/glossary";
import { SITE } from "@/lib/site";

export const GET: APIRoute = () => new Response(glossaryMarkdown(SITE.url), { headers: { "content-type": "text/markdown; charset=utf-8" } });
