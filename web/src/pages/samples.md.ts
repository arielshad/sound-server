// Markdown twin of /samples.
import type { APIRoute } from "astro";
import { allCollections, allHubs } from "@/lib/collections";
import { indexMarkdown } from "@/lib/collections-md";

export const GET: APIRoute = async () => new Response(indexMarkdown(await allCollections(), await allHubs()), { headers: { "content-type": "text/markdown; charset=utf-8" } });
