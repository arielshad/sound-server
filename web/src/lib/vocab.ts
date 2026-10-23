/**
 * The sample vocabulary (categories, forms, keys, licence verdicts), read from
 * src/data/vocab.json, which web/scripts/export-vocab.mjs writes from the
 * compiled server (src/core/vocab.ts, src/core/licence.ts). Nothing here is a
 * hand-copied list: only presentation (tones, wording) is added.
 */
import vocab from "@/data/vocab.json";

export interface CategoryDef {
  id: string;
  label: string;
}

export const CATEGORY_DEFS: CategoryDef[] = vocab.categories;
export const TOP_CATEGORIES: string[] = vocab.topCategories;
export const SAMPLE_FORMS: string[] = vocab.forms;
export const PITCH_CLASSES: string[] = vocab.pitchClasses;
export const VERDICTS = vocab.verdicts as Verdict[];
export const VERDICT_LABELS = vocab.verdictLabels as Record<Verdict, string>;

export type Verdict = "yes" | "yes-with-credit" | "restricted" | "clearance-required" | "check-terms" | "no";

const byId = new Map(CATEGORY_DEFS.map((c) => [c.id, c]));

export function categoryLabel(id: string | undefined): string {
  if (!id) return "";
  return byId.get(id)?.label ?? id;
}

/** "drums.hat.closed" -> "drums" */
export const topCategory = (id: string) => id.split(".")[0] ?? id;

/** Direct and deeper children of a top-level category, in vocabulary order ("drums" -> kick, snare, …, closed hat…). */
export function subCategories(top: string): CategoryDef[] {
  return CATEGORY_DEFS.filter((c) => c.id.startsWith(`${top}.`));
}

/** Depth of a category below its top level (drums.hat = 1, drums.hat.closed = 2). */
export const depth = (id: string) => id.split(".").length - 1;

/** "Drums › Closed hat" */
export function categoryPath(id: string): string {
  const parts = id.split(".");
  if (parts.length === 1) return categoryLabel(id);
  return `${categoryLabel(parts[0])} › ${categoryLabel(id)}`;
}

/** "one-shot" -> "One-shot", "multisample" -> "Multisample". */
export function formLabel(form: string | undefined): string {
  if (!form) return "";
  return form === "midi" ? "MIDI" : form.charAt(0).toUpperCase() + form.slice(1);
}

/** Traffic-light colour of a verdict. */
export type Tone = "green" | "amber" | "red";
export function verdictTone(v: string | undefined): Tone {
  if (v === "yes" || v === "yes-with-credit") return "green";
  if (v === "no") return "red";
  return "amber";
}

/** Longer, plain-language meaning of each verdict (detail sheet, licence docs, landing page). */
export const VERDICT_MEANING: Record<Verdict, string> = {
  yes: "You can use it in a released, commercial track. No credit is required (giving one is still kind).",
  "yes-with-credit": "You can use it in a released, commercial track as long as you credit the author, for example in the release notes or video description.",
  restricted: "Commercial use comes with conditions that usually rule out a normal release: share-alike (your whole track must carry the same licence) or the retired Sampling+ rules.",
  "clearance-required": "A real recording whose owners must clear each release, usually for a fee. Fine for sketching; budget for clearance before you release.",
  "check-terms": "Nobody has verified the licence: the source states none, an anonymous uploader asserted it, or a subscription sets the terms. Read them before you use it.",
  no: "Non-commercial only: personal projects, study and practice. Not for a release that earns money, including monetised streams and videos.",
};

/** Verdicts in display order, grouped by tone. */
export const VERDICTS_BY_TONE: Record<Tone, Verdict[]> = {
  green: VERDICTS.filter((v) => verdictTone(v) === "green"),
  amber: VERDICTS.filter((v) => verdictTone(v) === "amber"),
  red: VERDICTS.filter((v) => verdictTone(v) === "red"),
};

/** All 24 keys, "C major" … "B minor", in the form the API's `key` parameter accepts. */
export const KEYS = PITCH_CLASSES.flatMap((t) => [`${t} major`, `${t} minor`]);

/** "F minor" from the API's { tonic, mode } */
export function keyText(k: { tonic: string; mode?: string } | string | undefined): string {
  if (!k) return "";
  if (typeof k === "string") return k;
  return k.mode ? `${k.tonic} ${k.mode}` : k.tonic;
}

/** 0.42 -> "0.4 s", 75 -> "1:15" */
export function durationText(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec)) return "";
  if (sec < 10) return `${sec < 1 ? sec.toFixed(2).replace(/0$/, "") : sec.toFixed(1)} s`;
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
