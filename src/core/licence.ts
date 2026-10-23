/**
 * Licences for music samples, and the one question an agent has to answer:
 * "can this go into a commercially released track?"
 *
 * Every provider builds its License through these helpers so the verdicts are
 * decided in one place (see test/licence.test.ts for the table).
 */
import type { CommercialVerdict, License, Sample } from "./types.js";

type Base = Omit<License, "assertedBy">;

const CC = "https://creativecommons.org";

/** Known licences, keyed by SPDX id (or LicenseRef-* for the rest). */
export const LICENSES = {
  "CC0-1.0": {
    id: "CC0-1.0",
    name: "CC0 1.0",
    url: `${CC}/publicdomain/zero/1.0/`,
    commercialUse: true,
    attributionRequired: false,
    redistribution: true,
    verdict: "yes",
  },
  "CC-PDM-1.0": {
    id: "CC-PDM-1.0",
    name: "Public domain",
    url: `${CC}/publicdomain/mark/1.0/`,
    commercialUse: true,
    attributionRequired: false,
    redistribution: true,
    verdict: "yes",
  },
  "LicenseRef-Sampling-Plus-1.0": {
    id: "LicenseRef-Sampling-Plus-1.0",
    name: "CC Sampling+ 1.0",
    url: `${CC}/licenses/sampling+/1.0/`,
    commercialUse: true,
    attributionRequired: true,
    redistribution: false,
    verdict: "restricted",
    note: "Retired licence: commercial use only once transformed into a new work, never in advertising, and the sound itself may not be sold.",
  },
  "LicenseRef-NC-Sampling-Plus-1.0": {
    id: "LicenseRef-NC-Sampling-Plus-1.0",
    name: "CC NonCommercial Sampling+ 1.0",
    url: `${CC}/licenses/nc-sampling+/1.0/`,
    commercialUse: false,
    attributionRequired: true,
    redistribution: false,
    verdict: "no",
    note: "Non-commercial only.",
  },
  "LicenseRef-BBC-RemArc": {
    id: "LicenseRef-BBC-RemArc",
    name: "BBC RemArc licence",
    url: "https://sound-effects.bbcrewind.co.uk/licensing",
    commercialUse: false,
    attributionRequired: true,
    redistribution: false,
    verdict: "no",
    note: "Personal, educational or research use only. Commercial licences are sold through Pro Sound Effects.",
  },
  "LicenseRef-OGA-BY-3.0": {
    id: "LicenseRef-OGA-BY-3.0",
    name: "OGA-BY 3.0",
    url: "https://opengameart.org/content/oga-by-30-faq",
    commercialUse: true,
    attributionRequired: true,
    redistribution: true,
    verdict: "yes-with-credit",
    note: "OpenGameArt's CC BY variant without the DRM clause: credit the author.",
  },
  "LicenseRef-Personal-Use-Only": {
    id: "LicenseRef-Personal-Use-Only",
    name: "Personal use only",
    commercialUse: false,
    redistribution: false,
    verdict: "no",
    note: "Personal, non-commercial use only.",
  },
  "LicenseRef-Unknown": {
    id: "LicenseRef-Unknown",
    name: "No licence stated",
    verdict: "check-terms",
    note: "The source states no licence. Treat it as all rights reserved until you find one.",
  },
} as const satisfies Record<string, Base>;

export type KnownLicenseId = keyof typeof LICENSES;

/** Attach who asserted it. */
export function license(id: KnownLicenseId, assertedBy: License["assertedBy"] = "source"): License {
  return applyAssertion({ ...LICENSES[id], assertedBy });
}

/**
 * A Creative Commons licence from its parts. `version` like "4.0", "3.0".
 * Verdicts: BY → yes-with-credit, SA → restricted (the whole track must be
 * released under the same licence), NC or ND → no (a song using an ND sound is
 * a derivative work).
 */
export function creativeCommons(
  parts: { nc?: boolean; nd?: boolean; sa?: boolean },
  version = "4.0",
  assertedBy: License["assertedBy"] = "source",
): License {
  const slug = ["by", parts.nc && "nc", parts.nd && "nd", parts.sa && "sa"].filter(Boolean).join("-");
  const id = `CC-${slug.toUpperCase()}-${version}`;
  const name = `CC ${slug.toUpperCase().replace(/-/g, "-")} ${version}`;
  let verdict: CommercialVerdict = "yes-with-credit";
  let note: string | undefined = "Credit the author in your release notes or description.";
  if (parts.nc) {
    verdict = "no";
    note = "Non-commercial only.";
  } else if (parts.nd) {
    verdict = "no";
    note = "No derivatives: using it inside a track counts as a derivative.";
  } else if (parts.sa) {
    verdict = "restricted";
    note = "Share-alike: a track that uses it must be released under the same CC licence.";
  }
  return applyAssertion({
    id,
    name,
    url: `${CC}/licenses/${slug}/${version}/`,
    commercialUse: !parts.nc,
    attributionRequired: true,
    shareAlike: parts.sa || undefined,
    redistribution: !parts.nd,
    verdict,
    note,
    assertedBy,
  });
}

/**
 * A site's own royalty-free licence: usable in music, but the samples may not
 * be redistributed as samples.
 */
