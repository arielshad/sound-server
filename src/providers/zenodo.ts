/**
 * Research datasets on Zenodo that work as sample or instrument sources: isolated orchestral and
 * instrument notes (TinySOL, Good-sounds), singing and choir recordings (VocalSet, Dagstuhl
 * ChoirSet), guitar (GuitarSet), percussion one-shots and the WaivOps drum-loop sets.
 *
 * Static: an allow-list in ./data/zenodo-datasets.json, searched locally with no requests.
 * Zenodo's REST API is public, but its robots.txt disallows `/api` and `/search` for every agent
 * (checked 2026-10-23), and its full-text search is too noisy to use unfiltered anyway (a query for
 * "drum samples" returns land-cover maps and COVID statistics). So record metadata, licences and
 * file sizes were read by hand from https://zenodo.org/api/records/{id} and written to the JSON.
 * Downloads use `https://zenodo.org/records/{id}/files/{key}?download=1`, which robots.txt allows
 * (only `/records/*\/preview` is closed) and which answers a plain GET with the file.
 *
 * Every dataset is one archive or a few; there is no per-sample file to audition, so there is no
 * `previewUrl`. Licences come from the record and its description: where they disagree
 * (Good-sounds: record CC BY 4.0, description CC BY-NC 4.0) the stricter one is used.
 */
import { catalogueCensus } from "../core/census.js";
import { isCommercialSafe } from "../core/licence.js";
import type { Category, Provider, Sample, SampleDetails, SampleFile, SampleForm } from "../core/types.js";
import { filterLocal, makeSample, paginate, wantsCategory } from "../core/util.js";
import { SAMPLE_FORMS, isCategory, topCategory } from "../core/vocab.js";
import { buildLicense, type CuratedLicenseSpec } from "./curated.js";
import data from "./data/zenodo-datasets.json" with { type: "json" };

const SITE = "https://zenodo.org";

export interface ZenodoFile {
  key: string;
  sizeBytes?: number;
  format: string;
  role: SampleFile["role"];
}

export interface ZenodoRecord {
  recordId: number;
  /** Our slug, for readability in the JSON. */
  id: string;
  title: string;
  creators: string[];
  doi?: string;
  version?: string;
  published?: string;
  category: string;
  form: string;
  unit: "pack" | "instrument" | "sample";
  packSize?: number;
  formats?: string[];
  tags: string[];
  description: string;
  license: string;
  files: ZenodoFile[];
  /** Ids of the same dataset on other providers (the curated list carries a few). */
  sameAs?: string[];
  verified?: string;
}

export interface ZenodoCatalogue {
  licenses: Record<string, CuratedLicenseSpec>;
  records: ZenodoRecord[];
}

export function fileUrl(recordId: number, key: string): string {
  return `${SITE}/records/${recordId}/files/${encodeURIComponent(key)}?download=1`;
}

const FORMS = new Set<string>(SAMPLE_FORMS);
const ROLES = new Set<string>(["original", "preview", "pack", "stem", "midi"]);

/** Check the allow-list and build samples. Throws on the first bad entry. */
export function buildZenodoCatalogue(cat: ZenodoCatalogue): { sample: Sample; files: SampleFile[] }[] {
  const licenses = new Map(Object.entries(cat.licenses).map(([k, spec]) => [k, buildLicense(spec)]));
  const seen = new Set<number>();
  return cat.records.map((r) => {
    const where = `zenodo record ${r.recordId} (${r.id})`;
    if (!Number.isInteger(r.recordId) || r.recordId <= 0) throw new Error(`${where}: bad record id`);
    if (seen.has(r.recordId)) throw new Error(`${where}: duplicate record`);
    seen.add(r.recordId);
    if (!isCategory(r.category)) throw new Error(`${where}: unknown category ${r.category}`);
    if (!FORMS.has(r.form)) throw new Error(`${where}: unknown form ${r.form}`);
    const lic = licenses.get(r.license);
    if (!lic) throw new Error(`${where}: unknown licence key ${r.license}`);
    if (!r.files.length) throw new Error(`${where}: no files`);
    for (const f of r.files) if (!ROLES.has(f.role)) throw new Error(`${where}: unknown file role ${f.role}`);
    const files: SampleFile[] = r.files.map((f) => ({
      url: fileUrl(r.recordId, f.key),
      filename: f.key,
      format: f.format,
      role: f.role,
      ...(f.sizeBytes ? { sizeBytes: f.sizeBytes } : {}),
    }));
    const sample = makeSample({
      provider: "zenodo",
      nativeId: String(r.recordId),
      title: r.title,
      description: r.description,
      url: `${SITE}/records/${r.recordId}`,
      author: r.creators.length > 3 ? `${r.creators.slice(0, 3).join(", ")} et al.` : r.creators.join(", ") || undefined,
      tags: [...r.tags, "free", "dataset"],
      category: r.category as Category,
      categoryEvidence: { by: "source", confidence: 1 },
      form: r.form as SampleForm,
      unit: r.unit,
      packSize: r.packSize,
      formats: r.formats,
      license: lic,
      price: { free: true },
      downloadable: true,
      createdAt: r.published,
      sameAs: r.sameAs,
      sourceName: "Zenodo",
    });
    return { sample, files };
  });
}

const CATALOGUE = buildZenodoCatalogue(data as unknown as ZenodoCatalogue);
const BY_ID = new Map(CATALOGUE.map((e) => [e.sample.nativeId, e]));
const TOPS = [...new Set(CATALOGUE.map((e) => topCategory(e.sample.category)))];

export const zenodo: Provider = {
  id: "zenodo",
  name: "Zenodo datasets",
  homepage: SITE,
  description:
    "Hand-checked research datasets on Zenodo that work as sample sources: orchestral and instrument notes (TinySOL, Good-sounds), singing, choir and guitar recordings, percussion one-shots and large CC BY drum-loop sets (WaivOps).",
  categories: TOPS,
  forms: ["pack", "multisample"],
  access: "static",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["categories", "forms", "commercialOnly", "freeOnly"],

  census(ctx) {
    return catalogueCensus(this, ctx, "packs");
  },

  buildSearchUrl(q) {
    // Zenodo's own search, limited to datasets (robots.txt keeps us off it; people are welcome).
    const text = q.query.trim();
    return `${SITE}/search?${new URLSearchParams({ q: text ? `${text} AND audio` : "audio samples", f: "resource_type:dataset" }).toString()}`;
  },

  async search(q) {
    const searchUrl = this.buildSearchUrl(q);
    if (!wantsCategory(q, ...TOPS)) return { samples: [], total: 0, searchUrl };
    let samples = CATALOGUE.map((e) => e.sample);
    if (q.commercialOnly) samples = samples.filter((s) => isCommercialSafe(s.license));
    samples = filterLocal(samples, q);
    return { samples: paginate(samples, q), total: samples.length, searchUrl };
  },

  async getSample(nativeId): Promise<SampleDetails | null> {
    const e = BY_ID.get(nativeId);
    return e ? { ...e.sample, files: e.files.map((f) => ({ ...f })) } : null;
  },
};
