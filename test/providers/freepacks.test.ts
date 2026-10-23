import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/core/http.js";
import { FEEDS, freepacks } from "../../src/providers/freepacks.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  ["https://99sounds.org/wp-json/wp/v2/posts?", "freepacks/99sounds_posts.json"],
  ["https://bedroomproducersblog.com/feed/", "freepacks/bpb_feed.xml"],
  ["https://reverbmachine.com/wp-json/wc/store/products?", "freepacks/reverbmachine_free.json"],
];

describe("freepacks", () => {
  it("loads each feed once, in parallel, and returns packs newest first", async () => {
    const ctx = fixtureCtx(routes);
    const r = await freepacks.search({ query: "", limit: 50 }, ctx);
    expect(ctx.fetch.requests.sort()).toEqual([
      "https://99sounds.org/wp-json/wp/v2/posts?categories=1&per_page=100&_fields=id%2Cdate%2Clink%2Ctitle%2Cexcerpt",
      "https://bedroomproducersblog.com/feed/",
      "https://reverbmachine.com/wp-json/wc/store/products?category=213&per_page=100",
    ]);
    // 8 99Sounds posts, 3 BPB free-soundware items (plugin news dropped), 3 Reverb Machine freebies.
    expect(r.samples).toHaveLength(14);
    expect(r.total).toBe(14);
    expect(r.samples[0]).toMatchObject({
      id: "freepacks:bpb:71505",
      title: "Minimal Audio offers Element downtempo sample pack for FREE",
      url: "https://bedroomproducersblog.com/2026/10/22/minimal-audio-element-free/",
      unit: "pack",
      form: "pack",
      createdAt: "2026-10-22",
      price: { free: true },
      downloadable: false,
      thumbnailUrl: "https://bedroomproducersblog.com/wp-content/uploads/2026/10/element.jpg",
      license: { name: "Free pack, see the article", verdict: "check-terms" },
    });
    expect(r.samples[0]!.description).toMatch(/^Minimal Audio is offering Element/);
    expect(r.samples[0]!.description).not.toMatch(/View post/);
    expect(r.samples.some((s) => /HardStop|GLUECOMP|Detunicorn|Review/.test(s.title))).toBe(false);
    expect(r.samples.every((s) => !s.downloadable && s.price?.free && s.license)).toBe(true);
  });

  it("uses each site's licence", async () => {
    const r = await freepacks.search({ query: "", limit: 50 }, fixtureCtx(routes));
    const byId = new Map(r.samples.map((s) => [s.nativeId, s]));
    expect(byId.get("99sounds:3708")).toMatchObject({
      title: "Cinematic Sounds",
      url: "https://99sounds.org/cinematic-sounds/",
      author: "99Sounds",
      createdAt: "2025-10-23",
      license: { name: "99Sounds licence", verdict: "yes", url: "https://99sounds.org/license/" },
    });
    expect(byId.get("reverbmachine:145647")).toMatchObject({
      title: "DX100 Factory Set",
      form: "preset",
      category: "synth",
      license: { name: "Reverb Machine licence", verdict: "yes" },
    });
    // A roundup of "royalty-free sound effects" from many sites is not a royalty-free pack.
    expect(byId.get("bpb:34733")!.license).toMatchObject({ verdict: "check-terms" });
  });

  it("trusts a BPB post only when it says the pack itself is royalty free", () => {
    const xml = (excerpt: string) =>
      `<?xml version="1.0"?><rss><channel><item><title>Acme releases Dusty Keys for FREE</title><link>https://bedroomproducersblog.com/2026/10/01/dusty-keys/</link><pubDate>Thu, 01 Oct 2026 10:00:00 +0000</pubDate><category><![CDATA[Free Soundware]]></category><guid isPermaLink="false">https://bedroomproducersblog.com/?p=123</guid><description><![CDATA[<p>${excerpt}</p>]]></description></item></channel></rss>`;
    const [stated] = FEEDS.bpb.parse(xml("The samples are 100% royalty-free and come as WAV."));
    expect(FEEDS.bpb.license(stated!)).toMatchObject({ name: "Royalty free (stated in the article)", verdict: "yes", assertedBy: "source" });
    const [plain] = FEEDS.bpb.parse(xml("A free pack of dusty piano loops."));
    expect(FEEDS.bpb.license(plain!)).toMatchObject({ verdict: "check-terms" });
  });

  it("filters locally by text and category", async () => {
    const ctx = fixtureCtx(routes);
    const cinematic = await freepacks.search({ query: "cinematic", limit: 10 }, ctx);
    expect(cinematic.samples.map((s) => s.title)).toEqual(expect.arrayContaining(["Cinematic Sounds", "Cinematic Textures"]));
    const presets = await freepacks.search({ query: "", forms: ["preset"], limit: 10 }, ctx);
    expect(presets.samples.every((s) => s.form === "preset")).toBe(true);
    expect(presets.samples).toHaveLength(3);
    expect((await freepacks.search({ query: "", forms: ["one-shot"], limit: 10 }, ctx)).samples).toEqual([]);
    // Two searches read the three feeds (the client caches them for an hour); the one-shot search made no request.
    expect(ctx.fetch.requests).toHaveLength(6);
  });

  it("keeps working when one feed fails, and fails when all do", async () => {
    const partial = fixtureCtx(routes.filter(([m]) => !String(m).includes("bedroomproducersblog")));
    const r = await freepacks.search({ query: "", limit: 50 }, partial);
    expect(r.samples).toHaveLength(11);
    await expect(freepacks.search({ query: "", limit: 5 }, fixtureCtx([]))).rejects.toBeInstanceOf(HttpError);
  });

  it("resolves one item from its feed", async () => {
    const ctx = fixtureCtx(routes);
    const d = await freepacks.getSample!("99sounds:3407", ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(d).toMatchObject({ id: "freepacks:99sounds:3407", title: "Dub Reggae Sounds", files: [] });
    expect(await freepacks.getSample!("99sounds:1", ctx)).toBeNull();
    expect(await freepacks.getSample!("evil:1", ctx)).toBeNull();
  });

  it("counts the feeds", async () => {
    const c = await freepacks.census!(fixtureCtx(routes));
    expect(c).toMatchObject({ total: 14, free: 14, unit: "packs" });
  });

  it("builds search links", () => {
    expect(freepacks.buildSearchUrl({ query: "drum kit", limit: 1 })).toBe("https://99sounds.org/?s=drum+kit");
    expect(freepacks.buildSearchUrl({ query: "", limit: 1 })).toBe("https://99sounds.org/sounds/");
  });
});
