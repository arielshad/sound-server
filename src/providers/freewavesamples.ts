import * as cheerio from "cheerio";
import { parseCount } from "../core/census.js";
import { royaltyFree } from "../core/licence.js";
import type { Category, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleQuery, SourceCensus } from "../core/types.js";
import { absoluteUrl, cleanText, filenameFromUrl, makeSample, paginate, qs } from "../core/util.js";
import { PITCH_CLASSES } from "../core/vocab.js";

/**
 * Free Wave Samples: a few thousand 16-bit/44.1 kHz WAV one-shots recorded by Jason Champion from
 * his own synths, drum machines and instruments (Casio, Ensoniq, Korg, Roland, Yamaha…), plus
 * drums, multisampled instruments by note ("… Piano C4") and some sound effects.
 *
 * `/search?q=` is server-rendered and returns at most 50 hits on one page (no pagination): sample
 * pages (`/<slug>`) mixed with category (`/sample-type/…`) and instrument (`/source/…`) hits, which
 * are skipped. Hits carry only a title and a short description; the WAV file name is not derivable
 * from them (`R&B` becomes `RandB`, `TG55` is slugged `tg-55`), so the file URL comes from the
 * detail page in `getSample` (`<a href="/files/<Name>.wav">`, a plain GET).
 *
 * robots.txt allows everything. Licence (`/about-us-license`): freeware, royalty free in music,
 * film and other work; a link back is appreciated but not required; do not re-host the samples
 * for download (they "don't prevent direct linking").
 */

const SITE = "https://freewavesamples.com";
const SOURCE_NAME = "Free Wave Samples";
const SEARCH_CACHE_MS = 60 * 60_000;

export const FREEWAVESAMPLES_LICENSE = royaltyFree("Free Wave Samples licence", {
  url: `${SITE}/about-us-license`,
  note: "Freeware, royalty free in music, film and other creative work. A credit or link back is appreciated but not required. Do not re-host the samples for download.",
});

/** Single-segment pages that are not samples. */
const NOT_SAMPLES = new Set([
  "about-us-license",
  "contact",
  "popular",
  "privacy-policy",
  "random",
  "search",
  "sources",
  "midi-drums",
  "midi-instruments",
  "hydrogen-drum-kits",
]);

/** The site's `/sample-type/<path>` categories → ours. Children override their parent. */
const SITE_CATEGORIES: Record<string, Category> = {
  drums: "drums",
  "drums/kick": "drums.kick",
  "drums/snare": "drums.snare",
  "drums/toms": "drums.tom",
  "drums/percussion": "drums.perc",
  "drums/latin-percussion": "drums.perc",
  cymbals: "drums.cymbal",
  "cymbals/crash": "drums.cymbal.crash",
  "cymbals/ride": "drums.cymbal.ride",
  "cymbals/hi-hat": "drums.hat",
  bass: "bass",
  guitar: "guitar",
  "guitar/synth": "synth",
  loops: "drums",
  "loops/beats": "drums",
  "loops/looped-sound-effects": "fx",
  orchestral: "strings",
  "orchestral/bells": "mallets",
  "orchestral/brass": "brass",
  "orchestral/percussion": "drums.perc",
  "orchestral/strings": "strings",
  "orchestral/woodwinds": "woodwind",
  "sound-effects": "fx",
  "sound-effects/foley": "foley",
  "sound-effects/footsteps": "foley",
  "sound-effects/nature": "ambience",
  "sound-effects/audience": "ambience",
  "sound-effects/vinyl": "fx.noise",
  "sound-effects/voice": "vocals",
  synthesizer: "synth",
  "synthesizer/bells": "mallets",
  "synthesizer/brass": "brass",
  "synthesizer/electric-piano": "keys",
  "synthesizer/keyboards": "keys",
  "synthesizer/organs": "keys",
  "synthesizer/piano": "keys",
  "synthesizer/lead": "synth.lead",
  "synthesizer/pads": "synth.pad",
  "synthesizer/melodic-percussion": "mallets",
  "synthesizer/strings": "strings",
  "synthesizer/wind-instruments": "woodwind",
  vocal: "vocals",
};

/** Top-level `/sample-type/<slug>` pages, each headed "N samples of this type." (census). */
const TOP_TYPES: { slug: string; label: string; category: Category }[] = [
  { slug: "drums", label: "Drums", category: "drums" },
  { slug: "cymbals", label: "Cymbals", category: "drums" },
  { slug: "bass", label: "Bass", category: "bass" },
  { slug: "guitar", label: "Guitar", category: "guitar" },
  { slug: "synthesizer", label: "Synthesizer", category: "synth" },
  { slug: "orchestral", label: "Orchestral", category: "strings" },
  { slug: "ethnic-instruments", label: "Ethnic Instruments", category: "other" },
  { slug: "loops", label: "Loops", category: "drums" },
  { slug: "sound-effects", label: "Sound Effects", category: "fx" },
  { slug: "vocal", label: "Vocal", category: "vocals" },
];

