/**
 * Sample sites we only deep-link to. Each one is link-only for a stated reason (checked
 * 2026-10-22/23 with curl from a cloud IP; details in docs/research/sources-scrape-and-marketplaces.md):
 * a bot wall (Cloudflare / Vercel / JS challenge), robots.txt disallowing the search path, terms
 * that forbid scraping, or a JS-only app whose results never reach the HTML.
 *
 * Every `buildSearchUrl` is the URL the site's own search UI produces. Where the site has URL
 * parameters for BPM, key, loop/one-shot or free, they are set, and those words are left out of the
 * search text; otherwise `linkTerms` puts the BPM and key into the text.
 */
import { customLicense, royaltyFree } from "../core/licence.js";
import type { Category, SampleQuery } from "../core/types.js";
import type { PitchClass, SampleForm } from "../core/vocab.js";
import { qs } from "../core/util.js";
import { linkProvider, linkTerms } from "./link.js";

/** Search text, leaving out what the site filters with its own parameters. */
function terms(q: SampleQuery, native: { bpm?: boolean; key?: boolean } = {}): string {
  return linkTerms({ ...q, bpm: native.bpm ? undefined : q.bpm, key: native.key ? undefined : q.key });
}

function exactBpm(q: SampleQuery): number | undefined {
  return q.bpm?.min !== undefined && q.bpm.min === q.bpm.max ? q.bpm.min : undefined;
}

/** "loop" or "one-shot" when the query asks for exactly one of them. */
function loopOrOneShot(q: SampleQuery): "loop" | "one-shot" | undefined {
  const f = (q.forms ?? []).filter((x): x is "loop" | "one-shot" => x === "loop" || x === "one-shot");
  return f.length === 1 ? f[0] : undefined;
}

function wants(q: SampleQuery, top: Category): boolean {
  return [...(q.categories ?? []), ...(q.hints ?? [])].some((c) => c === top || c.startsWith(`${top}.`));
}

/** `${base}?{param}={text}` or `empty` when there is nothing to search for. */
function simple(base: string, param: string, empty: string, extra: Record<string, string | undefined> = {}) {
  return (q: SampleQuery) => {
    const text = terms(q);
    return text ? `${base}${qs({ [param]: text, ...extra })}` : empty;
  };
}

const MUSIC: Category[] = ["drums", "bass", "vocals", "fx", "keys", "guitar", "synth", "strings", "brass", "woodwind", "mallets", "ambience"];
const SFX: Category[] = ["fx", "foley", "ambience", "vocals"];

const PACK_FORMS: SampleForm[] = ["pack", "loop", "one-shot", "midi", "preset"];

// ---------------------------------------------------------------------------
// Commercial marketplaces and subscriptions (robots.txt or JS-only search)
// ---------------------------------------------------------------------------

/** robots allows it, but the server render ignores `q` and previews are scrambled + signed. */
export const splice = linkProvider({
  id: "splice",
  name: "Splice",
  homepage: "https://splice.com/sounds",
  description:
    "The largest subscription sample library: millions of individual one-shots and loops from label packs, each licensed with credits, filterable by BPM, key and type.",
  categories: MUSIC,
  forms: ["one-shot", "loop", "midi", "preset"],
  pricing: "paid",
  license: royaltyFree("Splice licence", {
    url: "https://support.splice.com/en/articles/8652642-splice-sounds-licensing-faq",
    note: "Royalty free in your music once you license the sound with credits; no redistributing the samples, and no use as AI training data.",
  }),
  buildSearchUrl: (q) => {
    const bpm = exactBpm(q);
    const form = loopOrOneShot(q);
    return `https://splice.com/sounds/search/samples${qs({
      q: terms(q, { bpm: !!q.bpm, key: !!q.key }),
      bpm,
      min_bpm: bpm === undefined ? q.bpm?.min : undefined,
      max_bpm: bpm === undefined ? q.bpm?.max : undefined,
      key: q.key?.tonic,
      chord_type: q.key?.mode,
      asset_category_slug: form === "loop" ? "loop" : form === "one-shot" ? "oneshot" : undefined,
    })}`;
  },
});

