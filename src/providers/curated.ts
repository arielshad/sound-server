import { catalogueCensus } from "../core/census.js";
import { creativeCommons, customLicense, isCommercialSafe, license, royaltyFree, type KnownLicenseId } from "../core/licence.js";
import type { Category, CommercialVerdict, License, Provider, Sample, SampleDetails, SampleFile, SampleForm } from "../core/types.js";
import { filterLocal, makeSample, paginate, wantsCategory } from "../core/util.js";
import { SAMPLE_FORMS, isCategory, topCategory } from "../core/vocab.js";
import data from "./data/curated-packs.json" with { type: "json" };

/**
 * Curated free sample packs and instruments (src/providers/data/curated-packs.json): orchestral
 * libraries (Philharmonia, Univ. of Iowa MIS, VSCO 2 CE, VCSL, Sonatina), FreePats and DrumGizmo
 * instruments, Adobe's Audition SFX, research datasets (TinySOL, VocalSet) and well-known freebies
 * that only link out (Goldbaby, Sonniss GDC, 99Sounds, Legowelt...).
 *
 * The catalogue is maintained by hand: every file URL was fetched with a plain GET (no cookies) on
 * the entry's `verified` date, and entries without a direct file are `downloadable: false` and
 * link to their page. Search runs locally; it makes no requests.
 */

const HOMEPAGE = "https://github.com/arielshad/sound-server/blob/main/src/providers/data/curated-packs.json";

export interface CuratedLicenseSpec {
  kind: "spdx" | "cc" | "royalty-free" | "custom";
  /** spdx: a known id (CC0-1.0, LicenseRef-Sampling-Plus-1.0...). */
  id?: string;
  /** cc: version, plus which parts apply. */
  version?: string;
  nc?: boolean;
  nd?: boolean;
  sa?: boolean;
  name?: string;
  url?: string;
  note?: string;
  verdict?: CommercialVerdict;
  commercialUse?: boolean;
  attributionRequired?: boolean;
}

export interface CuratedFile {
  url: string;
  filename: string;
  format: string;
  role: SampleFile["role"];
  sizeBytes?: number;
}

export interface CuratedPack {
  id: string;
  title: string;
  author?: string;
  /** The publisher's page for the pack. */
  url: string;
  category: string;
  form: string;
  unit: "pack" | "instrument" | "sample";
  packSize?: number;
  formats?: string[];
  tags: string[];
  /** Short, in our own words. */
  description: string;
  /** Key into `licenses`. */
  license: string;
  downloadable: boolean;
  files: CuratedFile[];
  /** How to get it when there is no direct file. */
  note?: string;
  /** Date the URLs were last checked (YYYY-MM-DD). */
  verified?: string;
}

export interface CuratedCatalogue {
  licenses: Record<string, CuratedLicenseSpec>;
  packs: CuratedPack[];
}

export function buildLicense(spec: CuratedLicenseSpec): License {
  switch (spec.kind) {
    case "spdx": {
      const l = license(spec.id as KnownLicenseId, "source");
      if (!l?.id) throw new Error(`unknown licence id ${spec.id}`);
      return spec.note ? { ...l, note: spec.note } : l;
    }
    case "cc": {
      const l = creativeCommons({ nc: spec.nc, nd: spec.nd, sa: spec.sa }, spec.version ?? "4.0", "source");
      return spec.note ? { ...l, note: spec.note } : l;
    }
    case "royalty-free":
      return royaltyFree(spec.name ?? "Royalty-free licence", { url: spec.url, note: spec.note, attributionRequired: spec.attributionRequired, assertedBy: "source" });
    case "custom":
      return customLicense(spec.name ?? "Custom licence", {
        url: spec.url,
        verdict: spec.verdict,
        note: spec.note,
        commercialUse: spec.commercialUse,
        attributionRequired: spec.attributionRequired,
        assertedBy: "source",
      });
    default:
      throw new Error(`unknown licence kind ${(spec as { kind: string }).kind}`);
  }
}

const FORMS = new Set<string>(SAMPLE_FORMS);
const ROLES = new Set<string>(["original", "preview", "pack", "stem", "midi"]);

/** Check the hand-written JSON and turn it into samples. Throws on the first bad entry. */
export function buildCatalogue(cat: CuratedCatalogue): { sample: Sample; files: SampleFile[] }[] {
  const licenses = new Map(Object.entries(cat.licenses).map(([k, spec]) => [k, buildLicense(spec)]));
  const seen = new Set<string>();
  return cat.packs.map((p) => {
    const where = `curated pack "${p.id}"`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id)) throw new Error(`${where}: id must be lowercase-dashed`);
    if (seen.has(p.id)) throw new Error(`${where}: duplicate id`);
    seen.add(p.id);
    if (!isCategory(p.category)) throw new Error(`${where}: unknown category ${p.category}`);
    if (!FORMS.has(p.form)) throw new Error(`${where}: unknown form ${p.form}`);
    const lic = licenses.get(p.license);
    if (!lic) throw new Error(`${where}: unknown licence key ${p.license}`);
    if (!/^https?:\/\//.test(p.url)) throw new Error(`${where}: page url must be absolute`);
    for (const f of p.files) {
      if (!/^https:\/\//.test(f.url)) throw new Error(`${where}: file url must be https (${f.url})`);
      if (!ROLES.has(f.role)) throw new Error(`${where}: unknown file role ${f.role}`);
    }
    if (p.downloadable && !p.files.length) throw new Error(`${where}: downloadable without files`);
    const files: SampleFile[] = p.downloadable
      ? p.files.map((f) => ({ url: f.url, filename: f.filename, format: f.format, role: f.role, ...(f.sizeBytes ? { sizeBytes: f.sizeBytes } : {}) }))
      : [];
    const sample = makeSample({
      provider: "curated",
      nativeId: p.id,
      title: p.title,
      description: p.note ? `${p.description} ${p.note}` : p.description,
      url: p.url,
      author: p.author,
      tags: [...p.tags, "free", p.unit === "instrument" ? "instrument" : "pack"],
      category: p.category as Category,
      categoryEvidence: { by: "source", confidence: 1 },
      form: p.form as SampleForm,
      unit: p.unit,
      packSize: p.packSize,
      formats: p.formats,
      license: lic,
      price: { free: true },
      downloadable: p.downloadable,
    });
    return { sample, files };
  });
}

const CATALOGUE = buildCatalogue(data as unknown as CuratedCatalogue);
const BY_ID = new Map(CATALOGUE.map((e) => [e.sample.nativeId, e]));
const TOPS = [...new Set(CATALOGUE.map((e) => topCategory(e.sample.category)))];

export const curated: Provider = {
  id: "curated",
  name: "Curated free libraries",
  homepage: HOMEPAGE,
  description:
    "A hand-checked list of well-known free sample libraries and instruments (Philharmonia, Iowa MIS, VSCO 2 CE, VCSL, FreePats, DrumGizmo, Adobe SFX, Goldbaby, Sonniss GDC...), with verified direct downloads where they exist.",
  categories: TOPS,
  forms: ["pack", "multisample", "preset"],
  access: "static",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["categories", "forms", "commercialOnly", "freeOnly"],

  census(ctx) {
    return catalogueCensus(this, ctx, "packs");
  },

  buildSearchUrl() {
    return HOMEPAGE;
  },

  async search(q) {
    const searchUrl = HOMEPAGE;
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
