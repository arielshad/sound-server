/**
 * Open Graph images (1200×630 PNG) for every page and share link.
 *
 * Cards are laid out with satori (flexbox → SVG, text as paths) and rasterised
 * with resvg, so no browser is needed. Used at build time for the static pages
 * (web/integrations/og-images.mjs) and at request time for search and sample
 * share links (GET /og/query.png, /og/sample.png).
 *
 * Fonts: Geist (SIL OFL 1.1, see fonts/OFL.txt), vendored as TTF because
 * satori can't read WOFF2.
 */

import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { assertPublicUrl } from "../core/download.js";
import { USER_AGENT } from "../core/http.js";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const C = {
  bg: "#16141f",
  fg: "#f4f4f6",
  muted: "#a9a7b8",
  soft: "#cfcde0",
  primary: "#9b7cff",
  cyan: "#4cc9e6",
  line: "rgba(255,255,255,0.14)",
};

const LOGO =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><defs><linearGradient id="g" x1="3" y1="4" x2="29" y2="28" gradientUnits="userSpaceOnUse"><stop stop-color="#8b6cf6"/><stop offset="1" stop-color="#4cc9e6"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="#16141f"/><g fill="url(#g)"><rect x="3.35" y="13" width="2.8" height="6" rx="1.4"/><rect x="7.85" y="9" width="2.8" height="14" rx="1.4"/><rect x="12.35" y="5" width="2.8" height="22" rx="1.4"/><rect x="16.85" y="10" width="2.8" height="12" rx="1.4"/><rect x="21.35" y="7.5" width="2.8" height="17" rx="1.4"/><rect x="25.85" y="12" width="2.8" height="8" rx="1.4"/></g></svg>`,
  ).toString("base64");

type Style = Record<string, string | number>;
interface Node {
  type: string;
  props: { style?: Style; children?: Child | Child[]; [k: string]: unknown };
}
type Child = Node | string | null | undefined | false;

const h = (type: string, props: Node["props"] | null, ...children: Child[]): Node => ({
  type,
  props: { ...(props ?? {}), children: children.filter((c) => c !== null && c !== undefined && c !== false) },
});
const div = (style: Style, ...children: Child[]) => h("div", { style: { display: "flex", ...style } }, ...children);

let fonts: { name: string; data: Buffer; weight: 400 | 500 | 600; style: "normal" }[] | undefined;
function loadFonts() {
  if (!fonts) {
    const file = (name: string) => readFileSync(new URL(`./fonts/${name}`, import.meta.url));
    fonts = [
      { name: "Geist", data: file("Geist-Regular.ttf"), weight: 400, style: "normal" },
      { name: "Geist", data: file("Geist-Medium.ttf"), weight: 500, style: "normal" },
      { name: "Geist", data: file("Geist-SemiBold.ttf"), weight: 600, style: "normal" },
    ];
  }
  return fonts;
}

/** Shorten to `max` characters on a word boundary, with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

function titleSize(text: string, wide: boolean): number {
  const n = text.length;
  if (wide) return n <= 26 ? 78 : n <= 44 ? 66 : n <= 70 ? 56 : 48;
  return n <= 20 ? 64 : n <= 36 ? 54 : n <= 60 ? 46 : 40;
}

function frame(...children: Child[]): Node {
  return div(
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      position: "relative",
      backgroundColor: C.bg,
      color: C.fg,
      fontFamily: "Geist",
      overflow: "hidden",
    },
    // Faint grid + purple glow, as on the site's hero.
    div({
      position: "absolute",
      top: 0,
      left: 0,
      width: OG_WIDTH,
      height: OG_HEIGHT,
      backgroundImage:
        "linear-gradient(rgba(139,108,246,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(139,108,246,0.08) 1px, transparent 1px)",
      backgroundSize: "48px 48px",
    }),
    div({
      position: "absolute",
      top: -420,
      left: 420,
      width: 1100,
      height: 900,
      backgroundImage: "radial-gradient(circle at 50% 50%, rgba(139,108,246,0.38) 0%, rgba(139,108,246,0.14) 38%, rgba(139,108,246,0) 68%)",
    }),
    div(
      { position: "absolute", top: 0, left: 0, width: OG_WIDTH, height: OG_HEIGHT, padding: "64px 76px", flexDirection: "column" },
      ...children,
    ),
  );
}

function brand(): Node {
  return div(
    { alignItems: "center", fontSize: 30, fontWeight: 600, letterSpacing: -0.5 },
    h("img", { src: LOGO, width: 52, height: 52, style: { marginRight: 16 } }),
    "Sound Server",
  );
}

function chipRow(chips: string[], site: string): Node {
  return div(
    { marginTop: "auto", alignItems: "center", fontSize: 22, color: C.soft },
    ...chips.slice(0, 4).map((c) =>
      div({ border: `1px solid ${C.line}`, borderRadius: 999, padding: "8px 18px", marginRight: 12, backgroundColor: "rgba(255,255,255,0.04)" }, clip(c, 28)),
    ),
    div({ marginLeft: "auto", color: C.primary, fontWeight: 600 }, site),
  );
}

export interface PageCard {
  /** Small label above the title ("Docs", "API", "Search"…). */
  kicker?: string;
  title: string;
  /** Part of the title drawn with the brand gradient (home page). */
  highlight?: string;
  subtitle?: string;
  chips?: string[];
  /** Host shown bottom right, e.g. sound.shep.bot. */
  site: string;
}

export function pageCard(c: PageCard): Node {
  const title = clip(c.title, 90);
  const size = titleSize(title + (c.highlight ?? ""), true);
  return frame(
    brand(),
    c.kicker ? div({ marginTop: 54, fontSize: 26, fontWeight: 500, color: C.primary, textTransform: "uppercase", letterSpacing: 2 }, clip(c.kicker, 40)) : null,
    div(
      { marginTop: c.kicker ? 14 : 64, fontSize: size, fontWeight: 600, lineHeight: 1.04, letterSpacing: -2, maxWidth: 1000, flexDirection: "column" },
      div({}, title),
      // The gradient part gets its own line (satori can't clip a gradient to wrapped inline text).
      c.highlight
        ? div({ alignSelf: "flex-start", backgroundImage: `linear-gradient(90deg, ${C.primary}, ${C.cyan})`, backgroundClip: "text", color: "transparent" }, c.highlight)
        : null,
    ),
    c.subtitle ? div({ marginTop: 26, fontSize: 28, lineHeight: 1.35, color: C.muted, maxWidth: 960 }, clip(c.subtitle, 150)) : null,
    chipRow(c.chips ?? [], c.site),
  );
}

export interface SampleCard {
  title: string;
  /** Source site name, e.g. "Freesound". */
  source: string;
  /** Human category, e.g. "Kick". */
  type: string;
  license?: string;
  /** Short licence verdict, e.g. "Commercial use OK". */
  verdict?: string;
  free?: boolean;
  /** Musical facts, e.g. ["one-shot", "0.4 s", "F minor"]. */
  facts?: string[];
  author?: string;
  /** Pack artwork as a data: URI (PNG or JPEG). Without it the card draws a waveform. */
  image?: string;
  site: string;
}

/** Deterministic pseudo-waveform bars from the title, so every card looks different but stable. */
function waveBars(seed: string, n = 28): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const env = Math.sin((Math.PI * (i + 1)) / (n + 1));
    out.push(0.2 + 0.8 * env * (0.45 + ((h >>> 0) % 1000) / 1800));
  }
  return out;
}

export function sampleCard(c: SampleCard): Node {
  const title = clip(c.title, 70);
  const chips = [c.type, c.verdict ?? c.license, c.free === undefined ? undefined : c.free ? "Free" : "Paid"].filter(Boolean) as string[];
  const art = c.image
    ? div(
        { width: 420, height: 420, flexShrink: 0, alignSelf: "center", borderRadius: 28, overflow: "hidden", border: `1px solid ${C.line}`, backgroundColor: "#0f0e16" },
        h("img", { src: c.image, width: 420, height: 420, style: { objectFit: "cover" } }),
      )
    : div(
        { width: 420, height: 420, flexShrink: 0, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 24, borderRadius: 28, border: `1px solid ${C.line}`, backgroundColor: "#0f0e16" },
        ...waveBars(c.title).map((v) => div({ width: 8, height: Math.round(360 * v), borderRadius: 4, backgroundColor: C.primary })),
      );
  return frame(
    div(
      { flexDirection: "row", width: "100%", height: "100%" },
      div(
        { flexDirection: "column", flexGrow: 1, flexShrink: 1, paddingRight: 48 },
        brand(),
        div({ marginTop: 50, fontSize: 24, fontWeight: 500, color: C.primary, textTransform: "uppercase", letterSpacing: 2 }, `On ${clip(c.source, 30)}`),
        div({ marginTop: 12, fontSize: titleSize(title, false), fontWeight: 600, lineHeight: 1.05, letterSpacing: -1.5 }, title),
        c.author ? div({ marginTop: 18, fontSize: 26, color: C.muted }, `by ${clip(c.author, 40)}`) : null,
        c.facts?.length ? div({ marginTop: 14, fontSize: 24, color: C.muted }, clip(c.facts.slice(0, 5).join(" · "), 60)) : null,
        chipRow(chips, c.site),
      ),
      art,
    ),
  );
}

/** Lay out a card and rasterise it to PNG. */
export async function renderPng(card: Node): Promise<Buffer> {
  const svg = await satori(card as unknown as Parameters<typeof satori>[0], { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng());
}

/** Thumbnails are re-encoded to this square JPEG (decodes WebP/AVIF/GIF, which resvg can't). */
const THUMB_PX = 420;

/**
 * Fetch artwork as a data: URI for a sample card. Only public http(s)
 * hosts (checked on every redirect), image/* responses of at most `maxBytes`;
 * the bytes are decoded and re-encoded as a 420px JPEG. Returns undefined on
 * any problem so the card renders without the picture.
 */
export async function fetchImage(url: string, opts: { timeoutMs?: number; maxBytes?: number; fetch?: typeof fetch } = {}): Promise<string | undefined> {
  const doFetch = opts.fetch ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 4000);
  const max = opts.maxBytes ?? 4 * 1024 * 1024;
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      assertPublicUrl(current);
      const res = await doFetch(current, { redirect: "manual", signal, headers: { "user-agent": USER_AGENT, accept: "image/*" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current).toString();
        continue;
      }
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!res.ok || !type.startsWith("image/") || type.startsWith("image/svg")) return undefined;
      if (Number(res.headers.get("content-length") ?? 0) > max) return undefined;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > max) return undefined;
      const jpeg = await sharp(body, { limitInputPixels: 40_000_000, animated: false })
        .resize(THUMB_PX, THUMB_PX, { fit: "cover" })
        .flatten({ background: "#0f0e16" })
        .jpeg({ quality: 85 })
        .toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
