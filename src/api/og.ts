/**
 * Share cards rendered on request: GET /og/query.png (search links) and
 * GET /og/sample.png?id= (sample links, with pack artwork or a waveform).
 *
 * Rendering costs ~100–300 ms of CPU, so results are kept in a small LRU,
 * at most two cards render at once, and the routes sit behind the API rate
 * limit. Responses are cacheable for a day by crawlers and CDNs.
 */
import { VERDICT_LABELS } from "../core/licence.js";
import type { SampleService } from "../core/service.js";
import { categoryLabel } from "../core/vocab.js";
import { fetchImage, pageCard, renderPng, sampleCard } from "../og/render.js";
import { allProviders } from "../providers/index.js";
import { sampleFacts, searchShare } from "./search-meta.js";

export interface OgImagesOptions {
  /** Host printed on the card, e.g. sound.shep.bot. */
  site: string;
  maxEntries?: number;
  concurrency?: number;
  /** Fetch for thumbnails (tests). */
  fetch?: typeof fetch;
}

export class OgImages {
  private readonly cache = new Map<string, Promise<Buffer | null>>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly service: SampleService,
    private readonly opts: OgImagesOptions,
  ) {}

  /** Card for a /search share link; null when the parameters describe no search. */
  query(params: URLSearchParams): Promise<Buffer | null> {
    const share = searchShare(params);
    if (!share) return Promise.resolve(null);
    return this.cached(`q:${share.key}`, () =>
      renderPng(pageCard({ kicker: share.kicker, title: share.title, subtitle: share.subtitle, chips: share.chips, site: this.opts.site })),
    );
  }

  /** Card for a sample share link; null when the sample doesn't exist or can't be looked up. */
  sample(id: string): Promise<Buffer | null> {
    return this.cached(`s:${id}`, async () => {
      const a = await this.service.getSample(id).catch(() => null);
      if (!a) return null;
      const image = a.thumbnailUrl ? await fetchImage(a.thumbnailUrl, { fetch: this.opts.fetch }) : undefined;
      return renderPng(
        sampleCard({
          title: a.title,
          source: allProviders.find((p) => p.id === a.provider)?.name ?? a.provider,
          type: categoryLabel(a.category),
          license: a.license?.name,
          verdict: a.license ? VERDICT_LABELS[a.license.verdict] : undefined,
          free: a.price?.free,
          facts: sampleFacts(a).slice(1),
          author: a.author,
          image,
          site: this.opts.site,
        }),
      );
    });
  }

  private cached(key: string, make: () => Promise<Buffer | null>): Promise<Buffer | null> {
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const value = this.limit(make);
    this.cache.set(key, value);
    // Don't keep failures or misses: the sample may appear, the source may recover.
    value.then((v) => v === null && this.cache.delete(key)).catch(() => this.cache.delete(key));
    while (this.cache.size > (this.opts.maxEntries ?? 300)) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  private async limit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= (this.opts.concurrency ?? 2)) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
