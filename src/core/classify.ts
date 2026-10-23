/**
 * Turn a sample's words (title, file name, tags, the source's own categories)
 * into one of our categories and forms, with a confidence.
 *
 * Rules only, no model: phrases from src/core/vocab.ts are matched longest
 * first ("bass drum" is a kick, not bass; "closed hat" beats "hat"), each
 * field has a weight, deeper categories win ties, and duration/BPM decide
 * one-shot vs loop when the words don't say.
 */
import { CATEGORY_DEFS, FORM_ALIASES, SAMPLE_FORMS, type Category, type SampleForm } from "./vocab.js";

export interface ClassifyInput {
  title: string;
  filename?: string;
  tags?: string[];
  /** The source's own category labels, e.g. "Drums > Kicks" or "Percussion". */
  sourceCategories?: string[];
  description?: string;
  durationSec?: number;
  bpm?: number;
}

export interface Classification {
  category: Category;
  confidence: number;
  form?: SampleForm;
}

/**
 * Context words that cancel an alias in the same field: a "soccer kick" is a
 * football sound, a "door slam" is foley, a "ride" on a "bike" is no cymbal.
 */
const NOT_IN_CONTEXT: Record<string, string[]> = {
  "drums.kick": ["soccer", "football", "ball", "door", "karate", "martial", "kickstarter", "horse"],
  "drums.cymbal.ride": ["bike", "car", "horse", "train", "bus", "elevator"],
  "drums.cymbal.crash": ["car", "glass", "plane", "computer"],
  "drums.clap": ["thunder", "applause", "audience", "crowd"],
  "fx.impact": ["door"],
  "drums.break": ["glass", "bone", "wood", "branch", "ice"],
};

const FIELD_WEIGHTS = { source: 1.3, filename: 1.0, title: 1.0, tags: 0.7, description: 0.25 } as const;
type Field = keyof typeof FIELD_WEIGHTS;

/** Split text into lowercase word tokens, also splitting camelCase and letter/digit runs ("DeepKick01" → deep kick 01). */
export function soundTokens(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}#+]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

interface Alias {
  words: string[];
  target: string;
}

function buildAliases(): Alias[] {
  const out: Alias[] = [];
  for (const def of CATEGORY_DEFS) {
    for (const a of def.aliases) out.push({ words: soundTokens(a), target: def.id });
  }
  // Longest phrases first so they consume their words before shorter aliases see them.
  return out.sort((a, b) => b.words.length - a.words.length);
}
const CATEGORY_ALIASES = buildAliases();

function buildFormAliases(): Alias[] {
  const out: Alias[] = [];
  for (const form of SAMPLE_FORMS) for (const a of FORM_ALIASES[form]) out.push({ words: soundTokens(a), target: form });
  return out.sort((a, b) => b.words.length - a.words.length);
}
const FORM_ALIAS_LIST = buildFormAliases();

/** Find which alias targets occur in `tokens`, longest match first, each token used once. */
export function matchAliases(tokens: string[], aliases: Alias[] = CATEGORY_ALIASES): Set<string> {
  return new Set(matchAliasPositions(tokens, aliases).keys());
}

