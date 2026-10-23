import { describe, expect, it } from "vitest";
import data from "../../src/providers/data/curated-packs.json" with { type: "json" };
import { buildCatalogue, buildLicense, curated, type CuratedCatalogue } from "../../src/providers/curated.js";
import { fixtureCtx } from "../helpers.js";

const catalogue = data as unknown as CuratedCatalogue;

describe("curated", () => {
  it("serves the whole catalogue locally, with no requests", async () => {
    const ctx = fixtureCtx([]);
    const r = await curated.search({ query: "", limit: 500 }, ctx);
    expect(ctx.fetch.requests).toEqual([]);
    expect(r.total).toBe(catalogue.packs.length);
    expect(r.total).toBeGreaterThanOrEqual(30);
    expect(r.samples.every((s) => s.price?.free && s.license && s.provider === "curated")).toBe(true);
    expect(r.searchUrl).toBe(curated.homepage);
    expect(curated.buildSearchUrl({ query: "piano", limit: 5 })).toBe(curated.homepage);
  });

  it("keeps the JSON honest: valid categories, licence keys, https files and verified dates", () => {
    expect(() => buildCatalogue(catalogue)).not.toThrow();
    const ids = new Set<string>();
    for (const p of catalogue.packs) {
      expect(ids.has(p.id), p.id).toBe(false);
      ids.add(p.id);
      expect(p.verified, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.description.length, p.id).toBeLessThan(260);
      if (p.downloadable) {
        expect(p.files.length, p.id).toBeGreaterThan(0);
        for (const f of p.files) {
          expect(f.url, p.id).toMatch(/^https:\/\//);
          expect(f.sizeBytes, `${p.id} ${f.url}`).toBeGreaterThan(0);
        }
      } else {
        // a link-only entry says how to get it
        expect(p.note, p.id).toBeTruthy();
      }
    }
    expect(() => buildCatalogue({ ...catalogue, packs: [{ ...catalogue.packs[0]!, category: "drums.cowbell" }] })).toThrow(/unknown category/);
    expect(() => buildCatalogue({ ...catalogue, packs: [{ ...catalogue.packs[0]!, license: "nope" }] })).toThrow(/unknown licence key/);
    expect(() => buildCatalogue({ ...catalogue, packs: [catalogue.packs[0]!, catalogue.packs[0]!] })).toThrow(/duplicate id/);
    expect(() => buildCatalogue({ ...catalogue, packs: [{ ...catalogue.packs[0]!, files: [] }] })).toThrow(/downloadable without files/);
  });

  it("covers drums, instruments, vocals and FX", async () => {
    const r = await curated.search({ query: "", limit: 500 }, fixtureCtx([]));
    const tops = new Set(r.samples.map((s) => s.category.split(".")[0]));
    for (const t of ["drums", "strings", "brass", "woodwind", "keys", "guitar", "mallets", "vocals", "fx", "foley"]) expect(tops, t).toContain(t);
    expect(r.samples.filter((s) => s.downloadable).length).toBeGreaterThanOrEqual(25);
  });

  it("builds licences from the spec table with the right verdicts", async () => {
    const lic = async (id: string) => (await curated.getSample!(id, fixtureCtx([])))!.license!;
    expect(await lic("vcsl")).toMatchObject({ id: "CC0-1.0", verdict: "yes" });
    expect(await lic("sonatina-symphonic-orchestra")).toMatchObject({ id: "LicenseRef-Sampling-Plus-1.0", verdict: "restricted" });
    expect(await lic("drumgizmo-drskit")).toMatchObject({ id: "CC-BY-4.0", verdict: "yes-with-credit" });
    expect(await lic("freepats-salamander-grand-piano")).toMatchObject({ id: "CC-BY-3.0", verdict: "yes-with-credit" });
    expect(await lic("philharmonia-strings")).toMatchObject({ verdict: "yes", redistribution: false, url: "https://philharmonia.co.uk/resources/sound-samples/" });
    expect((await lic("philharmonia-strings")).note).toMatch(/as is/);
    expect(await lic("adobe-audition-foley")).toMatchObject({ verdict: "check-terms" });
    expect(await lic("avl-drumkits-blonde-bop")).toMatchObject({ verdict: "yes", attributionRequired: false });
    const credited = await curated.getSample!("tinysol", fixtureCtx([]));
    expect(credited!.attribution).toMatch(/TinySOL.*CC BY 4\.0/);
    expect(buildLicense({ kind: "cc", sa: true, version: "3.0" })).toMatchObject({ id: "CC-BY-SA-3.0", verdict: "restricted" });
    expect(() => buildLicense({ kind: "spdx", id: "MIT" })).toThrow(/unknown licence id/);

    const commercial = await curated.search({ query: "", commercialOnly: true, limit: 500 }, fixtureCtx([]));
    expect(commercial.samples.map((s) => s.nativeId)).not.toContain("sonatina-symphonic-orchestra");
    expect(commercial.samples.map((s) => s.nativeId)).not.toContain("adobe-audition-foley");
  });

  it("searches with filterLocal: text, category and form", async () => {
    const piano = await curated.search({ query: "grand piano", limit: 5 }, fixtureCtx([]));
    expect(piano.samples[0]!.nativeId).toBe("freepats-salamander-grand-piano");

    const choir = await curated.search({ query: "", categories: ["vocals"], limit: 10 }, fixtureCtx([]));
    expect(choir.samples.map((s) => s.nativeId).sort()).toEqual(["adobe-audition-human-elements", "dagstuhl-choirset", "vocalset"]);

    const kits = await curated.search({ query: "drum kit", categories: ["drums"], forms: ["multisample"], limit: 10 }, fixtureCtx([]));
    expect(kits.samples.length).toBeGreaterThanOrEqual(5);
    expect(kits.samples.every((s) => s.form === "multisample" && s.unit === "instrument" && s.category.startsWith("drums"))).toBe(true);

    const page = await curated.search({ query: "", limit: 3, offset: 2 }, fixtureCtx([]));
    expect(page.samples).toHaveLength(3);
    expect(page.samples[0]!.nativeId).toBe(catalogue.packs[2]!.id);

    expect((await curated.search({ query: "bagpipe", limit: 5 }, fixtureCtx([]))).samples).toEqual([]);
  });

  it("returns verified files for downloadable packs and none for link-only ones", async () => {
    const iowa = await curated.getSample!("iowa-mis-cymbals", fixtureCtx([]));
    expect(iowa).toMatchObject({ id: "curated:iowa-mis-cymbals", unit: "pack", form: "pack", category: "drums.cymbal", downloadable: true });
    expect(iowa!.files).toHaveLength(4);
    expect(iowa!.files[0]).toEqual({
      url: "https://theremin.music.uiowa.edu/sound%20files/MIS/Percussion/cymbals/hihat/hihat.normal.zip",
      filename: "hihat.normal.zip",
      format: "zip",
      role: "pack",
      sizeBytes: 822089,
    });
    const goldbaby = await curated.getSample!("goldbaby-free-packs", fixtureCtx([]));
    expect(goldbaby).toMatchObject({ downloadable: false, files: [] });
    expect(goldbaby!.description).toMatch(/MediaFire/);
    expect(await curated.getSample!("nope", fixtureCtx([]))).toBeNull();
  });

  it("counts the catalogue for the census", async () => {
    const c = await curated.census!(fixtureCtx([]));
    expect(c).toMatchObject({ total: catalogue.packs.length, unit: "packs", free: catalogue.packs.length });
    expect(c.byLicense?.["CC0-1.0"]).toBeGreaterThan(5);
  });
});
