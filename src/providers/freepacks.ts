/**
 * Free pack news: new free sample packs announced on a few sites, as pack results that link to the
 * announcement. Each feed is one request, cached for an hour; all feeds load in parallel and a feed
 * that fails is skipped (the others still answer).
 *
 * Feeds (checked 2026-10-23):
 * - 99Sounds (WordPress REST, category "Free Sounds"): robots.txt allows everything; every pack is
 *   under the 99Sounds licence (royalty free for personal and commercial projects, credit optional,
 *   no redistribution). Downloads go through a Gumroad $0 checkout, so nothing is downloadable here.
 * - Bedroom Producers Blog: robots.txt disallows `/wp-json/` (so its REST API is out), but the RSS
 *   feed (`/feed/`) is allowed and is what feeds are for. Its HTML pages sit behind a "Security
 *   Verification" wall; the feed does not. Only items in the "Free Soundware" or "Free Samples"
 *   categories are kept (the rest is plugin and deal news). The category feeds are stale (2021), so
 *   the main feed is read: it carries the latest 10 posts.
 * - Reverb Machine: its blog posts are synth tutorials, not packs, so the feed is the WooCommerce
 *   Store API's "Free" product category (free preset and sample packs, $0 checkout). robots.txt
 *   only closes WooCommerce internals; the terms cover the licence, not access.
 *
 * Licences: 99Sounds and Reverb Machine have one site licence each. BPB reports packs from many
 * makers, so its items are "check the terms" unless the post itself says the pack is royalty free.
 */
import * as cheerio from "cheerio";
import { tallySamples } from "../core/census.js";
import { customLicense, royaltyFree } from "../core/licence.js";
import type { License, Provider, ProviderContext, Sample, SampleDetails, SampleForm, SampleQuery, SourceCensus } from "../core/types.js";
import { cleanText, filterLocal, makeSample, paginate, qs, wantsCategory } from "../core/util.js";
import { topCategory } from "../core/vocab.js";

const CACHE_MS = 60 * 60_000;
const HOMEPAGE = "https://99sounds.org/sounds/";

export type FeedId = "99sounds" | "bpb" | "reverbmachine";

export interface FreePackItem {
  feed: FeedId;
  id: string;
  title: string;
  url: string;
  excerpt?: string;
  image?: string;
  date?: string;
  tags: string[];
  /** The post itself says the pack is royalty free. */
  statesRoyaltyFree?: boolean;
  preset?: boolean;
}

interface Feed {
  id: FeedId;
  name: string;
  url: string;
  parse(body: string): FreePackItem[];
  license(item: FreePackItem): License;
}

function text(html: string | undefined): string {
  if (!html) return "";
  const $ = cheerio.load(`<div id="r">${html}</div>`);
  $("style, script").remove();
  return cleanText($("#r").text());
}

function short(s: string, max = 400): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** "the pack is 100% royalty free", "royalty-free for commercial use"; a roundup of "royalty-free sounds" doesn't count. */
const STATES_ROYALTY_FREE = /\b(?:is|are)\s+(?:100%\s+)?royalty[- ]free\b|\broyalty[- ]free\s+(?:for|in)\s+(?:personal and\s+)?commercial\b/i;
const PRESET = /\bpresets?\b|\bpatch(?:es)?\b|\bsound ?banks?\b/i;

export const ninetyNineSoundsLicense = royaltyFree("99Sounds licence", {
  url: "https://99sounds.org/license/",
  note: "Royalty free in personal and commercial projects, credit optional. The sounds may not be resold or redistributed, or used to make noise or sleep-sound apps.",
});

export const reverbMachineLicense = royaltyFree("Reverb Machine licence", {
  url: "https://reverbmachine.com/terms-and-conditions/",
  note: "Use in your own compositions, commercial releases included, without credit. No redistribution, no new sample packs or instruments, and no AI or machine-learning training.",
});

const CHECK_ARTICLE = customLicense("Free pack, see the article", {
  verdict: "check-terms",
  note: "A free pack announced by Bedroom Producers Blog. Each maker sets its own licence (and often asks for an email or a $0 checkout): read the terms linked from the article.",
});

