# Writing a provider

A provider adapts one sample website to the shared model in `src/core/types.ts`.

## Contract

```ts
import type { Provider } from "../core/types.js";
import { makeSample, paginate, filterLocal, wantsCategory, qs, cleanText, absoluteUrl, formatFromFilename } from "../core/util.js";
import { creativeCommons, license, parseLicense, royaltyFree, customLicense } from "../core/licence.js";

export const myprovider: Provider = {
  id: "myprovider",            // lowercase, no spaces; used in sample ids `myprovider:<nativeId>`
  name: "My Provider",
  homepage: "https://…",
  description: "One line: what the site is best for.",
  categories: ["drums", "fx"], // top-level categories it carries (src/core/vocab.ts TOP_CATEGORIES)
  forms: ["one-shot", "loop"], // optional: forms it carries
  access: "api" | "static" | "scrape" | "link",
  pricing: "free" | "freemium" | "paid",
  license: royaltyFree("Mixkit licence", { url }), // when uniform across the site
  supportsDownload: true,      // only if getSample returns direct, unauthenticated file URLs
  nativeFilters: ["bpm", "key"], // filters the source applies itself (the aggregator applies the rest)
  apiKeyEnv: "MYPROVIDER_API_KEY", // optional
  isEnabled() {...},           // optional, e.g. requires key
  buildSearchUrl(q) {...},     // deep link to the same search on the website
  async search(q, ctx) {...},  // -> { samples, total?, searchUrl? }
  async getSample(nativeId, ctx) {...}, // -> SampleDetails (sample + files[]) | null
  async census(ctx) {...},     // optional: count the catalogue (daily job)
};
```

## Rules

- **All HTTP goes through `ctx.fetch`** (`json`, `text`, `raw`). It sets a User-Agent, timeout and an
  in-memory cache. Pass `signal: ctx.signal`. For catalogue/listing pages that rarely change, pass
  `cacheTtlMs` (e.g. one hour) and filter locally with `filterLocal` + `paginate`.
- **Respect the query.** `q.query` is free text with BPM/key words already removed. `q.categories`,
  `q.forms`, `q.bpm`, `q.key`, `q.maxDurationSec`, `q.commercialOnly`, `q.freeOnly` are filters; map
  the ones the source supports to its own parameters and list them in `nativeFilters`. The aggregator
  applies every filter again locally, so a source that can't filter still works. `q.hints` are
  categories suggested by the query words: use them to pick a native category, never to drop results.
  Return `{ samples: [] }` quickly when `wantsCategory(q, ...)` says the source has nothing relevant.
  Respect `q.limit` and `q.offset`.
- **Build samples with `makeSample(...)`.** It adds the id, lowercases tags, classifies category and
  form from title/filename/tags/`sourceCategories` when you don't set them, reads BPM and key from the
  title or filename, and writes the credit line. Set `category` yourself only when the source states
  it reliably (then evidence is "source"). Pass `sourceName` (display name) for credit lines.
- **Licence on every sample.** Use `parseLicense(urlOrName)`, `creativeCommons(...)`, `license(id)`,
  `royaltyFree(...)` or `customLicense(...)`. Use `assertedBy: "uploader"` when an anonymous uploader
  states it (Internet Archive); it caps the verdict at `check-terms`. Never invent a licence: when
  the source states none, use `license("LicenseRef-Unknown")`.
- `nativeId` must be something `getSample` can resolve on its own (slug / API id / path), URL-safe-ish.
- `downloadable: true` only if `getSample` returns direct file URLs fetchable with a plain GET (headers
  in `SampleFile.headers` are fine, e.g. a Referer; cookies and logins are not). Otherwise `false`.
- `previewUrl` is the playable mp3/ogg for auditioning. If it needs a Referer, set `previewNeedsReferer`.
- `SampleFile.role`: `original` (full quality), `preview`, `pack` (archive), `stem`, `midi`.
  Mark files that need a login or token with `requiresAuth: true`.
- Never throw for "no results"; throw for network/parse failures (the aggregator records the error per
  provider and continues with the others).
- Parse HTML with `cheerio` (`import * as cheerio from "cheerio"`). Prefer stable hooks (JSON-LD,
  `__NEXT_DATA__`, WordPress REST `/wp-json/wp/v2/...`, Shopify `/search/suggest.json`, sitemaps, data
  attributes) over CSS classes.
- **Be polite and lawful.** At most a couple of requests per search; no per-result detail fetches inside
  `search`. Honour robots.txt and terms of service: a site whose terms forbid scraping is a link-only
  provider (`linkProvider` in `src/providers/link.ts`), even if scraping would work. Never mirror or
  re-host samples.

## Tests

Each provider gets `test/providers/<id>.test.ts` that runs **offline** against fixtures saved under
`test/fixtures/<id>/` (trim fixtures to a few KB–~100KB; strip scripts/styles you don't need). Use
`fixtureCtx` / `fixtureHttp` from `test/helpers.ts` to map URLs to fixture files, and assert the request
count so a provider never fans out. Cover: search mapping (category, form, bpm/key, licence verdict,
preview, downloadable), filters passed natively, `getSample` files, `buildSearchUrl`, and the
empty/no-results path. Add a live smoke test to `test/live/<id>.live.test.ts` (only runs with `LIVE=1`).

Register the provider in `src/providers/index.ts` and `integrations/registry.json`.
