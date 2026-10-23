#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp } from "./api/app.js";
import type { UmamiOptions } from "./api/site.js";
import { Gauge } from "prom-client";
import { PrometheusAnalytics, noopAnalytics, type Analytics } from "./core/analytics.js";
import { setAnalysisCacheBackend } from "./core/analyze.js";
import { createHttpClient } from "./core/http.js";
import { NetworkClassifier, startNetworkData } from "./core/network.js";
import { formatKey } from "./core/query.js";
import { SampleService } from "./core/service.js";
import { EmbeddingIndex, embeddingIndexFromEnv, indexCatalogue } from "./core/similar.js";
import { storeFromEnv } from "./core/store.js";
import { teeAnalytics } from "./core/stats.js";
import { TELEMETRY_HOST, TELEMETRY_NOTICE, TELEMETRY_WEBSITE_ID, UmamiTelemetry, telemetryDisabled } from "./core/telemetry.js";
import { VERSION, createMcpServer } from "./mcp/server.js";
import { allProviders } from "./providers/index.js";

const HELP = `sound-server — search & download music samples from many sources

Usage:
  sound-server serve   Start the HTTP API (+ MCP at /mcp)
  sound-server mcp     Run the MCP server over stdio (for Claude Desktop/Code, Cursor, ...)
  sound-server search <query> [--category drums.kick] [--form one-shot] [--bpm 140] [--key "F minor"]
                       [--commercial] [--free] [--providers freesound,wikimediacommons] [--limit N]

  sound-server index   [--providers strudel,curated,kenney] [--limit N] [--query q]
                       Embed previews of static catalogues into the CLAP index (needs
                       SOUND_SERVER_DATA_DIR; downloads the model on first use)

  Queries understand BPM and key words: sound-server search "dark 808 in F minor"

Environment:
  PORT                         HTTP port (default 8787)
  HOST                         Bind address (default 0.0.0.0)
  SOUND_SERVER_API_KEY         Require this key on /v1 and /mcp
  SOUND_SERVER_PUBLIC_URL      Public base URL used in links
  SOUND_SERVER_PROVIDERS       Comma list to enable a subset of providers
  SOUND_DOWNLOAD_DIR           Default folder for MCP downloads (default ./samples)
  SOUND_SERVER_HTTP_DOWNLOADS  "true" to expose download_sample on the HTTP MCP endpoint
  SOUND_SERVER_HTTP_MCP        "false" to turn off MCP at /mcp (website and /v1 API stay up)
  FREESOUND_API_KEY            Enables Freesound search and previews (free key: freesound.org/apiv2/apply)
  FREESOUND_OAUTH_TOKEN        Local use only: your own Freesound OAuth2 token, to download originals
  OPENVERSE_CLIENT_ID, OPENVERSE_CLIENT_SECRET
                               Optional Openverse app credentials for higher rate limits
  FFMPEG_PATH, FFPROBE_PATH    ffmpeg binaries for audio analysis (default: from PATH)
  SOUND_SERVER_RATE_LIMIT      Requests per client per window on /v1 and /mcp (default 120, 0 = off)
  SOUND_SERVER_RATE_LIMIT_WINDOW  Window in seconds (default 60)
  METRICS_PORT                 Serve Prometheus metrics on this port at /metrics and log
                               one JSON line per search/download/tool call (off when unset)
  PROMETHEUS_URL               Prometheus that scrapes METRICS_PORT; /v1/stats then reports
                               the last 24 hours and 7 days (default: counts since start)
  MAXMIND_ACCOUNT_ID, MAXMIND_LICENSE_KEY
                               With METRICS_PORT: download MaxMind GeoLite2-ASN (free) to label
                               MCP callers by network (isp, aws, gcp, ...). Refreshed weekly
  SOUND_SERVER_ASN_DB          Use this GeoLite2-ASN .mmdb file instead of downloading one
  SOUND_SERVER_SESSION_SECRET  Signs MCP session IDs used to label tool calls by client
                               (random per process when unset)
  SOUND_SERVER_TELEMETRY       "1" to send anonymous usage telemetry (off by default; also needs
                               SOUND_SERVER_TELEMETRY_WEBSITE_ID; event counts only, see /privacy)
  DO_NOT_TRACK                 "1" always turns telemetry off
  UMAMI_WEBSITE_ID, UMAMI_HOST Send web page views to your own Umami instead

Optional search quality (v2):
  SOUND_SERVER_DATA_DIR        Persistent store (SQLite): analysis cache, embeddings, indexed
                               samples, downloaded models. Off (all in memory) when unset
  SOUND_SERVER_ANALYSIS_TTL_DAYS  How long stored analyses are reused (default 30)
  SOUND_SERVER_EMBEDDINGS      "1" turns on CLAP audio embeddings: find-similar for any sample,
                               text-to-audio re-ranking, zero-shot category fallback. Needs
                               @huggingface/transformers installed and ~400 MB more memory
  SOUND_SERVER_CLAP_MODEL      Default Xenova/clap-htsat-unfused (or Xenova/larger_clap_music_and_speech)
  SOUND_SERVER_MODEL_DIR       Model cache (default <SOUND_SERVER_DATA_DIR>/models, else a temp dir)
  SOUND_SERVER_INDEX_PER_MINUTE  Background embeddings per minute (default 20, 0 = off)
  SOUND_SERVER_EMBEDDINGS_THREADS, SOUND_SERVER_EMBEDDINGS_CONCURRENCY
                               ONNX threads per job (default 2) and jobs at once (default 1)
`;

