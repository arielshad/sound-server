import { describe, expect, it } from "vitest";
import { buildQuery, internetarchive, isDenylisted } from "../../src/providers/internetarchive.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  [/advancedsearch\.php\?q=%28title%3Axqzzy/, "internetarchive/empty.json"],
  [/advancedsearch\.php\?q=%28title%3Abest\+OR/, "internetarchive/search_denylisted.json"],
  [/advancedsearch\.php\?q=.*rows=0/, "internetarchive/count.json"],
  ["advancedsearch.php", "internetarchive/search_kick.json"],
  ["/metadata/sin-aesthetics-free-808-bass-pack-75-.wav-files", "internetarchive/metadata_808bass.json"],
  ["/metadata/kick-blizzard", "internetarchive/metadata_kickblizzard.json"],
  ["/metadata/", "internetarchive/metadata_missing.json"],
];

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("internetarchive", () => {
  it("searches CC/PD sample packs in one request, licences capped at check-terms", async () => {
    const ctx = fixtureCtx(routes);
    const r = await internetarchive.search({ query: "kick", limit: 10 }, ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    const p = params(ctx.fetch.requests[0]!);
    const q = p.get("q")!;
    expect(q).toContain("(title:kick OR subject:kick OR description:kick)");
    expect(q).toContain("licenseurl:*creativecommons.org*");
    expect(q).toContain("NOT licenseurl:*nc*");
    expect(q).toContain("NOT licenseurl:*nd*");
    expect(q).toContain('"best service"');
    expect(p.getAll("fl[]")).toEqual(expect.arrayContaining(["identifier", "title", "creator", "licenseurl", "subject", "downloads"]));
    expect(p.get("rows")).toBe("10");
    expect(p.get("page")).toBe("1");
    expect(p.get("sort[]")).toBe("downloads desc");
    expect(p.get("output")).toBe("json");

    expect(r.total).toBe(15);
    expect(r.samples.length).toBe(10);
    const mb = r.samples.find((s) => s.nativeId === "mailboxbadgerdrumsamplesvolume2")!;
    expect(mb).toMatchObject({
      provider: "internetarchive",
      unit: "pack",
      form: "pack",
      category: "drums",
      url: "https://archive.org/details/mailboxbadgerdrumsamplesvolume2",
      thumbnailUrl: "https://archive.org/services/img/mailboxbadgerdrumsamplesvolume2",
      downloadable: true,
      popularity: 12815,
    });
    expect(mb.formats).toEqual(expect.arrayContaining(["wav", "mp3"]));
    for (const s of r.samples) {
      expect(s.license?.assertedBy).toBe("uploader");
      expect(s.license?.verdict).toBe("check-terms");
      expect(s.license?.note).toMatch(/asserted by uploader/i);
    }
    expect(r.samples.find((s) => s.nativeId === "ktb_sounds")?.license?.id).toBe("CC0-1.0");
    // A one-sound item (few files, no zip) is a sample, not a pack.
    expect(r.samples.find((s) => s.nativeId === "BassDrum")).toMatchObject({ unit: "sample", category: "drums.kick" });
  });

  it("drops commercial sample CDs that slip through the query (denylist)", async () => {
    const ctx = fixtureCtx(routes);
    const r = await internetarchive.search({ query: "best service", limit: 5 }, ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(r.samples.map((s) => s.title)).toEqual([]);
    expect(isDenylisted("Best Service - Killer Horns (CDDA)")).toBe(true);
    expect(isDenylisted("All Various SFX Hollywoodedge And Others")).toBe(true);
    expect(isDenylisted("Zero G Datafile 3")).toBe(true);
    expect(isDenylisted("Beckstrom's Weird TR-808 Sample Pack")).toBe(false);
    expect(isDenylisted("Mailbox Badger : Public Domain Drum Samples")).toBe(false);
  });

  it("pages with rows/page and keeps Lucene syntax out of user words", async () => {
    const ctx = fixtureCtx(routes);
    await internetarchive.search({ query: 'deep "kick" OR (808)*', limit: 20, offset: 40 }, ctx);
    const p = params(ctx.fetch.requests[0]!);
    expect(p.get("rows")).toBe("20");
    expect(p.get("page")).toBe("3");
    expect(p.get("q")).toMatch(/^\(title:deep OR subject:deep OR description:deep\) AND \(title:kick .+ AND \(title:808 /);
    expect(buildQuery({ query: "", limit: 5 })).not.toContain("title:  ");
  });

  it("skips commercial-only searches (uploader licences are never commercial-safe)", async () => {
    const ctx = fixtureCtx(routes);
    const r = await internetarchive.search({ query: "kick", limit: 5, commercialOnly: true }, ctx);
    expect(r.samples).toEqual([]);
    expect(ctx.fetch.requests).toHaveLength(0);
  });

  it("returns an empty list for no hits", async () => {
    const r = await internetarchive.search({ query: "xqzzyvv", limit: 5 }, fixtureCtx(routes));
    expect(r.samples).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("lists a pack's zip, original audio and mp3 previews", async () => {
    const ctx = fixtureCtx(routes);
    const d = await internetarchive.getSample!("sin-aesthetics-free-808-bass-pack-75-.wav-files", ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(d).toBeTruthy();
    expect(d!.license?.id).toBe("CC-BY-4.0");
    expect(d!.license?.verdict).toBe("check-terms");
    const zip = d!.files.find((f) => f.role === "pack")!;
    expect(zip).toMatchObject({
      format: "zip",
      filename: "Sin Aesthetic's Free 808 Bass Pack! 75 .wav files.zip",
      url: "https://archive.org/download/sin-aesthetics-free-808-bass-pack-75-.wav-files/Sin%20Aesthetic's%20Free%20808%20Bass%20Pack!%2075%20.wav%20files.zip",
      sizeBytes: 11697632,
    });
    const originals = d!.files.filter((f) => f.role === "original");
    expect(originals.length).toBeGreaterThan(5);
    expect(originals.every((f) => f.format === "wav")).toBe(true);
    const previews = d!.files.filter((f) => f.role === "preview");
    expect(previews.every((f) => f.format === "mp3")).toBe(true);
    expect(d!.previewUrl).toBe(previews[0]!.url);
    expect(d!.previewUrl).toMatch(/^https:\/\/archive\.org\/download\/sin-aesthetics-free-808-bass-pack-75-\.wav-files\/.+\.mp3$/);
    expect(d!.files.some((f) => f.format === "flac" || f.format === "png")).toBe(false);
    expect(d!.packSize).toBe(originals.length);
  });

  it("caps the listed files and resolves items without a zip", async () => {
    const d = await internetarchive.getSample!("kick-blizzard", fixtureCtx(routes));
    expect(d!.files.filter((f) => f.role === "original")).toHaveLength(32);
    expect(d!.files.filter((f) => f.role === "pack")).toHaveLength(0);
    expect(d!.license?.id).toBe("CC0-1.0");
    expect(d!.files.length).toBeLessThanOrEqual(400);
  });

  it("returns null for unknown or malformed identifiers", async () => {
    const ctx = fixtureCtx(routes);
    expect(await internetarchive.getSample!("this-id-does-not-exist", ctx)).toBeNull();
    expect(await internetarchive.getSample!("../../etc/passwd", ctx)).toBeNull();
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("builds the site search URL", () => {
    expect(internetarchive.buildSearchUrl({ query: "808", limit: 5 })).toBe("https://archive.org/search?query=808+AND+mediatype%3Aaudio");
  });

  it("counts the filtered catalogue", async () => {
    const ctx = fixtureCtx(routes);
    const c = await internetarchive.census!(ctx);
    expect(c.total).toBe(2483);
    expect(c.unit).toBe("packs");
    expect(params(ctx.fetch.requests[0]!).get("rows")).toBe("0");
  });
});
