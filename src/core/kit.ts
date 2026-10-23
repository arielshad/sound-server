/**
 * Kit planning for agents: one search per slot (kick, snare, hats, 808…), in
 * parallel, then the best pick per slot with alternatives and a reason. The
 * pure exporters turn a plan plus local paths/URLs into a Strudel sample map,
 * a General MIDI drum map with an SFZ file, and the credits.
 */
import { categoriesIn } from "./classify.js";
import { COMMERCIAL_SAFE, VERDICT_LABELS } from "./licence.js";
import { keyMatches } from "./query.js";
import { UnknownProviderError, type SampleService } from "./service.js";
import type { CommercialVerdict, MusicalKey, Sample } from "./types.js";
import { COMMERCIAL_VERDICTS } from "./types.js";
import { CATEGORIES, categoryLabel, categoryMatches, isCategory, PITCH_CLASSES, type Category } from "./vocab.js";

export { creditsJson, creditsMarkdown, mergeCredits, type CreditEntry, type CreditsFile } from "./credits.js";

export const DEFAULT_SLOTS = ["kick", "snare", "clap", "hat.closed", "hat.open", "808"] as const;

export interface KitRequest {
  /** Slot names: category ids ("drums.kick", "hat.closed") or free words ("crash", "perc", "riser", "vocal chop"). */
  slots?: string[];
  /** Genre/character words added to every slot's query, e.g. "dark trap". */
  style?: string;
  bpm?: number;
  /** Key for pitched slots (808, bass, synth…). */
  key?: MusicalKey;
  /** Default true. */
  commercialOnly?: boolean;
  /** Default true. */
  downloadableOnly?: boolean;
  providers?: string[];
  /** Alternatives per slot (default 3). */
  perSlot?: number;
  /** Per-provider timeout passed to each search. */
  timeoutMs?: number;
  credentials?: Record<string, string>;
}

export interface KitSlot {
  slot: string;
  category: Category;
  pick?: Sample;
  alternatives: Sample[];
  reason: string;
}

export interface KitPlan {
  /** Short identifier for the kit (from the style), used as the Strudel bank name. */
  name: string;
  style?: string;
  bpm?: number;
  key?: MusicalKey;
  slots: KitSlot[];
  warnings: string[];
  /** Picks per licence verdict. */
  licences: Record<CommercialVerdict, number>;
  /** True when any pick asks for attribution. */
  creditsNeeded: boolean;
}

/** Map a slot word to a category: an id, an id suffix ("hat.closed"), then vocabulary aliases. */
export function slotCategory(slot: string): Category | undefined {
  const s = slot.trim().toLowerCase();
  if (isCategory(s)) return s;
  const suffix = CATEGORIES.filter((c) => c.endsWith(`.${s}`));
  if (suffix.length) return suffix.sort((a, b) => a.length - b.length)[0];
  return categoriesIn(s.replace(/[._]/g, " "))[0];
}

const PITCHED_PREFIXES = ["bass", "synth", "keys", "guitar", "strings", "brass", "woodwind", "mallets", "vocals.chop"];
function isPitched(c: string): boolean {
  return PITCHED_PREFIXES.some((p) => c === p || c.startsWith(`${p}.`));
}
function isLoopSlot(slot: string, c: string): boolean {
  return /\bloops?\b|\bgroove\b/.test(slot.toLowerCase()) || c === "drums.break" || c === "drums.fill";
}
function wantsOneShot(slot: string, c: string): boolean {
  return !isLoopSlot(slot, c) && (c.startsWith("drums.") || c === "bass.808");
}

function slotWords(slot: string, category: Category | undefined): string {
  if (category && (slot.includes(".") || isCategory(slot))) return categoryLabel(category).toLowerCase();
  return slot.replace(/[._]/g, " ").trim();
}

