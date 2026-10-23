/**
 * Preview buttons on static pages (collections, source pages): one shared
 * <audio>, one sound at a time. Plays the source's preview directly; if that
 * fails (e.g. it needs a Referer), retries through the server's preview proxy.
 */
const audio = new Audio();
audio.preload = "none";
let current: HTMLButtonElement | null = null;

function setState(btn: HTMLButtonElement | null, playing: boolean) {
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(playing));
  const label = btn.getAttribute("aria-label") ?? "";
  btn.setAttribute("aria-label", label.replace(/^(Play|Pause) /, playing ? "Pause " : "Play "));
}

audio.addEventListener("pause", () => setState(current, false));
audio.addEventListener("ended", () => setState(current, false));
audio.addEventListener("play", () => setState(current, true));
audio.addEventListener("error", () => {
  const btn = current;
  const id = btn?.dataset.sampleId;
  if (!btn || !id || audio.src.includes("/v1/samples/")) return setState(btn, false);
  audio.src = `/v1/samples/${encodeURIComponent(id)}/preview?proxy=1`;
  void audio.play().catch(() => setState(btn, false));
});

document.addEventListener("click", (e) => {
  const btn = (e.target as Element | null)?.closest<HTMLButtonElement>("button[data-preview]");
  if (!btn) return;
  e.preventDefault();
  if (btn === current && !audio.paused) {
    audio.pause();
    return;
  }
  if (current && current !== btn) setState(current, false);
  current = btn;
  const src = btn.dataset.preview ?? "";
  if (!/^https?:\/\//.test(src)) return;
  if (audio.src !== src) audio.src = src;
  void audio.play().catch(() => setState(btn, false));
});
