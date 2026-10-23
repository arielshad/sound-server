// Collection topics (web/src/content/collections/<slug>.md) and their
// snapshots (web/src/data/collections/<slug>.json), shared by
// scripts/snapshot-collections.mjs, scripts/collection-gate.mjs and
// scripts/collection-ideas.mjs.
//
// The website validates the same files with its content schema
// (web/src/content.config.ts); `topicErrors` adds the editorial rules every
// topic must meet, whoever wrote it.
//
// The vocabulary (categories, forms) comes from the server's own module
// (src/core/vocab.ts, compiled to dist/core/vocab.js), so a topic can only use
// a category the search API accepts. Run `npm run build:server` first; under
// vitest the TypeScript source is read directly.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/** A server module: dist/<name>.js (the compiled server), or src/<name>.ts under vitest. */
export async function serverModule(name) {
  if (process.env.VITEST) return import(`../../src/${name}.ts`);
  try {
    return await import(`../../dist/${name}.js`);
  } catch (e) {
    throw new Error(`scripts need the compiled server: run \`npm run build:server\` first (${e instanceof Error ? e.message : e})`);
  }
}

export const { CATEGORIES, TOP_CATEGORIES, SAMPLE_FORMS } = await serverModule("core/vocab");
/** Thresholds for an indexable page, from src/core/collections.ts (the website reads the same). */
export const { MIN_INDEXABLE, MIN_SOURCES } = await serverModule("core/collections");

export const TOPICS_DIR = "web/src/content/collections";
export const SNAPSHOT_DIR = "web/src/data/collections";
export const HUBS_FILE = "web/src/data/collection-hubs.json";

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEARCH_FIELDS = ["q", "categories", "forms", "free", "commercial", "downloadable", "providers", "exclude"];
const TOPIC_FIELDS = ["title", "description", "hub", "search", "aliases", "related", "faq", "addedAt", "addedBy"];

/** Parse one topic file: YAML frontmatter + Markdown body. */
export function parseTopic(text, slug) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${slug}: missing frontmatter`);
  const data = parse(m[1]) ?? {};
  return { slug, data, body: m[2].trim() };
}

export function readTopics(dir = TOPICS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseTopic(readFileSync(join(dir, f), "utf8"), f.slice(0, -3)));
}

export function readHubs(file = HUBS_FILE) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function readSnapshot(slug, dir = SNAPSHOT_DIR) {
  const file = join(dir, `${slug}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

/** Words of running text in a Markdown body (headings, links and code excluded). */
export function wordCount(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#+ .*$/gm, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;
}

/**
 * Normalised search identity: two topics with the same key are the same page.
 * Mirrors `searchKey` in src/core/collections.ts.
 */
export function searchKey(s) {
  const list = (l) => [...(l ?? [])].sort().join(",");
  return [
    String(s.q ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    list(s.categories),
    list(s.forms),
    s.free ? "free" : "",
    s.commercial ? "commercial" : "",
    s.downloadable ? "dl" : "",
    list(s.providers),
  ].join("|");
}

/**
 * Editorial rules for one topic. `ctx.slugs` is every topic slug (for
 * `related`), `ctx.hubs` the hub ids, `ctx.providers` the source ids.
 */
export function topicErrors(topic, ctx) {
  const e = [];
  const d = topic.data;
  const str = (v) => typeof v === "string" && v.trim().length > 0;
  const len = (field, v, min, max) => {
    if (!str(v)) e.push(`${field}: required`);
    else if (v.length < min || v.length > max) e.push(`${field}: ${v.length} characters (want ${min}-${max})`);
  };
  const oneOf = (field, v, allowed, what) => {
    if (v !== undefined && (!Array.isArray(v) || !v.length || v.some((x) => !allowed.includes(x)))) e.push(`${field}: a list of ${what}`);
  };
  if (!SLUG.test(topic.slug) || topic.slug.length > 60) e.push(`slug "${topic.slug}": lowercase words joined by hyphens, at most 60 characters`);
  if (ctx.hubs.includes(topic.slug)) e.push(`slug "${topic.slug}": taken by a hub page`);
  len("title", d.title, 10, 60);
  len("description", d.description, 110, 160);
  if (!ctx.hubs.includes(d.hub)) e.push(`hub: "${d.hub}" is not one of ${ctx.hubs.join(", ")}`);

  const s = d.search;
  if (!s || typeof s !== "object") e.push("search: required");
  else {
    len("search.q", s.q, 2, 60);
    oneOf("search.categories", s.categories, CATEGORIES, `categories from src/core/vocab.ts (${TOP_CATEGORIES.join(", ")}, or a child like drums.kick)`);
    oneOf("search.forms", s.forms, SAMPLE_FORMS, SAMPLE_FORMS.join(", "));
    if (s.providers !== undefined && (!Array.isArray(s.providers) || s.providers.some((p) => !ctx.providers.includes(p)))) e.push("search.providers: unknown source id");
    for (const k of ["free", "commercial", "downloadable"]) if (s[k] !== undefined && typeof s[k] !== "boolean") e.push(`search.${k}: true or false`);
    if (s.exclude !== undefined && (!Array.isArray(s.exclude) || s.exclude.length > 30 || s.exclude.some((x) => !str(x) || x.length > 60))) e.push("search.exclude: up to 30 title phrases or sample ids");
    const extra = Object.keys(s).filter((k) => !SEARCH_FIELDS.includes(k));
    if (extra.length) e.push(`search: unknown field(s) ${extra.join(", ")}`);
  }
  if (d.aliases !== undefined && (!Array.isArray(d.aliases) || d.aliases.some((a) => !str(a) || a.length > 60))) e.push("aliases: a list of short search phrases");

  if (!Array.isArray(d.related) || d.related.length < 2 || d.related.length > 6) e.push("related: 2-6 collection slugs");
  else for (const r of d.related) if (r === topic.slug || !ctx.slugs.includes(r)) e.push(`related: "${r}" is not another collection`);

  if (!Array.isArray(d.faq) || d.faq.length < 2 || d.faq.length > 5) e.push("faq: 2-5 questions");
  else
    d.faq.forEach((f, i) => {
      if (!str(f?.q) || !f.q.trim().endsWith("?")) e.push(`faq[${i}].q: a question ending with "?"`);
      if (!str(f?.a) || f.a.length < 40 || f.a.length > 450) e.push(`faq[${i}].a: 40-450 characters`);
    });

  if (!["human", "agent"].includes(d.addedBy)) e.push('addedBy: "human" or "agent"');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.addedAt instanceof Date ? d.addedAt.toISOString().slice(0, 10) : d.addedAt))) e.push("addedAt: YYYY-MM-DD");

  const words = wordCount(topic.body);
  if (words < 80 || words > 350) e.push(`body: ${words} words (want 80-350)`);
  if (/<script|<iframe|<style|<audio|<video|javascript:/i.test(topic.body)) e.push("body: no scripts, iframes, styles or embedded players");
  const unknown = Object.keys(d).filter((k) => !TOPIC_FIELDS.includes(k));
  if (unknown.length) e.push(`unknown field(s) ${unknown.join(", ")}`);
  return e;
}
