import { royaltyFree } from "../core/licence.js";
import type { SampleQuery } from "../core/types.js";
import { linkProvider, linkTerms } from "./link.js";

/**
 * Mixkit (Envato) free sound effects: a few thousand risers, whooshes, impacts, glitches,
 * foley and ambiences under the Mixkit Sound Effects Free License.
 *
 * Link-only on purpose. Scraping would work technically (cards carry
 * `data-audio-player-preview-url-value=".../sfx/{id}/{id}-preview.mp3"` and the full WAV is a plain
 * GET at `.../sfx/{id}/{id}.wav`), but the Mixkit User Terms (https://mixkit.co/terms/, clause 9)
 * forbid using "Mixkit or its related systems and networks, or any Item, to build a similar or
 * competitive product or service", copying, republishing or framing "any part of Mixkit
 * (including any component of the website)", aggregating Items and making them available, using
 * "scripts or bots to mass download Items", and accessing Mixkit "in any way not expressly
 * permitted". A search aggregator that scrapes its listings falls under that, so we only link to
 * the site's own search. robots.txt itself allows everything (except CCBot).
 *
 * The site's search box lands on `/free-sound-effects/discover/<words-joined-by-dashes>/`.
 */

const SITE = "https://mixkit.co";

export const MIXKIT_LICENSE = royaltyFree("Mixkit Sound Effects Free License", {
  url: `${SITE}/license/#sfxFree`,
  note: "Free for commercial and personal projects, no attribution needed. The sound effects may not be redistributed or sold on their own.",
});

/** "Door knock!" → "door-knock" (the path segment Mixkit's own search uses). */
export function mixkitSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export const mixkit = linkProvider({
  id: "mixkit",
  name: "Mixkit",
  homepage: SITE,
  description: "Envato's free sound effects: risers, whooshes, impacts, glitches, foley and ambiences, free for commercial use (link only: its terms forbid automated access).",
  categories: ["fx", "foley", "ambience", "drums", "vocals"],
  forms: ["one-shot", "loop"],
  pricing: "free",
  license: MIXKIT_LICENSE,
  buildSearchUrl(q: SampleQuery) {
    const slug = mixkitSlug(linkTerms(q));
    return slug ? `${SITE}/free-sound-effects/discover/${slug}/` : `${SITE}/free-sound-effects/`;
  },
});
