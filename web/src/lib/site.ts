import organization from "@/data/organization.json";
import providers from "@/data/providers.json";

// Optional data files (written by scripts/export-site-data.mjs and scripts/census.mjs).
const optional = import.meta.glob<unknown>("../data/integrations.json", { eager: true, import: "default" });
const integrations = (optional["../data/integrations.json"] as { integrations: Integration[] } | undefined)?.integrations ?? [];

export const SITE = {
  name: "Sound Server",
  shortName: "Sounds",
  url: (import.meta.env.SITE as string | undefined)?.replace(/\/$/, "") ?? "https://sound.shep.bot",
  tagline: "One search for free music samples, with the licence on every sound",
  homeTitle: "Sound Server: Search Free Music Samples, Drums, Vocals & FX",
  description: `Search ${providers.length} sample sites at once for free kicks, snares, 808s, loops, vocals and FX, and see if each sound is cleared for a commercial release. Web, API and MCP.`,
  repo: "https://github.com/arielshad/sound-server",
  image: "/og.png",
  locale: "en_US",
};

/** Who runs the site. Fill `email` / `address` in organization.json to publish them. */
export const ORG = organization as {
  name: string;
  url: string;
  contactUrl: string;
  issuesUrl: string;
  securityUrl: string;
  email: string | null;
  address: { streetAddress?: string; addressLocality?: string; postalCode?: string; addressRegion?: string; addressCountry: string } | null;
};

export interface Provider {
  id: string;
  name: string;
  homepage: string;
  description: string;
  /** Top-level categories the source carries. */
  categories: string[];
  forms?: string[];
  access: "api" | "static" | "scrape" | "link";
  pricing: "free" | "freemium" | "paid";
  /** Licence name when the whole source uses one. */
  license: string | null;
  /** Its verdict, when the source has one licence. */
  licenseVerdict?: string | null;
  supportsDownload: boolean;
}
export interface Integration {
  id: string;
  name: string;
  homepage: string;
  addedAt: string;
  addedBy?: string;
}

export const PROVIDERS = (providers as unknown as Provider[]).map((p) => ({ ...p, categories: p.categories ?? [] }));
export const SOURCE_COUNT = PROVIDERS.length;
/** Sources searched directly (everything except deep links). */
export const SEARCHED = PROVIDERS.filter((p) => p.access !== "link");
export const LINKED = PROVIDERS.filter((p) => p.access === "link");
export const DIRECT_DOWNLOAD_COUNT = PROVIDERS.filter((p) => p.supportsDownload).length;

/** Sources by date added, newest first (from integrations/registry.json). */
export const INTEGRATIONS: Integration[] = integrations;

/** Share-card path for a route: "/" -> /og/home.png, "/docs/api" -> /og/docs-api.png. */
export function ogImagePath(route: string): string {
  const slug = route === "/" ? "home" : route.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
  return `/og/${slug}.png`;
}

export const MCP_URL = `${SITE.url}/mcp`;
/** Name agents register the MCP server under. */
export const MCP_NAME = "sounds";

export const NAV = [
  { href: "/search", label: "Search" },
  { href: "/kit", label: "Kit builder" },
  { href: "/samples", label: "Collections" },
  { href: "/guides", label: "Guides" },
  { href: "/docs", label: "Docs" },
  { href: "/docs/mcp", label: "AI agents" },
  { href: "/docs/api", label: "API" },
  { href: "/docs/licences", label: "Licences" },
];

export const DOCS_NAV = [
  {
    title: "Get started",
    items: [
      { href: "/docs", label: "Quick start" },
      { href: "/docs/mcp", label: "Coding agents & MCP" },
      { href: "/docs/api", label: "REST API guide" },
      { href: "/docs/api/reference", label: "API reference" },
      { href: "/docs/api/playground", label: "API playground" },
      { href: "/docs/cli", label: "CLI" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/licences", label: "Sample licences explained" },
      { href: "/docs/sources", label: "Sources & licences" },
      { href: "/docs/faq", label: "FAQ" },
      { href: "/guides", label: "Guides" },
      { href: "/glossary", label: "Glossary" },
      { href: "/docs/api/versioning", label: "Versioning & rate limits" },
      { href: "/docs/self-hosting", label: "Self-hosting" },
      { href: "/AGENTS.md", label: "AGENTS.md (for agents)" },
      { href: "/llms.txt", label: "llms.txt" },
    ],
  },
];
