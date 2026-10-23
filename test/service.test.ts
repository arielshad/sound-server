import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApp } from "../src/api/app.js";
import { PrometheusAnalytics, noopAnalytics, type ConnectEvent, type ToolCallEvent } from "../src/core/analytics.js";
import { NetworkClassifier } from "../src/core/network.js";
import { prefersMarkdown } from "../src/api/negotiate.js";
import { openApiSpec } from "../src/api/openapi.js";
import { searchMeta } from "../src/api/search-meta.js";
import { buildCsp, rewriteHead, umamiHead } from "../src/api/site.js";
import { createHash } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import {
  assertPublicHost,
  assertPublicUrl,
  downloadSample,
  extractZip,
  safeRelative,
  selectFiles,
  setHostResolver,
} from "../src/core/download.js";
import { SampleService, dedupe, passes } from "../src/core/service.js";
import { makeSample } from "../src/core/util.js";
import { license } from "../src/core/licence.js";
import { createMcpServer } from "../src/mcp/server.js";
import { allProviders } from "../src/providers/index.js";
import { linkProvider } from "../src/providers/link.js";
import { KICK, VOCAL, brokenProvider, bytesHttp, fakeProvider, slowProvider } from "./fakes.js";

const splice = linkProvider({
  id: "splice",
  name: "Splice",
  homepage: "https://splice.com",
  description: "Subscription sample library.",
  categories: ["drums", "vocals", "fx"],
  pricing: "paid",
  buildSearchUrl: (q) => `https://splice.com/sounds/search/samples?q=${encodeURIComponent(q.query)}`,
});

// Test hosts don't resolve; pretend every name is public.
beforeAll(() => setHostResolver(async () => ["93.184.216.34"]));

function service(http = bytesHttp()) {
  return new SampleService({ providers: [fakeProvider, brokenProvider, slowProvider, splice], http, defaultTimeoutMs: 200 });
}

describe("SampleService.search", () => {
  it("merges results and reports every provider", async () => {
    const res = await service().search({ query: "deep kick" });
    expect(res.results.map((a) => a.id)).toEqual(["fake:kick"]);
    const status = Object.fromEntries(res.providers.map((p) => [p.provider, p.status]));
    expect(status).toEqual({ fake: "ok", broken: "error", slow: "timeout", splice: "link" });
    expect(res.providers.find((p) => p.provider === "splice")?.searchUrl).toContain("splice.com/sounds/search/samples?q=deep%20kick");
  });

  it("parses BPM and key out of the query into filters", async () => {
    const res = await service().search({ query: "vocal chop 140 bpm in F minor", providers: ["fake"] });
    expect(res.query).toBe("vocal chop");
    expect(res.filters).toMatchObject({ bpm: { min: 140, max: 140 }, key: { tonic: "F", mode: "minor" } });
    expect(res.results.map((a) => a.id)).toEqual(["fake:vocal"]);
    // Known mismatches go; the kick (no BPM, no key) stays only outside strict mode.
    const strict = await service().search({ query: "120 bpm", providers: ["fake"], strict: true });
    expect(strict.results).toEqual([]);
  });

  it("filters by category and licence verdict", async () => {
    const res = await service().search({ query: "", providers: ["fake"], categories: ["drums"] });
    expect(res.results.map((a) => a.id)).toEqual(["fake:kick", "fake:pack"]);
    const safe = await service().search({ query: "", providers: ["fake"], commercialOnly: true });
    expect(safe.results.map((a) => a.id)).not.toContain("fake:vocal");
  });

  it("skips providers that cannot match the filters", async () => {
    const res = await service().search({ query: "rain", categories: ["ambience"] });
    expect(res.results).toEqual([]);
    expect(res.providers.find((p) => p.provider === "fake")?.status).toBe("skipped");
  });

  it("supports provider allow-lists and downloadable-only", async () => {
    const res = await service().search({ query: "", providers: ["fake"], downloadableOnly: true });
    expect(res.providers.map((p) => p.provider)).toEqual(["fake"]);
    expect(res.results.map((a) => a.id).sort()).toEqual(["fake:kick", "fake:vocal"]);
  });

  it("rejects unknown providers and bad ids", async () => {
    await expect(service().search({ query: "x", providers: ["nope"] })).rejects.toThrow(/Unknown provider/);
    await expect(service().getSample("no-colon")).rejects.toThrow(/Invalid sample id/);
    await expect(service().getSample("broken:x")).rejects.toThrow(/does not support/);
  });

  it("drops mirrored copies of the same sound, keeping the original source", () => {
    const original = makeSample({ provider: "freesound", nativeId: "1", title: "Kick", tags: [], url: "https://freesound.org/s/1", downloadable: true });
    const mirror = makeSample({ provider: "openverse", nativeId: "u", title: "Kick", tags: [], url: "https://openverse.org/audio/u", sameAs: ["freesound:1"], downloadable: true });
    const kept = dedupe(
      [
        { sample: mirror, provider: { id: "openverse" } },
        { sample: original, provider: { id: "freesound" } },
      ],
      ["freesound", "openverse"],
    );
    expect(kept.map((k) => k.sample.id)).toEqual(["freesound:1"]);
  });

  it("applies filters with known-vs-unknown values", () => {
    expect(passes(KICK, { forms: ["loop"] })).toBe(false);
    expect(passes(KICK, { bpm: { min: 140, max: 140 } })).toBe(true);
    expect(passes(KICK, { bpm: { min: 140, max: 140 } }, { strict: true })).toBe(false);
    expect(passes(VOCAL, { bpm: { min: 70, max: 70 } })).toBe(true); // half time
    expect(passes(VOCAL, { key: { tonic: "G#", mode: "major" } })).toBe(true); // relative major
    expect(passes(VOCAL, { maxDurationSec: 2 })).toBe(false);
    expect(passes(VOCAL, { commercialOnly: true })).toBe(false);
  });
});

