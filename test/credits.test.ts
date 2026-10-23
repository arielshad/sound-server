import { describe, expect, it } from "vitest";
import { creditEntry, creditsJson, creditsMarkdown, mergeCredits } from "../src/core/credits.js";
import { creditsMarkdown as fromKit } from "../src/core/kit.js";
import { creativeCommons, license, royaltyFree } from "../src/core/licence.js";
import type { Sample } from "../src/core/types.js";

function sample(id: string, title: string, extra: Partial<Sample> = {}): Sample {
  return {
    id: `freesound:${id}`,
    provider: "freesound",
    nativeId: id,
    title,
    url: `https://freesound.org/s/${id}/`,
    author: "jdoe",
    authorUrl: "https://freesound.org/people/jdoe/",
    tags: [],
    category: "drums.kick",
    unit: "sample",
    downloadable: true,
    license: license("CC0-1.0"),
    ...extra,
  };
}

const NOW = new Date("2026-10-23T10:00:00.000Z");
const names = { freesound: "Freesound", mixkit: "Mixkit" };
const cc0 = sample("1", "Deep Kick");
const by = sample("2", "Snare *tight*", { license: creativeCommons({}) });
const nc = sample("3", "NC Hat", { license: creativeCommons({ nc: true }), author: undefined, authorUrl: undefined });
const rf = sample("4", "Mixkit Riser", { provider: "mixkit", id: "mixkit:4", url: "https://mixkit.co/4", license: royaltyFree("Mixkit Sound Effects Free License", { url: "https://mixkit.co/license/" }) });
const none = sample("5", "Mystery Loop", { license: undefined });

describe("creditsJson", () => {
  it("one machine-readable entry per sample with licence, verdict and credit line", () => {
    const j = creditsJson([cc0, by, by], { sourceNames: names, now: NOW });
    expect(j.generator).toBe("sound-server");
    expect(j.generatedAt).toBe("2026-10-23T10:00:00.000Z");
    expect(j.samples).toHaveLength(2); // deduped by id
    expect(j.commercialSafe).toBe(true);
    expect(j.creditsNeeded).toBe(true);
    expect(j.samples[0]).toEqual({
      id: "freesound:1",
      provider: "freesound",
      source: "Freesound",
      title: "Deep Kick",
      author: "jdoe",
      authorUrl: "https://freesound.org/people/jdoe/",
      url: "https://freesound.org/s/1/",
      license: {
        id: "CC0-1.0",
        name: "CC0 1.0",
        url: "https://creativecommons.org/publicdomain/zero/1.0/",
        verdict: "yes",
        verdictLabel: "Commercial use OK",
        attributionRequired: false,
        commercialUse: true,
      },
      downloadedAt: "2026-10-23T10:00:00.000Z",
    });
    expect(j.samples[1]!.attribution).toBe(
      "“Snare *tight*” by jdoe (Freesound), https://freesound.org/s/2/, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
    );
    expect(j.samples[1]!.license).toMatchObject({ id: "CC-BY-4.0", verdict: "yes-with-credit", attributionRequired: true });
  });

  it("uses the sample's own attribution line, per-id timestamps and files", () => {
    const own = { ...by, attribution: "Snare by jdoe — CC BY" };
    const e = creditEntry(own, { downloadedAt: { [own.id]: "2026-01-01T00:00:00Z" }, files: { [own.id]: [{ path: "drums/snare.wav", sha256: "ab" }] } });
    expect(e.attribution).toBe("Snare by jdoe — CC BY");
    expect(e.downloadedAt).toBe("2026-01-01T00:00:00Z");
    expect(e.files).toEqual([{ path: "drums/snare.wav", sha256: "ab" }]);
    expect(creditEntry(cc0, { downloadedAt: {} }).downloadedAt).toBeUndefined();
  });

  it("marks unsafe sets and samples without a licence", () => {
    const j = creditsJson([cc0, nc, none], { now: NOW });
    expect(j.commercialSafe).toBe(false);
    expect(j.creditsNeeded).toBe(true); // NC still asks for credit
    expect(j.samples[2]!.license).toEqual({ id: "LicenseRef-Unknown", name: "No licence stated", verdict: "check-terms", verdictLabel: "Unclear: check the terms", attributionRequired: false });
  });

  it("mergeCredits is idempotent by id and combines files", () => {
    const a = creditsJson([cc0], { now: NOW, files: { [cc0.id]: [{ path: "kick.wav" }] } });
    const b = creditsJson([cc0, by], { now: new Date("2026-10-24T00:00:00Z"), files: { [cc0.id]: [{ path: "kick.wav" }, { path: "kit/kick.wav" }] } });
    const m = mergeCredits(a, b);
    expect(m.samples.map((x) => x.id)).toEqual(["freesound:1", "freesound:2"]);
    expect(m.samples[0]!.files).toEqual([{ path: "kick.wav" }, { path: "kit/kick.wav" }]);
    expect(m.generatedAt).toBe("2026-10-24T00:00:00.000Z");
    expect(mergeCredits(m, b)).toEqual(m);
    expect(mergeCredits(undefined, a).samples).toHaveLength(1);
  });
});

describe("creditsMarkdown", () => {
  it("groups by licence, lists TASL and the credit lines to publish", () => {
    const md = creditsMarkdown([by, cc0, rf], names, { now: NOW });
    expect(md.startsWith("# Attribution\n")).toBe(true);
    expect(md).not.toContain("Warning");
    expect(md).toContain("## Credits to publish");
    expect(md).toContain("- “Snare *tight*” by jdoe (Freesound), https://freesound.org/s/2/, licensed under CC BY 4.0");
    // most permissive first: CC0 / royalty-free (yes) before CC BY (yes-with-credit)
    const cc0At = md.indexOf("## [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)");
    const byAt = md.indexOf("## [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)");
    expect(cc0At).toBeGreaterThan(0);
    expect(byAt).toBeGreaterThan(cc0At);
    expect(md).toContain("Commercial use OK with credit. Attribution required.");
    expect(md).toContain("- **Deep Kick** by [jdoe](https://freesound.org/people/jdoe/), Freesound: https://freesound.org/s/1/");
    expect(md).toContain("- **Snare \\*tight\\*** by");
    expect(md).toContain("Mixkit: https://mixkit.co/4");
    expect(md).toContain("id: `freesound:1`, downloaded 2026-10-23");
    expect(md).toContain("not legal advice");
  });

  it("puts a warning header first when anything is not commercial-safe", () => {
    const md = creditsMarkdown([cc0, nc, none], names);
    const warn = md.indexOf("> **Warning:** 2 of 3 samples are not cleared for a commercial release:");
    expect(warn).toBeGreaterThan(0);
    expect(warn).toBeLessThan(md.indexOf("## "));
    expect(md).toContain("> - NC Hat (freesound:3): Non-commercial only");
    expect(md).toContain("> - Mystery Loop (freesound:5): Unclear: check the terms");
    expect(md).toContain("by unknown author");
    expect(md).toContain("## No licence stated");
  });

  it("renders from a credits.json and handles an empty list; kit.ts re-exports it", () => {
    const j = creditsJson([cc0], { sourceNames: names, now: NOW });
    expect(creditsMarkdown(j)).toBe(creditsMarkdown([cc0], names, { now: NOW }));
    expect(creditsMarkdown([])).toContain("No samples yet.");
    expect(fromKit).toBe(creditsMarkdown);
  });
});
