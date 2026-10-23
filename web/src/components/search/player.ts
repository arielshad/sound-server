/**
 * Audio for the search and kit pages: preview URLs, waveform peaks,
 * one-at-a-time playback and a registry of players that keyboard shortcuts
 * can drive.
 *
 * Playback uses a plain <audio> element pointed at the source's preview (or
 * the server's /preview endpoint, which redirects or proxies), so it needs no
 * CORS from the sample sites. The waveform comes from the server's
 * /v1/samples/:id/peaks (a few KB of JSON, cached), so the browser never has
 * to download and decode audio just to draw it.
 */
import { useSyncExternalStore } from "react";
import { apiHeaders, getKey, safeUrl, sampleBase, type Sample } from "./api";

type PreviewSource = Pick<Sample, "id" | "previewUrl" | "previewNeedsReferer">;

/** The source's own preview URL, when the browser may load it directly. */
function sourcePreview(s: PreviewSource): string | undefined {
  return s.previewNeedsReferer ? undefined : safeUrl(s.previewUrl);
}

/**
 * A URL an <audio> element can play: the source's preview, or the server's
 * preview endpoint (search results don't always carry a preview URL, and
 * some previews need a Referer, which the server adds). Undefined when the
 * server needs an API key: then the preview is fetched with the key in a
 * header (previewBlob).
 */
export function playableUrl(s: PreviewSource): string | undefined {
  if (getKey()) return undefined;
  return sourcePreview(s) ?? `${sampleBase(s.id)}/preview`;
}

const MAX_PREVIEW_BYTES = 30 * 1024 * 1024;

/** The preview as a Blob through the server (for servers that need an API key). */
export async function previewBlob(s: PreviewSource): Promise<Blob> {
  const res = await fetch(`${sampleBase(s.id)}/preview?proxy=1`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0 || blob.size > MAX_PREVIEW_BYTES) throw new Error("bad preview");
  return blob;
}

/** /v1/samples/:id/peaks: interleaved min/max pairs, −1..1. */
export interface Peaks {
  peaks: number[];
  points: number;
  durationSec: number;
}

const PEAKS_CACHE = 200;
const peaksCache = new Map<string, Promise<Peaks>>();

/** Waveform peaks for a sample (cached, failures included, so a broken preview is asked for once). */
export function fetchPeaks(id: string, points: number): Promise<Peaks> {
  const k = `${id}|${points}`;
  let p = peaksCache.get(k);
  if (!p) {
    p = fetch(`${sampleBase(id)}/peaks?points=${points}`, { headers: apiHeaders({ accept: "application/json" }) }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as Peaks;
      if (!Array.isArray(body.peaks) || !body.peaks.length || !(body.durationSec > 0)) throw new Error("no peaks");
      return body;
    });
    p.catch(() => undefined);
    peaksCache.set(k, p);
    while (peaksCache.size > PEAKS_CACHE) peaksCache.delete(peaksCache.keys().next().value!);
  }
  return p;
}

/** wavesurfer draws the top half from the first channel and the bottom from the second. */
export function peakChannels(p: Peaks): [number[], number[]] {
  const max: number[] = [];
  const min: number[] = [];
  for (let i = 0; i + 1 < p.peaks.length; i += 2) {
    min.push(p.peaks[i]!);
    max.push(p.peaks[i + 1]!);
  }
  return [max, min];
}

/** Run at most a few waveform loads at once (rows load as they scroll into view). */
const MAX_PARALLEL = 3;
let running = 0;
const waiting: (() => void)[] = [];
export async function queued<T>(fn: () => Promise<T>, urgent = false): Promise<T> {
  if (!urgent) {
    while (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  }
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
