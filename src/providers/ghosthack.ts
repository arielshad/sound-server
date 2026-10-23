/**
 * Ghosthack (https://www.ghosthack.de): a German label's Shopware 6 store of sample packs (vocals,
 * cinematic FX, EDM, drums), song kits, MIDI and synth presets.
 *
 * Checked 2026-10-23:
 * - robots.txt allows `/` for every agent; it disallows only `*\/?` (query strings after a slash),
 *   account, checkout and widget paths. `/search?search=…&p=…` is allowed; category pages with
 *   `/?p=` paging are not, so browsing reads only the first page of /Categories/Sample-Packs/.
 * - The General Terms & Conditions say nothing about robots or scraping; they forbid AI training
 *   on the samples ("All sorts of AI learning is forbidden"), which this provider never does.
 * - Licence (terms §6 and every product page): "100% Royalty Free Rights: Cleared for Commercial
 *   Use", a personal, non-transferable licence once the pack is paid for.
 * - The store sometimes answers with a Cloudflare-style "Under Attack Mode" page (HTTP 503) after a
 *   burst of requests; one cached request per search stays well under that.
 *
 * Search reads the server-rendered result page (24 product cards per page): title, link, price,
 * cover and the pack's demo mp3 (`.product-box-mp3-demo-track source`), which plays with a plain
 * GET. `getSample` reads the product page (Open Graph + product meta tags, demo players, specs).
 */
import * as cheerio from "cheerio";
import { HttpError } from "../core/http.js";
import { royaltyFree } from "../core/licence.js";
import type { Price, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleForm, SampleQuery } from "../core/types.js";
import { absoluteUrl, cleanText, filenameFromUrl, makeSample, qs, wantsCategory } from "../core/util.js";
import { storeForm } from "./shopify.js";

const SITE = "https://www.ghosthack.de";
const SOURCE_NAME = "Ghosthack";
const PAGE_SIZE = 24;
const CACHE_MS = 30 * 60_000;
const FORMS: SampleForm[] = ["pack", "preset", "midi"];

export const ghosthackLicense = royaltyFree("Ghosthack licence", {
  url: `${SITE}/Information/General-Terms-Conditions/`,
  note: "Once bought, the sounds are 100% royalty free and cleared for commercial releases. The licence is personal: the samples may not be passed on, and AI training on them is forbidden.",
});

const CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };

/** "$7.00" / "€ 1.234,50" → { amount, currency }. */
export function parsePrice(text: string | undefined): Price | undefined {
  const t = cleanText(text);
  const m = /([$€£])?\s*(\d[\d.,]*)\s*([$€£])?/.exec(t);
  if (!m?.[2]) return undefined;
  const symbol = m[1] ?? m[3];
  let digits = m[2];
  // "1.234,50" (EUR style) vs "1,234.50".
  if (/,\d{2}$/.test(digits)) digits = digits.replace(/\./g, "").replace(",", ".");
  else digits = digits.replace(/,/g, "");
  const amount = Number(digits);
  if (!Number.isFinite(amount)) return undefined;
  return amount === 0 ? { free: true } : { free: false, amount, currency: symbol ? CURRENCY[symbol] : undefined };
}

