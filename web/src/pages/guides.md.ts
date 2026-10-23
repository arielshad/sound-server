// Markdown twin of /guides.
import type { APIRoute } from "astro";
import { allGuides, guidesIndexMarkdown } from "@/lib/guides";

export const GET: APIRoute = async () => new Response(guidesIndexMarkdown(await allGuides()), { headers: { "content-type": "text/markdown; charset=utf-8" } });