describe("selectFiles", () => {
  it("prefers the lossless original over previews", () => {
    expect(selectFiles(KICK).map((f) => f.filename)).toEqual(["kick.wav"]);
  });
  it("honours format and role", () => {
    expect(selectFiles(KICK, { format: "flac" }).map((f) => f.filename)).toEqual(["kick.flac"]);
    expect(selectFiles(KICK, { role: "preview" }).map((f) => f.filename)).toEqual(["kick.mp3"]);
    expect(selectFiles(KICK, { format: "aiff" })).toEqual([]);
  });
  it("never picks files that need a login, falling back to the preview", () => {
    const s = { ...KICK, files: KICK.files.map((f) => (f.role === "original" ? { ...f, requiresAuth: true } : f)) };
    expect(selectFiles(s).map((f) => f.filename)).toEqual(["kick.mp3"]);
  });
  it("keeps construction-kit stems and MIDI together", () => {
    const s = {
      ...KICK,
      files: [
        { url: "https://x.example/a.wav", filename: "drums.wav", format: "wav", role: "stem" as const },
        { url: "https://x.example/b.wav", filename: "bass.wav", format: "wav", role: "stem" as const },
        { url: "https://x.example/c.mid", filename: "bass.mid", format: "mid", role: "midi" as const },
      ],
    };
    expect(selectFiles(s)).toHaveLength(3);
  });
});

