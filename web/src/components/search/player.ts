/**
 * Audio for the search and kit pages: fetching previews, one-at-a-time
 * playback and a registry of players that keyboard shortcuts can drive.
 *
 * Previews are fetched once into a Blob (cached), then handed to wavesurfer,
 * which draws the waveform and plays from a blob: URL. The first try is the
 * source's own preview URL (most sample CDNs send CORS headers); when that is
 * blocked, or the preview needs a Referer, the server's same-origin proxy
 * (/v1/samples/:id/preview?proxy=1) fetches it instead.
 */
import { useSyncExternalStore } from "react";
import { apiHeaders, safeUrl, sampleBase, type Sample } from "./api";

type PreviewSource = Pick<Sample, "id" | "previewUrl" | "previewNeedsReferer">;

const MAX_PREVIEW_BYTES = 30 * 1024 * 1024;
const CACHE_SIZE = 48;
const cache = new Map<string, Promise<Blob>>();

async function fetchAudio(url: string, init: RequestInit): Promise<Blob> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_PREVIEW_BYTES) throw new Error("preview too large");
  const blob = await res.blob();
  if (blob.size > MAX_PREVIEW_BYTES || blob.size === 0) throw new Error("bad preview");
  if (/^(text|application\/json)/.test(blob.type)) throw new Error("not audio");
  return blob;
}

/** The URL an <audio> element can play without CORS (fallback when the waveform can't be drawn). */
export function directPreview(s: PreviewSource): string | undefined {
  return s.previewNeedsReferer ? undefined : safeUrl(s.previewUrl);
}

export const proxiedPreview = (id: string) => `${sampleBase(id)}/preview?proxy=1`;

/** The preview as a Blob, from the source or through the server. Cached per sample. */
export function previewBlob(s: PreviewSource): Promise<Blob> {
  let p = cache.get(s.id);
  if (p) {
    // Refresh its place in the LRU order.
    cache.delete(s.id);
    cache.set(s.id, p);
    return p;
  }
  p = (async () => {
    const direct = directPreview(s);
    if (direct) {
      try {
        return await fetchAudio(direct, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
      } catch {
        /* blocked by CORS or gone: try the proxy */
      }
    }
    return fetchAudio(proxiedPreview(s.id), { headers: apiHeaders() });
  })();
  p.catch(() => cache.delete(s.id));
  cache.set(s.id, p);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return p;
}

/** Run at most `n` preview loads at once (rows load as they scroll into view). */
const MAX_PARALLEL = 3;
let running = 0;
const waiting: (() => void)[] = [];
export async function queued<T>(fn: () => Promise<T>, urgent = false): Promise<T> {
  if (!urgent && running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/* ---------- one player at a time ---------- */

export interface Controls {
  play(): Promise<void>;
  pause(): void;
  isPlaying(): boolean;
}

const players = new Map<string, Controls>();
let nowPlaying: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function register(key: string, c: Controls): () => void {
  players.set(key, c);
  return () => {
    if (players.get(key) === c) players.delete(key);
    if (nowPlaying === key) {
      nowPlaying = null;
      emit();
    }
  };
}

/** A player started: stop whichever other one was playing. */
export function claim(key: string): void {
  if (nowPlaying && nowPlaying !== key) players.get(nowPlaying)?.pause();
  nowPlaying = key;
  emit();
}

/** A player stopped (paused or finished). */
export function release(key: string): void {
  if (nowPlaying !== key) return;
  nowPlaying = null;
  emit();
}

export async function play(key: string): Promise<void> {
  await players.get(key)?.play();
}

export function pauseAll(): void {
  if (nowPlaying) players.get(nowPlaying)?.pause();
}

/** Play, or pause if it is the one playing. */
export async function toggle(key: string): Promise<void> {
  const c = players.get(key);
  if (!c) return;
  if (c.isPlaying()) c.pause();
  else await c.play();
}

export function useNowPlaying(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => nowPlaying,
    () => null,
  );
}

/** The per-request CSP nonce the server puts on /search and /kit (wavesurfer's shadow-DOM <style> needs it). */
export function cspNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content || undefined;
}