export function kitName(style?: string): string {
  const n = (style ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
  return n ? n.slice(0, 24) : "kit";
}

/** Plan a kit: one parallel search per slot, best pick + alternatives each. */
export async function planKit(service: SampleService, req: KitRequest = {}): Promise<KitPlan> {
  const slots = req.slots?.length ? req.slots : [...DEFAULT_SLOTS];
  const perSlot = Math.max(0, Math.min(10, req.perSlot ?? 3));
  const commercialOnly = req.commercialOnly ?? true;
  const downloadableOnly = req.downloadableOnly ?? true;
  const style = req.style?.trim() ?? "";
  const warnings: string[] = [];

  const results = await Promise.all(
    slots.map(async (slot): Promise<KitSlot> => {
      const mapped = slotCategory(slot);
      const category = mapped ?? "other";
      if (!mapped) warnings.push(`"${slot}": no matching category; searched by its words only.`);
      const oneShot = wantsOneShot(slot, category);
      const pitched = isPitched(category);
      const query = [style, slotWords(slot, mapped)].filter(Boolean).join(" ");
      try {
        const res = await service.search({
          query,
          categories: mapped ? [category] : undefined,
          forms: oneShot ? ["one-shot"] : isLoopSlot(slot, category) ? ["loop"] : undefined,
          key: pitched && req.key ? req.key : undefined,
          bpm: isLoopSlot(slot, category) && req.bpm ? { min: req.bpm, max: req.bpm } : undefined,
          commercialOnly,
          downloadableOnly,
          providers: req.providers,
          limit: Math.max(12, perSlot * 4),
          timeoutMs: req.timeoutMs,
          credentials: req.credentials,
        });
        for (const p of res.providers) {
          if (p.status === "error" || p.status === "timeout") warnings.push(`"${slot}": ${p.name} ${p.status === "timeout" ? "timed out" : `failed (${p.error ?? "error"})`}.`);
        }
        const ranked = res.results
          .map((s) => ({ s, ...scorePick(s, { category, oneShot, pitched, key: req.key, bpm: req.bpm, loop: isLoopSlot(slot, category) }) }))
          .sort((a, b) => b.score - a.score);
        const best = ranked[0];
        if (!best) {
          warnings.push(`"${slot}": nothing found${commercialOnly ? " that is commercial-safe" : ""}${downloadableOnly ? " and downloadable" : ""}.`);
          return { slot, category, alternatives: [], reason: "No results." };
        }
        return { slot, category, pick: best.s, alternatives: ranked.slice(1, 1 + perSlot).map((r) => r.s), reason: best.reasons.join("; ") };
      } catch (e) {
        if (e instanceof UnknownProviderError) throw e;
        warnings.push(`"${slot}": search failed (${e instanceof Error ? e.message : String(e)}).`);
        return { slot, category, alternatives: [], reason: "Search failed." };
      }
    }),
  );

  const licences = Object.fromEntries(COMMERCIAL_VERDICTS.map((v) => [v, 0])) as Record<CommercialVerdict, number>;
  let creditsNeeded = false;
  for (const r of results) {
    if (!r.pick) continue;
    licences[r.pick.license?.verdict ?? "check-terms"]++;
    if (r.pick.license?.attributionRequired) creditsNeeded = true;
  }
  return {
    name: kitName(style),
    ...(style ? { style } : {}),
    ...(req.bpm ? { bpm: req.bpm } : {}),
    ...(req.key ? { key: req.key } : {}),
    slots: results,
    warnings,
    licences,
    creditsNeeded,
  };
}

interface PickContext {
  category: Category;
  oneShot: boolean;
  pitched: boolean;
  loop: boolean;
  key?: MusicalKey;
  bpm?: number;
}

/** Score one candidate for a slot (0..~1) and say why. */
export function scorePick(s: Sample, ctx: PickContext): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0.25 * (s.score ?? 0.5);
  const conf = s.categoryEvidence?.confidence ?? 0.5;
  if (s.category === ctx.category) {
    score += 0.2 + 0.15 * conf;
    reasons.push(`${s.category} (confidence ${round(conf)})`);
  } else if (categoryMatches(s.category, [ctx.category])) {
    score += 0.2;
    reasons.push(s.category);
  } else if (categoryMatches(ctx.category, [s.category])) {
    score += 0.08;
    reasons.push(`${s.category} (broader than ${ctx.category})`);
  }
  if (ctx.oneShot) {
    if (s.form === "one-shot") {
      score += 0.12;
      reasons.push("one-shot");
    } else if (s.form === undefined) score += 0.05;
    if (s.durationSec !== undefined) {
      const limit = ctx.category === "bass.808" || ctx.category.startsWith("drums.cymbal") ? 4 : 2;
      if (s.durationSec < limit) {
        score += 0.08;
        reasons.push(`${round(s.durationSec)} s`);
      } else score -= 0.05;
    } else score += 0.03;
  } else if (ctx.loop && s.form === "loop") {
    score += 0.1;
    reasons.push("loop");
  }
  if (ctx.loop && ctx.bpm && s.bpm) {
    if (Math.abs(s.bpm - ctx.bpm) <= 1) {
      score += 0.1;
      reasons.push(`${s.bpm} BPM`);
    }
  }
  if (ctx.pitched && ctx.key) {
    if (s.key && keyMatches(s.key, ctx.key)) {
      score += 0.15;
      reasons.push(`in ${s.key.tonic} ${s.key.mode}`);
    } else if (s.key && keyMatches(s.key, ctx.key, true)) {
      score += 0.1;
      reasons.push(`in ${s.key.tonic} ${s.key.mode} (relative key)`);
    } else if (s.rootNote !== undefined && PITCH_CLASSES[s.rootNote % 12] === ctx.key.tonic) {
      score += 0.15;
      reasons.push(`root ${ctx.key.tonic}`);
    } else if (!s.key && s.rootNote === undefined) score += 0.04;
  }
  const verdict = s.license?.verdict;
  if (verdict && COMMERCIAL_SAFE.has(verdict)) {
    score += verdict === "yes" ? 0.1 : 0.08;
    reasons.push(`${s.license!.name}: ${VERDICT_LABELS[verdict]}`);
  } else if (verdict) reasons.push(`${s.license!.name}: ${VERDICT_LABELS[verdict]}`);
  if (s.downloadable) score += 0.04;
  return { score: round(score, 4), reasons };
}

