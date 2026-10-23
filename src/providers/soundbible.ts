import * as cheerio from "cheerio";
import { creativeCommons, customLicense, license, parseLicense } from "../core/licence.js";
import type { License, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleQuery } from "../core/types.js";
import { absoluteUrl, cleanText, makeSample, paginate, qs } from "../core/util.js";

/**
 * SoundBible.com: a classic collection of a few thousand free sound effects (animals, doors,
 * weapons, weather, household…), each with its own licence: Attribution 3.0, Public Domain,
 * Sampling Plus 1.0, Noncommercial 3.0 or Personal Use Only.
 *
 * `/search.php?q=` is tag based and server-rendered: up to 30 cards (most downloaded first, no
 * pagination), each with the licence (`<h4>`), title link `/<id>-<Slug>.html`, description, author,
 * download count and the player's relative `data-source="mp3/<Name>.mp3"`. Downloads are plain GETs:
 * `/grab.php?id=<id>&type=wav|mp3` (Content-Disposition names the file) and the MP3 itself under
 * `/mp3/`. Detail pages add tags (the first few are the uploader's; a thesaurus expansion follows).
 *
 * robots.txt sets `Crawl-delay: 2` and disallows nothing; the site publishes no terms of use.
 * SoundBible's "Royalty Free" section is paid premium packs, which are not in search.
 */

const SITE = "https://soundbible.com";
const SOURCE_NAME = "SoundBible";
const SEARCH_CACHE_MS = 60 * 60_000;
/** Tags past these are thesaurus padding ("knock" → "abuse", "batter", "visitant"…). */
const MAX_TAGS = 6;

const PERSONAL_USE = customLicense("Personal Use Only", {
  verdict: "no",
  commercialUse: false,
  note: "SoundBible offers this sound for personal use only: no commercial releases.",
  assertedBy: "source",
});

/** SoundBible's licence labels ("Attribution 3.0", "Noncommercial 3.0", "Personal Use Only"…). */
export function soundbibleLicense(label: string | undefined): License {
  const s = cleanText(label).toLowerCase();
  if (!s) return license("LicenseRef-Unknown");
  if (/personal|private/.test(s)) return PERSONAL_USE;
  // parseLicense wants "Sampling+"/"Sampling-Plus"; SoundBible writes "Sampling Plus 1.0".
  if (/sampling/.test(s)) return license(/non-?commercial|\bnc\b/.test(s) ? "LicenseRef-NC-Sampling-Plus-1.0" : "LicenseRef-Sampling-Plus-1.0");
  if (/public domain/.test(s)) return license("CC-PDM-1.0");
  const version = /(\d\.\d)/.exec(s)?.[1] ?? "3.0";
  const nc = /non-?commercial/.test(s);
  const nd = /no ?deriv/.test(s);
  const sa = /share ?alike/.test(s);
  if (nc || nd || sa || /attribution/.test(s)) return creativeCommons({ nc, nd, sa }, version);
  return parseLicense(s) ?? customLicense(cleanText(label), { assertedBy: "source" });
}

interface Card {
  id: string;
  slug: string;
  title: string;
  description?: string;
  licenseLabel?: string;
  author?: string;
  downloads?: number;
  mp3Path?: string;
}

const ITEM_HREF = /^(\d+)-([A-Za-z0-9-]+)\.html$/;

function mp3Url(path: string): string {
  return new URL(path, `${SITE}/`).toString();
}

function files(id: string, mp3Path: string | undefined): SampleFile[] {
  const base = mp3Path ? decodeURIComponent(mp3Path.slice(mp3Path.lastIndexOf("/") + 1)).replace(/\.mp3$/i, "") : `soundbible-${id}`;
  const out: SampleFile[] = [
    { url: `${SITE}/grab.php?id=${id}&type=wav`, filename: `${base}.wav`, format: "wav", role: "original" },
  ];
  // The MP3 download (`type=mp3`) is this same file.
  out.push(mp3Path ? { url: mp3Url(mp3Path), filename: `${base}.mp3`, format: "mp3", role: "preview" } : { url: `${SITE}/grab.php?id=${id}&type=mp3`, filename: `${base}.mp3`, format: "mp3", role: "preview" });
  return out;
}

