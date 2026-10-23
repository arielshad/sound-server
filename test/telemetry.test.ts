import { describe, expect, it } from "vitest";
import { umamiHead } from "../src/api/site.js";
import type { SearchResponse } from "../src/core/service.js";
import { TELEMETRY_WEBSITE_ID, UmamiTelemetry, telemetryDisabled, telemetryUserAgent } from "../src/core/telemetry.js";

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

describe("telemetry opt-out", () => {
  it("is on unless SOUND_SERVER_TELEMETRY or DO_NOT_TRACK turns it off", () => {
    expect(telemetryDisabled({})).toBe(false);
    for (const v of ["0", "false", "OFF", " no "]) expect(telemetryDisabled({ SOUND_SERVER_TELEMETRY: v }), v).toBe(true);
    expect(telemetryDisabled({ SOUND_SERVER_TELEMETRY: "1" })).toBe(false);
    for (const v of ["1", "true", "yes"]) expect(telemetryDisabled({ DO_NOT_TRACK: v }), v).toBe(true);
    for (const v of ["0", "false", ""]) expect(telemetryDisabled({ DO_NOT_TRACK: v }), v).toBe(false);
  });

  it("uses a browser-shaped User-Agent (Umami drops bot-like ones) that names the OS", () => {
    expect(telemetryUserAgent("1.2.3", "linux", "x64")).toBe("Mozilla/5.0 (X11; Linux x86_64) sounds/1.2.3");
    expect(telemetryUserAgent("1.2.3", "darwin", "arm64")).toContain("Macintosh");
    expect(telemetryUserAgent("1.2.3", "win32", "x64")).toContain("Windows NT 10.0");
  });
});

describe("UmamiTelemetry", () => {
  const response: SearchResponse = {
    query: "secret project oak tree",
    types: ["model"],
    results: [{ id: "polyhaven:oak_secret" } as never],
    providers: [],
  };

  it("sends bounded labels only, never the search text or asset IDs", async () => {
    const { sent, fetch } = recorder();
    const t = new UmamiTelemetry({ version: "9.9.9", mode: "stdio", fetch });
    t.started();
    t.search({ surface: "mcp", client: "claude-code", query: response.query, types: ["model"], response, tookMs: 120 });
    t.download({ surface: "mcp", client: "claude-code", provider: "polyhaven", kind: "local" });
    t.toolCall({ tool: "search_assets", client: "claude-code", outcome: "ok", tookMs: 120 });
    t.httpRequest();
    t.pageView();
    await flush();

    expect(sent.map((s) => s.url)).toEqual(Array(4).fill("https://stats.shep.bot/api/send"));
    expect(sent.map((s) => payload(s).name)).toEqual(["start", "search", "download", "tool_call"]);
    expect(payload(sent[1]!)).toEqual({
      website: TELEMETRY_WEBSITE_ID,
      hostname: "self-hosted",
      url: "/mcp",
      name: "search",
      data: { surface: "mcp", client: "claude-code", type: "model", free_only: "false", has_results: "true", version: "9.9.9" },
    });
    expect(payload(sent[0]!).data).toEqual({ mode: "stdio", version: "9.9.9" });
    const all = sent.map((s) => String(s.init.body)).join("\n");
    expect(all).not.toMatch(/secret|oak/);
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
    const t = new UmamiTelemetry({ version: "1", mode: "http", fetch });
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
    const head = umamiHead({ websiteId: TELEMETRY_WEBSITE_ID, host: "https://stats.shep.bot", anonymous: true });
    expect(head).not.toContain("data-domains");
    const code = /<script>([\s\S]*?)<\/script>/.exec(head)![1]!;
    const win: { umamiBeforeSend?: (type: string, p: Record<string, string>) => Record<string, string> | null } = {};
    new Function("window", "document", "location", code)(win, { addEventListener() {} }, { href: "http://assets.corp.internal:8787/" });
    const out = win.umamiBeforeSend!("event", {
      hostname: "assets.corp.internal",
      url: "http://assets.corp.internal:8787/search?q=secret&utm_source=wiki",
      referrer: "https://wiki.corp.internal/3d-tools",
      title: "“secret”: 3D assets",
    });
    expect(out).toEqual({ hostname: "self-hosted", url: "/search", referrer: "", title: "" });
  });
});
