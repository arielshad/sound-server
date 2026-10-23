/**
 * One sample's player: a plain <audio> element for playback and, once the
 * row is near the viewport (or played), a wavesurfer.js waveform drawn from
 * the server's precomputed peaks. Without peaks (the server could not read
 * the preview) the sound still plays; only the waveform is missing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type { Sample } from "./api";
import { claim, cspNonce, current, fetchPeaks, inlineStylesBlocked, peakChannels, playableUrl, previewBlob, queued, register, release, useNowPlaying } from "./player";

export type PlayerState = "idle" | "loading" | "ready" | "nowave";

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
  /** Peaks to ask the server for (roughly the number of bars drawn). */
  points?: number;
  /** Load the waveform as soon as it is near the viewport (otherwise on first play). */
  autoLoad?: boolean;
  barWidth?: number;
}

type PlayerSample = Pick<Sample, "id" | "previewUrl" | "previewNeedsReferer" | "durationSec">;

export function useSamplePlayer(key: string, sample: PlayerSample, opts: PlayerOptions = {}) {
  const container = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const media = useRef<HTMLAudioElement | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  const [state, setState] = useState<PlayerState>("idle");
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | undefined>(sample.durationSec);
  const playing = useNowPlaying() === key;
  const { height = 36, points = 160, autoLoad = true, barWidth = 2 } = opts;

  /** The <audio> element, created on first use. */
  const audio = useCallback((): HTMLAudioElement => {
    if (media.current) return media.current;
    const a = new Audio();
    a.preload = "none";
    // Every start goes through play(), which claims first; a late "play" from a
    // sound that was superseded while it loaded is stopped.
    a.addEventListener("play", () => (current() === key ? undefined : a.pause()));
    a.addEventListener("pause", () => release(key));
    a.addEventListener("ended", () => release(key));
    a.addEventListener("timeupdate", () => setTime(a.currentTime));
    a.addEventListener("loadedmetadata", () => Number.isFinite(a.duration) && a.duration > 0 && setDuration((d) => d ?? a.duration));
    a.addEventListener("error", () => {
      if (!a.getAttribute("src")) return;
      setFailed(true);
      release(key);
    });
    media.current = a;
    return a;
  }, [key]);

  const ensure = useCallback(
    (urgent = false): Promise<void> => {
      if (loading.current) return loading.current;
      loading.current = (async () => {
        setState("loading");
        const a = audio();
        const src = playableUrl(sample);
        let peaks: Awaited<ReturnType<typeof fetchPeaks>> | undefined;
        try {
          peaks = await queued(() => fetchPeaks(sample.id, points), urgent);
        } catch {
          peaks = undefined;
        }
        if (!alive.current) return;
        if (peaks && container.current && !inlineStylesBlocked()) {
          let w: WaveSurfer | undefined;
          try {
            const { default: WS } = await import("wavesurfer.js");
            if (!alive.current || !container.current) return;
            w = WS.create({
              container: container.current,
              media: a,
              url: src,
              peaks: peakChannels(peaks),
              duration: peaks.durationSec,
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
            // Clicking the waveform seeks; start playing from there.
            w.on("interaction", () => {
              if (a.paused) void playRef.current();
            });
            // Without a CSP nonce the waveform's styles are refused (reported asynchronously).
            await new Promise((r) => setTimeout(r, 50));
            if (inlineStylesBlocked()) throw new Error("inline styles blocked");
            ws.current = w;
            setDuration(peaks.durationSec);
            setState("ready");
            return;
          } catch {
            w?.destroy();
            ws.current = null;
            container.current?.replaceChildren();
          }
        }
        if (src && !a.getAttribute("src")) a.src = src;
        setState("nowave");
      })();
      return loading.current;
    },
    // The sample and key identify the player; options are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, sample.id, audio],
  );

  const play = useCallback(async () => {
    claim(key); // stop the others right away, even while this one loads
    setFailed(false);
    await ensure(true);
    // Another sound was asked for while this one loaded (e.g. ↓ pressed twice): stay quiet.
    if (current() !== key) return;
    const a = media.current;
    if (!a || !alive.current) return release(key);
    if (!a.getAttribute("src")) {
      const src = playableUrl(sample);
      if (src) a.src = src;
      else {
        // The server needs a key: fetch the preview with it in a header.
        try {
          const blob = await previewBlob(sample);
          if (current() !== key) return;
          a.src = URL.createObjectURL(blob);
        } catch {
          setFailed(true);
          return release(key);
        }
      }
    }
    if (a.ended) a.currentTime = 0;
    await a.play().catch((e: unknown) => {
      if (!(e instanceof DOMException && e.name === "AbortError")) setFailed(true);
      release(key);
    });
  }, [ensure, key, sample]);
  const playRef = useRef(play);
  playRef.current = play;

  const pause = useCallback(() => {
    media.current?.pause();
    release(key);
  }, [key]);

  const isPlaying = useCallback(() => Boolean(media.current && !media.current.paused), []);

  // Register with the one-at-a-time registry (keyboard shortcuts drive players by key).
  useEffect(() => register(key, { play, pause, isPlaying }), [key, play, pause, isPlaying]);

  // Load the waveform when near the viewport.
  useEffect(() => {
    if (!autoLoad || !container.current) return;
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
  }, [autoLoad, ensure]);

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
      const a = media.current;
      if (a) {
        a.pause();
        if (a.src.startsWith("blob:")) URL.revokeObjectURL(a.src);
        a.removeAttribute("src");
        a.load();
        media.current = null;
      }
      loading.current = null;
      release(key);
    };
  }, [key]);

  const toggle = useCallback(() => (isPlaying() ? pause() : play()), [isPlaying, pause, play]);

  return { container, state, failed, playing, time, duration, play, pause, toggle, hasPreview: true };
}