/** Like matchAliases, with the last token position of each target (later words are the head noun: "noise riser"). */
export function matchAliasPositions(tokens: string[], aliases: Alias[] = CATEGORY_ALIASES): Map<string, number> {
  const used = new Array<boolean>(tokens.length).fill(false);
  const hits = new Map<string, number>();
  for (const alias of aliases) {
    const n = alias.words.length;
    for (let i = 0; i + n <= tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < n; j++) {
        if (used[i + j] || tokens[i + j] !== alias.words[j]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      hits.set(alias.target, Math.max(hits.get(alias.target) ?? -1, i + n - 1));
      for (let j = 0; j < n; j++) used[i + j] = true;
    }
  }
  return hits;
}

function depth(id: string): number {
  return id.split(".").length - 1;
}

/** Score every category for the given fields. */
function scoreCategories(fields: Partial<Record<Field, string[]>>): Map<string, number> {
  const scores = new Map<string, number>();
  const strongHits = new Set<string>();
  for (const [field, values] of Object.entries(fields) as [Field, string[]][]) {
    if (!values?.length) continue;
    const fieldHits = new Map<string, number>();
    for (const v of values) {
      const tokens = soundTokens(v);
      const present = new Set(tokens);
      for (const [h, pos] of matchAliasPositions(tokens)) {
        if (NOT_IN_CONTEXT[h]?.some((w) => present.has(w))) continue;
        // A tiny bonus for words nearer the end breaks ties towards the head noun.
        fieldHits.set(h, Math.max(fieldHits.get(h) ?? 0, 0.01 * ((pos + 1) / tokens.length)));
      }
    }
    for (const [h, bonus] of fieldHits) {
      scores.set(h, (scores.get(h) ?? 0) + FIELD_WEIGHTS[field] + (FIELD_WEIGHTS[field] >= 1 ? bonus : 0));
      if (FIELD_WEIGHTS[field] >= 1) strongHits.add(h);
    }
  }
  // "808 snare", "808 kick", "808 drums": the 808 names the drum machine, not the bass.
  if (scores.has("bass.808") && [...strongHits].some((h) => h === "drums" || h.startsWith("drums."))) {
    scores.set("bass.808", scores.get("bass.808")! * 0.3);
  }
  // A child that scored lends its weight to its parent, so "kick" also means "drums".
  for (const [id, s] of [...scores]) {
    const parts = id.split(".");
    for (let i = parts.length - 1; i > 0; i--) {
      const parent = parts.slice(0, i).join(".");
      scores.set(parent, Math.max(scores.get(parent) ?? 0, s * 0.8));
    }
  }
  return scores;
}

export function classify(input: ClassifyInput): Classification {
  const scores = scoreCategories({
    source: input.sourceCategories,
    filename: input.filename ? [input.filename.replace(/\.[a-z0-9]{2,5}$/i, "")] : undefined,
    title: [input.title],
    tags: input.tags,
    description: input.description ? [input.description.slice(0, 400)] : undefined,
  });

  let best: string | undefined;
  let bestScore = 0;
  for (const [id, s] of scores) {
    const ranked = s + 0.15 * depth(id);
    const current = best === undefined ? -1 : bestScore + 0.15 * depth(best);
    if (ranked > current) {
      best = id;
      bestScore = s;
    }
  }

  let confidence = 0;
  if (best) {
    // Competing categories that are not the winner's ancestors lower the confidence.
    let rival = 0;
    for (const [id, s] of scores) {
      if (id === best || best.startsWith(`${id}.`)) continue;
      rival = Math.max(rival, s);
    }
    confidence = round(Math.min(1, bestScore / 1.3) * (bestScore / (bestScore + rival)));
  }
  const category = (best ?? "other") as Category;
  return { category, confidence, form: inferForm(input, category) };
}

/** One-shot vs loop vs phrase, from words first, then duration and tempo. */
export function inferForm(input: ClassifyInput, category?: string): SampleForm | undefined {
  const words = [input.title, input.filename ?? "", ...(input.tags ?? []), ...(input.sourceCategories ?? [])].join(" ");
  const hits = matchAliases(soundTokens(words), FORM_ALIAS_LIST);
  for (const form of ["midi", "preset", "multisample", "loop", "one-shot", "phrase"] as const) {
    if (hits.has(form)) return form;
  }
  if (category === "vocals.acapella") return "phrase";
  const d = input.durationSec;
  if (d !== undefined) {
    if (input.bpm && d >= 1) return "loop";
    if (d <= 2.5) return "one-shot";
    if (category?.startsWith("drums.") && category !== "drums.fill" && category !== "drums.break" && d <= 4) return "one-shot";
    if (category?.startsWith("fx.") && d <= 12) return "one-shot";
  }
  return undefined;
}

/** All categories the words point at (for query hints), most specific first. */
export function categoriesIn(text: string): Category[] {
  const hits = [...matchAliases(soundTokens(text))];
  if (hits.includes("bass.808") && hits.some((h) => h === "drums" || h.startsWith("drums."))) hits.splice(hits.indexOf("bass.808"), 1);
  return hits.sort((a, b) => depth(b) - depth(a)) as Category[];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
