import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createApp } from "../src/api/app.js";
import { OgImages } from "../src/api/og.js";
import { categoryNoun, sampleFacts, sampleMeta, searchMeta, searchShare, shareableSampleId } from "../src/api/search-meta.js";
import { rewriteHead } from "../src/api/site.js";
import { SampleService } from "../src/core/service.js";
import { OG_HEIGHT, OG_WIDTH, clip, fetchImage, pageCard, renderPng, sampleCard } from "../src/og/render.js";
import { KICK, VOCAL, brokenProvider, bytesHttp, fakeProvider } from "./fakes.js";

const SITE = fileURLToPath(new URL("./fixtures/site", import.meta.url));
const service = () => new SampleService({ providers: [fakeProvider, brokenProvider], http: bytesHttp(), defaultTimeoutMs: 200 });
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const meta = (html: string, key: string) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

describe("OG renderer", () => {
  it("renders a 1200×630 PNG card", async () => {
    const png = await renderPng(pageCard({ kicker: "Docs", title: "MCP server for coding agents", subtitle: "Connect Claude Code.", chips: ["MCP"], site: "sound.shep.bot" }));
    expect(isPng(png)).toBe(true);
    expect(await sharp(png).metadata()).toMatchObject({ width: OG_WIDTH, height: OG_HEIGHT, format: "png" });
  });

  it("renders sample cards with a waveform, or with pack artwork", async () => {
    const card = { title: "Deep Kick 01", source: "Freesound", type: "Kick", license: "CC0 1.0", verdict: "Commercial use OK", free: true, facts: ["one-shot", "0.4 s"], author: "drumkid", site: "sound.shep.bot" };
    const wave = await renderPng(sampleCard(card));
    expect(await sharp(wave).metadata()).toMatchObject({ width: OG_WIDTH, height: OG_HEIGHT, format: "png" });
    const art = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#3c6" } }).png().toBuffer();
    const withArt = await renderPng(sampleCard({ ...card, image: `data:image/png;base64,${art.toString("base64")}` }));
    expect(isPng(withArt)).toBe(true);
    expect(Buffer.compare(wave, withArt)).not.toBe(0);
    // The waveform is drawn from the title: stable for one sample, different for another.
    expect(Buffer.compare(wave, await renderPng(sampleCard(card)))).toBe(0);
    expect(Buffer.compare(wave, await renderPng(sampleCard({ ...card, title: "Dusty Snare 02" })))).not.toBe(0);
  });

  it("clips long text on a word boundary", () => {
    expect(clip("The quick brown fox jumps over the lazy dog", 20)).toBe("The quick brown…");
    expect(clip("short", 12)).toBe("short");
  });

  it("fetches artwork as JPEG data URIs (any image format) and refuses internal hosts", async () => {
    const webp = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } }).webp().toBuffer();
    const fetchWebp = (async () => new Response(new Uint8Array(webp), { headers: { "content-type": "image/webp" } })) as typeof fetch;
    const uri = await fetchImage("https://cdn.example/t.webp", { fetch: fetchWebp });
    expect(uri?.startsWith("data:image/jpeg;base64,")).toBe(true);
    const jpeg = Buffer.from(uri!.split(",")[1]!, "base64");
    expect(await sharp(jpeg).metadata()).toMatchObject({ width: 420, height: 420, format: "jpeg" });

    let called = false;
    const spy = (async () => ((called = true), new Response("x"))) as typeof fetch;
    expect(await fetchImage("http://127.0.0.1/x.png", { fetch: spy })).toBeUndefined();
    expect(await fetchImage("http://169.254.169.254/latest", { fetch: spy })).toBeUndefined();
    expect(called).toBe(false);
    // A redirect to an internal host is refused too.
    const redirect = (async (u: string | URL) =>
      String(u).includes("cdn.example") ? new Response(null, { status: 302, headers: { location: "http://10.0.0.5/x.png" } }) : ((called = true), new Response("x"))) as typeof fetch;
    expect(await fetchImage("https://cdn.example/a.png", { fetch: redirect })).toBeUndefined();
    expect(called).toBe(false);
    const html = (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
    expect(await fetchImage("https://cdn.example/a.png", { fetch: html })).toBeUndefined();
  });
});

