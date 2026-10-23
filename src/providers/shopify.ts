/**
 * Shopify sample-pack stores.
 *
 * Every Shopify storefront serves the same public JSON:
 * - `/search/suggest.json?q=&resources[type]=product&resources[limit]=10`: predictive search
 *   (title, handle, price, tags, product_type, vendor, image, body). At most 10 results, no
 *   paging, and `q` is required (an empty q is HTTP 422).
 * - `/products.json?limit=250&page=n`: the whole catalogue, 250 per page (used for browse and census).
 * - `/products/{handle}.js`: one product (prices in minor units).
 * Demo mp3s are not in that JSON: themes put them in the product page HTML, so `getSample` reads them
 * from there (`data-sample-url` on a play button tagged with the product id, or an
 * `audioSources_demos = [...]` script array).
 *
 * Products are commercial sample packs: unit "pack", never downloadable here (paid, or a $0
 * checkout). A store whose terms forbid robots or scraping is built with `linkOnly` and only
 * deep-links to the store's own search page.
 */
import * as cheerio from "cheerio";
import { HttpError } from "../core/http.js";
import { tallySamples } from "../core/census.js";
import type {
  Category,
  License,
  Price,
  Pricing,
  Provider,
  ProviderContext,
  Sample,
  SampleDetails,
  SampleFile,
  SampleForm,
  SampleQuery,
  SourceCensus,
} from "../core/types.js";
import { cleanText, filenameFromUrl, makeSample, paginate, qs, wantsCategory } from "../core/util.js";
import { topCategory } from "../core/vocab.js";
import { linkProvider } from "./link.js";

export interface ShopifyStoreSpec {
  id: string;
  name: string;
  /** Store origin, e.g. "https://primeloops.com" (no trailing slash). */
  homepage: string;
  description: string;
  categories: Category[];
  /** The store's own currency (Shopify `/meta.json` `currency`); suggest.json prices carry none. */
  currency: string;
  license: License;
  pricing?: Pricing;
  /** Getting any product (even a free one) needs an account on the store. */
  requiresAccount?: boolean;
  /**
   * Set when the store's terms forbid automated access: the provider becomes link-only and makes no
   * requests. The text says why (kept for the docs; not shown to users).
   */
  linkOnly?: string;
}

/** Forms a Shopify pack store can carry. */
const STORE_FORMS: SampleForm[] = ["pack", "preset", "midi"];
/** predictive search caps `resources[limit]` at 10. */
const SUGGEST_MAX = 10;
const PAGE_SIZE = 250;
const SEARCH_TTL = 10 * 60_000;
const CATALOGUE_TTL = 6 * 60 * 60_000;
const CENSUS_MAX_PAGES = 40;

interface SuggestProduct {
  id: number;
  title: string;
  handle: string;
  body?: string;
  type?: string;
  vendor?: string;
  tags?: string[];
  price?: string;
  price_min?: string;
  available?: boolean;
  image?: string | null;
  featured_image?: { url?: string } | null;
  url?: string;
}

interface SuggestResponse {
  resources?: { results?: { products?: SuggestProduct[] } };
}

interface CatalogueProduct {
  id: number;
  title: string;
  handle: string;
  body_html?: string;
  product_type?: string;
  vendor?: string;
  tags?: string[] | string;
  published_at?: string;
  created_at?: string;
  variants?: { price?: string; available?: boolean }[];
  images?: { src?: string }[];
}

/** `/products/{handle}.js`: prices in minor units (cents). */
interface ProductJs {
  id: number;
  title: string;
  handle: string;
  description?: string;
  type?: string;
  vendor?: string;
  tags?: string[];
  price?: number;
  price_min?: number;
  available?: boolean;
  published_at?: string;
  created_at?: string;
  featured_image?: string | null;
  images?: string[];
}