/** robots.txt: `Disallow: /search?*`. */
export const loopmasters = linkProvider({
  id: "loopmasters",
  name: "Loopmasters",
  homepage: "https://www.loopmasters.com",
  description: "Long-running store of label sample packs across every dance and urban genre, with audio demos for each pack.",
  categories: MUSIC,
  forms: PACK_FORMS,
  pricing: "paid",
  license: royaltyFree("Loopmasters licence", {
    url: "https://www.loopmasters.com/legal",
    note: "Royalty free for use in your music; the samples may not be resold or redistributed.",
  }),
  buildSearchUrl: simple("https://www.loopmasters.com/search", "q", "https://www.loopmasters.com/"),
});

/** JS app (sounds.loopcloud.com); the search page HTML is an empty shell. */
export const loopcloud = linkProvider({
  id: "loopcloud",
  name: "Loopcloud",
  homepage: "https://www.loopcloud.com",
  description: "Loopmasters' subscription service: search the Loopmasters catalogue sound by sound and use it in the Loopcloud app or plugin.",
  categories: MUSIC,
  forms: ["one-shot", "loop"],
  pricing: "paid",
  license: royaltyFree("Loopcloud licence", {
    url: "https://www.loopcloud.com/cloud/terms_of_service",
    note: "Royalty free for sounds downloaded with an active plan; no redistributing the samples.",
  }),
  buildSearchUrl: simple("https://sounds.loopcloud.com/search", "q", "https://sounds.loopcloud.com/"),
});

/** robots.txt disallows `/search.php` and `/*mode=*`. */
export const producerloops = linkProvider({
  id: "producerloops",
  name: "Producer Loops",
  homepage: "https://www.producerloops.com",
  description: "Store of sample packs, construction kits, MIDI and presets from many labels, each with an audio demo.",
  categories: MUSIC,
  forms: PACK_FORMS,
  pricing: "paid",
  license: royaltyFree("Producer Loops licence", {
    url: "https://www.producerloops.com/download-royalty-free-loops-and-samples/",
    note: "Royalty free for use in your music; the samples may not be resold or redistributed.",
  }),
  buildSearchUrl: (q) => {
    const text = terms(q);
    return text ? `https://www.producerloops.com/search.php${qs({ mode: "search", substring: text })}` : "https://www.producerloops.com/";
  },
});

/** robots.txt disallows `?s=`, `?src=` and `?fastwpac_s=`; results load by JS. */
export const adsr = linkProvider({
  id: "adsr",
  name: "ADSR Sounds",
  homepage: "https://www.adsrsounds.com",
  description: "Store of sample packs, synth presets and plugins for electronic producers, plus tutorials.",
  categories: MUSIC,
  forms: ["pack", "loop", "one-shot", "midi", "preset"],
  pricing: "paid",
  license: royaltyFree("ADSR Sounds licence", {
    url: "https://www.adsrsounds.com/terms-conditions/",
    note: "Royalty free for use in your music; the samples and presets may not be resold or shared.",
  }),
  buildSearchUrl: simple("https://www.adsrsounds.com/", "fastwpac_s", "https://www.adsrsounds.com/"),
});

/** robots.txt: `Disallow: /search?*`. Licences vary by label, so none is set. */
export const pluginboutique = linkProvider({
  id: "pluginboutique",
  name: "Plugin Boutique",
  homepage: "https://www.pluginboutique.com",
  description: "Plugin store that also sells sample packs, presets and Kontakt instruments from many labels, with a free section.",
  categories: MUSIC,
  forms: ["pack", "preset", "multisample", "midi"],
  pricing: "freemium",
  buildSearchUrl: (q) => {
    const text = terms(q);
    if (!text) return q.freeOnly ? "https://www.pluginboutique.com/search?shortcut=free" : "https://www.pluginboutique.com/categories/99-Sample-Packs";
    return `https://www.pluginboutique.com/search${qs({ q: text, shortcut: q.freeOnly ? "free" : undefined })}`;
  },
});

