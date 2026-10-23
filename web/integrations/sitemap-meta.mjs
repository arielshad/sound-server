// Per-URL sitemap facts, read from the site's data files at build time:
//
//   lastmod  only where the date is known and honest: a collection's last
//            content change, the newest change in a hub (and in /samples), the
//            census date for /stats and the source pages. Other pages get no
//            lastmod rather than the build time, which would claim every page
//            changed on every deploy and teach crawlers to ignore the field.
//   noindex  collections and source pages too thin to index (the same rules
//            as src/lib/collections.ts); they stay reachable but are left out
//            of the sitemap.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

/** Same thresholds as src/core/collections.ts (MIN_INDEXABLE, MIN_SOURCES). */
const MIN_INDEXABLE = 12;
const MIN_SOURCES = 2;

export function sitemapMeta() {
  const lastmod = new Map();
  const noindex = new Set();
  const catalog = existsSync(join(root, "src/data/catalog.json")) ? read("src/data/catalog.json") : { sources: [] };
  const providers = read("src/data/providers.json");
  const notes = existsSync(join(root, "src/data/source-notes.json")) ? read("src/data/source-notes.json") : {};
  const topicsDir = join(root, "src/content/collections");
  const snapDir = join(root, "src/data/collections");

  const hubOf = new Map();
  if (existsSync(topicsDir)) {
    for (const f of readdirSync(topicsDir).filter((f) => f.endsWith(".md"))) {
      const hub = readFileSync(join(topicsDir, f), "utf8").match(/^hub:\s*([\w-]+)\s*$/m)?.[1];
      if (hub) hubOf.set(f.slice(0, -3), hub);
    }
  }
  const newest = (a, b) => (!a || b > a ? b : a);
  const perSource = new Map();
  let all;
  for (const [slug, hub] of hubOf) {
    const file = join(snapDir, `${slug}.json`);
    const snap = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    const samples = snap?.samples ?? [];
    for (const a of samples) perSource.set(a.provider, (perSource.get(a.provider) ?? 0) + 1);
    if (samples.length < MIN_INDEXABLE || new Set(samples.map((a) => a.provider)).size < MIN_SOURCES) noindex.add(`/samples/${slug}`);
    if (!snap) continue;
    lastmod.set(`/samples/${slug}`, snap.updatedAt);
    lastmod.set(`/samples/${hub}`, newest(lastmod.get(`/samples/${hub}`), snap.updatedAt));
    all = newest(all, snap.updatedAt);
  }
  if (all) lastmod.set("/samples", all);

  if (catalog.countedAt) lastmod.set("/stats", catalog.countedAt);

  // Guides: their own `updated` date; the index: the newest guide.
  const guidesDir = join(root, "src/content/guides");
  if (existsSync(guidesDir)) {
    let newestGuide;
    for (const f of readdirSync(guidesDir).filter((f) => f.endsWith(".md"))) {
      const updated = readFileSync(join(guidesDir, f), "utf8").match(/^updated:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m)?.[1];
      if (!updated) continue;
      lastmod.set(`/guides/${f.slice(0, -3)}`, `${updated}T00:00:00.000Z`);
      newestGuide = newest(newestGuide, `${updated}T00:00:00.000Z`);
    }
    if (newestGuide) lastmod.set("/guides", newestGuide);
  }
  for (const p of providers) {
    const census = catalog.sources.find((s) => s.id === p.id);
    if (census) lastmod.set(`/sources/${p.id}`, census.countedAt);
    // Same rule as sourcePages(): a census, at least 4 samples in collections, or editorial notes on a searched source.
    if (!census && (perSource.get(p.id) ?? 0) < 4 && !(p.access !== "link" && notes[p.id])) noindex.add(`/sources/${p.id}`);
  }
  return { lastmod, noindex };
}