interface WpPost {
  id: number;
  date?: string;
  link?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
}

interface StoreProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  short_description?: string;
  prices?: { price?: string };
  images?: { src?: string; thumbnail?: string }[];
  categories?: { name: string }[];
}

export const FEEDS: Record<FeedId, Feed> = {
  "99sounds": {
    id: "99sounds",
    name: "99Sounds",
    url: `https://99sounds.org/wp-json/wp/v2/posts${qs({ categories: 1, per_page: 100, _fields: "id,date,link,title,excerpt" })}`,
    parse(body) {
      const posts = JSON.parse(body) as WpPost[];
      if (!Array.isArray(posts)) throw new Error("99Sounds: unexpected posts response");
      return posts.flatMap((p): FreePackItem[] => {
        const title = text(p.title?.rendered);
        if (!title || !p.link) return [];
        const excerpt = text(p.excerpt?.rendered);
        return [{ feed: "99sounds", id: String(p.id), title, url: p.link, excerpt: short(excerpt), date: p.date?.slice(0, 10), tags: ["99sounds"], preset: PRESET.test(title) }];
      });
    },
    license: () => ninetyNineSoundsLicense,
  },
  bpb: {
    id: "bpb",
    name: "Bedroom Producers Blog",
    url: "https://bedroomproducersblog.com/feed/",
    parse(body) {
      const $ = cheerio.load(body, { xml: true });
      const items: FreePackItem[] = [];
      $("item").each((_, el) => {
        const it = $(el);
        const cats = it.find("category").map((_, c) => cleanText($(c).text())).get();
        if (!cats.some((c) => /^free (soundware|samples)$/i.test(c))) return;
        const title = cleanText(it.children("title").text());
        const url = cleanText(it.children("link").text());
        const id = /[?&]p=(\d+)/.exec(it.children("guid").text())?.[1];
        if (!title || !url || !id) return;
        const html = it.children("description").text();
        const $d = cheerio.load(`<div id="r">${html}</div>`);
        const image = $d("img[src]").first().attr("src");
        $d("p").filter((_, p) => /^View post:/i.test(cleanText($d(p).text()))).remove();
        const excerpt = cleanText($d("#r").text()).replace(/\s*\[(…|\.\.\.)\]\s*$/, "…");
        const date = Date.parse(cleanText(it.children("pubDate").text()));
        items.push({
          feed: "bpb",
          id,
          title,
          url,
          excerpt: short(excerpt),
          image,
          date: Number.isFinite(date) ? new Date(date).toISOString().slice(0, 10) : undefined,
          tags: ["bedroom producers blog", ...cats.filter((c) => !/^(news|mac|windows|hot|trending|recommended|deals)$/i.test(c))],
          statesRoyaltyFree: STATES_ROYALTY_FREE.test(`${title} ${excerpt}`),
          preset: PRESET.test(title),
        });
      });
      return items;
    },
    license: (item) =>
      item.statesRoyaltyFree
        ? royaltyFree("Royalty free (stated in the article)", {
            url: item.url,
            assertedBy: "source",
            note: "The article says the pack is royalty free. Check the maker's own licence when you download it.",
          })
        : CHECK_ARTICLE,
  },
  reverbmachine: {
    id: "reverbmachine",
    name: "Reverb Machine",
    url: `https://reverbmachine.com/wp-json/wc/store/products${qs({ category: 213, per_page: 100 })}`,
    parse(body) {
      const products = JSON.parse(body) as StoreProduct[];
      if (!Array.isArray(products)) throw new Error("Reverb Machine: unexpected Store API response");
      return products.flatMap((p): FreePackItem[] => {
        if (p.prices?.price !== undefined && Number(p.prices.price) !== 0) return [];
        const title = text(p.name);
        if (!title || !p.permalink) return [];
        const excerpt = text(p.short_description);
        return [
          {
            feed: "reverbmachine",
            id: String(p.id),
            title,
            url: p.permalink,
            excerpt: short(excerpt),
            image: p.images?.[0]?.thumbnail ?? p.images?.[0]?.src,
            tags: ["reverb machine", ...(p.categories ?? []).map((c) => text(c.name)).filter((c) => c && c !== "Free")],
            preset: PRESET.test(`${title} ${excerpt}`),
          },
        ];
      });
    },
    license: () => reverbMachineLicense,
  },
};