describe("share metadata", () => {
  it("normalises search share links", () => {
    const s = searchShare(new URLSearchParams("q=  punchy   kick &category=drums.kick,spaceship&free=true&commercial=true&bpm=140&offset=40&providers=freesound,nope"))!;
    expect(s.key).toBe("q=punchy+kick&category=drums.kick&bpm=140&free=true&commercial=true&providers=freesound");
    expect(s).toMatchObject({ kicker: "Search · kick samples", title: "“punchy kick”" });
    expect(s.chips).toEqual(["140 BPM", "Commercial use OK", "Free only", "Freesound"]);
    expect(searchShare(new URLSearchParams("offset=10"))).toBeUndefined();
    expect(searchShare(new URLSearchParams("bpm=fast&q=riser"))?.key).toBe("q=riser"); // malformed BPM is dropped
    expect(searchMeta(new URLSearchParams("q=kick"))).toMatchObject({ image: "/og/query.png?q=kick", robots: "noindex, follow" });
  });

  it("names categories with their own nouns", () => {
    expect(categoryNoun("drums.kick")).toBe("kick samples");
    expect(categoryNoun("fx")).toBe("sound effects");
    expect(categoryNoun("vocals.chop", false)).toBe("vocal chop sample");
    expect(categoryNoun(undefined)).toBe("samples");
  });

  it("validates sample ids against the running providers", () => {
    expect(shareableSampleId("fake:kick", ["fake"])).toBe("fake:kick");
    expect(shareableSampleId("nope:kick", ["fake"])).toBeUndefined();
    expect(shareableSampleId("fake:", ["fake"])).toBeUndefined();
    expect(shareableSampleId("kick", ["fake"])).toBeUndefined();
    expect(shareableSampleId(`fake:${"x".repeat(400)}`, ["fake"])).toBeUndefined();
    expect(shareableSampleId(undefined, ["fake"])).toBeUndefined();
  });

  it("describes a sample for its share link, with its musical facts and licence verdict", () => {
    const m = sampleMeta(KICK);
    expect(m.title).toBe("Deep Kick 01: kick sample on fake · Sound Server");
    expect(m.description).toContain("Kick sample “Deep Kick 01” on fake (one-shot, 0.4 s, CC0 1.0: commercial use OK, free)");
    expect(m.image).toBe("/og/sample.png?id=fake%3Akick");
    expect(sampleFacts(VOCAL)).toEqual(["Vocal chop", "loop", "6.9 s", "F minor", "140 BPM"]);
    expect(sampleMeta(VOCAL).description).toContain("CC BY-NC 4.0: non-commercial only");
  });

  it("rewrites image, alt and url tags with escaping", () => {
    const html = '<meta property="og:image" content="a"><meta name="twitter:image" content="a"><meta property="og:image:alt" content="a"><meta name="twitter:image:alt" content="a"><meta property="og:url" content="a"><meta name="twitter:url" content="a">';
    const out = rewriteHead(html, { image: "https://x/og.png?q=a&b", imageAlt: '"quoted"', url: "https://x/search?q=a" });
    expect(meta(out, "og:image")).toBe("https://x/og.png?q=a&amp;b");
    expect(meta(out, "twitter:image")).toBe("https://x/og.png?q=a&amp;b");
    expect(meta(out, "og:image:alt")).toBe("&quot;quoted&quot;");
    expect(meta(out, "twitter:url")).toBe("https://x/search?q=a");
  });
});