describe("download safety", () => {
  it("rejects path traversal and internal URLs", async () => {
    expect(() => safeRelative("../etc/passwd")).toThrow();
    expect(safeRelative("./drums//a.wav")).toBe("drums/a.wav");
    expect(() => assertPublicUrl("http://127.0.0.1/x")).toThrow();
    expect(() => assertPublicUrl("http://localhost:8080/x")).toThrow();
    expect(() => assertPublicUrl("http://[::ffff:10.0.0.1]/x")).toThrow();
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow();
    expect(assertPublicUrl("https://cdn.freesound.org/a.mp3").hostname).toBe("cdn.freesound.org");
  });

  it("refuses names that resolve to private addresses", async () => {
    setHostResolver(async () => ["10.1.2.3"]);
    try {
      await expect(assertPublicHost("https://evil.example/x.wav")).rejects.toThrow(/private address/);
    } finally {
      setHostResolver(async () => ["93.184.216.34"]);
    }
  });

  it("re-checks redirects", async () => {
    const http = {
      ...bytesHttp(),
      async raw(url: string) {
        if (url.includes("start")) return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
        return new Response("x");
      },
    };
    const dir = await mkdtemp(join(tmpdir(), "dl-"));
    try {
      const s = { ...KICK, files: [{ url: "https://cdn.fake.example/start.wav", filename: "x.wav", format: "wav", role: "original" as const }] };
      await expect(downloadSample(http, s, s.files, dir)).rejects.toThrow(/private address|Refusing/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("downloadSample", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("files single sounds by category", async () => {
    dir = await mkdtemp(join(tmpdir(), "samples-"));
    const res = await downloadSample(bytesHttp(), KICK, selectFiles(KICK), dir);
    const rel = res.files.map((f) => f.path.slice(dir!.length + 1).replaceAll("\\", "/"));
    expect(rel).toEqual(["drums/kick/fake-kick Deep Kick 01.wav"]);
    expect(await readFile(res.files[0]!.path, "utf8")).toBe("data:kick.wav");
  });

  it("enforces the size limit before downloading", async () => {
    dir = await mkdtemp(join(tmpdir(), "samples-"));
    await expect(downloadSample(bytesHttp(), KICK, selectFiles(KICK), dir, { maxBytes: 3 })).rejects.toThrow(/limit/);
  });

  it("extracts zips by streaming, skipping zip-slip and macOS entries, within caps", async () => {
    dir = await mkdtemp(join(tmpdir(), "zip-"));
    const zip = join(dir, "pack.zip");
    await writeFile(
      zip,
      zipSync({
        "Kicks/kick1.wav": new Uint8Array(1000).fill(1),
        "Snares/snare1.wav": new Uint8Array(500).fill(2),
        "../evil.wav": new Uint8Array(1),
        "__MACOSX/._kick1.wav": new Uint8Array(1),
      }),
    );
    const out = await extractZip(zip, join(dir, "pack"));
    expect(out.map((o) => o.path.slice(dir!.length + 1).replaceAll("\\", "/")).sort()).toEqual(["pack/Kicks/kick1.wav", "pack/Snares/snare1.wav"]);
    await expect(extractZip(zip, join(dir, "small"), { maxBytes: 1200 })).rejects.toThrow(/expands beyond/);
    await expect(extractZip(zip, join(dir, "few"), { maxEntries: 1 })).rejects.toThrow(/more than 1 files/);
  });
});

const SITE = fileURLToPath(new URL("./fixtures/site", import.meta.url));

describe("HTTP API", () => {
  const app = createApp(service(), { siteRoot: SITE });

  it("searches with sample filters", async () => {
    const res = await app.request("/v1/search?q=kick&category=drums&form=one-shot&providers=fake");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results[0]?.id).toBe("fake:kick");
    const vocal = (await (await app.request("/v1/search?q=vocal&bpm=140&key=Fm&providers=fake")).json()) as { filters: object; results: { id: string }[] };
    expect(vocal.filters).toMatchObject({ bpm: { min: 140, max: 140 }, key: { tonic: "F", mode: "minor" } });
    expect(vocal.results[0]?.id).toBe("fake:vocal");
  });

  it("validates parameters", async () => {
    expect((await app.request("/v1/search?q=x&category=spaceship")).status).toBe(400);
    expect((await app.request("/v1/search?q=x&bpm=fast")).status).toBe(400);
    expect((await app.request("/v1/search?q=x&key=H")).status).toBe(400);
    expect((await app.request("/v1/search?q=x&providers=nope")).status).toBe(400);
    expect((await app.request("/v1/samples/fake:missing")).status).toBe(404);
  });

  it("never returns file request headers", async () => {
    const withHeaders = {
      ...fakeProvider,
      async getSample() {
        return { ...KICK, files: KICK.files.map((f) => ({ ...f, headers: { authorization: "Bearer secret", referer: "https://x" } })) };
      },
    };
    const a = createApp(new SampleService({ providers: [withHeaders], http: bytesHttp() }), { siteRoot: SITE });
    const body = await (await a.request("/v1/samples/fake:kick")).text();
    expect(body).not.toContain("secret");
    expect(body).not.toContain("headers");
    const files = await (await a.request("/v1/samples/fake:kick/files?all=true")).text();
    expect(files).not.toContain("secret");
  });

  it("streams a zip bundle with credits", async () => {
    const res = await app.request(`/v1/samples/${encodeURIComponent("fake:kick")}/download?bundle=true`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("x-license")).toBe("CC0-1.0; verdict=yes");
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "fake-kick/ATTRIBUTION.md",
      "fake-kick/credits.json",
      "fake-kick/drums/kick/fake-kick Deep Kick 01.wav",
    ]);
  });

  it("redirects for a single plain file", async () => {
    const res = await app.request("/v1/samples/fake:kick/download?format=flac");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.fake.example/kick.flac");
  });

  it("serves previews: redirect for plain ones, proxied with CORS on request", async () => {
    const r = await app.request("/v1/samples/fake:kick/preview");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://cdn.fake.example/kick.mp3");
    const proxied = await app.request("/v1/samples/fake:kick/preview?proxy=1");
    expect(proxied.status).toBe(200);
    expect(proxied.headers.get("access-control-allow-origin")).toBe("*");
    expect(await proxied.text()).toBe("data:kick.mp3");
  });

  it("serves the website to browsers and JSON to API clients", async () => {
    const html = await app.request("/", { headers: { accept: "text/html" } });
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(html.headers.get("content-security-policy")).toContain("media-src 'self' https: blob:");
    expect(html.headers.get("link")).toBe('</AGENTS.md>; rel="alternate"; type="text/markdown"');
    expect(await html.text()).toContain("Sound Server");
    const json = (await (await app.request("/")).json()) as { name: string; agents: { instructions: string } };
    expect(json.name).toBe("sound-server");
    expect(json.agents.instructions).toBe("/AGENTS.md");
  });

  it("gives agents markdown when they ask for it", async () => {
    const root = await app.request("/", { headers: { accept: "text/markdown, text/html;q=0.9" } });
    expect(root.headers.get("content-type")).toContain("text/markdown");
    expect(await root.text()).toContain("agent guide");
    const mcp = await app.request("/docs/mcp", { headers: { accept: "text/markdown" } });
    expect((await mcp.text()).replace(/\r\n/g, "\n")).toBe("# MCP setup\n");
    expect((await app.request("/agents.md")).status).toBe(200);
    expect(await (await app.request("/llms.txt")).text()).toContain("Sound Server");
  });

  it("negotiates Markdown vs HTML on the homepage with Vary: Accept", async () => {
    const md = await app.request("/", { headers: { accept: "text/markdown" } });
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("vary")).toContain("Accept");
    expect((await md.text()).length).toBeGreaterThan(0);
    const html = await app.request("/", { headers: { accept: "text/html" } });
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("vary")).toContain("Accept");
    const json = await app.request("/");
    expect(json.headers.get("vary")).toContain("Accept");
    const twin = await app.request("/docs/mcp", { headers: { accept: "text/markdown" } });
    expect(twin.headers.get("content-type")).toContain("text/markdown");
    expect(twin.headers.get("vary")).toContain("Accept");
    // A client that ranks HTML above Markdown gets HTML.
    const ranked = await app.request("/", { headers: { accept: "text/markdown;q=0.5, text/html" } });
    expect(ranked.headers.get("content-type")).toContain("text/html");
  });

  it("answers unknown paths with a Markdown 404 for agents and HTML for browsers", async () => {
    const md = await app.request("/__ora-404-probe", { headers: { accept: "text/markdown" } });
    expect(md.status).toBe(404);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("vary")).toContain("Accept");
    const body = await md.text();
    expect(body.length).toBeGreaterThan(20);
    expect(body).toContain("/llms.txt");
    expect(body).toContain("/sitemap-index.xml");
    expect(body).toContain("/__ora-404-probe");
    const html = await app.request("/__ora-404-probe", { headers: { accept: "text/html" } });
    expect(html.status).toBe(404);
    expect(html.headers.get("content-type")).toContain("text/html");
    // Hostile paths can't break out of the inline code span.
    const hostile = await app.request("/a%60%0A%23injected", { headers: { accept: "text/markdown" } });
    expect(hostile.status).toBe(404);
    expect(hostile.headers.get("content-type")).toContain("text/markdown");
    expect(await hostile.text()).not.toMatch(/\n#\s*injected/);
    const backtick = await (await app.request("/x`y", { headers: { accept: "text/markdown" } })).text();
    expect(backtick).toContain("`/xy`");
    // API paths keep JSON errors.
    const api = await app.request("/v1/nope", { headers: { accept: "text/markdown" } });
    expect(api.headers.get("content-type")).toContain("application/json");
  });

  it("redirects predictable developer URLs and browser visits to /mcp", async () => {
    for (const [from, to] of [["/api", "/docs/api"], ["/developers", "/docs"], ["/reference", "/docs/api/reference"], ["/privacy-policy", "/privacy"]]) {
      const res = await app.request(from!);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(to);
    }
    const browser = await app.request("/mcp", { headers: { accept: "text/html,application/xhtml+xml" } });
    expect(browser.status).toBe(302);
    expect(browser.headers.get("location")).toBe("/docs/mcp");
  });

  it("serves site pages with canonical URLs, caching and a 404 page", async () => {
    expect((await app.request("/docs/mcp")).status).toBe(200);
    const slash = await app.request("/docs/mcp/?x=1");
    expect(slash.status).toBe(301);
    expect(slash.headers.get("location")).toBe("/docs/mcp?x=1");
    const asset = await app.request("/_astro/app.abc123.js");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const again = await app.request("/_astro/app.abc123.js", { headers: { "if-none-match": asset.headers.get("etag")! } });
    expect(again.status).toBe(304);
    const missing = await app.request("/no/such/page");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/html");
    const apiMissing = await app.request("/v1/nope");
    expect(apiMissing.status).toBe(404);
    expect(apiMissing.headers.get("content-type")).toContain("application/json");
  });

  it("records analytics for searches, downloads and page views", async () => {
    const lines: string[] = [];
    const analytics = new PrometheusAnalytics((l) => lines.push(l));
    const tracked = createApp(service(), { siteRoot: SITE, analytics });
    await tracked.request("/v1/search?q=Kick&providers=fake", { headers: { "x-sound-client": "web", "user-agent": "Mozilla/5.0" } });
    await tracked.request("/v1/samples/fake:kick/download?format=flac", { headers: { "user-agent": "curl/8.5" } });
    await tracked.request("/docs/mcp");
    const metrics = await analytics.registry.metrics();
    expect(metrics).toContain('sound_server_searches_total{surface="web",client="browser",category="any",free_only="false",has_results="true"} 1');
    expect(metrics).toContain('sound_server_provider_requests_total{provider="fake",status="ok"} 1');
    expect(metrics).toContain('sound_server_downloads_total{surface="api",client="curl",provider="fake",kind="redirect"} 1');
    expect(metrics).toContain('sound_server_page_views_total{page="/docs/mcp"} 1');
    expect(metrics).toContain('sound_server_http_requests_total{route="/v1/search",method="GET",status="2xx"} 1');
    const search = JSON.parse(lines.find((l) => l.includes('"event":"search"'))!);
    expect(search).toMatchObject({ event: "search", surface: "web", query: "kick", results: 1 });
  });

  it("counts MCP tool calls by client", async () => {
    const analytics = new PrometheusAnalytics(() => undefined);
    const tracked = createApp(service(), { siteRoot: SITE, analytics });
    await tracked.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "claude-code/2.1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_sources", arguments: {} } }),
    });
    expect(await analytics.registry.metrics()).toContain(
      'sound_server_mcp_tool_calls_total{tool="list_sources",client="claude-code",outcome="ok",network="unknown",consistency="no_session"} 1',
    );
  });

  it("labels MCP tool calls with the client declared at initialize, the caller's network and consistency", async () => {
    const lines: string[] = [];
    const analytics = new PrometheusAnalytics((l) => lines.push(l));
    const networks = new NetworkClassifier();
    const tracked = createApp(service(), { siteRoot: SITE, analytics, networks, mcpSessionSecret: "test-secret" });
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "user-agent": "node",
      "x-forwarded-for": "160.79.105.20",
    };
    const init = await tracked.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } },
      }),
    });
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("sound-server");

    const call = (session: string | undefined, ip: string) =>
      tracked.request("/mcp", {
        method: "POST",
        headers: { ...headers, "x-forwarded-for": ip, "mcp-protocol-version": "2025-06-18", ...(session ? { "mcp-session-id": session } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_sources", arguments: {} } }),
      });
    expect((await call(sessionId!, "160.79.105.20")).status).toBe(200);
    expect((await call(sessionId!, "160.79.105.20")).status).toBe(200);
    // A session ID this server did not issue is still served, just labelled.
    expect((await call("someone-elses-session", "10.0.0.3")).status).toBe(200);

    const metrics = await analytics.registry.metrics();
    expect(metrics).toContain('sound_server_mcp_connects_total{client="claude-ai",client_version="0.1",network="anthropic"} 1');
    expect(metrics).toContain(
      'sound_server_mcp_tool_calls_total{tool="list_sources",client="claude-ai",outcome="ok",network="anthropic",consistency="consistent"} 2',
    );
    expect(metrics).toContain(
      'sound_server_mcp_tool_calls_total{tool="list_sources",client="node",outcome="ok",network="private",consistency="bad_session"} 1',
    );
    expect(metrics).toContain('sound_server_mcp_new_callers_total{client="claude-ai",network="anthropic"} 1');
    const connect = JSON.parse(lines.find((l) => l.includes('"event":"mcp_connect"'))!);
    expect(connect).toMatchObject({ client: "claude-ai", client_name: "claude-ai", client_version: "0.1", network: "anthropic" });
    // The address itself is never logged.
    expect(lines.join("\n")).not.toContain("160.79.105.20");
  });

  it("requires the API key when configured", async () => {
    const secured = createApp(service(), { apiKey: "s3cret", siteRoot: SITE });
    expect((await secured.request("/v1/providers")).status).toBe(401);
    expect((await secured.request("/v1/providers", { headers: { authorization: "Bearer s3cret" } })).status).toBe(200);
    // Never in the URL: it would leak into logs and Referer headers.
    expect((await secured.request("/v1/providers?api_key=s3cret")).status).toBe(401);
    expect((await secured.request("/health")).status).toBe(200);
    expect((await secured.request("/", { headers: { accept: "text/html" } })).status).toBe(200);
  });

  it("serves MCP over streamable HTTP", async () => {
    const init = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }),
    });
    expect(init.status).toBe(200);
    const list = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const body = (await list.json()) as { result: { tools: { name: string }[] } };
    // download_sample writes to disk, so it is off for the HTTP transport by default.
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(["build_kit", "extract_midi", "find_similar", "get_sample", "list_sources", "search_samples"]);
  });

  it("can turn off HTTP MCP and keep the website and search API", async () => {
    const webOnly = createApp(service(), { siteRoot: SITE, httpMcpDisabled: true });
    const mcp = await webOnly.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    });
    expect(mcp.status).toBe(404);
    // No redirect to the setup guide either: there is nothing to set up.
    expect((await webOnly.request("/mcp", { headers: { accept: "text/html" } })).status).toBe(404);
    expect((await webOnly.request("/v1/search?q=kick&category=drums&providers=fake")).status).toBe(200);
    expect((await webOnly.request("/", { headers: { accept: "text/html" } })).status).toBe(200);
    const index = (await (await webOnly.request("/", { headers: { accept: "application/json" } })).json()) as { agents: object; endpoints: object };
    expect(index.agents).not.toHaveProperty("mcp");
    expect(index.endpoints).not.toHaveProperty("mcp");
  });
});

