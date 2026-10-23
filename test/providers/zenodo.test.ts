import { describe, expect, it } from "vitest";
import data from "../../src/providers/data/zenodo-datasets.json" with { type: "json" };
import { buildZenodoCatalogue, fileUrl, zenodo, type ZenodoCatalogue } from "../../src/providers/zenodo.js";
import { fixtureCtx } from "../helpers.js";

const catalogue = data as unknown as ZenodoCatalogue;

describe("zenodo (static allow-list)", () => {
  it("searches the allow-list locally with no requests", async () => {
    const ctx = fixtureCtx([]);
    const r = await zenodo.search({ query: "orchestral notes", limit: 10 }, ctx);
    expect(ctx.fetch.requests).toEqual([]);
    expect(r.samples[0]).toMatchObject({
      id: "zenodo:3685367",
      title: "TinySOL: isolated orchestral notes",
      url: "https://zenodo.org/records/3685367",
      category: "strings",
      form: "multisample",
      unit: "pack",
      packSize: 2913,
      downloadable: true,
      sameAs: ["curated:tinysol"],
      license: { id: "CC-BY-4.0", verdict: "yes-with-credit" },
    });
    expect(r.samples[0]!.attribution).toContain("Carmine-Emanuele Cella");
    expect(r.samples[0]!.previewUrl).toBeUndefined();
  });

  it("keeps the JSON honest: unique records, known licences and categories, sized files", () => {
    expect(() => buildZenodoCatalogue(catalogue)).not.toThrow();
    for (const rec of catalogue.records) {
      expect(rec.verified, rec.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rec.description.length, rec.id).toBeLessThan(260);
      expect(rec.doi, rec.id).toBe(`10.5281/zenodo.${rec.recordId}`);
      for (const f of rec.files) expect(f.sizeBytes, `${rec.id} ${f.key}`).toBeGreaterThan(0);
    }
    const first = catalogue.records[0]!;
    expect(() => buildZenodoCatalogue({ ...catalogue, records: [first, first] })).toThrow(/duplicate record/);
    expect(() => buildZenodoCatalogue({ ...catalogue, records: [{ ...first, license: "nope" }] })).toThrow(/unknown licence key/);
    expect(() => buildZenodoCatalogue({ ...catalogue, records: [{ ...first, category: "drums.cowbell" }] })).toThrow(/unknown category/);
    expect(() => buildZenodoCatalogue({ ...catalogue, records: [{ ...first, files: [] }] })).toThrow(/no files/);
  });

  it("uses the stricter licence when a record and its description disagree", async () => {
    const goodSounds = await zenodo.getSample!("4588740", fixtureCtx([]));
    expect(goodSounds!.license).toMatchObject({ id: "CC-BY-NC-4.0", verdict: "no" });
    expect(goodSounds!.license!.note).toMatch(/BY-NC/);
    const freesound = await zenodo.getSample!("3665275", fixtureCtx([]));
    expect(freesound!.license).toMatchObject({ verdict: "check-terms", url: "https://zenodo.org/records/3665275/files/licenses.txt" });
    const commercial = await zenodo.search({ query: "", limit: 100, commercialOnly: true }, fixtureCtx([]));
    expect(commercial.samples.map((s) => s.nativeId)).not.toContain("4588740");
    expect(commercial.samples.map((s) => s.nativeId)).not.toContain("3665275");
  });

  it("filters by category and resolves direct file links", async () => {
    const drums = await zenodo.search({ query: "", categories: ["drums"], limit: 100 }, fixtureCtx([]));
    expect(drums.samples.length).toBeGreaterThanOrEqual(10);
    expect(drums.samples.every((s) => s.category.startsWith("drums"))).toBe(true);
    const lofi = await zenodo.search({ query: "lofi drum loops", limit: 3 }, fixtureCtx([]));
    expect(lofi.samples[0]!.title).toMatch(/Lo-Fi|LFBB/);
    const d = await zenodo.getSample!("3371780", fixtureCtx([]));
    expect(d!.files[0]).toEqual({
      url: "https://zenodo.org/records/3371780/files/audio_mono-mic.zip?download=1",
      filename: "audio_mono-mic.zip",
      format: "zip",
      role: "pack",
      sizeBytes: 656927981,
    });
    expect(await zenodo.getSample!("1", fixtureCtx([]))).toBeNull();
    expect(fileUrl(1, "a b.zip")).toBe("https://zenodo.org/records/1/files/a%20b.zip?download=1");
  });

  it("returns nothing for no matches and counts the allow-list", async () => {
    expect((await zenodo.search({ query: "zzqxv", limit: 5 }, fixtureCtx([]))).samples).toEqual([]);
    expect((await zenodo.search({ query: "", categories: ["fx"], limit: 5 }, fixtureCtx([]))).samples).toEqual([]);
    const c = await zenodo.census!(fixtureCtx([]));
    expect(c).toMatchObject({ total: catalogue.records.length, unit: "packs", free: catalogue.records.length });
  });

  it("links to Zenodo's dataset search", () => {
    expect(zenodo.buildSearchUrl({ query: "drum loops", limit: 1 })).toBe("https://zenodo.org/search?q=drum+loops+AND+audio&f=resource_type%3Adataset");
  });
});
