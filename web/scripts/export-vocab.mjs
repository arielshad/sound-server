// Writes web/src/data/vocab.json from the compiled server (dist/core/*.js), so
// the website shows exactly the categories, forms and licence verdicts the
// server uses (src/core/vocab.ts and src/core/licence.ts are the source of
// truth; nothing here is hand-copied). Runs before `astro build` / `astro check`.
// When the server has not been built yet, the committed vocab.json is kept.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = new URL("../../dist/core/", import.meta.url);
const out = fileURLToPath(new URL("../src/data/vocab.json", import.meta.url));

if (!existsSync(new URL("vocab.js", dist)) || !existsSync(new URL("licence.js", dist))) {
  if (!existsSync(out)) throw new Error("dist/core/vocab.js is missing and there is no web/src/data/vocab.json: run `npm run build:server` first");
  console.warn("export-vocab: dist/core not built, keeping web/src/data/vocab.json");
  process.exit(0);
}

const vocab = await import(new URL("vocab.js", dist).href);
const licence = await import(new URL("licence.js", dist).href);
const types = await import(new URL("types.js", dist).href);

const data = {
  categories: vocab.CATEGORY_DEFS.map((c) => ({ id: c.id, label: c.label })),
  topCategories: vocab.TOP_CATEGORIES,
  forms: vocab.SAMPLE_FORMS,
  pitchClasses: vocab.PITCH_CLASSES,
  verdicts: types.COMMERCIAL_VERDICTS,
  verdictLabels: licence.VERDICT_LABELS,
};
mkdirSync(fileURLToPath(new URL("../src/data/", import.meta.url)), { recursive: true });
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`export-vocab: ${data.categories.length} categories, ${data.forms.length} forms, ${data.verdicts.length} verdicts`);