describe("MCP tools", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function connect(downloadDir?: string, publicBaseUrl?: string) {
    const server = createMcpServer(service(), { allowLocalDownload: true, downloadDir, publicBaseUrl });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);

  it("labels stdio tool calls with the client's declared name", async () => {
    const calls: ToolCallEvent[] = [];
    const connects: ConnectEvent[] = [];
    const analytics = { ...noopAnalytics, toolCall: (e: ToolCallEvent) => calls.push(e), mcpConnect: (e: ConnectEvent) => connects.push(e) };
    const server = createMcpServer(service(), { allowLocalDownload: false, analytics });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "claude-code", version: "2.1.0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    await client.callTool({ name: "list_sources", arguments: {} });
    expect(connects).toEqual([{ client: "claude-code", clientVersion: "2", clientName: "claude-code" }]);
    expect(calls).toMatchObject([{ tool: "list_sources", client: "claude-code", outcome: "ok" }]);
  });

  it("search_samples returns compact results with licence verdicts, commercial-safe by default", async () => {
    const client = await connect();
    const r = text(await client.callTool({ name: "search_samples", arguments: { query: "" , providers: ["fake", "splice"] } }));
    expect(r.results.map((x: { id: string }) => x.id)).not.toContain("fake:vocal");
    expect(r.results[0]).toMatchObject({ id: "fake:kick", category: "drums.kick", license: { verdict: "yes" }, downloadable: true });
    expect(r.also_search_on[0].provider).toBe("Splice");
    const all = text(await client.callTool({ name: "search_samples", arguments: { query: "vocal", commercial_only: false, providers: ["fake"] } }));
    expect(all.results[0]).toMatchObject({ id: "fake:vocal", license: { verdict: "no" } });
    const broken = text(await client.callTool({ name: "search_samples", arguments: { query: "kick" } }));
    expect(broken.unavailable.map((u: { provider: string }) => u.provider).sort()).toEqual(["broken", "slow"]);
  });

  it("get_sample shows files and the selection", async () => {
    const client = await connect();
    const r = text(await client.callTool({ name: "get_sample", arguments: { id: "fake:kick" } }));
    expect(r.files.map((f: { filename: string }) => f.filename)).toEqual(["kick.mp3", "kick.wav", "kick.flac"]);
    expect(r.selection.files).toEqual(["kick.wav"]);
    expect(r.shareUrl).toBeUndefined();
    const linked = text(await (await connect(undefined, "https://sound.shep.bot/")).callTool({ name: "get_sample", arguments: { id: "fake:kick" } }));
    expect(linked.shareUrl).toBe("https://sound.shep.bot/search?sample=fake%3Akick");
    expect(linked.selection.downloadUrl).toBe("https://sound.shep.bot/v1/samples/fake%3Akick/download");
  });

  it("without local downloads, tells agents to fetch downloadUrl themselves", async () => {
    const server = createMcpServer(service(), { allowLocalDownload: false, publicBaseUrl: "https://sound.shep.bot" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getInstructions()).toContain("selection.downloadUrl");
    expect(client.getInstructions()).not.toContain("download_sample");
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "get_sample")?.description).not.toContain("download_sample");
  });

  it("download_sample files the sound by category and writes the credits", async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-"));
    const client = await connect(dir);
    const r = text(await client.callTool({ name: "download_sample", arguments: { id: "fake:kick" } }));
    expect(r.directory).toBe(dir);
    expect(r.files).toEqual([join(dir, "drums/kick/fake-kick Deep Kick 01.wav")]);
    const credits = JSON.parse(await readFile(join(dir, "credits.json"), "utf8"));
    expect(JSON.stringify(credits)).toContain("fake:kick");
    expect(await readFile(join(dir, "ATTRIBUTION.md"), "utf8")).toContain("Deep Kick 01");
    // A second download merges into the same credits.
    await client.callTool({ name: "download_sample", arguments: { id: "fake:vocal" } });
    const both = JSON.stringify(JSON.parse(await readFile(join(dir, "credits.json"), "utf8")));
    expect(both).toContain("fake:kick");
    expect(both).toContain("fake:vocal");
  });

  it("reports errors as tool errors", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "get_sample", arguments: { id: "fake:missing" } });
    expect(r.isError).toBe(true);
  });
});