/**
 * "… Piano C4" → 60 (C4 = middle C). Only a note name as the last word counts, so
 * "Roland D-20 Kick" or "TR-808" never read as notes.
 */
export function rootNoteFromTitle(title: string): number | undefined {
  const m = /(?:^|\s)([A-G])(#|b)?(-1|[0-9])$/.exec(title.trim());
  if (!m) return undefined;
  const pc = PITCH_CLASSES.indexOf(m[1] as (typeof PITCH_CLASSES)[number]);
  const shift = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const midi = (Number(m[3]) + 1) * 12 + pc + shift;
  return midi >= 0 && midi <= 127 ? midi : undefined;
}

function searchUrl(query: string): string {
  return `${SITE}/search${qs({ q: query.trim() })}`;
}

interface Hit {
  slug: string;
  title: string;
  description?: string;
}

/** Search results: `.searchresult` blocks with an `<h4>` title link and a `<p>` blurb. */
export function parseSearch(html: string): Hit[] {
  const $ = cheerio.load(html);
  const hits: Hit[] = [];
  const seen = new Set<string>();
  $(".searchresult").each((_, el) => {
    const a = $(el).find("a").has("h4").first();
    const href = absoluteUrl(a.attr("href"), SITE);
    const m = href ? /^https:\/\/freewavesamples\.com\/([a-z0-9][a-z0-9-]*)\/?$/.exec(href) : null;
    if (!m) return; // categories (/sample-type/…), instruments (/source/…)
    const slug = m[1]!;
    if (NOT_SAMPLES.has(slug) || /-pack$|-kits?$/.test(slug) || seen.has(slug)) return;
    seen.add(slug);
    const title = cleanText(a.find("h4").text());
    const blurb = cleanText($(el).find("p").first().text());
    hits.push({ slug, title, description: blurb && blurb !== title ? blurb : undefined });
  });
  return hits;
}

function hitToSample(h: Hit): Sample {
  const rootNote = rootNoteFromTitle(h.title);
  return makeSample({
    provider: "freewavesamples",
    nativeId: h.slug,
    title: h.title,
    description: h.description,
    url: `${SITE}/${h.slug}`,
    author: "Jason Champion",
    tags: [],
    rootNote,
    form: rootNote !== undefined ? "one-shot" : undefined,
    // The site publishes everything as 16-bit / 44.1 kHz WAV.
    sampleRate: 44100,
    bitDepth: 16,
    formats: ["wav"],
    license: FREEWAVESAMPLES_LICENSE,
    price: { free: true },
    downloadable: true,
    sourceName: SOURCE_NAME,
  });
}

/** "Added on Feb. 11, 2015, 10:14 a.m." → "2015-02-11" */
function parseAdded(text: string): string | undefined {
  const m = /Added on ([A-Za-z]+)\.? (\d{1,2}), (\d{4})/.exec(text);
  if (!m) return undefined;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1]!.slice(0, 3).toLowerCase());
  if (month < 0) return undefined;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/** The value paragraph after a `<p><strong>Label:</strong></p>` heading. */
function field($: cheerio.CheerioAPI, label: string) {
  const head = $(".sample p > strong").filter((_, el) => cleanText($(el).text()).replace(/:$/, "") === label).first();
  return head.length ? head.parent().next() : undefined;
}

