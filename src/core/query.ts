/**
 * Musical facts in free text: "140 bpm", "120-128 bpm", "F minor", "F#m",
 * "one shot", "loop". Used two ways:
 * - on a user's query, to turn words into filters (`parseQuery`)
 * - on sample titles and file names, to fill in BPM and key (`bpmFromText`, `keyFromText`)
 */
import { categoriesIn, matchAliases, soundTokens } from "./classify.js";
import type { BpmRange, MusicalKey, SampleFilters } from "./types.js";
import { FORM_ALIASES, PITCH_CLASSES, SAMPLE_FORMS, type Category, type PitchClass, type SampleForm } from "./vocab.js";

const FLAT_OF: Record<string, PitchClass> = { C: "B", D: "C#", E: "D#", F: "E", G: "F#", A: "G#", B: "A#" };
const SHARP_OF: Record<string, PitchClass> = { C: "C#", D: "D#", E: "F", F: "F#", G: "G#", A: "A#", B: "C" };

/** "Eb", "e flat", "D#", "d♯" → a pitch class spelled with sharps. */
export function normalizePitch(letter: string, accidental?: string): PitchClass | undefined {
  const l = letter.toUpperCase();
  if (!/^[A-G]$/.test(l)) return undefined;
  const acc = (accidental ?? "").trim().toLowerCase();
  if (acc === "#" || acc === "♯" || acc === "sharp") return SHARP_OF[l];
  if (acc === "b" || acc === "♭" || acc === "flat") return FLAT_OF[l];
  return l as PitchClass;
}

// "120 bpm", "120bpm", "bpm 120", "120-128 bpm", "120 to 128 bpm"
// File names use "_" as a separator, which \b treats as a word character, so plain look-arounds are used.
const BPM_RANGE = /(?<![\d.])(\d{2,3})\s*(?:-|–|to)\s*(\d{2,3})\s*bpm(?![a-z])/i;
const BPM_AFTER = /(?<![\d.])(\d{2,3}(?:\.\d+)?)\s*[-_]?\s*bpm(?![a-z])/i;
const BPM_BEFORE = /(?<![a-z])bpm\s*[:=_]?\s*(\d{2,3}(?:\.\d+)?)(?![\d])/i;
// File-name style: "_140_" next to "loop" is too ambiguous; only explicit bpm marks are used.

export function bpmFromText(text: string): number | undefined {
  const m = BPM_AFTER.exec(text) ?? BPM_BEFORE.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 40 && n <= 300 ? n : undefined;
}

// "F minor", "f# major", "E flat minor", "Ebmin", "Cmaj", "in the key of A"
const KEY_WORDS = /(?:^|[\s_\-(\[])([A-Ga-g])\s?(#|♯|b|♭|\s?sharp|\s?flat)?\s?(major|minor|maj|min)(?=$|[\s_\-)\].,])/;
// "F#m", "Cm", "Abm", "Bbm" (letter must be upper case; "am" alone is English)
const KEY_COMPACT = /(?:^|[\s_\-(\[])([A-G])(#|♯|b)?(m|M)(?=$|[\s_\-)\].,\d])/;
const KEY_OF = /\bkey of ([A-Ga-g])(#|♯|b|♭)?\b/i;

export function keyFromText(text: string): MusicalKey | { tonic: PitchClass; mode?: undefined } | undefined {
  let m = KEY_WORDS.exec(text);
  if (m) {
    const tonic = normalizePitch(m[1]!, m[2]?.trim());
    if (tonic) return { tonic, mode: m[3]!.toLowerCase().startsWith("maj") ? "major" : "minor" };
  }
  m = KEY_COMPACT.exec(text);
  if (m) {
    const tonic = normalizePitch(m[1]!, m[2]);
    if (tonic) return { tonic, mode: m[3] === "M" ? "major" : "minor" };
  }
  m = KEY_OF.exec(text);
  if (m) {
    const tonic = normalizePitch(m[1]!, m[2]);
    if (tonic) return { tonic };
  }
  return undefined;
}

const FORM_ALIAS_LIST = SAMPLE_FORMS.flatMap((form) => FORM_ALIASES[form].map((a) => ({ words: soundTokens(a), target: form }))).sort(
  (a, b) => b.words.length - a.words.length,
);

export interface ParsedQuery extends SampleFilters {
  /** The words left for text search. */
  query: string;
  /** Categories the words point at (ranking hints, not filters). */
  hints: Category[];
}

/**
 * Pull BPM, key and form out of a user's query. BPM and key words are removed
 * from the text (they hurt text search); form and category words stay because
 * sources without those fields still match them in titles.
 */
export function parseQuery(raw: string): ParsedQuery {
  let text = ` ${raw} `;
  let bpm: BpmRange | undefined;
  const range = BPM_RANGE.exec(text);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    bpm = { min: Math.min(a, b), max: Math.max(a, b) };
    text = text.replace(range[0], " ");
  } else {
    const one = BPM_AFTER.exec(text) ?? BPM_BEFORE.exec(text);
    if (one) {
      const n = Number(one[1]);
      if (n >= 40 && n <= 300) bpm = { min: n, max: n };
      text = text.replace(one[0], " ");
    }
  }

  let key: ParsedQuery["key"];
  for (const re of [KEY_WORDS, KEY_COMPACT, KEY_OF]) {
    const m = re.exec(text);
    if (!m) continue;
    const k = keyFromText(m[0]);
    if (!k) continue;
    key = k.mode ? { tonic: k.tonic, mode: k.mode } : { tonic: k.tonic };
    text = text.replace(m[0], " ").replace(/\bin\s*$/i, " ").replace(/\s(in|the key of)\s(?=\s|$)/gi, " ");
    break;
  }

  const formHits = matchAliases(soundTokens(text), FORM_ALIAS_LIST);
  const forms = SAMPLE_FORMS.filter((f) => formHits.has(f) && f !== "phrase" && f !== "pack" && f !== "multisample") as SampleForm[];

  const query = text.replace(/\s+/g, " ").trim();
  return {
    query,
    hints: categoriesIn(query),
    ...(bpm ? { bpm } : {}),
    ...(key ? { key } : {}),
    ...(forms.length ? { forms } : {}),
  };
}

/** Within the range (± tolerance), allowing half and double time. */
export function bpmMatches(bpm: number, range: BpmRange, tolerance = 2): boolean {
  const lo = (range.min ?? 0) - tolerance;
  const hi = (range.max ?? Infinity) + tolerance;
  return [bpm, bpm * 2, bpm / 2].some((b) => b >= lo && b <= hi);
}

const PC_INDEX = new Map(PITCH_CLASSES.map((p, i) => [p, i]));

/** Same tonic and mode; with `compatible`, the relative major/minor also counts (F minor ≈ G# major). */
export function keyMatches(
  key: MusicalKey,
  wanted: { tonic: PitchClass; mode?: "major" | "minor" },
  compatible = false,
): boolean {
  if (key.tonic === wanted.tonic && (!wanted.mode || key.mode === wanted.mode)) return true;
  if (!compatible || !wanted.mode || key.mode === wanted.mode) return false;
  const shift = wanted.mode === "minor" ? 3 : 9; // relative major is +3 semitones from minor
  return (PC_INDEX.get(wanted.tonic)! + shift) % 12 === PC_INDEX.get(key.tonic);
}

export function formatKey(k: { tonic: string; mode?: string }): string {
  return k.mode ? `${k.tonic} ${k.mode}` : k.tonic;
}