/** Product fields every source above reduces to. */
interface Product {
  id: number;
  title: string;
  handle: string;
  bodyHtml?: string;
  type?: string;
  vendor?: string;
  tags: string[];
  /** Major units (e.g. 10.95). */
  price?: number;
  image?: string;
  createdAt?: string;
}

/**
 * Shopify tags on pack stores are mostly merchandising (collections, sales, DAW compatibility).
 * Drop those so the classifier and the tag list only see words about the sounds.
 */
const NOISE_TAG =
  /^(products?|all products|genres?|labels?|license type|type|daw|offers|deals|exclusive|featured|latest releases|fresh new sounds|sample|samples|sample packs?|free-product|bundle deals|melodies|freebies\s+taster packs|100% royalty[- ]free|sample clearance guaranteed|new|best ?sellers?)$|compatible with|templates|\bsale\b|discounts?|livestream|vault|\bsamples\s+presets\b|\bpacks\s+presets\b/i;

export function storeTags(tags: string[] | string | undefined): string[] {
  const list = Array.isArray(tags) ? tags : (tags ?? "").split(",");
  return list.map((t) => cleanText(t)).filter((t) => t && !NOISE_TAG.test(t));
}

const PRESET_WORDS = /\b(presets?|patches|sound ?banks?|serum|vital|massive|sylenth1?|spire|omnisphere|diva|phase plant|pigments)\b/i;
const PRESET_TYPE = /\bpresets?\b|\bpatches\b|\bsound ?banks?\b/i;
/** "Trap MIDI Collection" is MIDI; "Blue Keys + MIDI" is a sample pack that also has MIDI. */
const MIDI_TITLE = /\bmidi\s+(packs?|kits?|collection|files|bundle|chords|progressions|melodies|library)\b|^midi\b/i;
/** Categories a synth preset pack can sensibly be in; anything else falls back to "synth". */
const PRESET_CATEGORIES = new Set(["synth", "bass", "keys", "strings", "brass", "woodwind", "mallets", "guitar"]);

/**
 * Form of a store product. Only the title and product type decide: tags like "MIDI Melodies" or
 * "Hip Hop Samples & Presets" are attached to ordinary sample packs too.
 */
export function storeForm(p: Pick<Product, "title" | "type" | "tags">): SampleForm {
  const title = p.title;
  const type = p.type ?? "";
  if (PRESET_TYPE.test(type) || (PRESET_WORDS.test(title) && /\b(presets?|patches|bank)\b/i.test(title))) return "preset";
  if (/\bmidi\b/i.test(type) || MIDI_TITLE.test(title)) return "midi";
  if (p.tags.some((t) => /^(serum|vital|massive|sylenth1?|spire|omnisphere)\s+presets?$/i.test(t))) return "preset";
  return "pack";
}

function htmlText(html: string | undefined, max = 500): string | undefined {
  if (!html) return undefined;
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  $("style, script").remove();
  const text = cleanText($("#root").text());
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function absolute(url: string | undefined | null, origin: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("//")) return `https:${url}`;
  try {
    return new URL(url, origin).toString();
  } catch {
    return undefined;
  }
}

/** Shopify's CDN resizes on `width=`; a card needs no more than 600px. */
function thumbnail(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname === "cdn.shopify.com" || u.pathname.includes("/cdn/shop/")) u.searchParams.set("width", "600");
    return u.toString();
  } catch {
    return url;
  }
}

