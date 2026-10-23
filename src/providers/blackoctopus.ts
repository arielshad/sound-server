/**
 * Black Octopus Sound (https://blackoctopus-sound.com): a WooCommerce store of royalty-free sample
 * packs and synth presets from its own label and partner labels (Resonance Sound, Production
 * Master, Basement Freaks, Bingoshakerz…). The same store also resells plugins and hardware, which
 * are filtered out.
 *
 * Checked 2026-10-23:
 * - robots.txt (Cloudflare-managed) allows `/` for `User-agent: *` with
 *   `Content-Signal: search=yes, ai-train=no, use=reference`; it blocks AI training crawlers
 *   (ClaudeBot, GPTBot, CCBot…) by name. Building search results with links is the "search" use
 *   the site opts into; nothing here trains on or keeps the audio.
 * - The Terms of Service (a licence agreement plus FAQ) say nothing about robots or scraping.
 * - Licence: "You may use these sounds in your own musical productions royalty free", single-user
 *   and non-transferable, and not in other sample packs. Vocal packs: vocalists often ask not to
 *   be named in releases.
 *
 * Search uses the WooCommerce Store API (`/wp-json/wc/store/products?search=…`, public JSON, one
 * request, `X-WP-Total` for counts) with the Software and Hardware categories excluded. Demo mp3s
 * are not in that JSON: `getSample` reads them from the product page, where each player link
 * carries the product's permalink.
 */
import * as cheerio from "cheerio";
import { wpTotal } from "../core/census.js";
import { royaltyFree } from "../core/licence.js";
import type { Price, Provider, ProviderContext, Sample, SampleDetails, SampleFile, SampleForm, SampleQuery, SourceCensus } from "../core/types.js";
import { cleanText, filenameFromUrl, makeSample, qs, wantsCategory } from "../core/util.js";
import { storeForm } from "./shopify.js";

const SITE = "https://blackoctopus-sound.com";
const API = `${SITE}/wp-json/wc/store/products`;
const SOURCE_NAME = "Black Octopus Sound";
const CACHE_MS = 30 * 60_000;
const MAX_PER_PAGE = 100;
const FORMS: SampleForm[] = ["pack", "preset", "midi"];

/** Product categories that are not sounds: Software (plugins, 797 products) and Hardware. */
const EXCLUDED_CATEGORIES = [162, 2237];
/** The store's "Free" category (giveaways). */
const FREE_CATEGORY = 3532;

/** Category names that are labels (the pack's author), not kinds of sound. */
const LABELS = new Set(
  [
    "Black Octopus Sound",
    "Basement Freaks",
    "Bingoshakerz",
    "Chop Shop Samples",
    "Digit Sounds",
    "Futuretone",
    "Gravitas Create",
    "Production Master",
    "Resonance Sound",
    "Apex Audio",
    "Ova9000",
    "Samples Choice",
  ].map((s) => s.toLowerCase()),
);
/** Category names that say what the sounds are (fed to the classifier); the rest are genres and promos. */
const SOUND_CATEGORY = /^(drum samples|drums|vocal samples|vocals?|choir & voice|female|male|fx|bass|guitar|live instruments|keys|piano|strings|brass|synths?|percussion|one shots?|loops)$/i;

export const blackoctopusLicense = royaltyFree("Black Octopus Sound licence", {
  url: `${SITE}/terms-of-service/`,
  note: "Royalty free in your own music once bought; single user, not transferable, and the sounds may not be resold or used to make other sample packs. Vocal packs: vocalists often ask not to be named in releases.",
});

interface Term {
  id: number;
  name: string;
  slug?: string;
}

export interface StoreProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  description?: string;
  short_description?: string;
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
  images?: { src?: string; thumbnail?: string }[];
  categories?: Term[];
  tags?: Term[];
  brands?: Term[];
}

function decode(s: string | undefined): string {
  if (!s) return "";
  return cleanText(cheerio.load(`<p>${s}</p>`)("p").text());
}

