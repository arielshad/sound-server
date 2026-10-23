/**
 * Guides (/guides/<slug>): answer-first articles from src/content/guides/*.md.
 * The page, its Markdown twin (/guides/<slug>.md), the index (/guides) and
 * llms.txt all read them through here.
 */
import { getCollection, type CollectionEntry } from "astro:content";
import { allCollections, type Collection } from "./collections";
import { SITE } from "./site";

export type Guide = CollectionEntry<"guides">;

export const GUIDES_PATH = "/guides";
export const guidePath = (slug: string) => `${GUIDES_PATH}/${slug}`;

/** Sections in the order the index shows them. */
export const GUIDE_SECTIONS = ["Licensing", "Production", "AI agents"] as const;

let cache: Guide[] | undefined;

/** Every guide, by `order`. */
export async function allGuides(): Promise<Guide[]> {
  if (cache) return cache;
  cache = (await getCollection("guides")).sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
  return cache;
}

/** The collections a guide links to (unknown slugs are dropped with a build warning). */
export async function guideCollections(g: Guide): Promise<Collection[]> {
  const all = await allCollections();
  return g.data.collections
    .map((slug) => {
      const c = all.find((x) => x.slug === slug);
      if (!c) console.warn(`guides: ${g.id} links to unknown collection "${slug}"`);
      return c;
    })
    .filter((c): c is Collection => Boolean(c));
}

/** Related guides: its own picks, then others in the same section. */
export async function relatedGuides(g: Guide, n = 4): Promise<Guide[]> {
  const all = await allGuides();
  const picked = g.data.related
    .map((slug) => {
      const r = all.find((x) => x.id === slug);
      if (!r) console.warn(`guides: ${g.id} links to unknown guide "${slug}"`);
      return r;
    })
    .filter((x): x is Guide => Boolean(x));
  const more = all.filter((x) => x.data.section === g.data.section && x.id !== g.id && !picked.includes(x));
  return [...picked, ...more].slice(0, n);
}

/** Rough reading time of the body plus answer, steps and FAQ. */
export function readingMinutes(g: Guide): number {
  const text = [g.body ?? "", g.data.answer, ...(g.data.steps ?? []).map((s) => s.text), ...g.data.faq.map((f) => f.a)].join(" ");
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
  return Math.max(2, Math.round(words / 220));
}

const abs = (path: string) => `${SITE.url}${path}`;
const day = (d: Date) => d.toISOString().slice(0, 10);
/** Root-relative Markdown links become absolute so the file works wherever it is read. */
const absolutize = (md: string) => md.replace(/\]\(\//g, `](${SITE.url}/`);

/** Markdown twin of a guide: answer first, then the article, steps, FAQ and links. */
export function guideMarkdown(g: Guide, collections: Collection[], related: Guide[]): string {
  const d = g.data;
  return [
    `# ${d.title}`,
    "",
    `> ${d.answer}`,
    "",
    `${d.section} guide, updated ${day(d.updated)}. ${d.description}`,
    "",
    absolutize((g.body ?? "").trim()),
    "",
    ...(d.steps?.length ? ["## Step by step", "", ...d.steps.map((s, i) => `${i + 1}. **${s.name}.** ${s.text}`), ""] : []),
    ...(d.faq.length ? ["## Questions", "", ...d.faq.flatMap((f) => [`**${f.q}**`, "", f.a, ""])] : []),
    ...(d.searches.length ? ["## Try it", "", ...d.searches.map((s) => `- [${s.label}](${abs(s.href)})`), ""] : []),
    ...(collections.length ? ["## Collections", "", ...collections.map((c) => `- [${c.topic.data.title}](${abs(c.path)}.md): ${c.topic.data.description}`), ""] : []),
    ...(related.length ? ["## Related guides", "", ...related.map((r) => `- [${r.data.title}](${abs(guidePath(r.id))}.md): ${r.data.description}`), ""] : []),
    ...(d.cites.length ? ["## Sources", "", ...d.cites.map((c) => `- [${c.name}](${c.url})`), ""] : []),
    "This guide is practical information, not legal advice.",
    "",
    "---",
    `Source: ${abs(guidePath(g.id))}`,
    "",
  ].join("\n");
}

/** Markdown twin of /guides. */
export function guidesIndexMarkdown(guides: Guide[]): string {
  return [
    "# Guides: free samples, licences and production",
    "",
    "> Short, answer-first guides for music producers and AI assistants: whether a sample may be released, how to credit it, what common licences mean, and how to find and use samples by tempo, key and type.",
    "",
    ...GUIDE_SECTIONS.flatMap((section) => {
      const gs = guides.filter((g) => g.data.section === section);
      return gs.length ? [`## ${section}`, "", ...gs.map((g) => `- [${g.data.title}](${abs(guidePath(g.id))}.md): ${g.data.answer.split(/(?<=\.)\s/)[0]}`), ""] : [];
    }),
    `Glossary of sample and licence terms: ${abs("/glossary.md")}`,
    "",
    "---",
    `Source: ${abs(GUIDES_PATH)}`,
    "",
  ].join("\n");
}