const FEED_IDS = Object.keys(FEEDS) as FeedId[];

export function toSample(item: FreePackItem): Sample {
  const feed = FEEDS[item.feed];
  const form: SampleForm = item.preset ? "preset" : "pack";
  const sample = makeSample({
    provider: "freepacks",
    nativeId: `${item.feed}:${item.id}`,
    title: item.title,
    description: item.excerpt,
    url: item.url,
    author: item.feed === "bpb" ? undefined : feed.name,
    tags: ["free pack", ...item.tags],
    form,
    unit: "pack",
    thumbnailUrl: item.image,
    license: feed.license(item),
    price: { free: true },
    // Gumroad / email / $0 checkout: never a plain GET.
    downloadable: false,
    createdAt: item.date,
    sourceName: feed.name,
  });
  if (form === "preset" && topCategory(sample.category) === "other") return { ...sample, category: "synth", categoryEvidence: { by: "rules", confidence: 0.5 } };
  return sample;
}

async function loadFeed(id: FeedId, ctx: ProviderContext): Promise<FreePackItem[]> {
  const feed = FEEDS[id];
  const body = await ctx.fetch.text(feed.url, { signal: ctx.signal, cacheTtlMs: CACHE_MS });
  return feed.parse(body);
}

/** Every feed in parallel; failed feeds are skipped unless all of them fail. */
async function loadAll(ctx: ProviderContext): Promise<FreePackItem[]> {
  const results = await Promise.allSettled(FEED_IDS.map((id) => loadFeed(id, ctx)));
  const ok = results.filter((r): r is PromiseFulfilledResult<FreePackItem[]> => r.status === "fulfilled");
  if (!ok.length) {
    const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason instanceof Error ? first.reason : new Error("free pack feeds failed");
  }
  return ok.flatMap((r) => r.value);
}

function newestFirst(a: Sample, b: Sample): number {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

export const freepacks: Provider = {
  id: "freepacks",
  name: "Free pack news",
  homepage: HOMEPAGE,
  description:
    "Newly announced free sample and preset packs from 99Sounds, Bedroom Producers Blog and Reverb Machine, linking to the article or product page (downloads need an email or a $0 checkout there).",
  categories: ["drums", "bass", "vocals", "fx", "foley", "ambience", "keys", "guitar", "synth", "strings", "brass", "woodwind", "mallets", "other"],
  forms: ["pack", "preset"],
  access: "scrape",
  pricing: "free",
  supportsDownload: false,

  buildSearchUrl(q: SampleQuery) {
    const t = q.query.trim();
    return t ? `https://99sounds.org/${qs({ s: t })}` : HOMEPAGE;
  },

  async search(q, ctx) {
    const searchUrl = this.buildSearchUrl(q);
    if (!wantsCategory(q, ...this.categories)) return { samples: [], searchUrl };
    if (q.forms?.length && !q.forms.some((f) => f === "pack" || f === "preset")) return { samples: [], searchUrl };
    const items = await loadAll(ctx);
    let samples = items.map(toSample).sort(newestFirst);
    samples = filterLocal(samples, q);
    return { samples: paginate(samples, q), total: samples.length, searchUrl };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    const m = /^(99sounds|bpb|reverbmachine):(\d+)$/.exec(nativeId);
    if (!m) return null;
    const items = await loadFeed(m[1] as FeedId, ctx);
    const item = items.find((i) => i.id === m[2]);
    return item ? { ...toSample(item), files: [] } : null;
  },

  async census(ctx): Promise<SourceCensus> {
    const items = await loadAll(ctx);
    return tallySamples(items.map(toSample), "Items in the free-pack feeds (99Sounds free sounds, BPB's latest free soundware posts, Reverb Machine's free products)", {
      unit: "packs",
    });
  },
};