function htmlText(html: string | undefined, max = 600): string | undefined {
  const text = decode(html);
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function priceOf(p: StoreProduct): Price | undefined {
  const minor = Number(p.prices?.price);
  if (!p.prices?.price || !Number.isFinite(minor)) return undefined;
  if (minor === 0) return { free: true };
  const unit = 10 ** (p.prices.currency_minor_unit ?? 2);
  return { free: false, amount: minor / unit, currency: p.prices.currency_code };
}

export function toSample(p: StoreProduct): Sample {
  const title = decode(p.name) || p.slug;
  const cats = (p.categories ?? []).map((c) => decode(c.name));
  const label = cats.find((c) => LABELS.has(c.toLowerCase())) ?? p.brands?.map((b) => decode(b.name)).find(Boolean);
  const kinds = cats.filter((c) => SOUND_CATEGORY.test(c));
  const genres = cats.filter((c) => !LABELS.has(c.toLowerCase()) && !SOUND_CATEGORY.test(c) && !/^(presets|midi|samples|bundles|free|sale|top seller|front page featured|featured artist)$/i.test(c));
  const tags = (p.tags ?? []).map((t) => decode(t.name)).filter(Boolean);
  const hasSamples = cats.some((c) => /^(samples|drum samples|vocal samples|loops)$/i.test(c));
  const type = cats.includes("Presets") && !hasSamples ? "Presets" : cats.includes("MIDI") && !hasSamples ? "MIDI" : undefined;
  const form = storeForm({ title, type, tags });
  return makeSample({
    provider: "blackoctopus",
    nativeId: p.slug,
    title,
    description: htmlText(p.short_description) ?? htmlText(p.description),
    url: p.permalink,
    author: label ?? SOURCE_NAME,
    tags,
    genres: genres.length ? genres : undefined,
    sourceCategories: kinds.length ? kinds : undefined,
    form,
    unit: "pack",
    thumbnailUrl: p.images?.[0]?.thumbnail ?? p.images?.[0]?.src,
    license: blackoctopusLicense,
    price: priceOf(p),
    // Paid packs need a purchase and the free ones a $0 checkout: never a plain GET.
    downloadable: false,
    sourceName: SOURCE_NAME,
  });
}

/** Demo mp3s on a product page: the player links tagged with this product's permalink. */
export function parseDemos(html: string, permalink: string): string[] {
  const $ = cheerio.load(html);
  const norm = (u: string | undefined) => (u ?? "").trim().replace(/\/+$/, "");
  const own = norm(permalink);
  const urls = $("a[href]")
    .filter((_, el) => norm($(el).attr("data-product_permalink")) === own)
    .map((_, el) => $(el).attr("href")!.trim())
    .get()
    .filter((u) => /^https:\/\/blackoctopus-sound\.com\/wp-content\/uploads\/.+\.mp3$/i.test(u));
  return [...new Set(urls)];
}

function productsUrl(params: Record<string, string | number | undefined>): string {
  return `${API}${qs({ ...params, category: EXCLUDED_CATEGORIES.join(","), category_operator: "not_in" })}`;
}

export const blackoctopus: Provider = {
  id: "blackoctopus",
  name: SOURCE_NAME,
  homepage: SITE,
  description:
    "Label store of royalty-free sample packs and synth presets (vocals, drum hits, bass music, techno, cinematic), its own and partner labels'; a few free giveaways.",
  categories: ["drums", "bass", "vocals", "fx", "synth", "keys", "guitar", "strings", "brass", "woodwind", "ambience"],
  forms: FORMS,
  access: "scrape",
  pricing: "freemium",
  license: blackoctopusLicense,
  supportsDownload: false,
  nativeFilters: ["freeOnly"],

  buildSearchUrl(q: SampleQuery) {
    const text = q.query.trim();
    return text ? `${SITE}/${qs({ s: text, post_type: "product" })}` : `${SITE}/shop/`;
  },

  async search(q, ctx) {
    const searchUrl = this.buildSearchUrl(q);
    if (!wantsCategory(q, ...this.categories)) return { samples: [], searchUrl };
    if (q.forms?.length && !q.forms.some((f) => FORMS.includes(f))) return { samples: [], searchUrl };
    const url = q.freeOnly
      ? `${API}${qs({ search: q.query.trim() || undefined, per_page: Math.min(Math.max(q.limit, 1), MAX_PER_PAGE), offset: q.offset || undefined, category: FREE_CATEGORY })}`
      : productsUrl({ search: q.query.trim() || undefined, per_page: Math.min(Math.max(q.limit, 1), MAX_PER_PAGE), offset: q.offset || undefined });
    const products = await ctx.fetch.json<StoreProduct[]>(url, { signal: ctx.signal, cacheTtlMs: CACHE_MS });
    if (!Array.isArray(products)) throw new Error("Black Octopus: unexpected Store API response");
    let samples = products.map(toSample);
    if (q.forms?.length) samples = samples.filter((s) => !s.form || q.forms!.includes(s.form));
    return { samples, searchUrl };
  },

  async getSample(nativeId: string, ctx: ProviderContext): Promise<SampleDetails | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(nativeId)) return null;
    const list = await ctx.fetch.json<StoreProduct[]>(`${API}${qs({ slug: nativeId })}`, { signal: ctx.signal, cacheTtlMs: CACHE_MS });
    const product = Array.isArray(list) ? list.find((p) => p.slug === nativeId) : undefined;
    if (!product) return null;
    if ((product.categories ?? []).some((c) => EXCLUDED_CATEGORIES.includes(c.id))) return null;
    // Demos are only on the product page; a failure there still returns the product.
    const html = await ctx.fetch.text(product.permalink, { signal: ctx.signal, cacheTtlMs: CACHE_MS }).catch(() => "");
    const demos = html ? parseDemos(html, product.permalink) : [];
    const sample = toSample(product);
    const files: SampleFile[] = demos.map((url) => ({ url, filename: filenameFromUrl(url), format: "mp3", role: "preview" }));
    return { ...sample, ...(demos[0] ? { previewUrl: demos[0] } : {}), files };
  },

  async census(ctx): Promise<SourceCensus> {
    const [total, free] = await Promise.all([
      wpTotal(ctx.fetch, productsUrl({ per_page: 1 }), ctx.signal),
      wpTotal(ctx.fetch, `${API}${qs({ per_page: 1, category: FREE_CATEGORY })}`, ctx.signal),
    ]);
    return {
      total,
      free,
      byCategory: {},
      unit: "packs",
      method: "X-WP-Total of the WooCommerce Store API products, minus the Software and Hardware categories; free = the Free category",
    };
  },
};
