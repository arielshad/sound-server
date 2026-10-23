import * as cheerio from "cheerio";
import { catalogueCensus } from "../core/census.js";
import { license } from "../core/licence.js";
import type { Category, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleQuery } from "../core/types.js";
import { absoluteUrl, cleanText, filenameFromUrl, filterLocal, formatFromFilename, makeSample, paginate, qs, uniq, wantsCategory } from "../core/util.js";

/**
 * Kenney (https://kenney.nl/assets/category:Audio): CC0 game audio packs (UI clicks, impacts,
 * sci-fi, RPG foley, casino, voice-overs, music jingles). Each pack is one zip of OGG files.
 *
 * No API. The Audio category listing (one page, ~10 packs) is fetched once and cached 6h; search
 * runs locally on it. Pack pages carry tags, the file count, an <audio> preview and a direct,
 * unauthenticated zip behind "Continue without donating" (`#donate-text`).
 */

const BASE = "https://kenney.nl";
export const KENNEY_AUDIO_URL = `${BASE}/assets/category:Audio`;
const LISTING_TTL = 6 * 60 * 60_000;
const PAGE_TTL = 6 * 60 * 60_000;

const KENNEY_LICENSE = license("CC0-1.0", "site");

/** Category per pack (decided from what each pack holds); unknown packs fall back to name rules. */
const PACK_CATEGORY: Record<string, Category> = {
  "interface-sounds": "fx",
  "ui-audio": "fx",
  "digital-audio": "fx",
  "sci-fi-sounds": "fx",
  "impact-sounds": "fx.impact",
  "rpg-audio": "foley",
  "casino-audio": "foley",
  "foley-sounds": "foley",
  "voiceover-pack": "vocals.spoken",
  "voiceover-pack-fighter": "vocals.spoken",
  "music-jingles": "other",
};

/** The site's own tags per pack (from the pack pages), so text search works without a page fetch. */
const PACK_TAGS: Record<string, string[]> = {
  "casino-audio": ["foley", "casino", "card", "dice", "chip"],
  "sci-fi-sounds": ["sci-fi", "space", "engine", "laser"],
  "interface-sounds": ["interface", "ui", "click", "button"],
  "impact-sounds": ["impact", "foley", "hit"],
  "voiceover-pack-fighter": ["voice", "male", "fighter", "announcer"],
  "voiceover-pack": ["voice", "female", "male", "announcer"],
  "music-jingles": ["music", "jingle"],
  "rpg-audio": ["foley", "rpg", "footstep", "weapon"],
  "digital-audio": ["space", "laser", "zap", "power-up"],
  "ui-audio": ["ui", "button", "switch", "click"],
};

export function kenneyCategory(slug: string, title: string): Category {
  const known = PACK_CATEGORY[slug];
  if (known) return known;
  const t = `${slug} ${title}`.toLowerCase();
  if (/voice|announcer/.test(t)) return "vocals.spoken";
  if (/impact/.test(t)) return "fx.impact";
  if (/foley|footstep|rpg|casino/.test(t)) return "foley";
  if (/music|jingle|loop/.test(t)) return "other";
  return "fx";
}

interface ListingEntry {
  slug: string;
  title: string;
  thumbnailUrl?: string;
  category?: string;
}

function slugFromHref(href: string | undefined): string | undefined {
  return /\/assets\/([a-z0-9][a-z0-9-]*)\/?$/i.exec(href ?? "")?.[1];
}

/** Pack cards on a Kenney listing page. */
export function parseListing(html: string): ListingEntry[] {
  const $ = cheerio.load(html);
  const out: ListingEntry[] = [];
  $(".asset").each((_, el) => {
    const card = $(el);
    const link = card.find("h2 a").first();
    const slug = slugFromHref(link.attr("href"));
    if (!slug) return;
    const style = card.find(".cover").attr("style") ?? "";
    const thumb = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(style)?.[1];
    out.push({
      slug,
      title: cleanText(link.text()),
      thumbnailUrl: absoluteUrl(thumb, BASE),
      category: cleanText(card.find("a[href*='category']").first().text()) || undefined,
    });
  });
  return uniq(out.map((e) => e.slug)).map((s) => out.find((e) => e.slug === s)!);
}

function toSample(e: { slug: string; title: string; thumbnailUrl?: string }, extra: Partial<Sample> & { tags?: string[] } = {}): Sample {
  const { tags = [], ...rest } = extra;
  return makeSample({
    provider: "kenney",
    nativeId: e.slug,
    title: e.title,
    url: `${BASE}/assets/${e.slug}`,
    author: "Kenney",
    authorUrl: BASE,
    tags: ["kenney", "game audio", "sfx", "cc0", "pack", "ogg", ...(PACK_TAGS[e.slug] ?? []), ...tags],
    category: kenneyCategory(e.slug, e.title),
    // Our reading of what each pack holds, not a category the site states.
    categoryEvidence: { by: "rules", confidence: PACK_CATEGORY[e.slug] ? 0.9 : 0.6 },
    form: "pack",
    unit: "pack",
    formats: ["zip", "ogg"],
    thumbnailUrl: e.thumbnailUrl,
    license: KENNEY_LICENSE,
    price: { free: true },
    downloadable: true,
    sourceName: "Kenney",
    ...rest,
  });
}

