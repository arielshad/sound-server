// Markdown twins: /samples/<hub>.md and /samples/<slug>.md
import type { APIRoute } from "astro";
import { allCollections, allHubs, collectionsInHub, relatedTo, type Collection, type Hub } from "@/lib/collections";
import { collectionMarkdown, hubMarkdown } from "@/lib/collections-md";
import { allGuides, guidePath } from "@/lib/guides";

export async function getStaticPaths() {
  const all = await allCollections();
  return [...(await allHubs()).map((hub) => ({ params: { slug: hub.id }, props: { hub } })), ...all.map((collection) => ({ params: { slug: collection.slug }, props: { collection } }))];
}

export const GET: APIRoute = async ({ props }) => {
  const { hub, collection } = props as { hub?: Hub; collection?: Collection };
  const guides = hub ? (await allGuides()).filter((g) => hub.guides?.includes(g.id)).map((g) => ({ title: g.data.title, path: guidePath(g.id), description: g.data.description })) : [];
  const body = hub ? hubMarkdown(hub, await collectionsInHub(hub), await allHubs(), guides) : collectionMarkdown(collection!, await relatedTo(collection!));
  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
