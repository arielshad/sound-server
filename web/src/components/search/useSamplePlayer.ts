/**
 * One sample's player: a wavesurfer.js waveform that is only created when the
 * row scrolls into view (or is played), drawn from the cached preview blob.
 * Falls back to a plain <audio> element when the preview can't be fetched for
 * drawing (e.g. a CDN without CORS and no proxy) or can't be decoded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type { Sample } from "./api";
import { claim, cspNonce, directPreview, previewBlob, queued, register, release, useNowPlaying } from "./player";

export type PlayerState = "idle" | "loading" | "ready" | "nowave" | "error";

/** Resolve a CSS colour (with var()) to something a canvas understands. */
function cssColor(expr: string): string {
  const probe = document.createElement("span");
  probe.style.color = expr;
  probe.style.display = "none";
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}
const colors = () => ({
  waveColor: cssColor("var(--muted-foreground)"),
  progressColor: cssColor("var(--primary)"),
  cursorColor: cssColor("var(--foreground)"),
});

export interface PlayerOptions {
  /** Waveform height in px. */
  height?: number;
  /** Load as soon as the waveform is near the viewport (otherwise on first play). */
  autoLoad?: boolean;
  barWidth?: number;
}

export function useSamplePlayer(key: string, sample: Pick<Sample, "id" | "previewUrl" | "previewNeedsReferer" | "durationSec">, opts: PlayerOptions = {}) {
  const container = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  const [state, setState] = useState<PlayerState>("idle");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | undefined>(sample.durationSec);
  const playing = useNowPlaying() === key;
  const hasPreview = Boolean(sample.previewUrl);
  const { height = 36, autoLoad = true, barWidth = 2 } = opts;

  const ensure = useCallback(
    (urgent = false): Promise<void> => {
      if (loading.current) return loading.current;
      loading.current = (async () => {
        setState("loading");
        try {
          const blob = await queued(() => previewBlob(sample), urgent);
          if (!alive.current || !container.current) return;
          const { default: WS } = await import("wavesurfer.js");
          if (!alive.current || !container.current) return;
          const w = WS.create({
            container: container.current,
            height,
            ...colors(),
            cursorWidth: 1,
            barWidth,
            barGap: 1,
            barRadius: 2,
            normalize: true,
            hideScrollbar: true,
            dragToSeek: false,
            cspNonce: cspNonce(),
          });
          w.on("play", () => claim(key));
          w.on("pause", () => release(key));
          w.on("finish", () => release(key));
          w.on("timeupdate", (t) => setTime(t));
          w.on("interaction", () => {
            if (!w.isPlaying()) void w.play().catch(() => undefined);
          });
          try {
            await w.loadBlob(blob);
          } catch (e) {
            w.destroy();
            throw e;
          }
          if (!alive.current) {
            w.destroy();
            return;
          }
          ws.current = w;
          setDuration(w.getDuration() || sample.durationSec);
          setState("ready");
        } catch {
          // No waveform: play the preview directly when the browser can.
          const src = directPreview(sample);
          if (!src || !alive.current) {
            setState("error");
            loading.current = null;
            return;
          }
          const a = new Audio();
          a.preload = "auto";
          a.src = src;
          a.addEventListener("play", () => claim(key));
          a.addEventListener("pause", () => release(key));
          a.addEventListener("ended", () => release(key));
          a.addEventListener("timeupdate", () => setTime(a.currentTime));
          a.addEventListener("loadedmetadata", () => Number.isFinite(a.duration) && setDuration(a.duration));
          audio.current = a;
          setState("nowave");
        }
      })();
      return loading.current;
    },
    // The sample and key identify the player; options are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, sample.id],
  );

  const play = useCallback(async () => {
    if (!hasPreview) return;
    claim(key); // stop the others right away, even while this one loads
    await ensure(true);
    const target = ws.current ?? audio.current;
    if (!target) {
      release(key);
      return;
    }
    if (ws.current && ws.current.getCurrentTime() >= ws.current.getDuration() - 0.01) ws.current.setTime(0);
    await target.play().catch(() => release(key));
  }, [ensure, hasPreview, key]);

  const pause = useCallback(() => {
    ws.current?.pause();
    audio.current?.pause();
    release(key);
  }, [key]);

  const isPlaying = useCallback(() => Boolean(ws.current?.isPlaying() || (audio.current && !audio.current.paused)), []);

  // Register with the one-at-a-time registry (keyboard shortcuts drive players by key).
  useEffect(() => register(key, { play, pause, isPlaying }), [key, play, pause, isPlaying]);

  // Load when near the viewport.
  useEffect(() => {
    if (!autoLoad || !hasPreview || !container.current) return;
    const el = container.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void ensure();
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoLoad, hasPreview, ensure]);

  // Follow the light/dark theme.
  useEffect(() => {
    const mo = new MutationObserver(() => ws.current?.setOptions(colors()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Tear down on unmount.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ws.current?.destroy();
      ws.current = null;
      if (audio.current) {
        audio.current.pause();
        audio.current.removeAttribute("src");
        audio.current = null;
      }
      loading.current = null;
      release(key);
    };
  }, [key]);

  const toggle = useCallback(() => (isPlaying() ? pause() : play()), [isPlaying, pause, play]);

  return { container, state, playing, time, duration, play, pause, toggle, hasPreview };
}