/** Product handle from a product URL ("https://www.ghosthack.de/afro-vocals" → "afro-vocals"). */
function handleOf(url: string): string | undefined {
  try {
    const u = new URL(url, SITE);
    if (u.hostname !== "www.ghosthack.de") return undefined;
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    return isHandle(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function isHandle(s: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(s) && !s.includes("..");
}

/** Not sample products: gift cards and courses show up in searches too. */
const NOT_SOUNDS = /\bgift ?cards?\b|\bvideo courses?\b|\bmasterclass\b/i;

function isChallenge(html: string): boolean {
  return /Under Attack Mode|checking your browser/i.test(html.slice(0, 4000));
}

interface Card {
  handle: string;
  title: string;
  url: string;
  price?: Price;
  image?: string;
  demo?: string;
}

/** Product cards of a Shopware listing or search page. */
export function parseCards(html: string): Card[] {
  const $ = cheerio.load(html);
  const cards: Card[] = [];
  $(".card.product-box").each((_, el) => {
    const box = $(el);
    const link = box.find("a.product-name").first();
    const url = absoluteUrl(link.attr("href"), SITE);
    const handle = url ? handleOf(url) : undefined;
    const title = cleanText(link.attr("title") || link.text());
    if (!url || !handle || !title || NOT_SOUNDS.test(title)) return;
    const priceEl = box.find(".product-price").first().clone();
    priceEl.find(".list-price").remove();
    const demo = absoluteUrl(box.find(".product-box-mp3-demo-track source[src], audio source[src]").first().attr("src"), SITE);
    cards.push({
      handle,
      title,
      url,
      price: parsePrice(priceEl.text()),
      image: absoluteUrl(box.find("img.product-image").first().attr("src"), SITE),
      demo: demo && /\.mp3(\?|$)/i.test(demo) ? demo : undefined,
    });
  });
  return cards;
}

function toSample(c: Card & { description?: string; packSize?: number; genre?: string; tags?: string[] }): Sample {
  const form = storeForm({ title: c.title, type: undefined, tags: [] });
  return makeSample({
    provider: "ghosthack",
    nativeId: c.handle,
    title: c.title,
    description: c.description,
    url: c.url,
    author: SOURCE_NAME,
    tags: [...(c.tags ?? []), ...(c.genre ? [c.genre] : [])],
    form,
    unit: "pack",
    packSize: c.packSize,
    previewUrl: c.demo,
    thumbnailUrl: c.image,
    formats: form === "pack" ? ["wav"] : undefined,
    license: ghosthackLicense,
    price: c.price,
    downloadable: false,
    sourceName: SOURCE_NAME,
  });
}

function searchPageUrl(q: SampleQuery, page: number): string {
  const text = q.query.trim();
  // Category pages page with `/?p=`, which robots.txt disallows: browse reads page 1 only.
  if (!text) return `${SITE}/Categories/Sample-Packs/`;
  return `${SITE}/search${qs({ search: text, p: page > 1 ? page : undefined })}`;
}

export const ghosthack: Provider = {
  id: "ghosthack",
  name: SOURCE_NAME,
  homepage: SITE,
  description:
    "German label's store of royalty-free sample packs: big vocal and acapella packs, cinematic FX, EDM, techno and trap kits, song kits, MIDI and Serum/Vital presets; demo mp3 per pack.",
  categories: ["vocals", "fx", "drums", "bass", "synth", "keys", "guitar", "strings", "foley", "ambience"],
  forms: FORMS,
  access: "scrape",
  pricing: "paid",
  license: ghosthackLicense,
  supportsDownload: false,

  buildSearchUrl(q: SampleQuery) {
    const text = q.query.trim();
    return text ? `${SITE}/search${qs({ search: text })}` : `${SITE}/Categories/Sample-Packs/`;
  },

  async search(q, ctx) {
    const searchUrl = this.buildSearchUrl(q);
    if (!wantsCategory(q, ...this.categories)) return { samples: [], searchUrl };
    if (q.forms?.length && !q.forms.some((f) => FORMS.includes(f))) return { samples: [], searchUrl };
    const offset = q.offset ?? 0;
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    if (!q.query.trim() && page > 1) return { samples: [], searchUrl };
    const html = await ctx.fetch.text(searchPageUrl(q, page), { signal: ctx.signal, cacheTtlMs: CACHE_MS });
    if (isChallenge(html)) throw new Error("Ghosthack answered with a bot challenge page");
    let samples = parseCards(html).map(toSample);
    if (q.freeOnly) samples = samples.filter((s) => s.price?.free);
    if (q.forms?.length) samples = samples.filter((s) => !s.form || q.forms!.includes(s.form));
    const start = offset % PAGE_SIZE;
    return { samples: samples.slice(start, start + q.limit), searchUrl };
  },

  async getSample(nativeId: string, ctx: ProviderContext): Promise<SampleDetails | null> {
    if (!isHandle(nativeId)) return null;
    const url = `${SITE}/${nativeId}`;
    let html: string;
    try {
      html = await ctx.fetch.text(url, { signal: ctx.signal, cacheTtlMs: CACHE_MS });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
    if (isChallenge(html)) throw new Error("Ghosthack answered with a bot challenge page");
    const $ = cheerio.load(html);
    const meta = (p: string) => $(`meta[property="${p}"]`).attr("content") ?? $(`meta[name="${p}"]`).attr("content");
    if (meta("og:type") !== "product") return null;
    const title = cleanText(meta("og:title") ?? $("h1.product-detail-name").first().text());
    if (!title) return null;
    const amount = Number(meta("product:price:amount"));
    const currency = meta("product:price:currency");
    const price: Price | undefined = Number.isFinite(amount) ? (amount === 0 ? { free: true } : { free: false, amount, currency }) : undefined;
    // The product's own players; "related products" further down use plain <audio> tags.
    const demos = [...new Set($("[data-source]").map((_, el) => absoluteUrl($(el).attr("data-source"), SITE)).get())].filter((u) => /\.mp3(\?|$)/i.test(u));
    const specs = cleanText($(".product-short-description-specs").first().text());
    const packSize = Number(/Total Files:\s*([\d,]+)/i.exec(specs)?.[1]?.replace(/,/g, "")) || undefined;
    const genre = /Genre:\s*([^,]+)/i.exec(specs)?.[1]?.trim();
    const kinds = /Category:\s*(.+)$/i.exec(specs)?.[1]?.split(/,\s*/).map((s) => s.trim()).filter(Boolean) ?? [];
    const description = cleanText($(".product-detail-description-text").first().text()) || cleanText(meta("description"));
    const sample = toSample({
      handle: nativeId,
      title,
      url: meta("og:url") ?? url,
      price,
      image: meta("og:image"),
      demo: demos[0],
      description: description ? (description.length > 600 ? `${description.slice(0, 599).trimEnd()}…` : description) : undefined,
      packSize,
      genre,
      tags: kinds,
    });
    const files: SampleFile[] = demos.map((u) => ({ url: u, filename: filenameFromUrl(u), format: "mp3", role: "preview" }));
    return { ...sample, files };
  },
};