const LANDR_KEYS: Record<PitchClass, string> = {
  C: "C",
  "C#": "CSharpDFlat",
  D: "D",
  "D#": "DSharpEFlat",
  E: "E",
  F: "F",
  "F#": "FSharpGFlat",
  G: "G",
  "G#": "GSharpAFlat",
  A: "A",
  "A#": "ASharpBFlat",
  B: "B",
};

/** JS-only app; robots.txt `Disallow: /*?*`. Parameter names are the app's own (its browse URL builder). */
export const landr = linkProvider({
  id: "landr",
  name: "LANDR Samples",
  homepage: "https://samples.landr.com",
  description: "LANDR's sample library: individual loops and one-shots from label packs on a credit plan, with a set of free sounds.",
  categories: MUSIC,
  forms: ["one-shot", "loop", "preset"],
  pricing: "freemium",
  license: royaltyFree("LANDR Samples licence", {
    url: "https://www.landr.com/terms-of-service",
    note: "Royalty free in your music once downloaded with credits (or free); the samples may not be redistributed.",
  }),
  buildSearchUrl: (q) => {
    const form = loopOrOneShot(q);
    const bpm = exactBpm(q);
    return `https://samples.landr.com/browse${qs({
      textsearch: terms(q, { bpm: !!q.bpm, key: !!q.key }),
      bpmlowerbound: bpm ?? q.bpm?.min,
      bpmupperbound: bpm ?? q.bpm?.max,
      keyrootnote: q.key ? LANDR_KEYS[q.key.tonic] : undefined,
      keyquality: q.key?.mode,
      type: form === "loop" ? "loop" : form === "one-shot" ? "one_shot" : undefined,
      tags: q.freeOnly ? "free" : undefined,
    })}`;
  },
});

/** JS app; its search state is not in the URL, so the link opens the song catalogue. */
export const tracklib = linkProvider({
  id: "tracklib",
  name: "Tracklib",
  homepage: "https://www.tracklib.com",
  description:
    "Original recordings (soul, jazz, funk, library music) with stems that you may sample legally, by paying a clearance fee for each release.",
  categories: ["drums", "bass", "vocals", "keys", "guitar", "strings", "brass", "woodwind"],
  forms: ["phrase", "loop"],
  pricing: "paid",
  license: customLicense("Tracklib sample clearance", {
    url: "https://www.tracklib.com/terms",
    verdict: "clearance-required",
    commercialUse: true,
    note: "A real recording: a subscription lets you make music with it, but each commercial release needs a paid clearance for that song.",
  }),
  buildSearchUrl: () => "https://www.tracklib.com/songs",
});

// ---------------------------------------------------------------------------
// Sound-effects subscriptions
// ---------------------------------------------------------------------------

const SUBSCRIPTION_NOTE =
  "Subscription licence written for video and content creators; check whether it covers sounds inside a released track before you use them.";

/** robots.txt: `Disallow: /search/`. */
export const soundsnap = linkProvider({
  id: "soundsnap",
  name: "Soundsnap",
  homepage: "https://www.soundsnap.com",
  description: "Subscription library of professional sound effects (foley, ambiences, impacts, whooshes) plus some loops.",
  categories: SFX,
  forms: ["one-shot", "loop"],
  pricing: "paid",
  license: customLicense("Soundsnap subscription licence", { url: "https://www.soundsnap.com/licence", commercialUse: true, note: SUBSCRIPTION_NOTE }),
  buildSearchUrl: simple("https://www.soundsnap.com/search/audio", "query", "https://www.soundsnap.com/"),
});

/** robots.txt disallows `?term=`. */
export const epidemicsound = linkProvider({
  id: "epidemicsound",
  name: "Epidemic Sound",
  homepage: "https://www.epidemicsound.com/sound-effects/",
  description: "Subscription sound-effects library for video creators, searchable by keyword and category.",
  categories: SFX,
  forms: ["one-shot", "loop"],
  pricing: "paid",
  license: customLicense("Epidemic Sound subscription licence", {
    url: "https://www.epidemicsound.com/policy/v2/legal/",
    commercialUse: true,
    note: SUBSCRIPTION_NOTE,
  }),
  // `/sound-effects/search/?term=` redirects here with the term kept.
  buildSearchUrl: simple("https://www.epidemicsound.com/sound-effects/", "term", "https://www.epidemicsound.com/sound-effects/"),
});

