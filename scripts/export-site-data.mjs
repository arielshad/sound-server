// Export the provider registry and the API description from the compiled
// server (dist/) so the website shows exactly what the server searches and
// accepts. Run after `npm run build:server`. (The vocabulary goes to
// web/src/data/vocab.json through web/scripts/export-vocab.mjs.)
//
// Writes, into web/src/data/:
//   providers.json     every source (id, name, homepage, description, categories, forms, access, pricing,
//                      license name + licenseId/licenseUrl/licenseVerdict, supportsDownload, apiKeyEnv, nativeFilters)
//   integrations.json  when each live source was added (from integrations/registry.json), for /stats
//   openapi.json       the OpenAPI document served at /openapi.json, for the API reference page
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const { allProviders } = await import("../dist/providers/index.js");
const { openApiSpec } = await import("../dist/api/openapi.js");

const OUT = "web/src/data";
const write = (name, data) => writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2) + "\n");
mkdirSync(OUT, { recursive: true });

const providers = allProviders.map((p) => ({
  id: p.id,
  name: p.name,
  homepage: p.homepage,
  description: p.description,
  categories: p.categories,
  forms: p.forms ?? null,
  access: p.access,
  pricing: p.pricing,
  // The source's single licence, when uniform (null = set per sample).
  license: p.license?.name ?? null,
  licenseId: p.license?.id ?? null,
  licenseUrl: p.license?.url ?? null,
  licenseVerdict: p.license?.verdict ?? null,
  supportsDownload: p.supportsDownload,
  apiKeyEnv: p.apiKeyEnv ?? null,
  nativeFilters: p.nativeFilters ?? [],
}));
write("providers.json", providers);
console.log(`exported ${providers.length} providers to ${OUT}/providers.json`);

// Integration history (integrations/registry.json, kept up to date by the
// daily discovery workflow) for the "Recently added" list on /stats.
const registry = JSON.parse(readFileSync("integrations/registry.json", "utf8"));
const live = new Set(providers.map((p) => p.id));
const integrations = registry.integrated
  .filter((i) => live.has(i.id))
  .map(({ id, name, homepage, addedAt, addedBy }) => ({ id, name, homepage, addedAt, addedBy }))
  .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name));
write("integrations.json", { integrations, rejected: registry.rejected.length });
console.log(`exported ${integrations.length} integrations to ${OUT}/integrations.json`);

// The OpenAPI document the server serves at /openapi.json, for the
// server-rendered API reference page.
write("openapi.json", openApiSpec(process.env.SITE_URL ?? "https://sound.shep.bot"));
console.log(`exported the OpenAPI spec to ${OUT}/openapi.json`);