async function loadListing(ctx: ProviderContext): Promise<Sample[]> {
  const html = await ctx.fetch.text(KENNEY_AUDIO_URL, { cacheTtlMs: LISTING_TTL, signal: ctx.signal });
  // The listing is already the Audio category; drop any card that says otherwise.
  return parseListing(html)
    .filter((e) => !e.category || e.category.toLowerCase() === "audio")
    .map((e) => toSample(e));
}

/** dd/mm/yyyy → ISO date. */
function parseDmy(s: string | undefined): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s ?? "").trim());
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))).toISOString() : undefined;
}

/** A pack page: tags, file count, release date, zip and preview. */
export function parsePackPage(html: string, slug: string): SampleDetails | null {
  const $ = cheerio.load(html);
  const title = cleanText($("h1").first().text());
  if (!title || /^oops/i.test(title)) return null;
  const category = cleanText($("a[href*='/assets/category:']").first().text());
  if (category && category.toLowerCase() !== "audio") return null;
  const tags = $("a.tag")
    .map((_, a) => cleanText($(a).text()))
    .get()
    .filter(Boolean);
  let packSize: number | undefined;
  $("td.title").each((_, td) => {
    if (cleanText($(td).text()).toLowerCase() === "files") {
      const n = parseInt(cleanText($(td).next().text()).replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(n) && n > 0) packSize = n;
    }
  });
  const dates = $("td[title]")
    .map((_, td) => parseDmy($(td).attr("title")))
    .get()
    .filter((d): d is string => !!d);
  const zip = absoluteUrl($("#donate-text").attr("href"), BASE) ?? absoluteUrl($("a[href$='.zip']").first().attr("href"), BASE);
  const previews = uniq(
    $("audio source[src], audio[src]")
      .map((_, el) => absoluteUrl($(el).attr("src"), BASE))
      .get()
      .filter((u): u is string => !!u),
  );
  const image = absoluteUrl($("a.screenshot").first().attr("href"), BASE) ?? absoluteUrl($("meta[property='og:image']").attr("content"), BASE);
  const description = [`Game audio pack by Kenney`, packSize ? `${packSize} OGG files` : undefined, tags.length ? `tags: ${tags.join(", ")}` : undefined]
    .filter(Boolean)
    .join(", ")
    .concat(". CC0: use it anywhere, no credit needed.");

  const files: SampleFile[] = [];
  if (zip) files.push({ url: zip, filename: filenameFromUrl(zip), format: "zip", role: "pack" });
  for (const p of previews) files.push({ url: p, filename: filenameFromUrl(p), format: formatFromFilename(p) || "ogg", role: "preview" });

  const sample = toSample(
    { slug, title, thumbnailUrl: image },
    {
      tags,
      description,
      packSize,
      previewUrl: previews[0],
      // The oldest entry in the updates table is the release.
      createdAt: dates.length ? dates.sort()[0] : undefined,
      downloadable: !!zip,
    },
  );
  return { ...sample, files };
}

export const kenney: Provider = {
  id: "kenney",
  name: "Kenney",
  homepage: KENNEY_AUDIO_URL,
  description: "Kenney's CC0 game audio packs: UI clicks, impacts, sci-fi, RPG and casino foley, voice-overs and music jingles, as direct zips.",
  categories: ["fx", "foley", "vocals", "other"],
  forms: ["pack"],
  access: "scrape",
  pricing: "free",
  license: KENNEY_LICENSE,
  supportsDownload: true,
  nativeFilters: ["categories", "forms"],

  census(ctx) {
    return catalogueCensus(this, ctx, "packs");
  },

  buildSearchUrl(q: SampleQuery) {
    return `${KENNEY_AUDIO_URL}${qs({ search: q.query.trim() })}`;
  },

  async search(q, ctx) {
    const searchUrl = this.buildSearchUrl(q);
    if (!wantsCategory(q, "fx", "foley", "vocals", "other")) return { samples: [], total: 0, searchUrl };
    const samples = filterLocal(await loadListing(ctx), q);
    return { samples: paginate(samples, q), total: samples.length, searchUrl };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${BASE}/assets/${nativeId}`, { cacheTtlMs: PAGE_TTL, signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parsePackPage(html, nativeId);
  },
};