// ---------------------------------------------------------------------------
// Exports

/** Strudel's conventional sample names for a slot. */
export function strudelName(slot: string, category: string): string {
  const w = slot.toLowerCase();
  if (/\brim/.test(w)) return "rim";
  if (/\bcowbell/.test(w)) return "cb";
  if (/\bshaker/.test(w)) return "sh";
  if (/\btamb/.test(w)) return "tb";
  if (category === "drums.tom") return /\b(low|floor)\b/.test(w) ? "lt" : /\b(high|hi)\b/.test(w) ? "ht" : "mt";
  const byCategory: Record<string, string> = {
    "drums.kick": "bd",
    "drums.snare": "sd",
    "drums.clap": "cp",
    "drums.hat": "hh",
    "drums.hat.closed": "hh",
    "drums.hat.open": "oh",
    "drums.cymbal": "cr",
    "drums.cymbal.crash": "cr",
    "drums.cymbal.ride": "rd",
    "drums.perc": "perc",
    "drums.fill": "fill",
    "drums.break": "break",
    // A bare "808" would parse as a number in mini-notation.
    "bass.808": "bass808",
  };
  if (byCategory[category]) return byCategory[category]!;
  const top = category.split(".")[0]!;
  if (top === "fx") return "fx";
  if (top === "vocals") return "vox";
  if (top === "bass") return "bass";
  return top === "other" ? (w.replace(/[^a-z0-9]+/g, "") || "misc") : top;
}

