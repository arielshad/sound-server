/** Minimal typed client for the server's REST API (same origin). */

export interface License {
  id: string;
  name: string;
  url?: string;
  commercialUse?: boolean;
  attributionRequired?: boolean;
  shareAlike?: boolean;
  redistribution?: boolean;
  assertedBy?: "source" | "site" | "uploader";
  verdict: string;
  note?: string;
}
export interface Price { free: boolean; amount?: number; currency?: string }
export interface MusicalKey { tonic: string; mode: "major" | "minor" }
export interface Sample {
  id: string;
  provider: string;
  title: string;
  description?: string;
  url: string;
  author?: string;
  authorUrl?: string;
  tags: string[];
  genres?: string[];
  category: string;
  form?: string;
  unit?: "sample" | "pack" | "instrument";
  packSize?: number;
  bpm?: number;
  key?: MusicalKey;
  rootNote?: number;
  durationSec?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  loudnessLufs?: number;
  previewUrl?: string;
  previewNeedsReferer?: boolean;
  thumbnailUrl?: string;
  formats?: string[];
  license?: License;
  attribution?: string;
  price?: Price;
  requiresAccount?: boolean;
  downloadable: boolean;
  score?: number;
}
export interface SampleFile {
  url: string;
  filename: string;
  format: string;
  role: "original" | "preview" | "pack" | "stem" | "midi";
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  sizeBytes?: number;
  requiresAuth?: boolean;
}
export interface SampleDetails extends Sample {
  files: SampleFile[];
  shareUrl?: string;
}
export interface ProviderReport {
  provider: string;
  name: string;
  status: "ok" | "error" | "timeout" | "skipped" | "link";
  count: number;
  total?: number;
  searchUrl?: string;
  error?: string;
  filteredLocally?: boolean;
  tookMs: number;
}
export interface SearchResponse { query: string; filters?: Record<string, unknown>; results: Sample[]; providers: ProviderReport[] }
export interface Provider { id: string; name: string; description: string; supportsDownload: boolean; access?: string; categories?: string[] }
export interface FileSelection { id: string; totalBytes?: number; attribution?: string; files: SampleFile[] }

const KEY_STORE = "sound-server-key";
export class UnauthorizedError extends Error {}

export function getKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? "";
  } catch {
    return "";
  }
}
export function setKey(k: string): void {
  try {
    localStorage.setItem(KEY_STORE, k);
  } catch {
    /* private mode */
  }
}

/** Headers for every same-origin API call. The key travels only as a header, never in a URL. */
export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  // x-sound-client lets the server's analytics tell website traffic from other API users.
  const headers: Record<string, string> = { "x-sound-client": "web", ...extra };
  const key = getKey();
  if (key) headers["x-api-key"] = key;
  return headers;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: apiHeaders(init.body !== undefined ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" }),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (res.status === 401) throw new UnauthorizedError("This server needs an API key.");
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

export const sampleBase = (id: string) => `/v1/samples/${encodeURIComponent(id)}`;

export function formatBytes(n?: number): string {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Only ever put http(s) URLs into href/src: results come from third-party sites. */
export function safeUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u, typeof window === "undefined" ? "https://localhost" : window.location.href);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Start a download. Without an API key a plain link does it (the server
 * redirects or streams a zip). When the server needs a key, the file is
 * fetched with the key in a header and saved from a blob URL.
 */
export async function download(path: string, filename: string): Promise<void> {
  const a = document.createElement("a");
  if (!getKey()) {
    // Single files redirect to the source's CDN, which may play them instead of
    // saving them: open in a new tab so the search stays put.
    a.href = path;
    a.target = "_blank";
    a.rel = "noopener";
  } else {
    const res = await fetch(path, { headers: apiHeaders() });
    if (res.status === 401) throw new UnauthorizedError("This server needs an API key.");
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    const disposition = res.headers.get("content-disposition") ?? "";
    const named = /filename="([^"]+)"/.exec(disposition)?.[1];
    a.href = URL.createObjectURL(await res.blob());
    a.download = named ?? filename;
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
  if (!a.download && !a.target) a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

/** A filesystem-friendly name: "Deep Kick 01" -> "deep-kick-01". */
export const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "sample";