/** robots.txt disallows `/sfx/search` for every listed bot. */
export const artlist = linkProvider({
  id: "artlist",
  name: "Artlist SFX",
  homepage: "https://artlist.io/sfx",
  description: "Subscription sound-effects catalogue bundled with Artlist's music and footage plans.",
  categories: SFX,
  forms: ["one-shot", "loop"],
  pricing: "paid",
  license: customLicense("Artlist licence", { url: "https://artlist.io/license", commercialUse: true, note: SUBSCRIPTION_NOTE }),
  buildSearchUrl: simple("https://artlist.io/sfx/search", "terms", "https://artlist.io/sfx"),
});

// ---------------------------------------------------------------------------
// Free and community sites (bot walls or terms that forbid scraping)
// ---------------------------------------------------------------------------

/** Looperman key codes: "c" (C major), "csm" (C# minor). A key without a mode has no code. */
function looperKey(q: SampleQuery): string | undefined {
  const k = q.key;
  return k?.mode ? `${k.tonic.toLowerCase().replace("#", "s")}${k.mode === "minor" ? "m" : ""}` : undefined;
}

/**
 * Terms forbid scrapers and data mining. Loops and a cappellas live in separate sections: the
 * a cappella section is used when the query is about vocals and does not ask for loops.
 */
export const looperman = linkProvider({
  id: "looperman",
  name: "Looperman",
  homepage: "https://www.looperman.com",
  description:
    "Free community library of user-uploaded loops and a cappellas, searchable by keyword, tempo and key; downloads need a free account.",
  categories: ["drums", "bass", "vocals", "keys", "guitar", "synth", "strings", "brass", "woodwind", "fx"],
  forms: ["loop", "phrase"],
  pricing: "free",
  license: royaltyFree("Looperman licence", {
    url: "https://www.looperman.com/help/terms",
    assertedBy: "uploader",
    note: "Uploaded loops are royalty free for use in your own music (not for redistribution); a cappellas carry each uploader's own terms, often asking for credit or contact first.",
  }),
  buildSearchUrl: (q) => {
    const acapellas = wants(q, "vocals") && !q.forms?.includes("loop");
    if (acapellas) {
      // The a cappella section filters by key but has no tempo filter.
      return `https://www.looperman.com/acapellas${qs({ keys: terms(q, { key: !!looperKey(q) }), mkey: looperKey(q) })}`;
    }
    return `https://www.looperman.com/loops${qs({
      keys: terms(q, { bpm: !!q.bpm, key: !!looperKey(q) }),
      ftempo: q.bpm?.min,
      ttempo: q.bpm?.max,
      mkey: looperKey(q),
    })}`;
  },
});

/** Cloudflare challenge; robots.txt also disallows `/*search=`. */
export const samplefocus = linkProvider({
  id: "samplefocus",
  name: "SampleFocus",
  homepage: "https://samplefocus.com",
  description: "Community site of free user-uploaded one-shots and loops, with a monthly download allowance on free accounts.",
  categories: ["drums", "bass", "vocals", "fx", "keys", "guitar", "synth", "ambience"],
  forms: ["one-shot", "loop"],
  pricing: "freemium",
  license: royaltyFree("SampleFocus licence", {
    assertedBy: "uploader",
    note: "The site licenses uploads royalty free for music (no resale as samples), but anyone can upload, so check where a sound came from.",
  }),
  buildSearchUrl: simple("https://samplefocus.com/samples", "search", "https://samplefocus.com/samples"),
});