export interface StrudelExport {
  /** strudel.json content: { "_base": …, "<kit>_bd": ["kick.wav"], … }. */
  json: Record<string, string | string[]>;
  /** Ready-to-paste Strudel code. */
  snippet: string;
  /** Slot → Strudel sample name ("bd", "hh"…). */
  names: Record<string, string>;
  bank: string;
}

/**
 * A Strudel sample map for the kit. `paths` maps slot → file path or URL
 * (relative to `baseUrl` when given). Names follow the bank convention
 * (`<kit>_bd`), so `s("bd sd").bank("<kit>")` plays the kit. Slots sharing a
 * name (two FX) become one array (`fx:0`, `fx:1`).
 */
export function strudelSampleMap(plan: KitPlan, opts: { baseUrl?: string; paths: Record<string, string>; bank?: string }): StrudelExport {
  const bank = opts.bank ?? plan.name;
  const json: Record<string, string | string[]> = {};
  if (opts.baseUrl) json._base = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
  const names: Record<string, string> = {};
  for (const s of plan.slots) {
    const path = opts.paths[s.slot];
    if (!path) continue;
    const name = strudelName(s.slot, s.category);
    names[s.slot] = name;
    const key = `${bank}_${name}`;
    const list = (json[key] as string[] | undefined) ?? [];
    list.push(path);
    json[key] = list;
  }
  const has = (n: string) => Object.values(names).includes(n);
  const layers: string[] = [];
  const drums = has("bd") && has("sd") ? "bd sd [~ bd] sd" : has("bd") ? "bd*4" : has("sd") ? "~ sd ~ sd" : undefined;
  if (drums) layers.push(`s("${drums}")`);
  if (has("cp")) layers.push(`s("~ cp ~ cp").gain(0.8)`);
  if (has("hh")) layers.push(`s("hh*8").gain(0.6)`);
  if (has("oh")) layers.push(`s("~ ~ ~ oh").gain(0.5)`);
  if (has("bass808")) layers.push(`s("bass808 ~ ~ bass808 ~ ~ bass808 ~")`);
  if (has("perc")) layers.push(`s("~ perc ~ [~ perc]").gain(0.5)`);
  if (has("rim")) layers.push(`s("~ ~ rim ~").gain(0.6)`);
  if (has("cr")) layers.push(`s("cr ~ ~ ~").slow(4).gain(0.5)`);
  if (has("rd")) layers.push(`s("rd*4").gain(0.4)`);
  if (!layers.length && Object.keys(names).length) layers.push(`s("${[...new Set(Object.values(names))].join(" ")}")`);
  const map = JSON.stringify(json, null, 2);
  const cps = plan.bpm ? `setcpm(${round(plan.bpm / 4, 2)})\n` : "";
  const body = layers.length === 1 ? `${layers[0]}.bank("${bank}")` : `stack(\n${layers.map((l) => `  ${l},`).join("\n")}\n).bank("${bank}")`;
  const snippet = `samples(${map})\n\n${cps}${body}\n`;
  return { json, snippet, names, bank };
}

/** General MIDI drum notes. */
export const GM_NOTES: Record<string, number> = {
  "bass.808": 35,
  "drums.kick": 36,
  rim: 37,
  "drums.snare": 38,
  "drums.clap": 39,
  "drums.hat.closed": 42,
  "drums.hat": 42,
  "drums.hat.open": 46,
  "drums.cymbal.crash": 49,
  "drums.cymbal": 49,
  "drums.cymbal.ride": 51,
  tambourine: 54,
  cowbell: 56,
  shaker: 70,
};
const TOM_NOTES = { low: 41, mid: 45, high: 48 } as const;
const PERC_NOTES = [37, 54, 56, 60, 61, 62, 63, 64, 70, 75, 76];

export interface GmDrumMap {
  /** MIDI note → slot. */
  notes: Record<number, { slot: string; category: string; sampleId?: string; title?: string; path?: string; gm: boolean }>;
  /** Slot → MIDI note. */
  bySlot: Record<string, number>;
  sfz: string;
}

