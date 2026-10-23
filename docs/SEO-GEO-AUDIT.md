# SEO & GEO audit: sound.shep.bot

Audit of the public site before and after the SEO and GEO pass. *SEO* covers classic search engines;
*GEO* (generative engine optimisation) covers AI answer engines and agents: ChatGPT, Claude,
Perplexity, Gemini, Copilot and coding agents that read the web.

The site was ported from [3d.shep.bot](https://3d.shep.bot), whose own audit
(`3d-asset-server/docs/SEO-GEO-AUDIT.md`) shipped the technical groundwork. This pass checked every item
of that audit against Sound Server, fixed what was missing, and added the content the port lacked.

## Before

The port brought over the technical base intact: pre-rendered Astro pages, canonical URLs and trailing-slash
redirects, a sitemap with honest `lastmod`, per-page share cards, hashed CSP, HSTS, Brotli, `robots.txt` naming
the AI crawlers, `llms.txt`, `llms-full.txt`, `AGENTS.md`, the Claude Code skill, Markdown content negotiation
and JSON-LD (`WebSite` + `SearchAction`, `Organization`, `WebApplication`, `WebAPI`, `FAQPage`,
`CollectionPage`, `Dataset`). What it lacked was content and a few page-level details.

Crawl of a local production build (our own fetch-based crawler, see "Crawl audit" below):

| Area | Finding | Impact |
|---|---|---|
| Content depth | 74 pages built, **44 indexable**: 8 indexable collections, 7 hubs of ~150 words, source pages of 60–90 words | Little to rank for beyond the brand; thin hubs |
| Answer content | No guides, no glossary, one 6-question FAQ on the home page | Nothing for answer engines to quote on "can I use Freesound samples commercially?", "what is an 808?" |
| Markdown twins | `/kit`, `/search`, `/docs/api/reference`, `/docs/api/playground` answered `Accept: text/markdown` with HTML | Agents got markup instead of text on 4 pages |
| Meta lengths | Descriptions over 160 characters on `/`, `/search`, `/docs/licences`, `/privacy`; sample share pages (`/search?sample=…`) with titles up to 112 and descriptions up to 200 characters | Truncated snippets (239 crawler warnings) |
| Source pages | Freesound, Openverse and other searched sources were `noindex` whenever the census or the collections had no samples from them | The most important sources had no landing page |
| Accessibility | Inline links underlined only on hover (`link-in-text-block`) on `/`, `/kit`, `/stats`, collection pages; hub cards jumped from `h1` to `h3` | Lighthouse accessibility 96–98 |
| Performance | The hero's animated grid (React + motion, `client:only`) re-rendered constantly: 2.4 s total blocking time on mobile | Lighthouse performance 71 on `/` |

Lighthouse 12.8, mobile emulation, local build, before:

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/` | 71 | 97 | 100 | 100 |
| `/search` | 100 | 100 | 100 | 100 |
| `/docs/mcp` | 100 | 100 | 100 | 100 |
| `/samples` | 100 | 100 | 100 | 100 |
| `/samples/drums` | 100 | 98 | 100 | 100 |
| `/samples/free-kick-samples` | 100 | 96 | 100 | 100 |
| `/sources/freesound` | 100 | 100 | 100 | 66 (noindex) |
| `/kit` | 98 | 96 | 100 | 100 |
| `/stats` | 99 | 96 | 100 | 100 |

## Fixes shipped

### Checklist from the 3D audit

| 3D item | Sound Server |
|---|---|
| Pre-rendered HTML, one canonical URL, 301 for trailing slashes | Already ported; verified on all 137 pages |
| `robots.txt` with named AI crawlers, one `*` group | Ported; added Amazonbot, DuckAssistBot, MistralAI-User and CCBot to the AI group |
| XML sitemap with real `lastmod` | Ported; guides now carry their `updated` date, `/guides` the newest guide; source pages with editorial notes are listed |
| Real 404, caching, Brotli, security headers, hashed CSP, HSTS | Already ported (`src/api/site.ts`, `src/api/app.ts`) |
| Unique titles ≤ 70, descriptions 70–160 | Fixed 4 static pages; `search-meta.ts` now keeps share-page titles ≤ 70 and descriptions ≤ 160 (`MAX_TITLE`, `MAX_DESCRIPTION`) |
| One `h1`, clean heading order | Hubs get an `h2` before their card grid; tested on every page |
| Share card per page | 138 cards; guides get a "Guide · Licensing/Production/AI agents" kicker |
| JSON-LD `@graph` with stable ids | Extended (see below) |
| `llms.txt`, `llms-full.txt`, `AGENTS.md`, skill | Extended with guides, glossary, FAQ and collections |
| Markdown twin for every page | Added `/kit.md`, `/search.md`, `/docs/api/reference.md` (generated from OpenAPI), `/docs/api/playground.md`; every page's `<link rel="alternate" type="text/markdown">` now points at its own twin |
| Accessibility (labelled controls, underlined inline links) | Inline links on Astro pages are underlined; Lighthouse accessibility 100 on every page tested |
| Consistent numbers | Source counts come from `providers.json` everywhere; new copy says "30+" where it is static text; the existing test still checks every "N sites" statement |

### New content (pre-rendered, each with its own title, description, H1, canonical, share card, BreadcrumbList and Markdown twin)

- **42 new collections** (13 → 55; 48 indexable): open hats, crash, ride, toms, rimshots, percussion, shakers,
  breakbeats, TR-808, TR-909 and LinnDrum kits; drum, guitar and lo-fi loops (the loops hub had none); sub, Reese and
  synth bass; vocal shouts, spoken word, choir; downlifters, whooshes, glitches, white noise, tape stops,
  transitions; footsteps, doors, glass, paper, water, forest, city, room tone; Rhodes, guitar, strings, brass,
  flute, marimba, synth pads and plucks. All pass the editorial gate (`topicErrors`); 7 stay `noindex` until their
  daily snapshot reaches 12 samples from 2 sources (several sources rate-limited the sandbox run).
- **13 guides** at `/guides/<slug>` plus the `/guides` index, each opening with a quotable short answer:
  Freesound in commercial releases, CC0 vs CC BY vs royalty-free, crediting CC BY samples, CC Sampling+,
  BBC Sound Effects, what counts as commercial use, sample clearance and Content ID, what an 808 is, one-shots vs
  loops, finding samples by BPM and key, building a drum kit (Strudel, SFZ, General MIDI), sample formats, and AI
  agents with MCP. Licence statements cite the licence deeds and primary sources (Creative Commons legal code, BBC
  licensing page, YouTube Help, US Copyright Office), and every external citation URL was checked.
- **Glossary** (`/glossary`): 52 terms in five groups, each with a linkable fragment id.
- **FAQ** (`/docs/faq`): 19 questions in five groups (the home page's six included).
- **Source pages**: 14 searched sources get editorial notes (what it is, best for, licence and what it means for a
  release, how Sound Server searches it, example searches, related guides) and become indexable even without a
  census, so `/sources/freesound` and `/sources/openverse` are landing pages again. Link-only sources stay `noindex`.
- **Hubs**: each of the 7 hubs gains three editorial sections, three questions and links to guides (about 400+
  words of copy each instead of ~150). Collection pages link to their hub's guides.
- **Home**: a guides section and links to the glossary and FAQ; the header nav gains "Guides"; the footer gains a
  "Learn" column.

### Structured data

| Page | Types (in addition to `WebSite` + `SearchAction` and `Organization` on every page) |
|---|---|
| `/` | `WebApplication` (a `SoftwareApplication`), `WebAPI`, `FAQPage`, `WebPage` |
| `/guides/<slug>` | `Article` (headline, `abstract` = the short answer, dates, `articleSection`, `citation`), `HowTo` with `HowToStep`s (4 how-to guides), `FAQPage` (all 13), `BreadcrumbList` |
| `/guides` | `CollectionPage` with an `ItemList`, `BreadcrumbList` |
| `/glossary` | `WebPage`, `DefinedTermSet` of `DefinedTerm`s (`@id` = `/glossary#<term>`, `alternateName`, `sameAs` licence deeds and specs), `BreadcrumbList` |
| `/docs/faq` | `TechArticle`, `FAQPage` (19 questions, the same text as the page), `BreadcrumbList` |
| `/samples/<hub>` | `CollectionPage`, `FAQPage`, `BreadcrumbList` |
| `/samples/<collection>` | `CollectionPage` with `AudioObject`s, `FAQPage`, `BreadcrumbList` |
| `/sources/<id>` | `CollectionPage`, `WebSite` for the source (publisher, licence, free), `BreadcrumbList` |
| `/stats` | `WebPage`, `Dataset`, `BreadcrumbList` |

### GEO: answer engines and agents

- `llms.txt` has a **Guides** section (every guide, the index and the glossary), the FAQ under Docs, and points the
  API reference, search and kit entries at their Markdown twins.
- `llms-full.txt` now holds the agent guide, docs, FAQ, all guides, the glossary, the collections index, hubs and
  collections (sample tables removed: their ids change daily), and the about pages: about 445 KB.
- `AGENTS.md` lists the guides to quote when users ask licence questions; `SKILL.md` tells agents to relay a guide's
  short answer.
- Every guide's Markdown twin starts with the short answer as a blockquote, then the article, steps, questions,
  live-search links, collections, related guides and sources.

### Server side (`src/api/`)

- `search-meta.ts`: share pages for samples and searches keep titles within 70 characters (dropping "on <source>"
  first, then shortening the sample name) and descriptions within 160 (dropping the closing sentence before
  truncating). Exported `MAX_TITLE` / `MAX_DESCRIPTION`.
- No other server changes were needed: `site.ts`, `negotiate.ts`, `og.ts` and `og/render.ts` already served
  Markdown twins for any `<route>.md`, which the new pages use.

### Performance

The hero grid is now `components/home/GridPattern.astro`: the same SVG grid with squares blinking on staggered CSS
animations, no JavaScript, and no animation under `prefers-reduced-motion`. Total blocking time on `/` fell from
2.4 s to near zero.

## Results (Lighthouse 12.8, mobile emulation, local build)

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/` | 99 | 100 | 100 | 100 |
| `/guides` | 100 | 100 | 100 | 100 |
| `/guides/freesound-samples-commercial-use` | 100 | 100 | 100 | 100 |
| `/guides/build-a-drum-kit-from-free-samples` | 100 | 100 | 100 | 100 |
| `/glossary` | 100 | 100 | 100 | 100 |
| `/docs/faq` | 100 | 100 | 100 | 100 |
| `/samples` | 100 | 100 | 100 | 100 |
| `/samples/drums` | 100 | 100 | 100 | 100 |
| `/samples/free-kick-samples` | 100 | 100 | 100 | 100 |
| `/sources/freesound` | 100 | 100 | 100 | 100 |
| `/kit` | 100 | 100 | 100 | 100 |
| `/search` | 100 | 100 | 100 | 100 |
| `/stats` | 100 | 100 | 100 | 100 |
| `/docs/licences` | 100 | 100 | 100 | 100 |
| `/docs/api/reference` | 99 | 100 | 100 | 100 |
| `/sources/kenney` | 100 | 100 | 100 | 100 |
| `/docs/mcp` | 100 | 100 | 100 | 100 |

CLS is 0 to 0.001 on every page: players reserve their space, and the waveform strips are static SVG.

## Crawl audit

SiteOne Crawler is not installed in this sandbox, so the audit used a small fetch-based crawler run against
`PORT=8799 node dist/cli.js serve`. It follows every internal link from `/` and the sitemap and checks status codes,
redirects, canonical tags, title and description length, duplicate titles and descriptions among indexable pages,
`h1` count, JSON-LD parsing, image alt text, the Markdown twin (`Accept: text/markdown` and the advertised
`rel="alternate"` file), broken internal links and sitemap coverage in both directions. Sample share pages
(`/search?sample=…`) look the sample up live, so 25 of them are checked rather than all.

| | Pages crawled | Indexable | In sitemap | Internal links | Issues |
|---|---|---|---|---|---|
| Before | 370 | 44 | 44 | 385 | 243 (173 description length, 66 title length, 4 missing twins) |
| After | 352 | 102 | 102 | 1,815 | 0 |

`test/site-build.test.ts` now enforces the same rules on every build: one `h1`, canonical, parseable JSON-LD and a
Markdown twin on every page; unique titles (≤ 70) and descriptions (70–160) on indexable pages; the sitemap lists
exactly the indexable pages; no broken internal links; every guide answer-first with `Article` (+ `HowTo`,
`FAQPage`), a twin, an `llms.txt` and `llms-full.txt` entry and a sitemap date; the glossary's `DefinedTermSet`
matches its anchors; the FAQ's markup matches its page; hubs and noted sources have substantial copy and schema.

## Recommended next steps

1. **Run SiteOne Crawler** against production after deploy for the scored report the 3D audit used; the local crawl
   found nothing, but SiteOne also scores security headers end to end through the edge.
2. **Search Console and Bing Webmaster Tools**: verify `sound.shep.bot`, submit `sitemap-index.xml`, and watch which
   guides get impressions. Bing feeds ChatGPT search and Copilot.
3. **List the MCP server** in the MCP Registry, Smithery, Glama, mcp.so and "awesome MCP" lists.
4. **Re-run the collection snapshots in CI** (with the Freesound key): 7 collections are below the indexable
   minimum only because Openverse, ccMixter and the BBC rate-limited the sandbox run.
5. **Thin pages left**: seven source pages (BBC, ccMixter, curated, Free Wave Samples, Internet Archive, Kenney,
   SampleRadar) have about 180–230 words outside the header and footer. Adding their census highlights in prose, or
   a short "what to search here" list per category, would lift them.
6. **New guides from real questions**: zero-result and frequent searches (the Grafana dashboard) and the questions
   agents ask over MCP are the best source of the next guides; keep each one answer-first with cited sources.
7. **Backlinks**: r/WeAreTheMusicMakers, r/edmproduction, r/musicproduction, Strudel and TidalCycles communities,
   Freesound forums, Hacker News; ask the CC0 sources whether they list tools that use their APIs.