/**
 * The service, plus the optional persistent store (SOUND_SERVER_DATA_DIR) and
 * CLAP embeddings (SOUND_SERVER_EMBEDDINGS=1). `background: false` turns off
 * the background indexer (one-shot commands).
 */
async function buildService(opts: { background?: boolean; forceEmbeddings?: boolean } = {}): Promise<SampleService> {
  const only = process.env.SOUND_SERVER_PROVIDERS?.split(",").map((s) => s.trim()).filter(Boolean);
  const providers = only?.length ? allProviders.filter((p) => only.includes(p.id)) : allProviders;
  const http = createHttpClient();
  const store = storeFromEnv();
  if (store) setAnalysisCacheBackend(store);
  const env = opts.forceEmbeddings ? { ...process.env, SOUND_SERVER_EMBEDDINGS: "1" } : process.env;
  let embeddings: EmbeddingIndex | undefined;
  try {
    embeddings = await embeddingIndexFromEnv({ http, store, env, perMinute: opts.background === false ? 0 : undefined });
  } catch (e) {
    console.error(`sound-server: embeddings disabled (${e instanceof Error ? e.message : String(e)})`);
  }
  return new SampleService({ providers, http, embeddings });
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "serve": {
      const service = await buildService();
      const port = Number(process.env.PORT ?? 8787);
      const hostname = process.env.HOST ?? "0.0.0.0";
      const telemetry = startTelemetry("http");
      const metrics = startMetrics(hostname);
      const analytics = telemetry ? teeAnalytics(metrics.analytics, telemetry) : metrics.analytics;
      const httpMcpDisabled = process.env.SOUND_SERVER_HTTP_MCP === "false";
      const app = createApp(service, {
        analytics,
        networks: metrics.networks,
        mcpSessionSecret: process.env.SOUND_SERVER_SESSION_SECRET,
        rateLimit: {
          limit: Number(process.env.SOUND_SERVER_RATE_LIMIT ?? 120),
          windowSec: Number(process.env.SOUND_SERVER_RATE_LIMIT_WINDOW ?? 60),
        },
        apiKey: process.env.SOUND_SERVER_API_KEY,
        publicBaseUrl: process.env.SOUND_SERVER_PUBLIC_URL,
        allowServerDownloads: process.env.SOUND_SERVER_HTTP_DOWNLOADS === "true",
        httpMcpDisabled,
        downloadDir: process.env.SOUND_DOWNLOAD_DIR,
        prometheus: process.env.PROMETHEUS_URL ? { url: process.env.PROMETHEUS_URL } : undefined,
        umami: umamiFromEnv() ?? (telemetry ? { websiteId: TELEMETRY_WEBSITE_ID, host: TELEMETRY_HOST, anonymous: true } : undefined),
      });
      serve({ fetch: app.fetch, port, hostname }, (info) => {
        console.log(`sound-server listening on http://${hostname}:${info.port}${httpMcpDisabled ? "" : " (MCP at /mcp)"}`);
      });
      return;
    }
    case "mcp": {
      const service = await buildService();
      const telemetry = startTelemetry("stdio");
      const server = createMcpServer(service, {
        analytics: telemetry,
        allowLocalDownload: true,
        downloadDir: process.env.SOUND_DOWNLOAD_DIR,
        publicBaseUrl: process.env.SOUND_SERVER_PUBLIC_URL,
      });
      await server.connect(new StdioServerTransport());
      // stdout is the protocol channel; log to stderr only.
      console.error("sound-server MCP running on stdio");
      return;
    }
    case "search": {
      const service = await buildService({ background: false });
      const flags = parseFlags(rest);
      const bpm = flags.bpm ? flags.bpm.split("-").map(Number) : undefined;
      const query = [flags.positional.join(" "), flags.key ? `in ${flags.key}` : ""].join(" ").trim();
      const res = await service.search({
        query,
        categories: flags.category?.split(",") as never,
        forms: flags.form?.split(",") as never,
        bpm: bpm ? { min: bpm[0], max: bpm[1] ?? bpm[0] } : undefined,
        commercialOnly: flags.commercial !== undefined,
        freeOnly: flags.free !== undefined,
        providers: flags.providers?.split(","),
        limit: flags.limit ? Number(flags.limit) : 15,
      });
      if (Object.keys(res.filters).length) console.log(`Filters: ${JSON.stringify(res.filters)}\n`);
      for (const a of res.results) {
        const facts = [a.category, a.form, a.bpm ? `${a.bpm}bpm` : "", a.key ? formatKey(a.key) : "", a.durationSec ? `${a.durationSec}s` : ""].filter(Boolean).join(" · ");
        const verdict = a.license?.verdict ?? "?";
        console.log(`${a.score?.toFixed(2)}  ${verdict.padEnd(15)} ${a.id}\n      ${a.title} (${facts})\n      ${a.previewUrl ?? a.url}`);
      }
      console.log("\nSources:");
      for (const p of res.providers) {
        console.log(`  ${p.provider.padEnd(18)} ${p.status.padEnd(8)} ${p.count} ${p.error ?? ""} ${p.status === "link" ? p.searchUrl : ""}`);
      }
      return;
    }
    case "index": {
      if (!process.env.SOUND_SERVER_DATA_DIR) {
        console.error("Set SOUND_SERVER_DATA_DIR so the index is kept (e.g. SOUND_SERVER_DATA_DIR=./data).");
        process.exitCode = 1;
        return;
      }
      const flags = parseFlags(rest);
      const service = await buildService({ background: false, forceEmbeddings: true });
      const index = service.embeddings;
      if (!index) throw new Error("could not start the embedding index");
      const providers = (flags.providers ?? "strudel,curated,kenney").split(",").map((s) => s.trim()).filter(Boolean);
      const limit = Number(flags.limit ?? 500) || 500;
      const started = Date.now();
      let last = 0;
      const reports = await indexCatalogue(service, index, {
        providers,
        limit,
        query: flags.query,
        concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
        onProgress: (r) => {
          if (Date.now() - last < 2000) return;
          last = Date.now();
          console.error(`  ${r.provider}: ${r.indexed} indexed, ${r.already} already, ${r.failed} failed of ${r.seen}`);
        },
      });
      for (const r of reports) {
        const skipped = Object.entries(r.skipped).map(([why, n]) => `${n} ${why}`).join(", ");
        console.log(`${r.provider.padEnd(14)} seen ${r.seen}, indexed ${r.indexed}, already ${r.already}, failed ${r.failed}${skipped ? `, skipped: ${skipped}` : ""}`);
        for (const e of r.errors.slice(0, 5)) console.log(`    ${e}`);
      }
      const st = index.status();
      console.log(`\nIndex: ${st.vectors} vectors (${st.model}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return;
    }
    default:
      console.log(HELP);
      if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
  }
}

function parseFlags(args: string[]): { positional: string[] } & Record<string, string | undefined> {
  const out: { positional: string[] } & Record<string, string | undefined> = { positional: [] } as never;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = "";
    } else out.positional.push(a);
  }
  return out;
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Analytics are opt-in: with METRICS_PORT set, metrics are served on that
 * separate port (kept off the public listener) and product events are
 * logged as JSON lines. MCP callers are then also labelled by network
 * (src/core/network.ts): OpenAI's published ranges are fetched, and the ASN
 * database is used when one is configured.
 */
function startMetrics(hostname: string): { analytics: Analytics; networks?: NetworkClassifier } {
  const port = Number(process.env.METRICS_PORT);
  if (!port) return { analytics: noopAnalytics };
  const analytics = new PrometheusAnalytics();
  const networks = new NetworkClassifier();
  startNetworkData({
    classifier: networks,
    asnDbPath: process.env.SOUND_SERVER_ASN_DB,
    maxmindAccountId: process.env.MAXMIND_ACCOUNT_ID,
    maxmindLicenseKey: process.env.MAXMIND_LICENSE_KEY,
  });
  new Gauge({
    name: "sound_server_asn_db_build_timestamp_seconds",
    help: "When the ASN database behind the MCP `network` label was built (0 = none loaded, ISP and cloud show as unknown).",
    registers: [analytics.registry],
    collect() {
      this.set(networks.asnBuiltAt);
    },
  });
  new Gauge({
    name: "sound_server_openai_ranges",
    help: "OpenAI egress ranges loaded for the MCP `network` label (0 = none).",
    registers: [analytics.registry],
    collect() {
      this.set(networks.openaiRanges);
    },
  });
  serve(
    {
      port,
      hostname,
      fetch: async (req) => {
        if (new URL(req.url).pathname !== "/metrics") return new Response("not found", { status: 404 });
        return new Response(await analytics.registry.metrics(), {
          headers: { "content-type": analytics.registry.contentType },
        });
      },
    },
    (info) => console.error(`metrics on http://${hostname}:${info.port}/metrics`),
  );
  return { analytics, networks };
}

/**
 * Anonymous usage telemetry (src/core/telemetry.ts), off unless the user opted
 * in. The notice goes to stderr: in stdio mode stdout is the MCP channel.
 */
function startTelemetry(mode: "http" | "stdio"): UmamiTelemetry | undefined {
  if (telemetryDisabled()) return undefined;
  console.error(TELEMETRY_NOTICE);
  const telemetry = new UmamiTelemetry({ version: VERSION, mode });
  telemetry.started();
  return telemetry;
}

/**
 * Your own web analytics: with UMAMI_WEBSITE_ID and UMAMI_HOST set, every page
 * loads that Umami's tracker (instead of the telemetry one). Visits only count
 * on the hostname of SOUND_SERVER_PUBLIC_URL when it is set.
 */
function umamiFromEnv(): UmamiOptions | undefined {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const host = process.env.UMAMI_HOST;
  if (!websiteId || !host) return undefined;
  const publicUrl = process.env.SOUND_SERVER_PUBLIC_URL;
  return { websiteId, host, domain: publicUrl ? new URL(publicUrl).hostname : undefined };
}
