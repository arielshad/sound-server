import type { Category, License, Pricing, Provider, SampleForm, SampleQuery } from "../core/types.js";

export interface LinkProviderSpec {
  id: string;
  name: string;
  homepage: string;
  description: string;
  categories: Category[];
  forms?: SampleForm[];
  pricing: Pricing;
  license?: License;
  buildSearchUrl(q: SampleQuery): string;
}

/**
 * Provider for sites that block automated access (Cloudflare/bot walls), or
 * whose robots.txt or terms forbid it. Search returns no samples, only a deep
 * link to the site's own search so agents and users can continue there.
 */
export function linkProvider(spec: LinkProviderSpec): Provider {
  return {
    ...spec,
    access: "link",
    supportsDownload: false,
    async search(q) {
      return { samples: [], searchUrl: spec.buildSearchUrl(q) };
    },
  };
}

/** The words to put in a site's search box: the text plus the BPM and key we parsed out. */
export function linkTerms(q: SampleQuery): string {
  const parts = [q.query.trim()];
  if (q.bpm?.min && q.bpm.min === q.bpm.max) parts.push(`${q.bpm.min} bpm`);
  if (q.key) parts.push(q.key.mode ? `${q.key.tonic} ${q.key.mode}` : q.key.tonic);
  return parts.filter(Boolean).join(" ");
}
