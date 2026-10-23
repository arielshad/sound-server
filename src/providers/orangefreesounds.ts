import * as cheerio from "cheerio";
import { wpTotal } from "../core/census.js";
import { classify } from "../core/classify.js";
import { customLicense, license, parseLicense } from "../core/licence.js";
import type { Category, License, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleForm, SampleQuery, SourceCensus } from "../core/types.js";
import { cleanText, filenameFromUrl, formatFromFilename, makeSample, qs, uniq } from "../core/util.js";
import { topCategory } from "../core/vocab.js";

/**
 * Orange Free Sounds: a WordPress site by sound designer Alexander Blu with thousands of free
 * sound effects, drum and synth loops and background music. Each post states its own licence in a
 * "File Details" table: loops are mostly CC BY 4.0, most sound effects CC BY-NC 4.0, some
 * "Personal Use Only" / "private use only", a few public domain.
 *
 * Read through the WordPress REST API (`/wp-json/wp/v2/posts?search=…&_fields=…`, `X-WP-Total` for
 * counts), one request per search. Post content has the direct `wp-content/uploads/…mp3` (the
 * player) and a `.zip` download (the WAV for loops, the same MP3 for MP3-only effects). Paid packs
 * (category "Sound Packs", sold on Gumroad) and "Collections" link lists are excluded.
 *
 * robots.txt only disallows /wp-admin/; the site publishes no terms of use.
 */

const SITE = "https://orangefreesounds.com";
const API = `${SITE}/wp-json/wp/v2`;
const SOURCE_NAME = "Orange Free Sounds";
const FIELDS = "id,date,slug,link,title,content,categories";
const SEARCH_CACHE_MS = 60 * 60_000;
const MAX_PER_PAGE = 100;

/** Category ids that are not single free sounds: Sound Packs (paid), Collections (link lists). */
const EXCLUDED_CATEGORIES = [3979, 3290];

interface CategoryInfo {
  name: string;
  /** Our category when the post's words say nothing (or always, for loops). */
  hint?: Category;
  kind: "sfx" | "loop" | "music";
}

/** WordPress category ids (stable term ids, from /wp-json/wp/v2/categories). */
const CATEGORIES: Record<number, CategoryInfo> = {
  3: { name: "Loops", kind: "loop" },
  4: { name: "Drum Loops", hint: "drums", kind: "loop" },
  5: { name: "Synth Loops", hint: "synth", kind: "loop" },
  6: { name: "Music", hint: "other", kind: "music" },
  7: { name: "Background Music", hint: "other", kind: "music" },
  8: { name: "Relaxing Music", hint: "other", kind: "music" },
  704: { name: "Sound Logo", hint: "other", kind: "music" },
  6272: { name: "Classical Music", hint: "other", kind: "music" },
  17086: { name: "Horror Music & Dark Melodies", hint: "other", kind: "music" },
  9: { name: "Sound Effects", hint: "fx", kind: "sfx" },
  21: { name: "Nature Sounds", hint: "ambience", kind: "sfx" },
  22: { name: "Rain Sounds", hint: "ambience", kind: "sfx" },
  23: { name: "Thunderstorm Sounds", hint: "ambience", kind: "sfx" },
  24: { name: "Water Sounds", hint: "ambience", kind: "sfx" },
  50: { name: "Misc Nature Sounds", hint: "ambience", kind: "sfx" },
  26: { name: "Street Sounds", hint: "ambience", kind: "sfx" },
  4230: { name: "Relaxing Sounds", hint: "ambience", kind: "sfx" },
  17088: { name: "Dark Ambient & Drone Sounds", hint: "ambience", kind: "sfx" },
  17091: { name: "Creepy Foley & Real-World Sounds", hint: "foley", kind: "sfx" },
  17089: { name: "Jump Scare & Horror Impact Sounds", hint: "fx.impact", kind: "sfx" },
  11: { name: "Animal Sounds", kind: "sfx" },
  12: { name: "Bird Sounds", kind: "sfx" },
  13: { name: "Cat Meow Sound", kind: "sfx" },
  14: { name: "Chicken Sounds", kind: "sfx" },
  15: { name: "Dog Sounds", kind: "sfx" },
  16: { name: "Goat Sounds", kind: "sfx" },
  17: { name: "Horse Sounds", kind: "sfx" },
  49: { name: "Misc Animal Sounds", kind: "sfx" },
  10: { name: "Alarm Clock Sound", kind: "sfx" },
  18: { name: "Bell Sound", kind: "sfx" },
  19: { name: "Doorbell Sound", hint: "foley", kind: "sfx" },
  20: { name: "Funny Sounds", kind: "sfx" },
  25: { name: "Scary Sounds", kind: "sfx" },
  48: { name: "Misc", kind: "sfx" },
  4640: { name: "Beep Sounds", kind: "sfx" },
  11397: { name: "Notification Sounds", kind: "sfx" },
  14699: { name: "3d Sounds", kind: "sfx" },
  15096: { name: "Human Sounds", kind: "sfx" },
  17090: { name: "Monsters, Screams & Ghost Sounds", kind: "sfx" },
  17113: { name: "Machine Sounds", kind: "sfx" },
};