describe("content negotiation", () => {
  it("prefers Markdown only when ranked at least as high as HTML", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
    expect(prefersMarkdown("text/html, text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown;q=0.5, text/html")).toBe(false);
    expect(prefersMarkdown("text/markdown;q=0")).toBe(false);
    expect(prefersMarkdown("text/html,application/xhtml+xml,*/*;q=0.8")).toBe(false);
    expect(prefersMarkdown(undefined)).toBe(false);
  });
});

describe("rate limiting", () => {
  const make = (limit = 3) => {
    let now = 1_000_000;
    const app = createApp(service(), { siteRoot: SITE, rateLimit: { limit, windowSec: 60, now: () => now } });
    return { app, tick: (s: number) => (now += s * 1000) };
  };
  const from = (ip: string) => ({ headers: { "x-forwarded-for": `${ip}, 10.42.0.7` } });

  it("sends RateLimit headers and 429 + Retry-After past the limit", async () => {
    const { app } = make(3);
    const first = await app.request("/v1/providers", from("203.0.113.1"));
    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-policy")).toBe('"default";q=3;w=60');
    expect(first.headers.get("ratelimit")).toBe('"default";r=2;t=60');
    expect(first.headers.get("ratelimit-limit")).toBe("3");
    expect(first.headers.get("ratelimit-remaining")).toBe("2");
    expect(first.headers.get("ratelimit-reset")).toBe("60");
    expect(first.headers.get("access-control-expose-headers")).toContain("RateLimit");
    await app.request("/v1/providers", from("203.0.113.1"));
    await app.request("/v1/providers", from("203.0.113.1"));
    const over = await app.request("/v1/providers", from("203.0.113.1"));
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe("60");
    expect(over.headers.get("ratelimit-remaining")).toBe("0");
    expect(((await over.json()) as { retryAfter: number }).retryAfter).toBe(60);
  });

  it("counts clients separately, resets per window and leaves pages and health alone", async () => {
    const { app, tick } = make(1);
    expect((await app.request("/v1/providers", from("203.0.113.1"))).status).toBe(200);
    expect((await app.request("/v1/providers", from("203.0.113.1"))).status).toBe(429);
    expect((await app.request("/v1/providers", from("203.0.113.2"))).status).toBe(200);
    tick(61);
    expect((await app.request("/v1/providers", from("203.0.113.1"))).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/health", from("203.0.113.1"))).status).toBe(200);
      expect((await app.request("/docs/mcp", from("203.0.113.1"))).status).toBe(200);
    }
  });

  it("limits the MCP endpoint too", async () => {
    const { app } = make(1);
    const call = () =>
      app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "198.51.100.9" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  it("is documented in the OpenAPI spec with a versioning policy", () => {
    const spec = openApiSpec() as unknown as {
      paths: Record<string, Record<string, { responses: Record<string, { headers?: Record<string, unknown> }> }>>;
      "x-api-lifecycle": { deprecationPolicy: string };
    };
    expect(spec.paths["/v1/search"]!.get!.responses["429"]).toBeDefined();
    expect(spec.paths["/v1/search"]!.get!.responses["200"]!.headers).toHaveProperty("RateLimit");
    expect(spec.paths["/mcp"]!.post!.responses["429"]).toBeDefined();
    expect(spec.paths["/health"]!.get!.responses["429"]).toBeUndefined();
    expect(spec["x-api-lifecycle"].deprecationPolicy).toContain("/docs/api/versioning");
  });
});

describe("site security, compression and SEO variants", () => {
  const app = createApp(service(), { siteRoot: SITE, publicBaseUrl: "https://sound.shep.bot" });
  const html = { headers: { accept: "text/html" } };

  it("sends a strict per-page CSP with hashes instead of 'unsafe-inline'", async () => {
    const res = await app.request("/", html);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).not.toContain("'unsafe-inline'");
    const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
    expect(csp).toContain(`script-src 'self' ${hash('document.documentElement.dataset.ok="1"')}`);
    expect(csp).toContain(hash("astro-island{display:contents}"));
    expect(csp).toContain(`'unsafe-hashes' ${hash("color:red")}`);
    expect(csp).not.toContain(hash('{"@context":"https://schema.org"}')); // JSON-LD is not executable
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("builds CSPs for nonces and the inline-style exception", () => {
    expect(buildCsp("<p></p>", { styleNonce: "abc" })).toContain("style-src 'self' 'nonce-abc'");
    expect(buildCsp("<p></p>", { inlineStyles: true })).toContain("style-src 'self' 'unsafe-inline'");
    expect(buildCsp('<script src="/a.js"></script>')).toContain("script-src 'self';");
    expect(buildCsp('<p style="a:&quot;b&quot;">')).toContain(`'sha256-${createHash("sha256").update('a:"b"').digest("base64")}'`);
  });

  it("adds the Umami tracker to every page only when configured", async () => {
    const umami = { websiteId: "8e5f2c1a-3b4d-4e6f-9a0b-1c2d3e4f5a6b", host: "https://stats.example/", domain: "sound.shep.bot" };
    const tracked = createApp(service(), { siteRoot: SITE, umami });
    const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
    const helper = /<script>([\s\S]*?)<\/script><script defer src="https:\/\/stats\.example\/script\.js"/;

    for (const path of ["/", "/search?q=oak+tree", "/docs/api/playground"]) {
      const res = await tracked.request(path, html);
      const body = await res.text();
      expect(body, path).toContain(
        '<script defer src="https://stats.example/script.js" data-website-id="8e5f2c1a-3b4d-4e6f-9a0b-1c2d3e4f5a6b" data-domains="sound.shep.bot" data-do-not-track="true" data-before-send="umamiBeforeSend"></script></head>',
      );
      const csp = res.headers.get("content-security-policy")!;
      expect(csp, path).toContain("script-src 'self' https://stats.example ");
      expect(csp, path).toContain("connect-src 'self' https: https://stats.example;");
      expect(csp, path).toContain(hash(helper.exec(body)![1]!));
    }
    const off = await app.request("/", html);
    expect(await off.text()).not.toContain("umami");
    expect(off.headers.get("content-security-policy")).toContain("connect-src 'self' https:;");
    // Same file, different markup: the ETag changes so caches refetch.
    expect((await tracked.request("/", html)).headers.get("etag")).not.toBe(off.headers.get("etag"));
    expect(() => umamiHead({ ...umami, websiteId: '"><script>' })).toThrow(/UUID/);
  });

  it("keeps search text out of what the Umami helper lets through", () => {
    const head = umamiHead({ websiteId: "8e5f2c1a-3b4d-4e6f-9a0b-1c2d3e4f5a6b", host: "https://stats.example" });
    const code = /<script>([\s\S]*?)<\/script>/.exec(head)![1]!;
    const win: { umamiBeforeSend?: (type: string, p: Record<string, string>) => Record<string, string> | null } = {};
    const doc = { addEventListener() {} };
    new Function("window", "document", "location", code)(win, doc, { href: "https://sound.shep.bot/" });
    const send = win.umamiBeforeSend!;

    const view = send("event", { url: "https://sound.shep.bot/search?q=oak+tree&utm_source=news#x", title: "“oak tree”: samples", referrer: "https://sound.shep.bot/search?q=kick" });
    expect(view).toEqual({ url: "https://sound.shep.bot/search?utm_source=news", title: "", referrer: "https://sound.shep.bot/search" });
    // Search rewrites the query as you type: same path, no second view.
    expect(send("event", { url: "https://sound.shep.bot/search?q=rock", title: "“rock”" })).toBeNull();
    expect(send("event", { url: "https://sound.shep.bot/docs", title: "Docs" })).toEqual({ url: "https://sound.shep.bot/docs", title: "Docs" });
    // Custom events always go through, with the same cleaning.
    expect(send("event", { name: "outbound", url: "https://sound.shep.bot/search?q=x", title: "“x”" })).toMatchObject({ url: "https://sound.shep.bot/search", title: "" });
  });

  it("sends HSTS on HTTPS only", async () => {
    expect((await app.request("/", html)).headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    const plain = createApp(service(), { siteRoot: SITE });
    expect((await plain.request("/", html)).headers.get("strict-transport-security")).toBeNull();
    const proxied = await plain.request("/", { headers: { accept: "text/html", "x-forwarded-proto": "https" } });
    expect(proxied.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("allows CORS on the API and machine-readable files but not on pages", async () => {
    const origin = { headers: { origin: "https://example.com", accept: "text/html" } };
    expect((await app.request("/", origin)).headers.get("access-control-allow-origin")).toBeNull();
    expect((await app.request("/docs/mcp", origin)).headers.get("access-control-allow-origin")).toBeNull();
    expect((await app.request("/v1/providers", origin)).headers.get("access-control-allow-origin")).toBe("*");
    expect((await app.request("/llms.txt", origin)).headers.get("access-control-allow-origin")).toBe("*");
    expect((await app.request("/AGENTS.md", origin)).headers.get("access-control-allow-origin")).toBe("*");
  });

  it("serves Brotli to clients that accept it", async () => {
    const res = await app.request("/", { headers: { accept: "text/html", "accept-encoding": "gzip, br" } });
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString()).toContain("<h1");
    const identity = await app.request("/", html);
    expect(identity.headers.get("content-encoding")).not.toBe("br");
  });

  it("caches unhashed static files for a day and fingerprinted assets forever", async () => {
    expect((await app.request("/llms.txt")).headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await app.request("/_astro/app.abc123.js")).headers.get("cache-control")).toContain("immutable");
    expect((await app.request("/", html)).headers.get("cache-control")).toContain("max-age=0");
  });

  it("gives /search query variants unique, noindex metadata and a style nonce", async () => {
    const res = await app.request("/search?q=dusty%20snare&category=drums.snare", html);
    const body = await res.text();
    expect(body).toContain("<title>“dusty snare”: snare samples · Sound Server</title>");
    expect(body).toContain('<meta name="robots" content="noindex, follow">');
    expect(body).toContain('<meta property="og:title" content="“dusty snare”: snare samples · Sound Server">');
    const nonce = body.match(/<meta property="csp-nonce" content="([^"]+)">/)![1]!;
    expect(res.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(res.headers.get("etag")).toBeNull();
    const other = await (await app.request("/search?category=fx.riser&free=true", html)).text();
    expect(other).toContain(`<title>Free riser samples: search ${allProviders.length} sites · Sound Server</title>`);
    const plain = await (await app.request("/search", html)).text();
    expect(plain).toContain("<title>Search free samples: drums, loops, vocals &amp; FX · Sound Server</title>");
    expect(plain).toContain('content="index, follow"');
    const again = await (await app.request("/search", html)).text();
    expect(again.match(/csp-nonce" content="([^"]+)"/)![1]).not.toBe(plain.match(/csp-nonce" content="([^"]+)"/)![1]);
  });

  it("only relaxes inline styles for the API playground", async () => {
    expect((await app.request("/docs/api/playground", html)).headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'");
    expect((await app.request("/docs/mcp", html)).headers.get("content-security-policy")).not.toContain("'unsafe-inline'");
  });

  it("builds search metadata and escapes it into the head", () => {
    expect(searchMeta(new URLSearchParams(""))).toBeUndefined();
    expect(searchMeta(new URLSearchParams("category=vocals&free=true"))!.title).toBe(`Free vocal samples: search ${allProviders.length} sites · Sound Server`);
    const out = rewriteHead('<title>x</title><meta name="description" content="y">', { title: '<b>"t"</b>', description: "d & e" });
    expect(out).toBe('<title>&lt;b&gt;&quot;t&quot;&lt;/b&gt;</title><meta name="description" content="d &amp; e">');
  });
});