/** Detail page: `.sample` block with category links, specs, the preview `<audio>` and the file link. */
export function parseDetails(html: string, slug: string): SampleDetails | null {
  const $ = cheerio.load(html);
  const box = $(".sample").first();
  if (!box.length) return null;
  const title = cleanText(box.find("h2").not(".catname").first().text());
  const fileHref = box.find('a[href*="/files/"]').first().attr("href");
  const fileUrl = absoluteUrl(fileHref?.split("?")[0], SITE);
  if (!title || !fileUrl) return null;

  const catLinks = box.find("h2.catname a");
  const catPath = catLinks
    .last()
    .attr("href")
    ?.replace(/^.*\/sample-type\//, "")
    .replace(/\/$/, "");
  const siteLabel = catLinks.map((_, el) => cleanText($(el).text())).get().join(" - ");
  const category = catPath ? (SITE_CATEGORIES[catPath] ?? SITE_CATEGORIES[catPath.split("/")[0]!]) : undefined;

  const description = cleanText(box.find("p.smallertext").first().next("p").not(":has(strong)").text()) || undefined;
  const source = field($, "Sound Source");
  const instrument = cleanText(source?.find("a").first().text()) || undefined;
  const midiNames = [field($, "MIDI Drum"), field($, "MIDI Instrument")]
    .flatMap((p) => (p ? p.find("a").map((_, el) => cleanText($(el).text())).get() : []))
    .filter(Boolean);
  const rate = Number(cleanText(field($, "Sample Rate")?.text()).replace(/\D/g, "")) || undefined;
  const channelsText = cleanText(field($, "Format")?.text()).toLowerCase();
  const channels = channelsText === "stereo" ? 2 : channelsText === "mono" ? 1 : undefined;
  const bitDepth = Number(/(\d+)-?bit/i.exec(cleanText(field($, "Bit Depth")?.text()))?.[1]) || undefined;
  const downloads = parseCount(box.find(".graylink").text(), /\(([\d,]+) downloads?\)/);
  const rootNote = rootNoteFromTitle(title);
  const filename = filenameFromUrl(fileUrl);
  const loop = catPath?.startsWith("loops");

  const sample = makeSample({
    provider: "freewavesamples",
    nativeId: slug,
    title,
    description,
    url: `${SITE}/${slug}`,
    author: "Jason Champion",
    tags: [instrument, ...midiNames].filter((t): t is string => !!t),
    sourceCategories: siteLabel ? [siteLabel] : undefined,
    filename,
    category,
    form: loop ? "loop" : rootNote !== undefined ? "one-shot" : undefined,
    rootNote,
    sampleRate: rate,
    bitDepth,
    channels,
    previewUrl: fileUrl,
    formats: ["wav"],
    license: FREEWAVESAMPLES_LICENSE,
    price: { free: true },
    downloadable: true,
    createdAt: parseAdded(box.find("p.smallertext").first().text()),
    popularity: downloads,
    sourceName: SOURCE_NAME,
  });
  const file: SampleFile = { url: fileUrl, filename, format: "wav", role: "original", sampleRate: rate, bitDepth, channels };
  return { ...sample, files: [file] };
}

export const freewavesamples: Provider = {
  id: "freewavesamples",
  name: SOURCE_NAME,
  homepage: SITE,
  description: "Free 16-bit WAV one-shots sampled from vintage synths and drum machines: drums, cymbals, basses, pianos and instrument notes by pitch.",
  categories: ["drums", "bass", "synth", "keys", "guitar", "strings", "brass", "woodwind", "mallets", "fx", "foley", "ambience", "vocals"],
  forms: ["one-shot", "loop"],
  access: "scrape",
  pricing: "free",
  license: FREEWAVESAMPLES_LICENSE,
  supportsDownload: true,

  buildSearchUrl(q: SampleQuery) {
    return q.query.trim() ? searchUrl(q.query) : SITE;
  },

  async search(q, ctx) {
    const url = this.buildSearchUrl(q);
    // The site's search needs words; there is no browse-everything listing to page through.
    if (!q.query.trim()) return { samples: [], searchUrl: url };
    const hits = parseSearch(await ctx.fetch.text(url, { signal: ctx.signal, cacheTtlMs: SEARCH_CACHE_MS }));
    const samples = hits.map(hitToSample);
    return { samples: paginate(samples, q), total: samples.length, searchUrl: url };
  },

  async getSample(nativeId: string, ctx: ProviderContext): Promise<SampleDetails | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(nativeId) || NOT_SAMPLES.has(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${SITE}/${nativeId}`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parseDetails(html, nativeId);
  },

  async census(ctx): Promise<SourceCensus> {
    const byCategory: SourceCensus["byCategory"] = {};
    const categories: Record<string, number> = {};
    let total = 0;
    // Ten small pages, one at a time.
    for (const t of TOP_TYPES) {
      const html = await ctx.fetch.text(`${SITE}/sample-type/${t.slug}`, { signal: ctx.signal });
      const n = parseCount(html, /([\d,]+) samples? of this type/);
      if (n === undefined) throw new Error(`no sample count on /sample-type/${t.slug}`);
      categories[t.label] = n;
      byCategory[t.category] = (byCategory[t.category] ?? 0) + n;
      total += n;
    }
    return {
      total,
      free: total,
      byCategory,
      categories,
      unit: "samples",
      method: "Sum of \"N samples of this type\" on the ten top-level /sample-type/ pages",
    };
  },
};