describe("OG endpoints and share links", () => {
  const app = createApp(service(), { siteRoot: SITE, publicBaseUrl: "https://sound.shep.bot" });

  it("serves search cards, cacheable for a day", async () => {
    const res = await app.request("/og/query.png?q=kick&category=drums.kick");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(isPng(new Uint8Array(await res.arrayBuffer()))).toBe(true);
    expect((await app.request("/og/query.png")).status).toBe(404);
    const head = await app.request("/og/query.png?q=kick", { method: "HEAD" });
    expect(head.status).toBe(200);
  });

  it("serves sample cards and 404s unknown or malformed ids", async () => {
    const res = await app.request(`/og/sample.png?id=${encodeURIComponent("fake:kick")}`);
    expect(res.status).toBe(200);
    expect(isPng(new Uint8Array(await res.arrayBuffer()))).toBe(true);
    expect((await app.request("/og/sample.png?id=fake:missing")).status).toBe(404);
    expect((await app.request("/og/sample.png?id=broken:x")).status).toBe(404);
    expect((await app.request("/og/sample.png?id=../../etc")).status).toBe(404);
    expect((await app.request("/og/sample.png")).status).toBe(404);
  });

  it("gives /search?sample= links the sample's title, card and url", async () => {
    const html = await (await app.request("/search?sample=fake%3Akick", { headers: { accept: "text/html" } })).text();
    expect(html).toContain("<title>Deep Kick 01: kick sample on fake · Sound Server</title>");
    expect(meta(html, "og:image")).toBe("https://sound.shep.bot/og/sample.png?id=fake%3Akick");
    expect(meta(html, "twitter:image")).toBe("https://sound.shep.bot/og/sample.png?id=fake%3Akick");
    expect(meta(html, "og:url")).toBe("https://sound.shep.bot/search?sample=fake%3Akick");
    expect(meta(html, "robots")).toBe("noindex, follow");
    // Unknown sample: the plain search page.
    const plain = await (await app.request("/search?sample=fake%3Amissing", { headers: { accept: "text/html" } })).text();
    expect(meta(plain, "og:image")).toBe("https://sound.shep.bot/og/search.png");
  });

  it("gives search links a query card and their own og:url", async () => {
    const html = await (await app.request("/search?q=kick&offset=20", { headers: { accept: "text/html" } })).text();
    expect(meta(html, "og:image")).toBe("https://sound.shep.bot/og/query.png?q=kick");
    expect(meta(html, "og:url")).toBe("https://sound.shep.bot/search?q=kick");
    expect(meta(html, "og:image:alt")).toContain("“kick”");
  });

  it("caches cards and renders at most two at once", async () => {
    let active = 0;
    let peak = 0;
    let lookups = 0;
    const slow = {
      ...fakeProvider,
      async getSample(id: string) {
        lookups++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 30));
        active--;
        return { ...KICK, nativeId: id, id: `fake:${id}`, title: `Kick ${id}`, thumbnailUrl: undefined };
      },
    };
    const og = new OgImages(new SampleService({ providers: [slow], http: bytesHttp() }), { site: "sound.shep.bot" });
    const first = og.sample("fake:a");
    expect(og.sample("fake:a")).toBe(first);
    const cards = await Promise.all([first, og.sample("fake:b"), og.sample("fake:c"), og.sample("fake:d")]);
    expect(cards.every((c) => c && isPng(c))).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(lookups).toBe(4);
  });

  it("does not keep misses, so a sample that appears later gets its card", async () => {
    let exists = false;
    const flaky = { ...fakeProvider, getSample: async () => (exists ? KICK : null) };
    const og = new OgImages(new SampleService({ providers: [flaky], http: bytesHttp() }), { site: "sound.shep.bot" });
    expect(await og.sample("fake:kick")).toBeNull();
    exists = true;
    expect(await og.sample("fake:kick")).not.toBeNull();
  });

  it("returns a shareUrl with sample details (REST)", async () => {
    const body = (await (await app.request(`/v1/samples/${encodeURIComponent("fake:kick")}`)).json()) as { shareUrl: string };
    expect(body.shareUrl).toBe("https://sound.shep.bot/search?sample=fake%3Akick");
  });
});