function priceOf(amount: number | undefined, currency: string): Price | undefined {
  if (amount === undefined || !Number.isFinite(amount)) return undefined;
  return amount === 0 ? { free: true } : { free: false, amount, currency };
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Demo mp3s from a product page. Prime Loops-style themes tag each play button with the product
 * id (related products on the same page carry their own ids); Cymatics-style themes list the
 * demos in an `audioSources_demos` script array.
 */
export function parseDemoUrls(html: string, productId: number | string, origin: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  $(`[data-sample-url][data-product-id="${productId}"]`).each((_, el) => {
    const u = absolute($(el).attr("data-sample-url"), origin);
    if (u) urls.push(u);
  });
  const arr = /audioSources_demos\s*=\s*\[([\s\S]*?)\]/.exec(html)?.[1];
  if (arr) for (const m of arr.matchAll(/['"]([^'"]+)['"]/g)) urls.push(absolute(m[1], origin) ?? "");
  return [...new Set(urls.filter((u) => /\.mp3(\?|$)/i.test(u)))];
}

export function shopifySearchUrl(origin: string, q: Pick<SampleQuery, "query">): string {
  const text = q.query.trim();
  return text ? `${origin}/search${qs({ q: text, type: "product" })}` : `${origin}/collections/all`;
}

export function shopifyStore(spec: ShopifyStoreSpec): Provider {
  const origin = spec.homepage.replace(/\/+$/, "");
  const buildSearchUrl = (q: SampleQuery) => shopifySearchUrl(origin, q);
  const info = {
    id: spec.id,
    name: spec.name,
    homepage: origin,
    description: spec.description,
    categories: spec.categories,
    forms: STORE_FORMS,
    pricing: spec.pricing ?? ("freemium" as Pricing),
    license: spec.license,
  };
  if (spec.linkOnly) return linkProvider({ ...info, buildSearchUrl });

  const toSample = (p: Product): Sample => {
    const url = `${origin}/products/${p.handle}`;
    const form = storeForm(p);
    const sample = makeSample({
      provider: spec.id,
      nativeId: p.handle,
      title: cleanText(p.title) || p.handle,
      description: htmlText(p.bodyHtml),
      url,
      author: p.vendor ? cleanText(p.vendor) : undefined,
      tags: p.tags,
      sourceCategories: p.type && !NOISE_TAG.test(p.type) ? [p.type] : undefined,
      form,
      unit: "pack",
      thumbnailUrl: thumbnail(absolute(p.image, origin)),
      license: spec.license,
      price: priceOf(p.price, spec.currency),
      requiresAccount: spec.requiresAccount,
      // Paid packs need a purchase and free ones a $0 checkout: never a plain GET.
      downloadable: false,
      createdAt: p.createdAt,
      sourceName: spec.name,
    });
    if (form === "preset" && !PRESET_CATEGORIES.has(topCategory(sample.category))) {
      return { ...sample, category: "synth", categoryEvidence: { by: "rules", confidence: 0.5 } };
    }
    return sample;
  };

  const fromSuggest = (p: SuggestProduct): Product => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    bodyHtml: p.body,
    type: p.type || undefined,
    vendor: p.vendor,
    tags: storeTags(p.tags),
    price: num(p.price_min ?? p.price),
    image: p.featured_image?.url ?? p.image ?? undefined,
  });

  const fromCatalogue = (p: CatalogueProduct): Product => {
    const prices = (p.variants ?? []).map((v) => num(v.price)).filter((n): n is number => n !== undefined);
    return {
      id: p.id,
      title: p.title,
      handle: p.handle,
      bodyHtml: p.body_html,
      type: p.product_type || undefined,
      vendor: p.vendor,
      tags: storeTags(p.tags),
      price: prices.length ? Math.min(...prices) : undefined,
      image: p.images?.[0]?.src,
      createdAt: p.published_at ?? p.created_at,
    };
  };

  const cataloguePage = async (page: number, ctx: ProviderContext, cacheTtlMs: number, limit = PAGE_SIZE) => {
    const url = `${origin}/products.json${qs({ limit, page })}`;
    const res = await ctx.fetch.json<{ products?: CatalogueProduct[] }>(url, { signal: ctx.signal, cacheTtlMs });
    return res.products ?? [];
  };

  /** One-of-a-kind titles: stores list giveaway copies of a pack under the same title. */
  const dedupe = (items: Product[]) => {
    const seen = new Set<string>();
    return items.filter((p) => {
      const k = cleanText(p.title).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  return {
    ...info,
    access: "scrape",
    supportsDownload: false,
    buildSearchUrl,

    async search(q, ctx) {
      const searchUrl = buildSearchUrl(q);
      if (!wantsCategory(q, ...spec.categories)) return { samples: [], searchUrl };
      if (q.forms?.length && !q.forms.some((f) => STORE_FORMS.includes(f))) return { samples: [], searchUrl };
      const offset = q.offset ?? 0;
      const text = q.query.trim();

      let products: Product[];
      let start: number;
      if (text) {
        // Predictive search returns at most 10 and cannot page.
        if (offset >= SUGGEST_MAX) return { samples: [], searchUrl };
        const url = `${origin}/search/suggest.json${qs({
          q: text,
          "resources[type]": "product",
          "resources[limit]": Math.min(SUGGEST_MAX, offset + q.limit),
          "resources[options][unavailable_products]": "hide",
        })}`;
        const res = await ctx.fetch.json<SuggestResponse>(url, { signal: ctx.signal, cacheTtlMs: SEARCH_TTL });
        products = (res.resources?.results?.products ?? []).filter((p) => p.available !== false).map(fromSuggest);
        start = offset;
      } else {
        // Browse: the catalogue feed, one page. Small first pages ask for just what they show.
        const small = offset + q.limit <= PAGE_SIZE;
        const page = small ? 1 : Math.floor(offset / PAGE_SIZE) + 1;
        const list = await cataloguePage(page, ctx, SEARCH_TTL, small ? offset + q.limit : PAGE_SIZE);
        products = list.map(fromCatalogue);
        start = small ? offset : offset % PAGE_SIZE;
      }

      let samples = dedupe(products).map(toSample);
      if (q.freeOnly) samples = samples.filter((s) => s.price?.free);
      if (q.forms?.length) samples = samples.filter((s) => !s.form || q.forms!.includes(s.form));
      return { samples: paginate(samples, { ...q, offset: start }), searchUrl };
    },

    async getSample(nativeId, ctx) {
      const handle = encodeURIComponent(nativeId);
      let product: ProductJs;
      try {
        product = await ctx.fetch.json<ProductJs>(`${origin}/products/${handle}.js`, { signal: ctx.signal, cacheTtlMs: SEARCH_TTL });
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      }
      // Demos are only on the product page; a failure there still returns the product.
      const html = await ctx.fetch
        .text(`${origin}/products/${handle}`, { signal: ctx.signal, cacheTtlMs: SEARCH_TTL })
        .catch(() => "");
      const demos = html ? parseDemoUrls(html, product.id, origin) : [];
      const minor = product.price_min ?? product.price;
      const sample = toSample({
        id: product.id,
        title: product.title,
        handle: product.handle,
        bodyHtml: product.description,
        type: product.type || undefined,
        vendor: product.vendor,
        tags: storeTags(product.tags),
        price: minor === undefined ? undefined : minor / 100,
        image: product.featured_image ?? product.images?.[0] ?? undefined,
        createdAt: product.published_at ?? product.created_at,
      });
      const files: SampleFile[] = demos.map((url) => ({ url, filename: filenameFromUrl(url), format: "mp3", role: "preview" }));
      const details: SampleDetails = { ...sample, previewUrl: demos[0], files };
      if (!details.previewUrl) delete details.previewUrl;
      return details;
    },

    async census(ctx): Promise<SourceCensus> {
      const all: CatalogueProduct[] = [];
      let page = 1;
      for (; page <= CENSUS_MAX_PAGES; page++) {
        const list = await cataloguePage(page, ctx, CATALOGUE_TTL);
        all.push(...list);
        if (list.length < PAGE_SIZE) break;
      }
      const samples = all.map(fromCatalogue).map(toSample);
      const c = tallySamples(samples, `Every product in the Shopify catalogue feed (/products.json, ${PAGE_SIZE} per page)`, { unit: "packs" });
      return page > CENSUS_MAX_PAGES ? { ...c, atLeast: true } : c;
    },
  };
}
