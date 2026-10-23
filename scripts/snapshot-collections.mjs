// Refresh the saved results behind every collection page.
//
//   node scripts/snapshot-collections.mjs [slug ...]   (after `npm run build:server`)
//
// For each topic in web/src/content/collections/ (or only the slugs given),
// runs its search against the live sources and merges the results into
// web/src/data/collections/<slug>.json (src/core/collections.ts keeps the
// list stable and only moves `updatedAt` when it really changes). Every
// chosen sample's preview is checked so a static page never shows a dead
// player. Snapshots of deleted topics are removed. Run daily by
// .github/workflows/catalog-census.yml; exits 1 only when every search failed.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SNAPSHOT_DIR, readSnapshot, readTopics, serverModule } from "./lib/topics.mjs";

/** Content types a preview may answer with: audio, or the generic binary types some CDNs use. */
export function isAudioType(contentType) {
  const t = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  return t.startsWith("audio/") || ["application/ogg", "video/ogg", "video/webm", "application/octet-stream", "binary/octet-stream"].includes(t);
}

const MAX_REDIRECTS = 5;

/**
 * Does this preview still play? HEAD first, then a one-kilobyte ranged GET
 * when the host refuses HEAD or names no type. Every hop (redirects are
 * followed by hand) must pass `assertHost` (src/core/download.ts
 * assertPublicHost), so a topic can never make the job fetch an internal
 * address.
 *
 * Only a definite answer counts as broken: 404/410, a refused host, or a
 * successful response that is not audio (an HTML "not found" page). Timeouts,
 * network errors and 5xx keep the sample, so a flaky CDN can't empty a page.
 */
export async function checkPreview(url, { assertHost, fetch: doFetch = fetch, userAgent, timeoutMs = 10_000 }) {
  const headers = userAgent ? { "user-agent": userAgent } : {};
  const request = async (method) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertHost(current);
      const res = await doFetch(current, { method, redirect: "manual", signal, headers: method === "GET" ? { ...headers, range: "bytes=0-1023" } : headers });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => undefined);
        current = new URL(res.headers.get("location"), current).toString();
        continue;
      }
      await res.body?.cancel().catch(() => undefined);
      return res;
    }
    throw new Error(`too many redirects for ${url}`);
  };
  let res;
  try {
    res = await request("HEAD");
  } catch (e) {
    if (/^Refusing/.test(e instanceof Error ? e.message : "")) return false;
    return true;
  }
  try {
    if ([403, 405, 501].includes(res.status) || (res.ok && !res.headers.get("content-type"))) res = await request("GET");
  } catch (e) {
    if (/^Refusing/.test(e instanceof Error ? e.message : "")) return false;
    return true;
  }
  if (res.status === 404 || res.status === 410) return false;
  const type = res.headers.get("content-type");
  return !(res.ok && type && !isAudioType(type));
}

/** checkPreview once per URL per run, at most `concurrency` at a time. */
export function previewChecker(opts, concurrency = 8) {
  const cache = new Map();
  let inFlight = 0;
  const waiting = [];
  return (url) => {
    if (cache.has(url)) return cache.get(url);
    const result = (async () => {
      while (inFlight >= concurrency) await new Promise((r) => waiting.push(r));
      inFlight++;
      try {
        return await checkPreview(url, opts);
      } finally {
        inFlight--;
        waiting.shift()?.();
      }
    })();
    cache.set(url, result);
    return result;
  };
}

async function main() {
  const { allProviders } = await serverModule("providers/index");
  const { SampleService } = await serverModule("core/service");
  const { createHttpClient, USER_AGENT } = await serverModule("core/http");
  const { assertPublicHost } = await serverModule("core/download");
  const { snapshotCollection, isIndexable } = await serverModule("core/collections");

  const only = process.argv.slice(2);
  const topics = readTopics().filter((t) => !only.length || only.includes(t.slug));
  const unknown = only.filter((s) => !topics.some((t) => t.slug === s));
  if (unknown.length) {
    console.error(`snapshot: no topic file for ${unknown.join(", ")}`);
    process.exit(1);
  }

  const service = new SampleService({ providers: allProviders, http: createHttpClient(), defaultTimeoutMs: 20_000 });
  const pricing = new Map(allProviders.map((p) => [p.id, p.pricing]));
  const checkMedia = previewChecker({ assertHost: assertPublicHost, userAgent: USER_AGENT });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  let ok = 0;
  let changed = 0;
  for (const t of topics) {
    try {
      const r = await snapshotCollection((req) => service.search(req), t.slug, t.data.search, { previous: readSnapshot(t.slug), pricing, checkMedia });
      if (r.changed) {
        writeFileSync(join(SNAPSHOT_DIR, `${t.slug}.json`), JSON.stringify(r.snapshot, null, 2) + "\n");
        changed++;
      }
      ok++;
      const n = r.snapshot.samples.length;
      console.log(
        `${t.slug}: ${n} samples from ${new Set(r.snapshot.samples.map((a) => a.provider)).size} sources` +
          ` (+${r.added} -${r.dropped})${r.brokenMedia ? `, ${r.brokenMedia} dead preview(s) skipped` : ""}${r.failed.length ? `, failed: ${r.failed.join(", ")}` : ""}${isIndexable(r.snapshot.samples) ? "" : " [below the indexable minimum]"}`,
      );
    } catch (e) {
      console.error(`${t.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // A deleted topic takes its snapshot with it (full runs only).
  if (!only.length && existsSync(SNAPSHOT_DIR)) {
    const live = new Set(topics.map((t) => t.slug));
    for (const f of readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json"))) {
      if (!live.has(f.slice(0, -5))) {
        rmSync(join(SNAPSHOT_DIR, f));
        console.log(`${f.slice(0, -5)}: topic removed, snapshot deleted`);
      }
    }
  }

  console.log(`snapshot: ${ok}/${topics.length} collections searched, ${changed} changed`);
  if (topics.length && ok === 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
