// Renders a 1200×630 Open Graph card for every built page, after `astro build`.
//
// Each page's <head> already names its card (`og:image` = /og/<slug>.png, see
// BaseLayout.astro) and carries the text; this reads the title, description
// and route from the built HTML and draws the card with the server's renderer
// (dist/og/render.js, built by `tsc` before the website): `pageCard` for
// every page here; share links of single samples use `sampleCard` at request time. /og.png, the old
// site-wide card, is kept as a copy of the home card for links already shared.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Label above the title, by route (most specific first). Hub kickers come from collection-hubs.json. */
const KICKERS = [
  ["/docs/api/reference", "API reference"],
  ["/docs/api/playground", "API playground"],
  ["/docs/api/versioning", "API policy"],
  ["/docs/api", "REST API"],
  ["/docs/mcp", "AI agents · MCP"],
  ["/docs/cli", "Command line"],
  ["/docs/self-hosting", "Self-hosting"],
  ["/docs/sources", "Sources & licences"],
  ["/docs/licences", "Licences"],
  ["/docs/faq", "FAQ"],
  ["/docs", "Docs"],
  ["/stats", "Live stats"],
  ["/kit", "Kit builder"],
  ["/glossary", "Glossary"],
  ["/samples", "Sample collections"],
  ["/sources", "Source"],
  ["/search", "Search"],
  ["/about", "About"],
  ["/contact", "Contact"],
  ["/privacy", "Privacy"],
  ["/404", "404"],
];

const CHIPS = {
  "/glossary": ["One-shot", "BPM", "CC0", "CC BY", "SFZ"],
  "/docs/faq": ["Licences", "Downloads", "API", "Agents"],
  "/guides": ["Licences", "Credits", "808s", "BPM & key"],
  "/docs/mcp": ["MCP", "Claude Code", "Cursor", "Copilot"],
  "/docs/api": ["REST", "OpenAPI 3.1", "JSON"],
  "/docs/api/reference": ["OpenAPI 3.1", "Schemas", "curl"],
  "/docs/api/playground": ["Try it live", "OpenAPI 3.1"],
  "/docs/api/versioning": ["/v1", "RateLimit headers", "Deprecation"],
  "/docs/cli": ["CLI", "stdio MCP", "Docker"],
  "/docs/self-hosting": ["Docker", "ffmpeg", "Prometheus"],
  "/docs/licences": ["CC0", "CC BY", "Royalty free", "Verdicts"],
  "/kit": ["Kick", "Snare", "Hats", "808", "Strudel"],
  "/stats": ["Samples by category", "Every source", "Live usage"],
};

const attr = (html, re) => {
  const m = html.match(re);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : undefined;
};

function* htmlFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(full);
    else if (e.name.endsWith(".html")) yield full;
  }
}

export default function ogImages() {
  return {
    name: "og-images",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const { pageCard, renderPng } = await import(new URL("../../dist/og/render.js", import.meta.url).href);
        const providers = JSON.parse(readFileSync(join(root, "src/data/providers.json"), "utf8"));
        const searched = providers.filter((p) => p.access !== "link");
        const catalogFile = join(root, "src/data/catalog.json");
        const totals = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, "utf8")).totals : undefined;
        const hubs = JSON.parse(readFileSync(join(root, "src/data/collection-hubs.json"), "utf8"));
        // Guides: "Guide · Licensing" from each guide's frontmatter.
        const guidesDir = join(root, "src/content/guides");
        const guideKickers = existsSync(guidesDir)
          ? readdirSync(guidesDir)
              .filter((f) => f.endsWith(".md"))
              .map((f) => [`/guides/${f.slice(0, -3)}`, `Guide · ${readFileSync(join(guidesDir, f), "utf8").match(/^section:\s*"?([^"\n]+)"?\s*$/m)?.[1] ?? "Guide"}`])
          : [];
        const kickers = [...guideKickers, ["/guides", "Guides"], ...hubs.map((h) => [`/samples/${h.id}`, h.name]), ...KICKERS];
        const big = (c) => (c.count >= 1e6 ? `${Math.floor(c.count / 1e5) / 10}M` : c.count >= 1e4 ? `${Math.floor(c.count / 1e3)}K` : c.count.toLocaleString("en")) + (c.atLeast || c.count >= 1e4 ? "+" : "");
        const out = fileURLToPath(dir);
        const started = Date.now();
        let count = 0;
        for (const file of htmlFiles(out)) {
          const html = readFileSync(file, "utf8");
          const image = attr(html, /<meta property="og:image" content="([^"]+)"/);
          if (!image) continue;
          const { pathname, host } = new URL(image);
          if (!pathname.startsWith("/og/")) continue;
          const rel = relative(out, file).replace(/\\/g, "/");
          const route = "/" + rel.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "");
          const title = (attr(html, /<meta property="og:title" content="([^"]+)"/) ?? "").replace(/ · Sound Server$/, "");
          const description = attr(html, /<meta property="og:description" content="([^"]+)"/) ?? "";
          const kicker = kickers.find(([prefix]) => route === prefix || route.startsWith(prefix + "/"))?.[1];
          const card =
            route === "/"
              ? pageCard({
                  title: "One search for every",
                  highlight: "free music sample",
                  subtitle: `${totals?.free?.count ? `${big(totals.free)} free sounds` : "Drums, 808s, loops, vocals and FX"} from ${providers.length} sites · a licence verdict on every sample · API & MCP for AI agents`,
                  chips: searched.slice(0, 4).map((p) => p.name),
                  site: host,
                })
              : pageCard({
                  kicker,
                  title,
                  subtitle: description,
                  chips:
                    CHIPS[route] ??
                    (route === "/docs/sources" || route === "/search"
                      ? searched.slice(0, 4).map((p) => p.name)
                      : route.startsWith("/samples")
                        ? ["Free", "Play every sound", "Licence verdicts", "Updated daily"]
                        : route.startsWith("/sources/")
                          ? ["Search", "Licences", "Previews"]
                          : route.startsWith("/guides/")
                            ? ["Short answer", "Licences", "Live searches"]
                            : ["Drums", "808s", "Vocals", "FX"]),
                  site: host,
                });
          const png = await renderPng(card);
          const target = join(out, pathname);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, png);
          if (route === "/") writeFileSync(join(out, "og.png"), png);
          count++;
        }
        logger.info(`rendered ${count} Open Graph cards in ${Date.now() - started} ms`);
      },
    },
  };
}
