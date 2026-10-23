/**
 * Commercial sample-pack stores on Shopify (see ./shopify.ts).
 *
 * Checked 2026-10-23:
 * - Both stores' robots.txt are Shopify's current default: `/search` (and so
 *   `/search/suggest.json`) and `/products.json` are not disallowed for `User-agent: *`.
 * - Cymatics' Terms of Use forbid "any robot, spider, or other automatic device, process, or means
 *   to access the Website for any purpose", and its Terms of Service list "spider, crawl, or
 *   scrape" as a prohibited use. So Cymatics is link-only, even though the JSON works.
 * - Prime Loops' terms forbid automated *downloading* software and extracting or re-using the
 *   site's contents, but not robots or search as such, and the store's own agents.md invites agents
 *   to browse products for a user. We send one cached metadata request per user search and never
 *   download products. Read strictly, that rules out scraping, so it is link-only too.
 */
import { royaltyFree } from "../core/licence.js";
import { shopifyStore } from "./shopify.js";

export const cymatics = shopifyStore({
  id: "cymatics",
  name: "Cymatics",
  homepage: "https://cymatics.fm",
  description:
    "Big catalogue of drum kits, loop and one-shot packs, vocals, Serum presets and MIDI for trap, hip hop and EDM; a lot of free packs that go through a $0 checkout.",
  categories: ["drums", "bass", "vocals", "synth", "keys", "guitar", "fx"],
  currency: "USD",
  pricing: "freemium",
  license: royaltyFree("Cymatics licence", {
    url: "https://cymatics.fm/pages/terms-of-service",
    note: "Product pages state the packs are 100% royalty free for your music; the samples themselves may not be redistributed or resold.",
  }),
  linkOnly: "Terms of Use forbid robots, spiders and any automatic means of access (2026-10-23).",
});

/** Prime Loops as a store spec; the scraper path is kept (and tested) for stores whose terms allow it. */
export const primeloopsSpec = {
  id: "primeloops",
  name: "Prime Loops",
  homepage: "https://primeloops.com",
  description:
    "UK store of label sample packs: hip hop, trap and drill drum kits, melody and MIDI kits, world vocals and cinematic loops, plus many free taster packs.",
  categories: ["drums", "bass", "vocals", "keys", "guitar", "strings", "brass", "woodwind", "synth", "fx"],
  currency: "GBP",
  pricing: "freemium",
  // The terms require registration before buying or downloading any product, free ones included.
  requiresAccount: true,
  license: royaltyFree("Prime Loops licence", {
    url: "https://support.primeloops.com/support/solutions/articles/11000036557-are-prime-loops-sample-packs-royalty-free-",
    note: "Royalty free for use inside your own music productions; the samples may not be shared, uploaded or resold as samples.",
  }),
  linkOnly: "Terms forbid extracting or re-using site contents and automated downloading (2026-10-23).",
} satisfies Parameters<typeof shopifyStore>[0];

export const primeloops = shopifyStore(primeloopsSpec);

export const packStoreProviders = [primeloops, cymatics];