/**
 * A General MIDI drum mapping (kick 36, snare 38, clap 39, closed hat 42,
 * open hat 46, crash 49, ride 51, toms 41/45/48, 808 on 35) and an SFZ file
 * so the kit plays in any SFZ sampler. Non-drum slots go to C6 (84) upward.
 * The open hat is choked by the closed hat.
 */
export function gmDrumMap(plan: KitPlan, opts: { paths?: Record<string, string> } = {}): GmDrumMap {
  const used = new Set<number>();
  const notes: GmDrumMap["notes"] = {};
  const bySlot: Record<string, number> = {};
  let extra = 84;
  const take = (n: number) => {
    used.add(n);
    return n;
  };
  for (const s of plan.slots) {
    if (!s.pick && !opts.paths?.[s.slot]) continue;
    const w = s.slot.toLowerCase();
    let note: number | undefined;
    let gm = true;
    const named = /\brim/.test(w) ? "rim" : /\btamb/.test(w) ? "tambourine" : /\bcowbell/.test(w) ? "cowbell" : /\bshaker/.test(w) ? "shaker" : undefined;
    const preferred = (named && GM_NOTES[named]) ?? GM_NOTES[s.category];
    if (preferred !== undefined && !used.has(preferred)) note = take(preferred);
    else if (s.category === "drums.kick" && !used.has(35)) note = take(35);
    else if (s.category === "drums.tom") {
      const order = /\b(low|floor)\b/.test(w) ? ["low", "mid", "high"] : /\b(high|hi)\b/.test(w) ? ["high", "mid", "low"] : ["mid", "low", "high"];
      const free = order.map((k) => TOM_NOTES[k as keyof typeof TOM_NOTES]).find((n) => !used.has(n));
      if (free !== undefined) note = take(free);
    } else if (s.category.startsWith("drums.")) {
      const free = PERC_NOTES.find((n) => !used.has(n));
      if (free !== undefined) note = take(free);
    }
    if (note === undefined) {
      while (used.has(extra)) extra++;
      note = take(extra);
      gm = false;
    }
    bySlot[s.slot] = note;
    notes[note] = {
      slot: s.slot,
      category: s.category,
      ...(s.pick ? { sampleId: s.pick.id, title: s.pick.title } : {}),
      ...(opts.paths?.[s.slot] ? { path: opts.paths[s.slot] } : {}),
      gm,
    };
  }

  const lines = [
    `// ${plan.style ? `${plan.style} kit` : "Drum kit"} by sound-server: General MIDI drum map.`,
    "// Credits and licences: see ATTRIBUTION.md next to this file.",
    "<control>",
    "default_path=./",
    "",
    "<global>",
    "loop_mode=one_shot",
    "amp_veltrack=100",
    "",
  ];
  const hasClosed = Object.values(notes).some((n) => n.category === "drums.hat.closed" || n.category === "drums.hat");
  for (const [note, n] of Object.entries(notes).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const path = (n.path ?? `${n.slot.replace(/[^a-z0-9]+/gi, "-")}.wav`).replace(/\\/g, "/");
    lines.push(`// ${n.slot}${n.title ? `: ${n.title}` : ""}${n.sampleId ? ` (${n.sampleId})` : ""}`);
    const choke = n.category === "drums.hat.open" && hasClosed ? " group=1 off_by=2" : n.category === "drums.hat.closed" || n.category === "drums.hat" ? " group=2" : "";
    lines.push(`<region> key=${note}${choke} sample=${path}`);
  }
  return { notes, bySlot, sfz: `${lines.join("\n")}\n` };
}

/** The picks of a plan (for credits). */
export function kitSamples(plan: KitPlan): Sample[] {
  return plan.slots.flatMap((s) => (s.pick ? [s.pick] : []));
}

function round(n: number, d = 2): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}
