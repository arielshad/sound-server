/**
 * Checks the built website (dist/web) for the machine-readable promises the
 * site makes to agents. Runs after `npm run build` (as in CI); skipped when
 * the site has not been built.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../dist/web/", import.meta.url);
const built = existsSync(new URL("index.html", root));
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const data = <T>(p: string, fallback: T): T => {
  const file = new URL(`../web/src/data/${p}`, import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
};
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<header[\s\S]*?<\/header>/g, "")
    .replace(/<footer[\s\S]*?<\/footer>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const jsonLd = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!) as { "@graph": Record<string, unknown>[] };

describe.skipIf(!built)("built website", () => {
  it.each(["about", "contact", "privacy"])("has a substantial /%s trust page with a Markdown twin", (page) => {
    expect(text(read(`${page}/index.html`)).length).toBeGreaterThan(500);
    expect(read(`${page}.md`).length).toBeGreaterThan(500);
  });

  it("lists the trust and policy pages in the sitemap", () => {
    const sitemap = read("sitemap-0.xml");
    for (const p of ["/about", "/contact", "/privacy", "/docs/api/versioning", "/docs/cli"]) expect(sitemap).toContain(`https://sound.shep.bot${p}<`);
  });

  it("gives agents when-to-use guidance in llms.txt (llmstxt.org layout) and AGENTS.md", () => {
    const llms = read("llms.txt");
    expect(llms.startsWith("# Sound Server\n\n> ")).toBe(true);
    const beforeSections = llms.slice(0, llms.indexOf("\n## "));
    expect(beforeSections).toContain("When to use Sound Server");
    expect(beforeSections).not.toMatch(/\n#{1,6} /); // free-form part has no headings
    expect(llms).toContain("/about.md");
    const agents = read("AGENTS.md");
    expect(agents).toContain("## When to use this");
    expect(agents).toContain("## When not to use it");
  });

  it("publishes an Organization with contact points", () => {
    const org = jsonLd(read("index.html"))["@graph"].find((n) => n["@type"] === "Organization") as { contactPoint: { url: string }[] };
    expect(org.contactPoint.length).toBeGreaterThan(0);
    expect(org.contactPoint[0]!.url).toBe("https://sound.shep.bot/contact");
  });

  it("documents versioning, deprecation and rate limits", () => {
    const page = text(read("docs/api/versioning/index.html"));
    for (const term of ["Deprecation", "Sunset", "Retry-After", "RateLimit-Policy", "90 days"]) expect(page).toContain(term);
  });

  it("names the product in the homepage title and H1", () => {
    const home = read("index.html");
    expect(home).toMatch(/<title>Sound Server[^<]*<\/title>/);
    expect(home.match(/<h1[\s\S]*?<\/h1>/)![0]).toContain("Sound Server");
  });

  it("has no duplicate ids and labels every form control", () => {
    for (const page of ["index.html", "search/index.html", "docs/api/reference/index.html", "docs/mcp/index.html"]) {
      const html = read(page);
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), page).toEqual([]);
    }
    const search = read("search/index.html");
    for (const input of search.match(/<input\b[^>]*>/g) ?? []) {
      if (/type="hidden"/.test(input)) continue;
      expect(/aria-label=|aria-labelledby=|title=/.test(input) || search.includes(`<label`), input).toBe(true);
    }
    expect(search).not.toMatch(/<button[^>]*role="switch"/); // switches are native, labelled checkboxes
  });

  it("serves the product screenshot as AVIF and WebP with a PNG fallback", () => {
    const home = read("index.html");
    expect(home).toContain('<source type="image/avif" srcset="/img/search-preview.avif"');
    expect(home).toContain('<source type="image/webp" srcset="/img/search-preview.webp"');
    expect(home).toMatch(/<img[^>]+src="\/img\/search-preview\.png"[^>]+width="1280"[^>]+height="800"/);
    for (const ext of ["avif", "webp", "png"]) expect(existsSync(new URL(`img/search-preview.${ext}`, root))).toBe(true);
  });

  it("keeps the API playground out of crawls and renders the full reference statically", () => {
    const robots = read("robots.txt").replace(/\r\n/g, "\n");
    expect(robots).toMatch(/User-agent: \*\nDisallow: \/v1\/samples\/\*\/download\nDisallow: \/v1\/samples\/\*\/preview\nDisallow: \/docs\/api\/playground/);
    expect(robots).not.toContain("Allow: /");
    expect(read("sitemap-0.xml")).not.toContain("playground");
    const reference = read("docs/api/reference/index.html");
    for (const id of ["searchSamples", "getSample", "selectFiles", "downloadSample", "getPreview", "buildKit", "listProviders", "mcp"]) expect(reference).toContain(`id="op-${id}"`);
    for (const schema of ["sample", "samplefile", "license", "searchresponse", "providersearchreport", "kit"]) expect(reference).toContain(`id="schema-${schema}"`);
    expect(read("docs/api/playground/index.html")).toContain('content="noindex, follow"');
  });

  it("publishes a /stats page with a Markdown twin, footer link and llms.txt entry", () => {
    const html = read("stats/index.html");
    expect(html).toMatch(/<h1[^>]*>[^<]* in numbers<\/h1>/);
    expect(html).toContain("StatsDashboard"); // the live island
    expect(read("sitemap-0.xml")).toContain("https://sound.shep.bot/stats<");
    expect(read("index.html")).toContain('href="/stats"');
    expect(read("stats.md")).toContain("/v1/stats");
    expect(read("llms.txt")).toContain("https://sound.shep.bot/stats.md");
  });

  it("states the same source count everywhere", async () => {
    const { allProviders } = await import("../src/providers/index.js");
    const n = allProviders.length;
    const files = ["index.html", "docs/index.html", "about.md", "docs/mcp.md", "docs/api.md", "docs/cli.md", "AGENTS.md", "skill/SKILL.md", "llms.txt", "stats/index.html"];
    const sources = [...files.map((f) => [f, read(f)]), ["README.md", readFileSync(new URL("../README.md", import.meta.url), "utf8")]];
    for (const [f, body] of sources) {
      for (const m of body!.matchAll(/\b(\d+) (?:music )?(?:sample |sound )?sites\b/g)) expect(`${f}: ${m[0]}`).toBe(`${f}: ${m[1] === String(n) ? m[0] : `${n} … sites`}`);
    }
  });

  it("gives every page its own 1200×630 share card, alt text and schema image", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const sharp = (await import("sharp")).default;
    const pages: string[] = [];
    const walk = (dir: URL) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(new URL(`${e.name}/`, dir));
        else if (e.name === "index.html" || e.name === "404.html") pages.push(new URL(e.name, dir).pathname.slice(root.pathname.length));
      }
    };
    walk(root);
    expect(pages.length).toBeGreaterThan(10);
    const images = new Set<string>();
    for (const page of pages) {
      const html = read(page);
      const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
      expect(image, page).toMatch(/^https:\/\/sound\.shep\.bot\/og\/[a-z0-9-]+\.png$/);
      images.add(image!);
      const file = new URL(`.${new URL(image!).pathname}`, root);
      expect(statSync(file).size, image).toBeGreaterThan(10_000);
      expect(await sharp(fileURLToPath(file)).metadata(), image).toMatchObject({ width: 1200, height: 630, format: "png" });
      for (const tag of ['property="og:image:alt"', 'name="twitter:image:alt"', 'property="og:image:type" content="image/png"', 'name="twitter:card" content="summary_large_image"']) {
        expect(html, `${page} ${tag}`).toContain(tag);
      }
      const nodes = jsonLd(html)["@graph"];
      const img = nodes.find((n) => n["@type"] === "ImageObject");
      expect(img?.url, page).toBe(image);
      expect(nodes.some((n) => (n.primaryImageOfPage as { "@id"?: string } | undefined)?.["@id"] === img?.["@id"] || (n.image as { "@id"?: string } | undefined)?.["@id"] === img?.["@id"]), page).toBe(true);
    }
    expect(images.size).toBe(pages.length); // one card per page
    expect(statSync(new URL("og.png", root)).size).toBeGreaterThan(10_000); // legacy URL still served
    expect(read("docs/mcp/index.html")).toContain('<meta property="article:section" content="Docs"');
  });

  it("publishes the catalog census on /stats, the homepage, llms.txt and as JSON", () => {
    const catalog = JSON.parse(read("catalog.json")) as { countedAt: string; totals: { listings: { count: number }; free: { count: number } }; sources: { id: string }[] };
    expect(catalog.sources.length).toBeGreaterThan(5);
    expect(JSON.parse(read("catalog-history.json")).length).toBeGreaterThan(0);
    const stats = read("stats/index.html");
    const listings = catalog.totals.listings.count.toLocaleString("en");
    expect(text(stats)).toContain(listings);
    expect(stats).toContain("Copy quote");
    expect(stats).toMatch(/As of [A-Z][a-z]+ \d+, \d{4}, Sound Server searches/);
    const dataset = jsonLd(stats)["@graph"].find((n) => n["@type"] === "Dataset") as { distribution: { contentUrl: string }[] } | undefined;
    expect(dataset?.distribution.map((d) => d.contentUrl)).toEqual(["https://sound.shep.bot/catalog.json", "https://sound.shep.bot/catalog-history.json"]);
    expect(read("index.html")).toMatch(/free (?:music )?samples/i);
    expect(read("llms.txt")).toMatch(/\*\*Catalog \(counted \d{4}-\d{2}-\d{2}\)\.\*\* [\d,]+\+? (?:sample )?listings/);
    const md = read("stats.md");
    expect(md).toMatch(/^# .+ in numbers$/m);
    expect(md).toContain(`| ${listings}`.slice(0, 2)); // the by-source table
    expect(md).toContain("/v1/catalog");
  });

  describe("pages for people and answer engines", () => {
    type Page = { route: string; file: string; html: string };
    const pages: Page[] = (() => {
      if (!built) return [];
      const out: Page[] = [];
      const walk = (dir: URL) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(new URL(`${e.name}/`, dir));
          else if (e.name === "index.html") {
            const file = new URL(e.name, dir).pathname.slice(root.pathname.length);
            out.push({ route: "/" + file.replace(/(^|\/)index\.html$/, ""), file, html: read(file) });
          }
        }
      };
      walk(root);
      return out.map((p) => ({ ...p, route: p.route === "/" ? "/" : p.route.replace(/\/$/, "") }));
    })();
    const indexable = () => pages.filter((p) => !p.html.includes('content="noindex'));
    const attr = (html: string, re: RegExp) => html.match(re)?.[1]?.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const guideSlugs = (() => {
      const dir = new URL("../web/src/content/guides/", import.meta.url);
      return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : [];
    })();
    const types = (html: string) => jsonLd(html)["@graph"].flatMap((n) => [n["@type"]].flat()) as string[];

    it("gives every page one H1, a canonical URL, parseable JSON-LD and a Markdown twin", () => {
      expect(pages.length).toBeGreaterThan(100);
      for (const p of pages) {
        expect((p.html.match(/<h1\b/g) ?? []).length, p.route).toBe(1);
        expect(attr(p.html, /<link rel="canonical" href="([^"]+)"/), p.route).toBe(`https://sound.shep.bot${p.route === "/" ? "/" : p.route}`.replace(/\/$/, p.route === "/" ? "/" : ""));
        expect(() => jsonLd(p.html), p.route).not.toThrow();
        const twin = p.route === "/" ? "AGENTS.md" : `${p.route.slice(1)}.md`;
        expect(existsSync(new URL(twin, root)), `${p.route} -> ${twin}`).toBe(true);
        const alt = attr(p.html, /<link rel="alternate" type="text\/markdown" href="([^"]+)"/);
        expect(alt, p.route).toBe(p.route === "/" ? "/AGENTS.md" : `${p.route}.md`);
      }
    });

    it("gives indexable pages unique titles and descriptions of a useful length", () => {
      const titles = new Map<string, string>();
      const descriptions = new Map<string, string>();
      for (const p of indexable()) {
        const title = attr(p.html, /<title>([^<]*)<\/title>/)!;
        const description = attr(p.html, /<meta name="description" content="([^"]*)"/)!;
        expect(title.length, `${p.route}: ${title}`).toBeLessThanOrEqual(70);
        expect(description.length, `${p.route}: ${description}`).toBeGreaterThanOrEqual(70);
        expect(description.length, `${p.route}: ${description}`).toBeLessThanOrEqual(160);
        expect(titles.get(title), `${p.route} repeats the title of ${titles.get(title)}`).toBeUndefined();
        expect(descriptions.get(description), `${p.route} repeats the description of ${descriptions.get(description)}`).toBeUndefined();
        titles.set(title, p.route);
        descriptions.set(description, p.route);
      }
    });

    it("lists exactly the indexable pages in the sitemap", () => {
      const sitemap = read("sitemap-0.xml");
      const urls = new Set([...sitemap.matchAll(/<loc>https:\/\/sound\.shep\.bot([^<]*)<\/loc>/g)].map((m) => m[1] || "/"));
      for (const p of indexable()) expect(urls.has(p.route), `${p.route} missing from the sitemap`).toBe(true);
      for (const p of pages.filter((x) => x.html.includes('content="noindex'))) expect(urls.has(p.route), `${p.route} is noindex but in the sitemap`).toBe(false);
    });

    it("has no broken internal links", () => {
      const exists = (path: string) => {
        const clean = decodeURIComponent(path.split(/[?#]/)[0]!.replace(/\/$/, "")) || "/";
        if (/^\/(v1|mcp|og)\b/.test(clean) || clean === "/openapi.json") return true; // served by the API
        if (clean === "/") return true;
        return existsSync(new URL(`.${clean}/index.html`, root)) || existsSync(new URL(`.${clean}`, root));
      };
      const broken: string[] = [];
      for (const p of pages) {
        for (const m of p.html.matchAll(/<a\b[^>]*\shref="(\/[^"]*)"/g)) if (!m[1]!.startsWith("//") && !exists(m[1]!.replace(/&amp;/g, "&"))) broken.push(`${p.route} -> ${m[1]}`);
      }
      expect(broken).toEqual([]);
    });

    it.skipIf(!guideSlugs.length)("publishes every guide answer-first, with schema, a twin, a sitemap date and an llms.txt entry", () => {
      expect(guideSlugs.length).toBeGreaterThanOrEqual(10);
      const llms = read("llms.txt");
      const full = read("llms-full.txt");
      const sitemap = read("sitemap-0.xml");
      for (const slug of guideSlugs) {
        const html = read(`guides/${slug}/index.html`);
        expect(html, slug).toContain("Short answer");
        const t = types(html);
        expect(t, slug).toEqual(expect.arrayContaining(["Article", "BreadcrumbList"]));
        const articleNode = jsonLd(html)["@graph"].find((n) => n["@type"] === "Article") as { abstract: string; datePublished: string; author: unknown };
        expect(articleNode.abstract.length, slug).toBeGreaterThan(80);
        expect(articleNode.datePublished, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (html.includes('id="steps"')) expect(t, slug).toContain("HowTo");
        if (html.includes('id="faq"')) expect(t, slug).toContain("FAQPage");
        expect(html, slug).toMatch(/href="\/search\?[^"]+"/); // links into live searches
        const md = read(`guides/${slug}.md`);
        expect(md, slug).toMatch(/^# .+\n\n> .{80,}/);
        expect(llms, slug).toContain(`https://sound.shep.bot/guides/${slug}.md`);
        expect(full, slug).toContain(md.split("\n")[0]!);
        expect(sitemap, slug).toMatch(new RegExp(`/guides/${slug}</loc><lastmod>\\d{4}-`));
      }
      expect(read("guides/index.html")).toContain(`href="/guides/${guideSlugs[0]}"`);
      expect(read("guides.md")).toContain(`/guides/${guideSlugs[0]}.md`);
      expect(read("AGENTS.md")).toContain("/guides/");
      expect(read("skill/SKILL.md")).toContain("/guides/");
    });

    it("publishes a glossary as a DefinedTermSet with linkable terms", () => {
      const html = read("glossary/index.html");
      const set = jsonLd(html)["@graph"].find((n) => n["@type"] === "DefinedTermSet") as { hasDefinedTerm: { "@id": string; name: string }[] };
      expect(set.hasDefinedTerm.length).toBeGreaterThanOrEqual(30);
      for (const term of set.hasDefinedTerm) expect(html, term.name).toContain(`id="${term["@id"].split("#")[1]}"`);
      for (const name of ["One-shot", "BPM", "CC0", "CC BY", "Sampling+", "SFZ", "General MIDI", "Strudel"]) expect(set.hasDefinedTerm.map((t) => t.name)).toContain(name);
      expect(read("glossary.md")).toContain("### Sample rate");
      expect(read("llms.txt")).toContain("https://sound.shep.bot/glossary.md");
      expect(read("sitemap-0.xml")).toContain("https://sound.shep.bot/glossary<");
    });

    it("publishes a FAQ whose FAQPage markup matches the questions on the page", () => {
      const html = read("docs/faq/index.html");
      const faq = jsonLd(html)["@graph"].find((n) => n["@type"] === "FAQPage") as { mainEntity: { name: string }[] };
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(15);
      const shown = text(html).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      for (const q of faq.mainEntity) expect(shown).toContain(q.name);
      expect(read("docs/faq.md").match(/^### /gm)!.length).toBe(faq.mainEntity.length);
      expect(read("llms.txt")).toContain("https://sound.shep.bot/docs/faq.md");
    });

    it("gives hubs and searched sources substantial copy and structured data", () => {
      for (const hub of data<{ id: string; faq?: unknown[] }[]>("collection-hubs.json", [])) {
        const html = read(`samples/${hub.id}/index.html`);
        expect(text(html).split(" ").length, hub.id).toBeGreaterThan(400);
        if (hub.faq?.length) expect(types(html), hub.id).toContain("FAQPage");
      }
      const notes = data<Record<string, unknown>>("source-notes.json", {});
      for (const id of Object.keys(notes)) {
        const html = read(`sources/${id}/index.html`);
        expect(html, id).toContain('content="index, follow');
        expect(html, id).toContain("How Sound Server searches it");
        expect(types(html), id).toContain("WebSite");
        expect(read(`sources/${id}.md`), id).toContain("## Licence");
      }
    });
  });

  describe("collections", () => {
    // Collections live at /samples/<slug>, hubs at /samples/<hub>; the first
    // indexable snapshot stands in for all of them (the set changes weekly).
    type Snap = { slug: string; samples: { provider: string }[] };
    const snapshots: Snap[] = (() => {
      const dir = new URL("../web/src/data/collections/", import.meta.url);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Snap);
    })();
    const page = snapshots.find((s) => s.samples.length >= 12 && new Set(s.samples.map((a) => a.provider)).size >= 2);
    const hubs = data<{ id: string }[]>("collection-hubs.json", []);
    const providers = data<{ id: string; access: string }[]>("providers.json", []);
    const sitemap = () => read("sitemap-0.xml");
    const entry = (path: string) => sitemap().match(new RegExp(`<url><loc>https://sound\\.shep\\.bot${path}</loc>(.*?)</url>`))?.[1];

    it.skipIf(!page)("pre-renders a collection with its samples, previews, copy, FAQ and structured data", () => {
      const html = read(`samples/${page!.slug}/index.html`);
      expect(html).toContain('content="index, follow');
      expect((html.match(/href="\/search\?sample=/g) ?? []).length).toBeGreaterThanOrEqual(12);
      expect((html.match(/<audio\b|data-preview=/g) ?? []).length).toBeGreaterThanOrEqual(1);
      const graph = jsonLd(html)["@graph"];
      expect(graph.map((n) => n["@type"])).toEqual(expect.arrayContaining(["CollectionPage", "BreadcrumbList", "FAQPage"]));
      const col = graph.find((n) => n["@type"] === "CollectionPage") as { dateModified: string; mainEntity: { numberOfItems: number } };
      expect(col.mainEntity.numberOfItems).toBeGreaterThanOrEqual(12);
      expect(col.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(read(`samples/${page!.slug}.md`)).toMatch(/\| `[a-z0-9-]+:/);
      expect(read("llms.txt")).toContain(`https://sound.shep.bot/samples/${page!.slug}.md`);
      expect(entry(`/samples/${page!.slug}`)).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
    });

    it("publishes the hubs and the index, each with a Markdown twin", () => {
      expect(hubs.length).toBeGreaterThan(0);
      for (const p of ["samples", ...hubs.map((h) => `samples/${h.id}`)]) {
        expect(text(read(`${p}/index.html`)).length, p).toBeGreaterThan(500);
        expect(read(`${p}.md`).length, p).toBeGreaterThan(300);
      }
      expect(entry(`/samples/${hubs[0]!.id}`)).toContain("<lastmod>");
    });

    it("dates only what it can date in the sitemap", () => {
      expect(entry("/stats")).toContain("<lastmod>");
      expect(entry("/docs/mcp")).not.toContain("<lastmod>");
      expect(entry("/")).not.toContain("<lastmod>");
    });

    it("keeps thin source pages out of the index and the sitemap", () => {
      const linked = providers.find((p) => p.access === "link");
      if (!linked) return;
      expect(read(`sources/${linked.id}/index.html`)).toContain('content="noindex, follow"');
      expect(sitemap()).not.toContain(`/sources/${linked.id}<`);
      expect(read("docs/sources/index.html")).toContain(`href="/sources/${linked.id}"`);
    });
  });
});
