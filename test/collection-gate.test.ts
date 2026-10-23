import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { MAX_NEW_TOPICS, checkChanges, checkSnapshots } from "../scripts/collection-gate.mjs";
// @ts-expect-error plain .mjs script without type declarations
import { coreTerms, ideasFrom, isCovered, sanitizeQuery } from "../scripts/collection-ideas.mjs";

type Topic = { slug: string; data: Record<string, unknown>; body: string };

const body = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
const topic = (slug: string, over: Record<string, unknown> = {}): Topic => ({
  slug,
  body,
  data: {
    title: "Free lo-fi drum loops",
    description: "Free lo-fi drum loops for chill hip hop and study beats: dusty, swung grooves at 70 to 90 BPM from many sample sites, each with its licence verdict.",
    hub: "drums",
    search: { q: slug.replace(/-/g, " "), categories: ["drums"], forms: ["loop"], free: true },
    related: ["existing-a", "existing-b"],
    faq: [
      { q: "Can I use these loops in a released track?", a: "Check the verdict on each card: CC0 loops need nothing, CC BY loops need a credit, and NC loops are for non-commercial use only." },
      { q: "What tempo are lo-fi drum loops?", a: "Most sit between 70 and 90 BPM. Each card shows the tempo when the source or our analysis knows it." },
    ],
    addedAt: "2026-10-07",
    addedBy: "agent",
    ...over,
  },
});
const existing = [topic("existing-a", { addedBy: "human" }), topic("existing-b", { addedBy: "human" })];
const base = { existing, hubs: ["drums", "vocals"], providers: ["freesound"] };
const file = (slug: string, status = "A") => ({ status, path: `web/src/content/collections/${slug}.md` });
const check = checkChanges as (i: { files: { status: string; path: string }[]; existing: Topic[]; added: Topic[]; hubs: string[]; providers: string[] }) => { errors: string[]; added: string[] };

describe("collection gate", () => {
  it("accepts new agent topics that meet the rules", () => {
    expect(check({ ...base, files: [file("lofi-drum-loops")], added: [topic("lofi-drum-loops")] })).toEqual({ errors: [], added: ["lofi-drum-loops"] });
  });

  it("refuses other files, edits to existing topics and deletions", () => {
    const { errors } = check({
      ...base,
      files: [file("lofi-drum-loops"), file("existing-a", "M"), file("existing-b", "D"), { status: "A", path: "src/core/service.ts" }],
      added: [topic("lofi-drum-loops")],
    });
    expect(errors).toHaveLength(3);
  });

  it(`refuses more than ${MAX_NEW_TOPICS} topics per run`, () => {
    const slugs = Array.from({ length: MAX_NEW_TOPICS + 1 }, (_, i) => `topic-${i}`);
    expect(check({ ...base, files: slugs.map((s) => file(s)), added: slugs.map((s) => topic(s)) }).errors.join()).toMatch(/at most/);
  });

  it("refuses duplicates, human authorship and links to new pages", () => {
    const { errors } = check({
      ...base,
      files: [file("lofi-drum-loops"), file("lofi-drum-loops-2")],
      added: [topic("lofi-drum-loops", { addedBy: "human" }), topic("lofi-drum-loops-2", { search: { q: "Lofi Drum  Loops", categories: ["drums"], forms: ["loop"], free: true }, related: ["existing-a", "lofi-drum-loops"] })],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'lofi-drum-loops: addedBy must be "agent"',
        'lofi-drum-loops-2: related "lofi-drum-loops" must be an existing collection',
        'lofi-drum-loops-2: same search as "lofi-drum-loops"',
      ]),
    );
  });

  it("applies the editorial rules", () => {
    const { errors } = check({ ...base, files: [file("thin")], added: [{ ...topic("thin"), body: "Too short." }] });
    expect(errors.join()).toMatch(/body: 2 words/);
  });

  it("only accepts the server's categories and forms", () => {
    const { errors } = check({
      ...base,
      files: [file("bad-vocab")],
      added: [topic("bad-vocab", { search: { q: "bad vocab", categories: ["drums.kick", "textures"], forms: ["loop", "stem"], types: ["model"] } })],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^bad-vocab: search\.categories: a list of categories/),
        expect.stringMatching(/^bad-vocab: search\.forms: a list of one-shot, loop/),
        "bad-vocab: search: unknown field(s) types",
      ]),
    );
    expect(check({ ...base, files: [file("hats")], added: [topic("hats", { search: { q: "closed hat", categories: ["drums.hat.closed"], commercial: true } })] }).errors).toEqual([]);
  });

  it("withdraws topics whose search finds too little", () => {
    const samples = (n: number, sources: number) => Array.from({ length: n }, (_, i) => ({ provider: `p${i % sources}` }));
    const snaps: Record<string, unknown> = { good: { samples: samples(20, 3) }, few: { samples: samples(5, 2) }, one: { samples: samples(30, 1) } };
    const r = checkSnapshots(["good", "few", "one", "missing"], (s: string) => snaps[s]);
    expect(r.kept).toEqual(["good"]);
    expect(r.dropped).toEqual([
      { slug: "few", reason: "5 samples (minimum 12)" },
      { slug: "one", reason: "1 source (minimum 2)" },
      { slug: "missing", reason: "no snapshot" },
    ]);
  });
});

describe("collection ideas", () => {
  it("keeps only plain topic-like queries", () => {
    expect(sanitizeQuery("  Dusty   Snare ")).toBe("dusty snare");
    expect(sanitizeQuery("90's boom-bap")).toBe("90's boom-bap");
    for (const bad of ["a", "john@example.com", "https://x.io/a", "www example com", "12345", "one two three four five six seven", "<script>"]) expect(sanitizeQuery(bad), bad).toBeUndefined();
  });

  it("matches queries to collections without the filler words", () => {
    expect(coreTerms("Free Riser Sound Effects")).toBe("riser");
    expect(coreTerms("lo-fi drum loops")).toBe("drum lofi loop");
    expect(coreTerms("free hi hat one shots")).toBe("hihat oneshot");
    expect(coreTerms("royalty-free 808s for commercial use")).toBe("808");
    expect(coreTerms("A Cappella vocals")).toBe("acapella vocal");
    const topics = [{ q: "riser", aliases: ["uplifter sfx"] }];
    expect(isCovered("free riser samples", topics)).toBe(true);
    expect(isCovered("uplifter", topics)).toBe(true);
    expect(isCovered("free sound effects", topics)).toBe(true); // only filler: the hubs answer it
    expect(isCovered("vinyl crackle", topics)).toBe(false);
  });

  it("ranks frequent, uncovered queries and drops rare ones", () => {
    const rows = [
      { query: "vinyl crackle", count: 9 },
      { query: "Vinyl Crackle ", count: 2 },
      { query: "riser sfx", count: 50 },
      { query: "rare thing", count: 2 },
      { query: "me@mail.com", count: 40 },
    ];
    const ideas = ideasFrom(rows, [{ query: "vinyl crackle", count: 4 }], [{ q: "riser" }], 3);
    expect(ideas).toEqual([{ query: "vinyl crackle", searches: 11, zeroResults: 4 }]);
  });
});