/** Our top categories → the WordPress category that holds them (native category filter). */
const NATIVE_CATEGORY: Partial<Record<Category, number>> = { drums: 4, synth: 5, other: 6, fx: 9, foley: 9, ambience: 9, vocals: 9 };

export interface WpPost {
  id: number;
  date?: string;
  slug?: string;
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  categories?: number[];
}

const PERSONAL_USE = customLicense("Personal Use Only", {
  verdict: "no",
  commercialUse: false,
  note: "Orange Free Sounds offers this sound for personal (private) use only: no commercial releases.",
  assertedBy: "source",
});

/** The "Licence:" cell of a post ("…permitted for commercial use under license Creative Commons Attribution 4.0…"). */
export function parsePostLicense(text: string, href?: string): License {
  const t = cleanText(text);
  if (/personal use|private use/i.test(t)) return PERSONAL_USE;
  const fromHref = parseLicense(href);
  if (fromHref) return fromHref;
  const fromText = parseLicense(t.replace(/^.*?under (?:the )?licen[cs]e\s*/i, ""));
  if (fromText) return fromText;
  if (/royalty[- ]free/i.test(t)) return customLicense("Orange Free Sounds royalty-free licence", { assertedBy: "source" });
  return license("LicenseRef-Unknown");
}

/** "00:06 sec", "01:16 min", "1:02:03" → seconds. */
export function parseDuration(text: string | undefined): number | undefined {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text ?? "");
  if (!m) return undefined;
  const parts = [m[1], m[2], m[3]].filter((p): p is string => p !== undefined).map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0) || undefined;
}

function cleanUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u, SITE);
    url.search = ""; // WordPress player cache-buster "?_=1"
    return url.toString();
  } catch {
    return undefined;
  }
}

interface ParsedPost {
  sample: Sample;
  files: SampleFile[];
}

