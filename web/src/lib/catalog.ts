/**
 * The daily catalog census (scripts/census.mjs -> src/data/catalog.json) with
 * formatting helpers, so every page quotes the same numbers the same way.
 * Before the first census has run there is no catalog.json: HAS_CATALOG is
 * false and pages leave the numbers out.
 */
import { categoryLabel } from "./vocab";

export interface Count {
  count: number;
  atLeast?: boolean;
}

export interface CatalogSource {
  id: string;
  name: string;
  homepage: string;
  license?: string;
  pricing: string;
  supportsDownload: boolean;
  total: number;
  atLeast?: boolean;
  free?: number;
  byCategory: Record<string, number>;
  byLicense?: Record<string, number>;
  categories?: Record<string, number>;
  unit?: "samples" | "packs";
  addedLast30Days?: number;
  downloads?: number;
  highlights?: { label: string; title: string; url: string; value?: number }[];
  method: string;
  countedAt: string;
  stale?: { since: string; error: string };
}

export interface Catalog {
  countedAt: string;
  totals: {
    listings: Count;
    free: Count;
    cc0: Count;
    directDownload: Count;
    addedLast30Days: number;
    sourcesCounted: number;
    sourcesLinked: number;
  };
  byCategory: Record<string, Count>;
  byLicense: Record<string, number>;
  sources: CatalogSource[];
  linked: { id: string; name: string; homepage: string }[];
}

export interface HistoryPoint {
  date: string;
  listings: number;
  free: number;
  byCategory: Record<string, number>;
  sources: Record<string, number>;
}

const files = import.meta.glob<unknown>(["../data/catalog.json", "../data/catalog-history.json"], { eager: true, import: "default" });
const EMPTY: Catalog = {
  countedAt: new Date(0).toISOString(),
  totals: { listings: { count: 0 }, free: { count: 0 }, cc0: { count: 0 }, directDownload: { count: 0 }, addedLast30Days: 0, sourcesCounted: 0, sourcesLinked: 0 },
  byCategory: {},
  byLicense: {},
  sources: [],
  linked: [],
};

export const HAS_CATALOG = Boolean(files["../data/catalog.json"]);
export const CATALOG = (files["../data/catalog.json"] as Catalog | undefined) ?? EMPTY;
for (const s of CATALOG.sources) s.byCategory ??= {};
CATALOG.byCategory ??= {};
export const HISTORY = (files["../data/catalog-history.json"] as HistoryPoint[] | undefined) ?? [];

/** Plural label of a top-level category for counts ("Drums", "Vocals", "FX"). */
export const categoryName = (id: string) => categoryLabel(id);

const full = new Intl.NumberFormat("en");

/** 2,951,627+ */
export function fmt(n: number, atLeast?: boolean): string {
  return `${full.format(n)}${atLeast ? "+" : ""}`;
}

/** 2.9M+ (for tiles); exact below 10,000. Rounds down, so a "+" never overstates. */
export function fmtShort(n: number, atLeast?: boolean): string {
  if (n < 10_000) return `${full.format(n)}${atLeast ? "+" : ""}`;
  const [div, suffix] = n >= 1_000_000 ? [1_000_000, "M"] : [1_000, "K"];
  const v = Math.floor((n / div) * 10) / 10;
  const shown = n >= 1_000_000 ? v : Math.floor(n / div);
  return `${shown.toLocaleString("en")}${suffix}${atLeast || shown * div < n ? "+" : ""}`;
}

/** "2.9 million+" for prose. */
export function fmtWords(n: number, atLeast?: boolean): string {
  if (n >= 1_000_000) return `${(Math.floor(n / 100_000) / 10).toLocaleString("en")} million${atLeast || n % 100_000 ? "+" : ""}`;
  if (n >= 10_000) return `${full.format(Math.floor(n / 1000) * 1000)}${atLeast || n % 1000 ? "+" : ""}`;
  return fmt(n, atLeast);
}

export const COUNTED_ON = new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(CATALOG.countedAt));

/** Top-level categories sorted by count (largest first). */
export const CATEGORIES_BY_SIZE = Object.entries(CATALOG.byCategory)
  .map(([category, c]) => ({ category, name: categoryName(category), ...c }))
  .sort((a, b) => b.count - a.count);

/** Free-only sources (every listing free), largest first: the libraries people quote. */
export const FREE_LIBRARIES = CATALOG.sources.filter((s) => s.pricing === "free");

/** One sentence anyone can quote. */
export const CATALOG_SENTENCE =
  `As of ${COUNTED_ON}, Sound Server searches ${fmtWords(CATALOG.totals.listings.count, CATALOG.totals.listings.atLeast)} sample listings ` +
  `from the ${CATALOG.totals.sourcesCounted} sources that publish counts, including ${fmtWords(CATALOG.totals.free.count, CATALOG.totals.free.atLeast)} free ones and ` +
  `${fmt(CATALOG.totals.cc0.count, CATALOG.totals.cc0.atLeast)} CC0 (public-domain) sounds.`;
