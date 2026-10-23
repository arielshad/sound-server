/**
 * Function Loops (https://www.functionloops.com): an Israeli label's store of royalty-free sample
 * packs (vocals, psytrance, techno, house, pop, hip hop), MIDI and presets, built on Weebly.
 *
 * Link-only. Checked 2026-10-23:
 * - robots.txt disallows `/apps/` and `/ajax/`, which is where Weebly's real search lives: the
 *   result paging links (`/apps/search?q=…&page=2`) and the product data both sit there.
 * - `/search?q=` is allowed, but its server render is cached by the CDN for 30 seconds without the
 *   query in the cache key (`cdn-cache-control: max-age=30, public`, `cf-cache-status: HIT`): a
 *   search for "kick" right after one for "techno" got the techno results back. Results could be
 *   another query's for anyone searching within half a minute, so they can't be trusted.
 * - Even a fresh result page carries only titles and links (no price, cover or demo); demos are
 *   YouTube embeds, so there is no mp3 to audition.
 * - The licence page (/license.html) says nothing about robots: packs are "100% royalty free, once
 *   purchased", may not be shared or resold, and may not be used for AI training.
 */
import { royaltyFree } from "../core/licence.js";
import type { SampleQuery } from "../core/types.js";
import { qs } from "../core/util.js";
import { linkProvider, linkTerms } from "./link.js";

const SITE = "https://www.functionloops.com";

export const functionloopsLicense = royaltyFree("Function Loops licence", {
  url: `${SITE}/license.html`,
  note: "100% royalty free once purchased: use in commercial releases, edit and rework freely; do not resell, share or upload the sounds, and no AI training.",
});

export const functionloops = linkProvider({
  id: "functionloops",
  name: "Function Loops",
  homepage: SITE,
  description:
    "Label store of royalty-free sample packs: vocal packs and acapellas, psytrance, techno, house, pop and hip hop kits, MIDI and presets (search on the site).",
  categories: ["vocals", "drums", "bass", "synth", "fx", "guitar", "keys"],
  forms: ["pack", "loop", "one-shot", "midi", "preset"],
  pricing: "paid",
  license: functionloopsLicense,
  buildSearchUrl(q: SampleQuery) {
    const text = linkTerms(q);
    return text ? `${SITE}/search${qs({ q: text })}` : `${SITE}/sounds.html`;
  },
});
