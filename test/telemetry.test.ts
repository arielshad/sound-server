import { describe, expect, it } from "vitest";
import { umamiHead } from "../src/api/site.js";
import type { SearchResponse } from "../src/core/service.js";
import { UmamiTelemetry, telemetryDisabled, telemetryUserAgent } from "../src/core/telemetry.js";

/** Telemetry has no built-in website id: the operator configures one (SOUND_SERVER_TELEMETRY_WEBSITE_ID). */
const WEBSITE_ID = "00000000-0000-4000-8000-000000000001";

type Sent = { url: string; init: RequestInit };

function recorder(status = 200) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response("{}", { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const payload = (s: Sent) => JSON.parse(String(s.init.body)).payload;

describe("telemetry opt-in", () => {
  const on = { SOUND_SERVER_TELEMETRY: "1", SOUND_SERVER_TELEMETRY_WEBSITE_ID: WEBSITE_ID };

  it("is off unless SOUND_SERVER_TELEMETRY turns it on and a website id is set", () => {
    expect(telemetryDisabled({})).toBe(true);
    expect(telemetryDisabled({ SOUND_SERVER_TELEMETRY: "1" })).toBe(true); // no website id: nowhere to send
    expect(telemetryDisabled({ SOUND_SERVER_TELEMETRY_WEBSITE_ID: WEBSITE_ID })).toBe(true); // not opted in
    expect(telemetryDisabled({ ...on, SOUND_SERVER_TELEMETRY_WEBSITE_ID: "  " })).toBe(true);
    for (const v of ["1", "true", "ON", " yes "]) expect(telemetryDisabled({ ...on, SOUND_SERVER_TELEMETRY: v }), v).toBe(false);
    for (const v of ["0", "false", "off", "no", "maybe"]) expect(telemetryDisabled({ ...on, SOUND_SERVER_TELEMETRY: v }), v).toBe(true);
  });

  it("always yields to DO_NOT_TRACK", () => {
    for (const v of ["1", "true", "yes"]) expect(telemetryDisabled({ ...on, DO_NOT_TRACK: v }), v).toBe(true);
    for (const v of ["0", "false", ""]) expect(telemetryDisabled({ ...on, DO_NOT_TRACK: v }), v).toBe(false);
  });

  it("uses a browser-shaped User-Agent (Umami drops bot-like ones) that names the OS", () => {
    expect(telemetryUserAgent("1.2.3", "linux", "x64")).toBe("Mozilla/5.0 (X11; Linux x86_64) sounds/1.2.3");
    expect(telemetryUserAgent("1.2.3", "darwin", "arm64")).toContain("Macintosh");
    expect(telemetryUserAgent("1.2.3", "win32", "x64")).toContain("Windows NT 10.0");
  });
});

describe("UmamiTelemetry", () => {
  const response: SearchResponse = {
    query: "secret project dark kick",
    filters: { categories: ["drums.kick"] },
    results: [{ id: "freesound:secret_kick" } as never],
    providers: [],
  };

  it("sends bounded labels only, never the search text or sample IDs", async () => {
    const { sent, fetch } = recorder();
    const t = new UmamiTelemetry({ version: "9.9.9", mode: "stdio", websiteId: WEBSITE_ID, host: "https://umami.example", fetch });
    t.started();
    t.search({ surface: "mcp", client: "claude-code", query: response.query, categories: ["drums.kick", "drums.snare"], response, tookMs: 120 });
    t.sampleView({ surface: "mcp", client: "claude-code", provider: "freesound", found: true });
    t.download({ surface: "mcp", client: "claude-code", provider: "freesound", kind: "local" });
    t.toolCall({ tool: "search_samples", client: "claude-code", outcome: "ok", tookMs: 120 });
    t.httpRequest();
    t.pageView();
    await flush();

    expect(sent.map((s) => s.url)).toEqual(Array(5).fill("https://umami.example/api/send"));
    expect(sent.map((s) => payload(s).name)).toEqual(["start", "search", "sample_view", "download", "tool_call"]);
    expect(payload(sent[1]!)).toEqual({
      website: WEBSITE_ID,
      hostname: "self-hosted",
      url: "/mcp",
      name: "search",
      // Categories collapse to their top level (bounded labels).
      data: { surface: "mcp", client: "claude-code", category: "drums", free_only: "false", has_results: "true", version: "9.9.9" },
    });
    expect(payload(sent[0]!).data).toEqual({ mode: "stdio", version: "9.9.9" });
    const all = sent.map((s) => String(s.init.body)).join("\n");
    expect(all).not.toMatch(/secret|dark kick/);
    expect((sent[0]!.init.headers as Record<string, string>)["user-agent"]).toMatch(/^Mozilla\/5\.0 \(.+\) sounds\/9\.9\.9$/);
  });

  it("stops trying after three failures in a row, and a success resets the count", async () => {
    let ok = false;
    let calls = 0;
    const fetch = (async () => {
      calls++;
      if (!ok) throw new Error("offline");
      return new Response("{}");
    }) as unknown as typeof globalThis.fetch;
    const t = new UmamiTelemetry({ version: "1", mode: "http", websiteId: WEBSITE_ID, fetch });
    t.started();
    await flush();
    t.started();
    await flush();
    ok = true;
    t.started(); // succeeds: count resets
    await flush();
    ok = false;
    for (let i = 0; i < 5; i++) {
      t.started();
      await flush();
    }
    expect(calls).toBe(3 + 3);
  });
});

describe("browser telemetry on self-hosted installs", () => {
  it("reports the host as self-hosted, the path only and no referrer", () => {
    const head = umamiHead({ websiteId: WEBSITE_ID, host: "https://stats.shep.bot", anonymous: true });
    expect(head).not.toContain("data-domains");
    const code = /<script>([\s\S]*?)<\/script>/.exec(head)![1]!;
    const win: { umamiBeforeSend?: (type: string, p: Record<string, string>) => Record<string, string> | null } = {};
    new Function("window", "document", "location", code)(win, { addEventListener() {} }, { href: "http://sounds.corp.internal:8787/" });
    const out = win.umamiBeforeSend!("event", {
      hostname: "sounds.corp.internal",
      url: "http://sounds.corp.internal:8787/search?q=secret&utm_source=wiki",
      referrer: "https://wiki.corp.internal/audio-tools",
      title: "“secret”: samples",
    });
    expect(out).toEqual({ hostname: "self-hosted", url: "/search", referrer: "", title: "" });
  });
});
