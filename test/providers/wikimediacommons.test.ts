import { describe, expect, it } from "vitest";
import { commonsNativeId, commonsTitle, wikimediacommons } from "../../src/providers/wikimediacommons.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  [/gsrsearch=xqzzyvvqk/, "wikimediacommons/empty.json"],
  // The raw search (no MIDI exclusion) proves the local MIDI filter.
  [/gsrsearch=kick\+filetype/, "wikimediacommons/search_with_midi.json"],
  ["generator=search", "wikimediacommons/search.json"],
  ["titles=File%3ABass+drum.ogg", "wikimediacommons/file.json"],
  ["titles=File%3A", "wikimediacommons/missing.json"],
  ["list=search", "wikimediacommons/count.json"],
];

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("wikimediacommons", () => {
  it("searches audio in one request, MIDI and pronunciations excluded at the source", async () => {
    const ctx = fixtureCtx(routes);
    const r = await wikimediacommons.search({ query: "kick drum", limit: 10 }, ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    const p = params(ctx.fetch.requests[0]!);
    expect(p.get("gsrsearch")).toBe('kick drum filetype:audio -filemime:audio/midi -pronunciation -"Lingua Libre"');
    expect(p.get("gsrnamespace")).toBe("6");
    expect(p.get("gsrlimit")).toBe("10");
    expect(p.get("prop")).toBe("imageinfo|videoinfo");
    expect(p.get("viprop")).toBe("derivatives");
    expect(p.get("iiprop")).toContain("extmetadata");

    expect(r.samples).toHaveLength(10);
    const s = r.samples[0]!;
    expect(s).toMatchObject({
      id: "wikimediacommons:Bass_drum.ogg",
      nativeId: "Bass_drum.ogg",
      title: "Bass drum",
      url: "https://commons.wikimedia.org/wiki/File:Bass_drum.ogg",
      category: "drums.kick",
      downloadable: true,
      author: "Clngre",
      previewUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/8/8a/Bass_drum.ogg/Bass_drum.ogg.mp3",
    });
    expect(s.durationSec).toBeCloseTo(5.412, 2);
    expect(s.formats).toEqual(["ogg", "mp3"]);
    expect(s.license).toMatchObject({ id: "CC-BY-SA-3.0", verdict: "restricted", attributionRequired: true, assertedBy: "source" });
    expect(s.attribution).toContain("Wikimedia Commons");
    // Licence bookkeeping categories are dropped; sound categories are kept.
    expect(s.tags).toContain("bass drums");
    expect(s.tags.some((t) => /gfdl|license|self-published/i.test(t))).toBe(false);

    const mp3 = r.samples.find((x) => x.nativeId.endsWith(".mp3"))!;
    expect(mp3.license).toMatchObject({ id: "CC-BY-3.0", verdict: "yes-with-credit" });
    expect(mp3.previewUrl).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/.+\.mp3$/);
    expect(mp3.previewUrl).not.toContain("utm_");
    expect(r.samples.every((x) => !/\.midi?$/i.test(x.nativeId))).toBe(true);
    expect(r.searchUrl).toBe("https://commons.wikimedia.org/w/index.php?search=kick+drum&title=Special%3AMediaSearch&type=audio");
  });

  it("drops MIDI files locally too", async () => {
    const r = await wikimediacommons.search({ query: "kick", limit: 6 }, fixtureCtx(routes));
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.every((x) => !/\.midi?$/i.test(x.nativeId))).toBe(true);
    expect(r.samples.every((x) => !x.nativeId.startsWith("LL-Q"))).toBe(true);
  });

  it("passes the page size (max 50) and offset", async () => {
    const ctx = fixtureCtx(routes);
    await wikimediacommons.search({ query: "", limit: 80, offset: 40 }, ctx);
    const p = params(ctx.fetch.requests[0]!);
    expect(p.get("gsrlimit")).toBe("50");
    expect(p.get("gsroffset")).toBe("40");
    expect(p.get("gsrsearch")).toBe('filetype:audio -filemime:audio/midi -pronunciation -"Lingua Libre"');
  });

  it("returns an empty list for no hits", async () => {
    const r = await wikimediacommons.search({ query: "xqzzyvvqk", limit: 10 }, fixtureCtx(routes));
    expect(r.samples).toEqual([]);
  });

  it("returns the original file and the transcoded previews", async () => {
    const ctx = fixtureCtx(routes);
    const d = await wikimediacommons.getSample!("Bass_drum.ogg", ctx);
    expect(params(ctx.fetch.requests[0]!).get("titles")).toBe("File:Bass drum.ogg");
    expect(d?.nativeId).toBe("Bass_drum.ogg");
    // The spaced title resolves to the same id.
    expect((await wikimediacommons.getSample!("Bass drum.ogg", ctx))?.nativeId).toBe("Bass_drum.ogg");
    expect(d?.files).toEqual([
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/8/8a/Bass_drum.ogg",
        filename: "Bass_drum.ogg",
        format: "ogg",
        role: "original",
        sizeBytes: 54487,
      },
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/transcoded/8/8a/Bass_drum.ogg/Bass_drum.ogg.mp3",
        filename: "Bass_drum.ogg.mp3",
        format: "mp3",
        role: "preview",
      },
    ]);
  });

  it("returns null for missing, MIDI or malformed titles", async () => {
    const ctx = fixtureCtx(routes);
    expect(await wikimediacommons.getSample!("Nope nothing here 123.ogg", ctx)).toBeNull();
    expect(await wikimediacommons.getSample!("Song.mid", ctx)).toBeNull();
    expect(await wikimediacommons.getSample!("", ctx)).toBeNull();
    expect(ctx.fetch.requests).toHaveLength(1);
  });

  it("normalises titles to MediaWiki's canonical form", () => {
    expect(commonsTitle("File:Snare_spill_gated.ogg")).toBe("Snare spill gated.ogg");
    expect(commonsTitle("Snare spill gated.ogg")).toBe("Snare spill gated.ogg");
    expect(commonsNativeId("File:Drums opening and closing a noise gate on a synth pad.wav")).toBe(
      "Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav",
    );
  });

  it("counts audio files (MIDI excluded) with one request", async () => {
    const ctx = fixtureCtx(routes);
    const c = await wikimediacommons.census!(ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(params(ctx.fetch.requests[0]!).get("srsearch")).toBe("filetype:audio -filemime:audio/midi");
    expect(c.total).toBeGreaterThan(1_000_000);
  });
});
