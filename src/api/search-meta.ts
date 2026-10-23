/**
 * Head metadata for share links to /search:
 * - query variants (/search?q=punchy+kick, /search?category=fx.riser&commercial=true)
 *   get a unique title, description and share card (/og/query.png?…);
 * - sample links (/search?sample=freesound:2086) get the sample's title, a
 *   generated description and a card (/og/sample.png?id=…).
 * Both are `noindex, follow`: they are share targets, not landing pages.
 */
import { VERDICT_LABELS } from "../core/licence.js";
import { formatKey } from "../core/query.js";
import type { SampleDetails } from "../core/types.js";
import { CATEGORIES, categoryLabel, type Category } from "../core/vocab.js";
import { allProviders } from "../providers/index.js";

const SITES = `${allProviders.length} sites`;

/** Top-level categories read better with their own nouns. */
const TOP_NOUNS: Record<string, [string, string]> = {
  drums: ["drum sample", "drum samples"],
  vocals: ["vocal sample", "vocal samples"],
  fx: ["sound effect", "sound effects"],
  foley: ["foley sound", "foley sounds"],
  ambience: ["ambience recording", "ambience recordings"],
  other: ["sample", "samples"],
};

/** Mid-sentence noun: "kick samples", "vocal samples", "sound effects". */
export function categoryNoun(id: string | undefined, plural = true): string {
  if (!id) return plural ? "samples" : "sample";
  const top = TOP_NOUNS[id];
  if (top) return plural ? top[1] : top[0];
  const label = categoryLabel(id).toLowerCase();
  return `${label} ${plural ? "samples" : "sample"}`;
}

/** "Commercial use OK" → "commercial use OK" (keeps acronyms). */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const providerName = (id: string) => allProviders.find((p) => p.id === id)?.name ?? id;
const FEATURED = ["Freesound", "Wikimedia Commons", "Openverse"];

export interface HeadMeta {
  title: string;
  description: string;
  robots: string;
  /** Root-relative share card path. */
  image?: string;
  imageAlt?: string;
}

export interface SearchShare {
  /** Normalised query string identifying the card (also its cache key). */
  key: string;
  kicker: string;
  title: string;
  subtitle: string;
  chips: string[];
}

function categoriesOf(params: URLSearchParams): Category[] {
  return (params.get("category") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is Category => (CATEGORIES as readonly string[]).includes(t))
    .slice(0, 4);
}

/** Normalise /search parameters to the few that change what a share card says. */
export function searchShare(params: URLSearchParams): SearchShare | undefined {
  const q = clip((params.get("q") ?? "").replace(/\s+/g, " ").trim(), 80);
  const cats = categoriesOf(params);
  const free = params.get("free") === "true";
  const commercial = params.get("commercial") === "true";
  const downloadable = params.get("downloadable") === "true";
  const bpm = /^\d{2,3}(-\d{2,3})?$/.test(params.get("bpm") ?? "") ? params.get("bpm")! : undefined;
  const key = clip((params.get("key") ?? "").trim(), 12) || undefined;
  const sources = (params.get("providers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allProviders.some((p) => p.id === s))
    .slice(0, 6);
  if (!q && !cats.length && !free && !commercial) return undefined;

  const k = new URLSearchParams();
  if (q) k.set("q", q);
  if (cats.length) k.set("category", cats.join(","));
  if (bpm) k.set("bpm", bpm);
  if (key) k.set("key", key);
  if (free) k.set("free", "true");
  if (commercial) k.set("commercial", "true");
  if (downloadable) k.set("downloadable", "true");
  if (sources.length) k.set("providers", sources.join(","));

  const what = cats.length ? cats.map((c) => categoryNoun(c)).join(" & ") : "samples";
  const kind = `${free ? "free " : ""}${what}`;
  const Kind = `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
  return {
    key: k.toString(),
    kicker: cats.length ? `Search · ${what}` : "Search",
    title: q ? `“${q}”` : Kind,
    subtitle: `${Kind} from ${sources.length ? sources.map(providerName).join(", ") : SITES}, with licences and previews.`,
    chips: [
      ...(bpm ? [`${bpm} BPM`] : []),
      ...(key ? [key] : []),
      ...(commercial ? ["Commercial use OK"] : []),
      ...(free ? ["Free only"] : []),
      ...(downloadable ? ["Direct download"] : []),
      ...(sources.length ? sources.map(providerName) : FEATURED),
    ].slice(0, 6),
  };
}

export function searchMeta(params: URLSearchParams): HeadMeta | undefined {
  const share = searchShare(params);
  if (!share) return undefined;
  const q = (params.get("q") ?? "").replace(/\s+/g, " ").trim();
  const cats = categoriesOf(params);
  const free = params.get("free") === "true";
  const what = cats.length ? cats.map((c) => categoryNoun(c)).join(" & ") : "samples";
  const kind = `${free ? "free " : ""}${what}`;
  const title = q ? `“${clip(q, 40)}”: ${kind} · Sound Server` : `${kind[0]!.toUpperCase()}${kind.slice(1)}: search ${SITES} · Sound Server`;
  const description = q
    ? `Search results for “${clip(q, 60)}” across ${SITES}: ${kind} with previews, licences and direct downloads from Freesound, Wikimedia Commons and more.`
    : `Browse ${kind} from ${SITES} at once, with previews, BPM and key, licence verdicts and one-click downloads.`;
  return {
    title,
    description,
    robots: "noindex, follow",
    image: `/og/query.png?${share.key}`,
    imageAlt: `${share.title}: ${share.subtitle}`,
  };
}

/** Sample ids look like `provider:nativeId` with a provider this server runs; reject anything else before touching a source. */
export function shareableSampleId(raw: string | null | undefined, providerIds: readonly string[]): string | undefined {
  if (!raw || raw.length > 300) return undefined;
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) return undefined;
  return providerIds.includes(raw.slice(0, i)) ? raw : undefined;
}

/** "Kick · one-shot · 0.4 s · F minor · 140 BPM" */
export function sampleFacts(a: Pick<SampleDetails, "category" | "form" | "durationSec" | "key" | "bpm">): string[] {
  return [
    categoryLabel(a.category),
    a.form,
    a.durationSec !== undefined ? `${a.durationSec < 10 ? a.durationSec.toFixed(1) : Math.round(a.durationSec)} s` : undefined,
    a.key ? formatKey(a.key) : undefined,
    a.bpm ? `${Math.round(a.bpm)} BPM` : undefined,
  ].filter((x): x is string => !!x);
}

export function sampleMeta(a: SampleDetails): HeadMeta {
  const source = providerName(a.provider);
  const noun = categoryNoun(a.category, false);
  const facts = [
    ...sampleFacts(a).slice(1),
    a.license ? `${a.license.name}: ${lowerFirst(VERDICT_LABELS[a.license.verdict])}` : undefined,
    a.price ? (a.price.free ? "free" : "paid") : undefined,
  ].filter(Boolean);
  const lead = `${noun[0]!.toUpperCase()}${noun.slice(1)} “${clip(a.title, 60)}” on ${source}${a.author ? ` by ${clip(a.author, 40)}` : ""}`;
  return {
    title: `${clip(a.title, 60)}: ${noun} on ${source} · Sound Server`,
    description: clip(`${lead}${facts.length ? ` (${facts.join(", ")})` : ""}. Preview, licence and downloads via Sound Server.`, 200),
    robots: "noindex, follow",
    image: `/og/sample.png?id=${encodeURIComponent(a.id)}`,
    imageAlt: `${a.title}: ${noun} on ${source}`,
  };
}