/** Cloudflare challenge. The site search is WordPress `?s=` limited to the sound post type. */
export const zapsplat = linkProvider({
  id: "zapsplat",
  name: "Zapsplat",
  homepage: "https://www.zapsplat.com",
  description: "Large free sound-effects library (with some music loops); free accounts must credit Zapsplat, paid accounts need not.",
  categories: SFX,
  forms: ["one-shot", "loop"],
  pricing: "freemium",
  license: royaltyFree("Zapsplat Standard licence", {
    attributionRequired: true,
    note: "Free downloads are royalty free for commercial work with credit to zapsplat.com; a paid plan removes the credit. No redistributing the sounds.",
  }),
  buildSearchUrl: simple("https://www.zapsplat.com/", "s", "https://www.zapsplat.com/sound-effect-categories/", {
    post_type: "music",
    "sound-effect-category-id": "",
  }),
});

/** Cloudflare challenge; the Pixabay API covers images and video, not audio. */
export const pixabay = linkProvider({
  id: "pixabay",
  name: "Pixabay Sound Effects",
  homepage: "https://pixabay.com/sound-effects/",
  description: "Free sound effects uploaded by the Pixabay community, under the Pixabay Content Licence.",
  categories: SFX,
  forms: ["one-shot", "loop"],
  pricing: "free",
  license: royaltyFree("Pixabay Content Licence", {
    url: "https://pixabay.com/service/license-summary/",
    note: "Free for commercial use without credit; you may not sell or distribute the sounds unchanged or on their own.",
  }),
  buildSearchUrl: (q) => {
    const text = terms(q);
    return text ? `https://pixabay.com/sound-effects/search/${encodeURIComponent(text)}/` : "https://pixabay.com/sound-effects/";
  },
});

/** Cloudflare challenge. Best known for the free yearly GDC bundles. */
export const sonniss = linkProvider({
  id: "sonniss",
  name: "Sonniss",
  homepage: "https://sonniss.com",
  description: "Sound-effects library store, best known for its free yearly GDC bundles of tens of gigabytes of professional effects.",
  categories: SFX,
  forms: ["pack"],
  pricing: "freemium",
  license: royaltyFree("Sonniss licence", {
    note: "GDC bundle sounds are royalty free for commercial use without credit; the files may not be redistributed. Paid libraries carry their publisher's licence.",
  }),
  buildSearchUrl: simple("https://sonniss.com/", "s", "https://sonniss.com/gameaudiogdc", { post_type: "product" }),
});

/** Vercel Security Checkpoint (HTTP 429) on every page. */
export const uppbeat = linkProvider({
  id: "uppbeat",
  name: "Uppbeat SFX",
  homepage: "https://uppbeat.io/sfx",
  description: "Sound effects for video creators, free with a monthly download limit or unlimited on a paid plan.",
  categories: SFX,
  forms: ["one-shot"],
  pricing: "freemium",
  license: customLicense("Uppbeat licence", {
    note: "Licensed to your creator account for content; check the terms before using a sound in a released track.",
  }),
  buildSearchUrl: simple("https://uppbeat.io/sfx/search", "query", "https://uppbeat.io/sfx"),
});

const PACK_WORDS = /\b(sample ?packs?|drum ?kits?|kits?|packs?|loops?|samples?|one ?shots?|presets?)\b/i;

/** JS "Client Challenge" page; robots.txt disallows `/search`. Licences are set by each artist. */
export const bandcamp = linkProvider({
  id: "bandcamp",
  name: "Bandcamp",
  homepage: "https://bandcamp.com",
  description: "Producers and labels sell (or give away, pay-what-you-want) sample packs and drum kits as Bandcamp releases.",
  categories: MUSIC,
  forms: ["pack"],
  pricing: "freemium",
  buildSearchUrl: (q) => {
    const text = terms(q);
    if (!text) return "https://bandcamp.com/tag/sample-pack";
    return `https://bandcamp.com/search${qs({ q: PACK_WORDS.test(text) ? text : `${text} sample pack`, item_type: "a" })}`;
  },
});

/** Every link-only sample source, marketplaces first. */
export const linkedProviders = [
  splice,
  loopmasters,
  loopcloud,
  producerloops,
  adsr,
  pluginboutique,
  landr,
  tracklib,
  looperman,
  samplefocus,
  zapsplat,
  pixabay,
  sonniss,
  uppbeat,
  bandcamp,
  soundsnap,
  epidemicsound,
  artlist,
];