export function royaltyFree(
  name: string,
  opts: { url?: string; attributionRequired?: boolean; note?: string; assertedBy?: License["assertedBy"] } = {},
): License {
  const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return applyAssertion({
    id: `LicenseRef-${slug}`,
    name,
    url: opts.url,
    commercialUse: true,
    attributionRequired: opts.attributionRequired ?? false,
    redistribution: false,
    verdict: opts.attributionRequired ? "yes-with-credit" : "yes",
    note: opts.note ?? "Royalty free for use in your music; do not share the samples themselves.",
    assertedBy: opts.assertedBy ?? "site",
  });
}

/** A licence we can't classify: name it and tell the user to read it. */
export function customLicense(name: string, opts: { url?: string; verdict?: CommercialVerdict; note?: string; commercialUse?: boolean; attributionRequired?: boolean; assertedBy?: License["assertedBy"] } = {}): License {
  const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return applyAssertion({
    id: `LicenseRef-${slug || "Custom"}`,
    name,
    url: opts.url,
    commercialUse: opts.commercialUse,
    attributionRequired: opts.attributionRequired,
    redistribution: false,
    verdict: opts.verdict ?? "check-terms",
    note: opts.note ?? "Read the licence on the source page before using it.",
    assertedBy: opts.assertedBy ?? "site",
  });
}

/** An uploader's claim is never treated as a clean "yes": cap it at check-terms. */
function applyAssertion(l: License): License {
  if (l.assertedBy === "uploader" && (l.verdict === "yes" || l.verdict === "yes-with-credit")) {
    return {
      ...l,
      verdict: "check-terms",
      note: `Uploader states ${l.name}, which the source does not verify. ${l.note ?? ""}`.trim(),
    };
  }
  return l;
}

/**
 * Parse a licence URL or name as written by the source: Creative Commons URLs
 * ("https://creativecommons.org/licenses/by-nc/4.0/"), Freesound names
 * ("Attribution NonCommercial", "Creative Commons 0"), Openverse codes ("by-sa"),
 * Wikimedia short names ("CC BY-SA 4.0", "Public domain").
 * Returns undefined when nothing matches.
 */
export function parseLicense(input: string | undefined | null, assertedBy: License["assertedBy"] = "source"): License | undefined {
  if (!input) return undefined;
  const s = input.trim().toLowerCase();
  if (!s) return undefined;

  if (/nc-?sampling\s*(\+|plus)|non-?commercial sampling/.test(s)) return license("LicenseRef-NC-Sampling-Plus-1.0", assertedBy);
  if (/sampling\s*\+|sampling[\s-]*plus/.test(s)) return license("LicenseRef-Sampling-Plus-1.0", assertedBy);
  if (/\boga-?by\b/.test(s)) return license("LicenseRef-OGA-BY-3.0", assertedBy);
  if (/personal (use )?only|private use only|for personal use/.test(s)) return license("LicenseRef-Personal-Use-Only", assertedBy);
  if (/publicdomain\/zero|\bcc0\b|cc-?zero|creative commons 0/.test(s)) return license("CC0-1.0", assertedBy);
  if (/publicdomain\/mark|public ?domain|\bpdm\b|^pd\b|\bpd-/.test(s)) return license("CC-PDM-1.0", assertedBy);

  const url = /licenses\/([a-z-]+)\/(\d\.\d)/.exec(s);
  if (url) return ccFromSlug(url[1]!, url[2]!, assertedBy);

  const version = /(\d\.\d)/.exec(s)?.[1] ?? (/\b4\b/.test(s) ? "4.0" : /\b3\b/.test(s) ? "3.0" : undefined);
  const hasBy = /\bby\b|attribution/.test(s);
  if (hasBy) {
    return creativeCommons(
      {
        nc: /\bnc\b|non-?commercial/.test(s),
        nd: /\bnd\b|no ?deriv/.test(s),
        sa: /\bsa\b|share ?alike/.test(s),
      },
      version ?? "4.0",
      assertedBy,
    );
  }
  return undefined;
}

function ccFromSlug(slug: string, version: string, assertedBy: License["assertedBy"]): License | undefined {
  const parts = slug.split("-");
  if (parts[0] !== "by") return undefined;
  return creativeCommons({ nc: parts.includes("nc"), nd: parts.includes("nd"), sa: parts.includes("sa") }, version, assertedBy);
}

export const COMMERCIAL_SAFE: ReadonlySet<CommercialVerdict> = new Set(["yes", "yes-with-credit"]);

export function isCommercialSafe(l: License | undefined): boolean {
  return !!l && COMMERCIAL_SAFE.has(l.verdict);
}

/** "“Deep Kick 01” by Jane (Freesound), CC BY 4.0, https://…" */
export function attributionLine(s: Pick<Sample, "title" | "author" | "url" | "provider" | "license">, sourceName?: string): string | undefined {
  const l = s.license;
  if (!l || !l.attributionRequired) return undefined;
  const by = s.author ? ` by ${s.author}` : "";
  const from = sourceName ? ` (${sourceName})` : "";
  const lic = l.url ? `${l.name} (${l.url})` : l.name;
  return `“${s.title}”${by}${from}, ${s.url}, licensed under ${lic}`;
}

/** Plain-language badge text for each verdict. */
export const VERDICT_LABELS: Record<CommercialVerdict, string> = {
  yes: "Commercial use OK",
  "yes-with-credit": "Commercial use OK with credit",
  restricted: "Restricted: read the conditions",
  "clearance-required": "Needs paid clearance per release",
  "check-terms": "Unclear: check the terms",
  no: "Non-commercial only",
};