/** Turn one post into a sample, or undefined for posts that are not a free sound (paid packs, link lists). */
export function parsePost(post: WpPost): ParsedPost | undefined {
  const html = post.content?.rendered ?? "";
  const $ = cheerio.load(html);
  const title = cleanText(cheerio.load(post.title?.rendered ?? "").text());
  if (!title || !post.link) return undefined;
  // Paid packs are sold on Gumroad with a "Price:" line.
  if ($('a[href*="gumroad.com"]').length || /<strong>\s*Price:\s*<\/strong>/i.test(html)) return undefined;

  /** The value after a `<strong>Label:</strong>`, either in the next table cell or inline up to `<br>`. */
  const field = (label: RegExp): { text: string; el?: ReturnType<typeof $> } | undefined => {
    const strong = $("strong").filter((_, el) => label.test(cleanText($(el).text()))).first();
    if (!strong.length) return undefined;
    const td = strong.closest("td");
    if (td.length) {
      const cell = td.next("td");
      return { text: cleanText(cell.text()), el: cell };
    }
    let text = "";
    for (let n = strong[0]!.nextSibling; n && !(n.type === "tag" && (n as { name?: string }).name === "br"); n = n.nextSibling) text += $(n).text();
    return { text: cleanText(text) };
  };

  const licenceField = field(/^Licen[cs]e:?$/i);
  const ccHref = (licenceField?.el ?? $.root()).find('a[href*="creativecommons.org"]').first().attr("href");
  const licence = licenceField ? parsePostLicense(licenceField.text, ccHref) : parseLicense(ccHref) ?? license("LicenseRef-Unknown");

  const uploads = $("a[href], source[src]")
    .map((_, el) => cleanUrl($(el).attr("href") ?? $(el).attr("src")))
    .get()
    .filter((u) => /\/wp-content\/uploads\//.test(u));
  const mp3 = $("audio source[src]").map((_, el) => cleanUrl($(el).attr("src"))).get()[0] ?? uploads.find((u) => /\.mp3$/i.test(u));
  const zip = uploads.find((u) => /\.zip$/i.test(u));
  const wav = uploads.find((u) => /\.wav$/i.test(u));
  if (!mp3 && !zip && !wav) return undefined;

  const quality = field(/^Quality:?$/i)?.text ?? "";
  const isWav = /\bwav\b/i.test(quality) || !!wav;
  const bitDepth = Number(/(\d{2})\s*-?bit/i.exec(quality)?.[1]) || undefined;
  const rateMatch = /(\d{2})[.,](\d)\d{0,2}\b/.exec(quality) ?? /(\d{2,3})\s*khz/i.exec(quality);
  const sampleRate = rateMatch ? (rateMatch[2] !== undefined ? Number(rateMatch[1]) * 1000 + Number(rateMatch[2]) * 100 : Number(rateMatch[1]) * 1000) : undefined;
  const durationSec = parseDuration(field(/^Duration:?$/i)?.text);
  const bpm = Number(/(\d{2,3})\s*bpm/i.exec(field(/^Tempo:?$/i)?.text ?? "")?.[1]) || undefined;
  const author = field(/^Artist:?$/i)?.text || undefined;
  const description = field(/^Description:?$/i)?.text || undefined;

  const files: SampleFile[] = [];
  if (wav) files.push({ url: wav, filename: filenameFromUrl(wav), format: "wav", role: "original", bitDepth, sampleRate });
  if (zip && isWav && !wav) files.push({ url: zip, filename: filenameFromUrl(zip), format: "zip", role: "pack" });
  if (mp3) files.push({ url: mp3, filename: filenameFromUrl(mp3), format: formatFromFilename(mp3), role: isWav ? "preview" : "original" });
  if (zip && !isWav && !mp3) files.push({ url: zip, filename: filenameFromUrl(zip), format: "zip", role: "pack" });

  const cats = (post.categories ?? []).map((id) => CATEGORIES[id]).filter((c): c is CategoryInfo => !!c);
  const kind = cats.find((c) => c.kind === "loop") ? "loop" : cats.find((c) => c.kind === "music") ? "music" : "sfx";
  const hint = cats.find((c) => c.hint && c.hint !== "fx" && c.hint !== "other")?.hint ?? cats.find((c) => c.hint)?.hint;
  const { category, categoryEvidence, form } = categorize({ title, description, durationSec, bpm, kind, hint });

  const sample = makeSample({
    provider: "orangefreesounds",
    nativeId: String(post.id),
    title,
    description: description?.slice(0, 600),
    url: post.link,
    author,
    tags: cats.filter((c) => c.name !== "Misc").map((c) => c.name),
    filename: mp3 ? filenameFromUrl(mp3) : undefined,
    category,
    categoryEvidence,
    form,
    bpm,
    durationSec,
    sampleRate,
    bitDepth,
    previewUrl: mp3,
    formats: uniq([...(isWav ? ["wav"] : []), ...files.map((f) => f.format)]),
    license: licence,
    price: { free: true },
    downloadable: files.some((f) => f.role !== "preview"),
    createdAt: post.date?.slice(0, 10),
    sourceName: SOURCE_NAME,
  });
  return { sample, files };
}

/**
 * Words first ("Kick Drum Loop" → drums.kick), the site's category when they say nothing. Titles
 * all end in "Sound Effect", which would otherwise make everything plain FX.
 */
function categorize(p: { title: string; description?: string; durationSec?: number; bpm?: number; kind: "sfx" | "loop" | "music"; hint?: Category }): {
  category: Category;
  categoryEvidence: Sample["categoryEvidence"];
  form?: SampleForm;
} {
  const words = p.title.replace(/\bsound effects?\b/gi, " ").replace(/\bsounds?\b/gi, " ");
  const c = classify({ title: words, description: p.description, durationSec: p.durationSec, bpm: p.bpm });
  // A hit from the description alone ("Goal" → "…a powerful kick…") is too weak to trust.
  const weak = classify({ title: words }).category === "other";
  const rules = { by: "rules" as const, confidence: c.confidence };
  const source = { by: "source" as const, confidence: 0.6 };
  if (p.kind === "loop") {
    const form: SampleForm = "loop";
    if (p.hint && (c.category === p.hint || c.category.startsWith(`${p.hint}.`))) return { category: c.category, categoryEvidence: rules, form };
    if (p.hint) return { category: p.hint, categoryEvidence: source, form };
    return { category: c.category, categoryEvidence: rules, form };
  }
  if (p.kind === "music") {
    // Tracks have a tempo and a length, which the classifier would read as a loop.
    const form: SampleForm = /\bloop/i.test(p.title) ? "loop" : "phrase";
    if (weak || c.category === "other" || topCategory(c.category) === "fx") return { category: "other", categoryEvidence: source, form };
    return { category: c.category, categoryEvidence: rules, form };
  }
  if (weak || c.category === "other" || (c.category === "fx" && p.hint && p.hint !== "fx")) return { category: p.hint ?? "fx", categoryEvidence: source, form: c.form };
  return { category: c.category, categoryEvidence: rules, form: c.form };
}

function nativeCategories(q: Pick<SampleQuery, "categories">): number[] | undefined {
  if (!q.categories?.length) return undefined;
  const ids = q.categories.map((c) => NATIVE_CATEGORY[topCategory(c)]);
  if (ids.some((id) => id === undefined)) return undefined;
  return uniq(ids as number[]);
}

function postsUrl(q: SampleQuery): string {
  const cats = nativeCategories(q);
  return `${API}/posts${qs({
    search: q.query.trim() || undefined,
    per_page: Math.min(Math.max(q.limit, 1), MAX_PER_PAGE),
    offset: q.offset || undefined,
    categories: cats?.join(","),
    categories_exclude: EXCLUDED_CATEGORIES.join(","),
    _fields: FIELDS,
  })}`;
}

export const orangefreesounds: Provider = {
  id: "orangefreesounds",
  name: SOURCE_NAME,
  homepage: SITE,
  description: "Free sound effects, drum and synth loops and background music; loops mostly CC BY 4.0, many effects non-commercial (licence per post).",
  categories: ["drums", "synth", "fx", "foley", "ambience", "vocals", "keys", "other"],
  forms: ["one-shot", "loop", "phrase"],
  access: "scrape",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["categories"],

  buildSearchUrl(q: SampleQuery) {
    return q.query.trim() ? `${SITE}/${qs({ s: q.query.trim() })}` : SITE;
  },

  async search(q, ctx) {
    const posts = await ctx.fetch.json<WpPost[]>(postsUrl(q), { signal: ctx.signal, cacheTtlMs: SEARCH_CACHE_MS });
    if (!Array.isArray(posts)) throw new Error("Orange Free Sounds: unexpected posts response");
    const samples = posts.map(parsePost).flatMap((p) => (p ? [p.sample] : []));
    return { samples, searchUrl: this.buildSearchUrl(q) };
  },

  async getSample(nativeId: string, ctx: ProviderContext): Promise<SampleDetails | null> {
    if (!/^\d+$/.test(nativeId)) return null;
    let post: WpPost;
    try {
      post = await ctx.fetch.json<WpPost>(`${API}/posts/${nativeId}${qs({ _fields: FIELDS })}`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    if ((post.categories ?? []).some((c) => EXCLUDED_CATEGORIES.includes(c))) return null;
    const parsed = parsePost(post);
    return parsed ? { ...parsed.sample, files: parsed.files } : null;
  },

  async census(ctx): Promise<SourceCensus> {
    const total = await wpTotal(ctx.fetch, `${API}/posts${qs({ per_page: 1, categories_exclude: EXCLUDED_CATEGORIES.join(","), _fields: "id" })}`, ctx.signal);
    const cats = await ctx.fetch.json<{ id: number; name: string; parent: number; count: number }[]>(
      `${API}/categories${qs({ per_page: 100, _fields: "id,name,parent,count" })}`,
      { signal: ctx.signal },
    );
    const count = (id: number) => cats.find((c) => c.id === id)?.count ?? 0;
    const categories = Object.fromEntries(
      cats.filter((c) => c.parent === 0 && c.count > 0 && !EXCLUDED_CATEGORIES.includes(c.id)).map((c) => [cheerio.load(c.name).text(), c.count]),
    );
    return {
      total,
      free: total,
      byCategory: { drums: count(4), synth: count(5), fx: count(9), other: count(6) },
      categories,
      unit: "samples",
      method: "X-WP-Total of the posts (minus paid packs and collections); categories from the WordPress category counts",
    };
  },
};