/** Search results: `<!-- Start Sound Item-->` cards (`.course-item`). */
export function parseSearch(html: string): Card[] {
  const $ = cheerio.load(html);
  const cards: Card[] = [];
  $("#courses .course-item").each((_, el) => {
    const a = $(el).find("h3 a").first();
    const m = ITEM_HREF.exec(a.attr("href") ?? "");
    if (!m) return;
    const author = cleanText($(el).find(".trainer-profile span").first().text());
    const downloads = Number(cleanText($(el).find(".trainer-rank").first().text()).split(/\s/)[0]?.replace(/\D/g, ""));
    cards.push({
      id: m[1]!,
      slug: `${m[1]}-${m[2]}`,
      title: cleanText(a.text()),
      description: cleanText($(el).find(".course-content > p").first().text()) || undefined,
      licenseLabel: cleanText($(el).find(".course-content h4").first().text()) || undefined,
      author: author || undefined,
      downloads: Number.isFinite(downloads) && downloads > 0 ? downloads : undefined,
      mp3Path: $(el).find("[data-source]").first().attr("data-source"),
    });
  });
  return cards;
}

function toSample(c: Card, extra: { tags?: string[] } = {}): Sample {
  return makeSample({
    provider: "soundbible",
    nativeId: c.slug,
    title: c.title,
    description: c.description,
    url: `${SITE}/${c.slug}.html`,
    author: c.author,
    tags: extra.tags ?? [],
    filename: c.mp3Path ? decodeURIComponent(c.mp3Path.split("/").pop()!) : undefined,
    previewUrl: c.mp3Path ? mp3Url(c.mp3Path) : undefined,
    formats: ["wav", "mp3"],
    license: soundbibleLicense(c.licenseLabel),
    price: { free: true },
    downloadable: true,
    popularity: c.downloads,
    sourceName: SOURCE_NAME,
  });
}

/** Detail page: `#course-details` with title, description, player, tags and an info column. */
export function parseDetails(html: string, slug: string): SampleDetails | null {
  const $ = cheerio.load(html);
  const box = $("#course-details").first();
  const title = cleanText(box.find("h3").first().text());
  const id = /^(\d+)/.exec(slug)?.[1];
  if (!title || !id) return null;
  const info = (label: string) =>
    cleanText(
      box
        .find(".course-info")
        .filter((_, el) => cleanText($(el).find("h5").text()) === label)
        .first()
        .find("p")
        .text(),
    ) || undefined;
  const mp3Path = box.find("[data-source]").first().attr("data-source");
  const author = cleanText(box.find(".icofont-user-male").first().parent().text()) || undefined;
  const downloads = Number((info("Downloads") ?? "").replace(/\D/g, "")) || undefined;
  const tags = box
    .find("#icon_tag_list a")
    .map((_, el) => cleanText($(el).text()))
    .get()
    .slice(0, MAX_TAGS);
  const card: Card = {
    id,
    slug,
    title,
    description: cleanText(box.find("h3").first().next("p").text()) || undefined,
    licenseLabel: info("License"),
    author,
    downloads,
    mp3Path,
  };
  const sizeMb = Number(/([\d.]+)\s*MB/i.exec(info("Size") ?? "")?.[1]);
  const fileList = files(id, mp3Path);
  // "Size" is the WAV's.
  if (Number.isFinite(sizeMb) && sizeMb > 0) fileList[0]!.sizeBytes = Math.round(sizeMb * 1_000_000);
  return { ...toSample(card, { tags }), files: fileList };
}

export const soundbible: Provider = {
  id: "soundbible",
  name: SOURCE_NAME,
  homepage: SITE,
  description: "Classic free sound effects (animals, doors, weapons, weather, household) in WAV and MP3, each with its own licence from public domain to personal use only.",
  categories: ["fx", "foley", "ambience", "vocals", "drums", "other"],
  forms: ["one-shot", "phrase"],
  access: "scrape",
  pricing: "free",
  supportsDownload: true,

  buildSearchUrl(q: SampleQuery) {
    return q.query.trim() ? `${SITE}/search.php${qs({ q: q.query.trim() })}` : `${SITE}/free-sound-effects-1.html`;
  },

  async search(q, ctx) {
    const url = this.buildSearchUrl(q);
    // Search is by tag and needs words; there is no total to browse by.
    if (!q.query.trim()) return { samples: [], searchUrl: url };
    const cards = parseSearch(await ctx.fetch.text(url, { signal: ctx.signal, cacheTtlMs: SEARCH_CACHE_MS }));
    const samples = cards.map((c) => toSample(c));
    return { samples: paginate(samples, q), total: samples.length, searchUrl: url };
  },

  async getSample(nativeId: string, ctx: ProviderContext): Promise<SampleDetails | null> {
    if (!/^\d+-[A-Za-z0-9-]+$/.test(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${SITE}/${nativeId}.html`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parseDetails(html, nativeId);
  },
};
