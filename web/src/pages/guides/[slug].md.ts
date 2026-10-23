// Markdown twins: /guides/<slug>.md
import type { APIRoute } from "astro";
import { allGuides, guideCollections, guideMarkdown, relatedGuides, type Guide } from "@/lib/guides";

export async function getStaticPaths() {
  return (await allGuides()).map((guide) => ({ params: { slug: guide.id }, props: { guide } }));
}

export const GET: APIRoute = async ({ props }) => {
  const g = (props as { guide: Guide }).guide;
  return new Response(guideMarkdown(g, await guideCollections(g), await relatedGuides(g)), { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
