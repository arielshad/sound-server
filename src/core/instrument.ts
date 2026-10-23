/**
 * Multisample instrument export: a folder of per-note audio files (a
 * downloaded multisample pack such as Iowa MIS, Philharmonia, VSCO 2,
 * FreePats or VCSL) → a playable SFZ file, a Decent Sampler `.dspreset` and a
 * JSON summary.
 *
 * Root notes come from the file name first (C4, C#3, Db3, As4, A-1, "60",
 * "midi60"), then the WAV `smpl` / ACID / AIFF INST header, then pitch
 * detection (analyze.ts) above a confidence threshold. Velocity layers come
 * from dynamics words (ppp…fff, pianissimo…fortissimo, soft/medium/loud,
 * vl1…vlN, v1…v16, Salamander "C4v8", FreePats "A0vH"); round robins from
 * rr1…rrN, or numbered files that repeat the same note + layer.
 *
 * Each layer's samples cover the keys from midway below to midway above their
 * neighbours; layers split the velocity range evenly. The SFZ uses
 * seq_length/seq_position for round robins and the smpl loop points when the
 * WAV has them; the Decent Sampler preset puts round robins in their own
 * groups (seqMode="round_robin", seqLength) and has attack/release knobs.
 *
 * `mapInstrument`, `toSfz`, `toDecentSampler` and `parseSampleName` are pure;
 * `buildInstrument` adds a small fs walker and header/pitch reads. No network.
 */
import { mkdir, open, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { analyzeAudio } from "./analyze.js";
import { hzToMidi, noteName, parseNoteName } from "./notes.js";
import { parseWavChunks } from "./wavchunks.js";

// ---------------------------------------------------------------------------
// Types

export interface InstrumentFileInput {
  /** Local file path (absolute, or relative to the working directory). */
  path: string;
  /** Where the file came from (kept in the summary). */
  url?: string;
  /** Provider title; parsed for a note when the file name has none. */
  title?: string;
}

export type RootSource = "filename" | "smpl" | "acid" | "aiff" | "pitch";

export interface ParsedSampleName {
  /** MIDI note from the name (C4 = 60). */
  note?: number;
  /** The file holds a run of notes (Iowa "Piano.ff.C4B4.aiff"): not playable as one zone. */
  noteRun?: [number, number];
  /** Velocity layer label: "pp", "ff", "vl2", "v8", "vH", "soft"… */
  layer?: string;
  /** Sort key for the layer (ppp 1 … fff 8; vlN/vN → N; vH 7). */
  layerRank?: number;
  /** Explicit round-robin index (rr2, round_robin_2). */
  rr?: number;
  /** Other plain numbers in the name (take numbers, Philharmonia lengths). */
  numbers: number[];
  /** Remaining words (instrument, articulation, mic…), lowercased. */
  words: string[];
}

export interface InstrumentSample {
  /** Path as given (used to read the file). */
  path: string;
  /** Path written into the SFZ/dspreset: relative to the output folder, forward slashes. */
  file: string;
  url?: string;
  title?: string;
  /** Root (unity) note, MIDI. */
  note: number;
  noteSource: RootSource;
  /** 1 for names and headers; the detector's confidence for "pitch". */
  confidence: number;
  /** Fine tuning to apply (cents), from the smpl pitch fraction or the detected frequency. */
  tuneCents?: number;
  layer?: string;
  layerRank?: number;
  rr?: number;
  numbers: number[];
  words: string[];
  /** Folder of the file relative to the output folder ("" for the same folder). */
  dir: string;
  /** smpl loop (sample frames, inclusive). */
  loop?: { start: number; end: number };
}

export interface InstrumentZone {
  file: string;
  path: string;
  url?: string;
  note: number;
  noteSource: RootSource;
  tuneCents?: number;
  layer: string;
  lokey: number;
  hikey: number;
  lovel: number;
  hivel: number;
  /** Round robins on this note in this layer (1 = none). */
  seqLength: number;
  seqPosition: number;
  loop?: { start: number; end: number };
}

export interface InstrumentLayer {
  name: string;
  rank: number;
  lovel: number;
  hivel: number;
  /** Sampled notes in this layer. */
  notes: number[];
  samples: number;
}

export interface InstrumentGap {
  /** Sampled notes on either side of the gap. */
  from: number;
  to: number;
  fromName: string;
  toName: string;
  /** Interval between the two sampled notes. */
  semitones: number;
  /** Set when only this layer has the gap. */
  layer?: string;
}

export interface InstrumentVariant {
  /** Folder + distinguishing words ("" when every file shares them). */
  name: string;
  files: number;
  lo: number;
  hi: number;
  used: "primary" | "fill" | "no";
}

export interface InstrumentMap {
  name: string;
  variant: string;
  variants: InstrumentVariant[];
  zones: InstrumentZone[];
  layers: InstrumentLayer[];
  /** Playable key range. */
  lo: number;
  hi: number;
  /** Sampled notes (all layers). */
  notes: number[];
  roundRobins: number;
  gaps: InstrumentGap[];
  attack: number;
  release: number;
  warnings: string[];
}

export interface MapOptions {
  name?: string;
  /** Pick a variant (articulation / instrument) by a word in its name; default the one covering most notes. */
  variant?: string;
  /** Fill notes the chosen variant lacks from other variants in the same folder (default true). */
  fillGaps?: boolean;
  /** Semitones the lowest/highest sample extends past its own note (default 6). */
  edge?: number;
  /** Intervals wider than this between sampled notes are reported as gaps (default 5). */
  maxGap?: number;
  /** Seconds (defaults 0.002 / 0.3). */
  attack?: number;
  release?: number;
}

export interface InstrumentOptions extends MapOptions {
  /** Folder the .sfz/.dspreset will live in; sample paths are written relative to it. Default: the input folder (or the files' common folder). */
  relativeTo?: string;
  /** Add to every note read from a name, e.g. -12 for packs where C3 = 60 (default 0). */
  octaveOffset?: number;
  /** Check a few name-derived notes against pitch detection and fix a whole-octave offset (default false). */
  verifyOctave?: boolean;
  /** Use pitch detection when name and headers give no note (default true; needs ffmpeg). */
  detectPitch?: boolean;
  /** Minimum detector confidence (0–1) to accept a detected root (default 0.6). */
  minPitchConfidence?: number;
  /** Only files whose relative path contains this text (case-insensitive) or matches this pattern. */
  filter?: string | RegExp;
  /** Cap on files read from a folder (default 3000). */
  maxFiles?: number;
}

export interface InstrumentSummary {
  name: string;
  variant: string;
  variants: InstrumentVariant[];
  files: { found: number; used: number; skipped: number };
  skipped: { file: string; reason: string }[];
  range: { lo: number; hi: number; loName: string; hiName: string };
  sampledNotes: string[];
  layers: { name: string; lovel: number; hivel: number; notes: number; samples: number }[];
  roundRobins: number;
  rootNotes: Partial<Record<RootSource, number>>;
  loops: number;
  gaps: InstrumentGap[];
  warnings: string[];
  zones: { file: string; root: string; keys: string; vel: string; layer: string; rr?: string; source: RootSource }[];
}

export interface InstrumentBuild {
  map: InstrumentMap;
  sfz: string;
  dspreset: string;
  summary: InstrumentSummary;
}

// ---------------------------------------------------------------------------
// File-name parsing

const NA = "(?<![A-Za-z0-9])";
const NZ = "(?![A-Za-z0-9])";
const DYNAMICS: Record<string, [string, number]> = {
  ppp: ["ppp", 1], pianississimo: ["ppp", 1],
  pp: ["pp", 2], pianissimo: ["pp", 2], quiet: ["pp", 2],
  p: ["p", 3], piano: ["p", 3], soft: ["soft", 3],
  mp: ["mp", 4], mezzopiano: ["mp", 4],
  mf: ["mf", 5], mezzoforte: ["mf", 5], medium: ["medium", 5],
  f: ["f", 6], forte: ["f", 6],
  ff: ["ff", 7], fortissimo: ["ff", 7], loud: ["loud", 7], hard: ["hard", 7],
  fff: ["fff", 8], fortississimo: ["fff", 8],
};
const LMH: Record<string, number> = { l: 3, m: 5, h: 7 };
/** Words that never distinguish variants. */
const NOISE = new Set(["stereo", "mono", "st", "normal", "sample", "samples", "wav", "aif", "aiff", "flac", "ogg", "mp3", "norm", "master"]);

function tokens(s: string): string[] {
  const t = s
    .normalize("NFKC")
    .replace(new RegExp(`mezzo[\\s._-]*forte`, "gi"), " mf ")
    .replace(new RegExp(`mezzo[\\s._-]*piano`, "gi"), " mp ")
    .replace(new RegExp(`${NA}(?:rr|round[\\s._-]*robin|robin)[\\s._-]*(\\d{1,2})${NZ}`, "gi"), " rr$1 ")
    .replace(new RegExp(`${NA}(?:vl|vel|velocity|layer|dyn)[\\s._-]*(\\d{1,3})${NZ}`, "gi"), " vel$1 ")
    .replace(new RegExp(`${NA}(?:note|midi|nn)[\\s._-]*(\\d{1,3})${NZ}`, "gi"), " midi$1 ")
    // A-1, C#-1: keep the minus sign of octave -1 (separators split on "-" below).
    .replace(new RegExp(`${NA}([A-Ga-g](?:#|♯|s|b|♭)?)-1(?![0-9])`, "g"), "$1~1");
  return t.split(/[\s._,()[\]{}+\-]+/).filter(Boolean);
}

function noteToken(tok: string): { note?: number; run?: [number, number]; layer?: string; rank?: number } | undefined {
  const m = /^([A-Ga-g](?:#|♯|s|b|♭)?~?-?\d)(.*)$/.exec(tok);
  if (!m) return undefined;
  const note = parseNoteName(m[1]!.replace("~", "-"));
  if (note === undefined) return undefined;
  const rest = m[2]!;
  if (!rest) return { note };
  const second = parseNoteName(rest.replace("~", "-"));
  if (second !== undefined) return { run: [note, second] };
  let v = /^v(\d{1,3})$/i.exec(rest);
  if (v) return { note, layer: `v${Number(v[1])}`, rank: Number(v[1]) };
  v = /^v([lmh])$/i.exec(rest);
  if (v) return { note, layer: `v${v[1]!.toUpperCase()}`, rank: LMH[v[1]!.toLowerCase()]! };
  return undefined;
}

/**
 * Note, velocity layer, round robin and leftover words from a sample's file
 * name (and its folders, for dynamics like "pp/C4.wav"). Pure.
 */
export function parseSampleName(relPath: string, opts: { octaveOffset?: number } = {}): ParsedSampleName {
  const parts = relPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const fileName = (parts.pop() ?? "").replace(/\.[a-z0-9]{2,5}$/i, "");
  const out: ParsedSampleName = { numbers: [], words: [] };
  const toks = tokens(fileName);
  let named: number | undefined;
  let midiTok: number | undefined;
  const numericNotes: number[] = [];
  toks.forEach((tok, i) => {
    const lt = tok.toLowerCase();
    const n = noteToken(tok);
    if (n) {
      if (n.run) out.noteRun = n.run;
      if (n.note !== undefined) named = n.note;
      if (n.layer) {
        out.layer = n.layer;
        out.layerRank = n.rank;
      }
      return;
    }
    const dyn = DYNAMICS[lt];
    // "Piano.ff.C4": the first word is the instrument, not the dynamic.
    if (dyn && !(i === 0 && /^(piano|hard|soft)$/.test(lt) && toks.length > 1)) {
      out.layer = dyn[0];
      out.layerRank = dyn[1];
      return;
    }
    let m = /^rr(\d{1,2})$/.exec(lt);
    if (m) return void (out.rr = Number(m[1]));
    m = /^vel(\d{1,3})$/.exec(lt) ?? /^v(\d{1,2})$/.exec(lt);
    if (m) {
      out.layer = lt.startsWith("vel") ? `vl${Number(m[1])}` : `v${Number(m[1])}`;
      out.layerRank = Number(m[1]);
      return;
    }
    m = /^midi(\d{1,3})$/.exec(lt);
    if (m && Number(m[1]) <= 127) return void (midiTok = Number(m[1]));
    if (/^\d+$/.test(lt)) {
      const v = Number(lt);
      if (lt.length >= 2 && lt.length <= 3 && v <= 127) numericNotes.push(v);
      out.numbers.push(v);
      return;
    }
    if (!NOISE.has(lt)) out.words.push(lt);
  });
  // Folders: dynamics ("pp/", "Soft/") and round robins only; other names are words (they separate instruments).
  for (const dir of parts) {
    for (const tok of tokens(dir)) {
      const lt = tok.toLowerCase();
      const dyn = DYNAMICS[lt];
      if (dyn && out.layer === undefined && parts.length > 0) {
        out.layer = dyn[0];
        out.layerRank = dyn[1];
      } else if (/^rr\d{1,2}$/.test(lt) && out.rr === undefined) out.rr = Number(lt.slice(2));
      else if (/^vel\d{1,3}$/.test(lt) && out.layer === undefined) {
        out.layer = `vl${Number(lt.slice(3))}`;
        out.layerRank = Number(lt.slice(3));
      }
    }
  }
  let note = named ?? midiTok;
  if (note === undefined && numericNotes.length) {
    note = numericNotes[0]!;
    out.numbers.splice(out.numbers.indexOf(note), 1);
  }
  if (note !== undefined && out.noteRun === undefined) {
    const shifted = note + (named !== undefined ? (opts.octaveOffset ?? 0) : 0);
    if (shifted >= 0 && shifted <= 127) out.note = shifted;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mapping (pure)

/** Even velocity split: layer i of n. */
function velRange(i: number, n: number): [number, number] {
  return [i === 0 ? 1 : Math.floor((i * 127) / n) + 1, Math.floor(((i + 1) * 127) / n)];
}

function cmpNumbers(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

const variantLabel = (v: string) => v || "(all files)";

/**
 * Key and velocity mapping for resolved samples. Splits the files into
 * variants (folder + distinguishing words), uses the one covering the most
 * notes (or `opts.variant`), fills its missing notes from sibling variants in
 * the same folder, then maps each layer across the keyboard. Pure.
 */
export function mapInstrument(samples: InstrumentSample[], opts: MapOptions = {}): InstrumentMap {
  const warnings: string[] = [];
  const edge = Math.max(0, opts.edge ?? 6);
  const maxGap = Math.max(1, opts.maxGap ?? 5);
  if (!samples.length) throw new Error("no samples with a root note to map");

  // Words shared by every file name are the instrument; the rest tell variants apart.
  const common = new Set(samples[0]!.words);
  for (const s of samples) for (const w of [...common]) if (!s.words.includes(w)) common.delete(w);
  const sigOf = (s: InstrumentSample) => {
    const ws = [...new Set(s.words.filter((w) => !common.has(w)))].sort();
    return [s.dir, ...ws].filter(Boolean).join(" ");
  };
  const groups = new Map<string, InstrumentSample[]>();
  for (const s of samples) {
    const k = sigOf(s);
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  const distinct = (g: InstrumentSample[]) => new Set(g.map((s) => s.note)).size;
  let ranked = [...groups.entries()].sort((a, b) => distinct(b[1]) - distinct(a[1]) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (opts.variant) {
    const want = opts.variant.toLowerCase();
    const hit = ranked.filter(([k]) => k.toLowerCase().includes(want));
    if (hit.length) ranked = [...hit, ...ranked.filter((r) => !hit.includes(r))];
    else warnings.push(`no variant matches "${opts.variant}"; used "${variantLabel(ranked[0]![0])}"`);
  }
  const [primaryKey, primary] = ranked[0]!;
  const primaryDir = primary[0]!.dir;
  const chosen = [...primary];
  const covered = new Set(primary.map((s) => s.note));
  const used = new Map<string, InstrumentVariant["used"]>([[primaryKey, "primary"]]);
  if (opts.fillGaps ?? true) {
    for (const [k, g] of ranked.slice(1)) {
      if (g[0]!.dir !== primaryDir) continue;
      const add = g.filter((s) => !covered.has(s.note));
      if (!add.length) continue;
      const notes = [...new Set(add.map((s) => s.note))];
      for (const s of add) chosen.push(s);
      for (const n of notes) covered.add(n);
      used.set(k, "fill");
      warnings.push(`filled ${notes.length} note(s) (${notes.sort((a, b) => a - b).map((n) => noteName(n)).join(", ")}) from variant "${variantLabel(k)}"`);
    }
  }
  const variants: InstrumentVariant[] = ranked.map(([k, g]) => ({
    name: variantLabel(k),
    files: g.length,
    lo: Math.min(...g.map((s) => s.note)),
    hi: Math.max(...g.map((s) => s.note)),
    used: used.get(k) ?? "no",
  }));
  if (variants.length > 1) {
    const unused = variants.filter((v) => v.used === "no");
    if (unused.length) warnings.push(`${variants.length} variants found; using "${variantLabel(primaryKey)}". Others (pass variant to pick one): ${unused.slice(0, 8).map((v) => `"${v.name}"`).join(", ")}${unused.length > 8 ? "…" : ""}`);
  }

  // Layers.
  const labelled = chosen.filter((s) => s.layer !== undefined);
  if (labelled.length && labelled.length < chosen.length) {
    warnings.push(`${chosen.length - labelled.length} file(s) have no dynamics marking; treated as mf`);
  }
  const layerOf = (s: InstrumentSample): { name: string; rank: number } =>
    s.layer !== undefined ? { name: s.layer, rank: s.layerRank ?? 5 } : labelled.length ? { name: "mf", rank: 5 } : { name: "all", rank: 0 };
  const byRank = new Map<number, { name: string; rank: number; samples: InstrumentSample[] }>();
  for (const s of chosen) {
    const l = layerOf(s);
    const e = byRank.get(l.rank);
    if (e) e.samples.push(s);
    else byRank.set(l.rank, { ...l, samples: [s] });
  }
  const layerList = [...byRank.values()].sort((a, b) => a.rank - b.rank);

  const allNotes = [...new Set(chosen.map((s) => s.note))].sort((a, b) => a - b);
  const lo = Math.max(0, allNotes[0]! - edge);
  const hi = Math.min(127, allNotes[allNotes.length - 1]! + edge);
  const zones: InstrumentZone[] = [];
  const layers: InstrumentLayer[] = [];
  const gaps: InstrumentGap[] = [];
  let roundRobins = 1;

  // Overall gaps (no layer has a sample in between).
  for (let i = 1; i < allNotes.length; i++) {
    const a = allNotes[i - 1]!;
    const b = allNotes[i]!;
    if (b - a > maxGap) gaps.push({ from: a, to: b, fromName: noteName(a), toName: noteName(b), semitones: b - a });
  }
  for (const g of gaps) {
    warnings.push(`missing notes between ${g.fromName} and ${g.toName} (${g.semitones} semitones apart; samples are stretched up to ${Math.ceil((g.semitones - 1) / 2)} semitones)`);
  }

  layerList.forEach((layer, li) => {
    const [lovel, hivel] = velRange(li, layerList.length);
    const byNote = new Map<number, InstrumentSample[]>();
    for (const s of layer.samples) {
      const e = byNote.get(s.note);
      if (e) e.push(s);
      else byNote.set(s.note, [s]);
    }
    const notes = [...byNote.keys()].sort((a, b) => a - b);
    layers.push({ name: layer.name, rank: layer.rank, lovel, hivel, notes, samples: layer.samples.length });
    if (layerList.length > 1) {
      for (let i = 1; i < notes.length; i++) {
        const a = notes[i - 1]!;
        const b = notes[i]!;
        if (b - a > maxGap && !gaps.some((g) => g.from <= a && g.to >= b)) {
          gaps.push({ from: a, to: b, fromName: noteName(a), toName: noteName(b), semitones: b - a, layer: layer.name });
          warnings.push(`layer ${layer.name}: missing notes between ${noteName(a)} and ${noteName(b)}`);
        }
      }
      if (notes[0]! - allNotes[0]! > maxGap) warnings.push(`layer ${layer.name} starts at ${noteName(notes[0]!)} (lowest sample: ${noteName(allNotes[0]!)})`);
      if (allNotes[allNotes.length - 1]! - notes[notes.length - 1]! > maxGap) warnings.push(`layer ${layer.name} ends at ${noteName(notes[notes.length - 1]!)} (highest sample: ${noteName(allNotes[allNotes.length - 1]!)})`);
    }
    let prevHi = lo - 1;
    notes.forEach((n, i) => {
      const next = notes[i + 1];
      const lokey = prevHi + 1;
      // The upper sample takes the middle key (pitching down sounds better than up).
      const hikey = next === undefined ? hi : n + Math.floor((next - n - 1) / 2);
      prevHi = hikey;
      const rrs = byNote.get(n)!.sort((a, b) => (a.rr ?? 0) - (b.rr ?? 0) || cmpNumbers(a.numbers, b.numbers) || a.file.localeCompare(b.file));
      roundRobins = Math.max(roundRobins, rrs.length);
      rrs.forEach((s, k) =>
        zones.push({
          file: s.file,
          path: s.path,
          ...(s.url ? { url: s.url } : {}),
          note: n,
          noteSource: s.noteSource,
          ...(s.tuneCents ? { tuneCents: s.tuneCents } : {}),
          layer: layer.name,
          lokey,
          hikey,
          lovel,
          hivel,
          seqLength: rrs.length,
          seqPosition: k + 1,
          ...(s.loop ? { loop: s.loop } : {}),
        }),
      );
    });
  });

  const name = opts.name?.trim() || defaultName(primary, common);
  return {
    name,
    variant: variantLabel(primaryKey),
    variants,
    zones,
    layers,
    lo,
    hi,
    notes: allNotes,
    roundRobins,
    gaps,
    attack: opts.attack ?? 0.002,
    release: opts.release ?? 0.3,
    warnings,
  };
}

function defaultName(primary: InstrumentSample[], common: Set<string>): string {
  const word = primary[0]!.words.find((w) => common.has(w) && /[a-z]/.test(w));
  const dir = primary[0]!.dir.split("/").filter(Boolean).pop();
  const raw = word ?? dir ?? "Instrument";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ---------------------------------------------------------------------------
// Writers (pure)

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

/** SFZ text for a mapped instrument. Sample paths are relative to the .sfz file. */
export function toSfz(map: InstrumentMap): string {
  const lines = [
    `// ${map.name}: multisample instrument built by sound-server.`,
    `// ${map.zones.length} regions, ${map.layers.length} velocity layer(s): ${map.layers.map((l) => l.name).join(", ")}; keys ${noteName(map.lo)}–${noteName(map.hi)}${map.roundRobins > 1 ? `; up to ${map.roundRobins} round robins` : ""}.`,
    "// Credits and licences: see ATTRIBUTION.md next to this file.",
    "",
    "<control>",
    "default_path=./",
    "",
    "<global>",
    `ampeg_attack=${fmt(map.attack)}`,
    `ampeg_release=${fmt(map.release)}`,
    "loop_mode=no_loop",
  ];
  for (const layer of map.layers) {
    lines.push("", `// layer ${layer.name}: velocity ${layer.lovel}-${layer.hivel}`, "<group>", `lovel=${layer.lovel} hivel=${layer.hivel}`);
    for (const z of map.zones.filter((z) => z.layer === layer.name)) {
      const ops = [`pitch_keycenter=${z.note}`, `lokey=${z.lokey}`, `hikey=${z.hikey}`, `lovel=${z.lovel}`, `hivel=${z.hivel}`];
      if (z.seqLength > 1) ops.push(`seq_length=${z.seqLength}`, `seq_position=${z.seqPosition}`);
      if (z.tuneCents) ops.push(`tune=${z.tuneCents}`);
      if (z.loop) ops.push("loop_mode=loop_continuous", `loop_start=${z.loop.start}`, `loop_end=${z.loop.end}`);
      // `sample` goes last so paths with spaces parse.
      ops.push(`sample=${z.file}`);
      lines.push(`<region> ${ops.join(" ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const xml = (s: string | number) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function knob(x: number, label: string, parameter: string, value: number, max: number): string[] {
  return [
    `      <labeled-knob x="${x}" y="60" width="90" height="90" textSize="14" textColor="FF222222" trackForegroundColor="FF3B6EA8" trackBackgroundColor="FFCCCCCC" label="${label}" type="float" minValue="0" maxValue="${max}" value="${fmt(value)}">`,
    `        <binding type="amp" level="instrument" position="0" parameter="${parameter}"/>`,
    "      </labeled-knob>",
  ];
}

/**
 * Decent Sampler preset XML. Each velocity layer becomes one group per
 * round-robin count (seqMode="round_robin" with that seqLength), so notes
 * with fewer takes never hit an empty step. Attack and release knobs.
 */
export function toDecentSampler(map: InstrumentMap): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- ${xml(map.name)}: multisample instrument built by sound-server. Credits and licences: see ATTRIBUTION.md next to this file. -->`,
    '<DecentSampler minVersion="1.0.0">',
    '  <ui width="812" height="375" layoutMode="relative" bgMode="top_left">',
    '    <tab name="main">',
    `      <label x="20" y="20" width="400" height="30" textSize="20" textColor="FF222222" text="${xml(map.name)}"/>`,
    ...knob(20, "Attack", "ENV_ATTACK", map.attack, 4),
    ...knob(120, "Release", "ENV_RELEASE", map.release, 8),
    "    </tab>",
    "  </ui>",
    `  <groups attack="${fmt(map.attack)}" decay="0" sustain="1" release="${fmt(map.release)}">`,
  ];
  for (const layer of map.layers) {
    const zones = map.zones.filter((z) => z.layer === layer.name);
    const lengths = [...new Set(zones.map((z) => z.seqLength))].sort((a, b) => a - b);
    for (const len of lengths) {
      const name = len > 1 ? `${layer.name} rr${len}` : layer.name;
      const seq = len > 1 ? ` seqMode="round_robin" seqLength="${len}"` : "";
      out.push(`    <group name="${xml(name)}"${seq}>`);
      for (const z of zones.filter((z) => z.seqLength === len)) {
        const attrs = [
          `path="${xml(z.file)}"`,
          `rootNote="${z.note}"`,
          `loNote="${z.lokey}"`,
          `hiNote="${z.hikey}"`,
          `loVel="${z.lovel}"`,
          `hiVel="${z.hivel}"`,
        ];
        if (len > 1) attrs.push(`seqPosition="${z.seqPosition}"`);
        if (z.tuneCents) attrs.push(`tuning="${fmt(z.tuneCents / 100)}"`);
        if (z.loop) attrs.push(`loopEnabled="true"`, `loopStart="${z.loop.start}"`, `loopEnd="${z.loop.end}"`);
        out.push(`      <sample ${attrs.join(" ")}/>`);
      }
      out.push("    </group>");
    }
  }
  out.push("  </groups>", "</DecentSampler>");
  return `${out.join("\n")}\n`;
}

/** A JSON-friendly summary for agents. */
export function instrumentSummary(map: InstrumentMap, extra: { found?: number; skipped?: { file: string; reason: string }[]; warnings?: string[] } = {}): InstrumentSummary {
  const rootNotes: Partial<Record<RootSource, number>> = {};
  const seen = new Set<string>();
  for (const z of map.zones) {
    if (seen.has(z.file)) continue;
    seen.add(z.file);
    rootNotes[z.noteSource] = (rootNotes[z.noteSource] ?? 0) + 1;
  }
  const skipped = extra.skipped ?? [];
  return {
    name: map.name,
    variant: map.variant,
    variants: map.variants,
    files: { found: extra.found ?? seen.size + skipped.length, used: seen.size, skipped: skipped.length },
    skipped,
    range: { lo: map.lo, hi: map.hi, loName: noteName(map.lo), hiName: noteName(map.hi) },
    sampledNotes: map.notes.map((n) => noteName(n)),
    layers: map.layers.map((l) => ({ name: l.name, lovel: l.lovel, hivel: l.hivel, notes: l.notes.length, samples: l.samples })),
    roundRobins: map.roundRobins,
    rootNotes,
    loops: map.zones.filter((z) => z.loop).length,
    gaps: map.gaps,
    warnings: [...(extra.warnings ?? []), ...map.warnings],
    zones: map.zones.map((z) => ({
      file: z.file,
      root: noteName(z.note),
      keys: `${noteName(z.lokey)}-${noteName(z.hikey)}`,
      vel: `${z.lovel}-${z.hivel}`,
      layer: z.layer,
      ...(z.seqLength > 1 ? { rr: `${z.seqPosition}/${z.seqLength}` } : {}),
      source: z.noteSource,
    })),
  };
}

// ---------------------------------------------------------------------------
// Files: walker, header reads, pitch fallback

const AUDIO_EXT = new Set([".wav", ".aif", ".aiff", ".flac", ".ogg", ".opus", ".mp3", ".m4a"]);
const HEADER_EXT = new Set([".wav", ".aif", ".aiff"]);

/** Audio files under `root` (recursive, no symlinks, skips dot-folders and __MACOSX), sorted. Absolute paths. */
export async function listAudioFiles(root: string, opts: { maxFiles?: number; maxDepth?: number } = {}): Promise<string[]> {
  const maxFiles = opts.maxFiles ?? 3000;
  const maxDepth = opts.maxDepth ?? 8;
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= maxFiles) return;
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(p, depth + 1);
      } else if (e.isFile() && AUDIO_EXT.has(extname(e.name).toLowerCase())) out.push(p);
    }
  };
  await walk(resolve(root), 0);
  return out.sort();
}

interface HeaderFacts {
  smpl?: { note: number; fraction: number; loop?: { start: number; end: number } };
  acid?: number;
  aiff?: number;
}

/**
 * The header chunks of a WAV/AIFF without its audio: walks the chunk list
 * (smpl often sits after `data`) and returns a RIFF/FORM buffer of every
 * chunk except the sample data, for parseWavChunks.
 */
async function headerBytes(path: string): Promise<Uint8Array> {
  const fh = await open(path, "r");
  try {
    const size = (await fh.stat()).size;
    const read = async (at: number, n: number) => {
      const b = Buffer.alloc(Math.max(0, Math.min(n, size - at)));
      if (b.length) await fh.read(b, 0, b.length, at);
      return b;
    };
    const head = await read(0, 12);
    const id = head.toString("latin1", 0, 4);
    const le = id === "RIFF";
    if (!le && id !== "FORM") return head;
    const parts: Buffer[] = [head];
    let pos = 12;
    for (let n = 0; n < 128 && pos + 8 <= size; n++) {
      const h = await read(pos, 8);
      const cid = h.toString("latin1", 0, 4);
      const csize = le ? h.readUInt32LE(4) : h.readUInt32BE(4);
      if (cid !== "data" && cid !== "SSND" && csize <= 1024 * 1024) parts.push(h, await read(pos + 8, csize + (csize & 1)));
      pos += 8 + csize + (csize & 1);
    }
    return Buffer.concat(parts);
  } finally {
    await fh.close();
  }
}

async function readHeader(path: string): Promise<HeaderFacts> {
  if (!HEADER_EXT.has(extname(path).toLowerCase())) return {};
  const c = parseWavChunks(await headerBytes(path));
  if (!c) return {};
  const out: HeaderFacts = {};
  if (c.smpl && c.smpl.midiUnityNote <= 127) {
    const l = c.smpl.loops.find((x) => x.end > x.start);
    out.smpl = { note: c.smpl.midiUnityNote, fraction: c.smpl.pitchFraction, ...(l ? { loop: { start: l.start, end: l.end } } : {}) };
  }
  if (c.acid?.rootNoteSet && c.acid.rootNote <= 127) out.acid = c.acid.rootNote;
  if (c.baseNote !== undefined && c.baseNote >= 0 && c.baseNote <= 127) out.aiff = c.baseNote;
  return out;
}

async function detectRoot(path: string): Promise<{ note: number; confidence: number; cents?: number } | undefined> {
  try {
    const a = await analyzeAudio({ path }, { deep: true, maxSeconds: 6 });
    if (a.rootNote === undefined || a.source.rootNote !== "analysis") return undefined;
    const cents = a.rootNoteHz ? Math.round((hzToMidi(a.rootNoteHz) - a.rootNote) * 100) : undefined;
    return { note: a.rootNote, confidence: a.rootNoteConfidence ?? 0, ...(cents ? { cents } : {}) };
  } catch {
    return undefined;
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

function commonDir(paths: string[]): string {
  if (!paths.length) return process.cwd();
  let parts = dirname(resolve(paths[0]!)).split(sep);
  for (const p of paths.slice(1)) {
    const q = dirname(resolve(p)).split(sep);
    let i = 0;
    while (i < parts.length && parts[i] === q[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(sep) || sep;
}

export interface ResolveResult {
  samples: InstrumentSample[];
  skipped: { file: string; reason: string }[];
  warnings: string[];
  found: number;
}

/** Root note, layer and round robin for each file: name → smpl/ACID/INST header → pitch detection. */
export async function resolveSamples(input: string | InstrumentFileInput[], opts: InstrumentOptions = {}): Promise<ResolveResult> {
  const files: InstrumentFileInput[] =
    typeof input === "string" ? (await listAudioFiles(input, { maxFiles: opts.maxFiles })).map((path) => ({ path })) : input.filter((f) => AUDIO_EXT.has(extname(f.path).toLowerCase()));
  const base = resolve(opts.relativeTo ?? (typeof input === "string" ? input : commonDir(files.map((f) => f.path))));
  const warnings: string[] = [];
  const skipped: ResolveResult["skipped"] = [];
  const relOf = (p: string) => {
    const r = relative(base, resolve(p)).split(sep).join("/");
    return r && !isAbsolute(r) ? r : resolve(p).split(sep).join("/");
  };
  const seen = new Set<string>();
  const filtered = files.filter((f) => {
    const key = resolve(f.path);
    if (seen.has(key)) return false;
    seen.add(key);
    if (!opts.filter) return true;
    const r = relOf(f.path);
    return typeof opts.filter === "string" ? r.toLowerCase().includes(opts.filter.toLowerCase()) : opts.filter.test(r);
  });
  const detect = opts.detectPitch ?? true;
  const minConf = opts.minPitchConfidence ?? 0.6;

  const resolved = await pool(filtered, 8, async (f): Promise<InstrumentSample | undefined> => {
    const file = relOf(f.path);
    const parsed = parseSampleName(file, opts);
    if (parsed.note === undefined && f.title) {
      const t = parseSampleName(f.title, opts);
      if (t.note !== undefined) Object.assign(parsed, { note: t.note, layer: parsed.layer ?? t.layer, layerRank: parsed.layerRank ?? t.layerRank, rr: parsed.rr ?? t.rr });
    }
    if (parsed.noteRun) {
      skipped.push({ file, reason: `holds a run of notes (${noteName(parsed.noteRun[0])}–${noteName(parsed.noteRun[1])}); split it into single notes first` });
      return undefined;
    }
    let header: HeaderFacts = {};
    try {
      header = await readHeader(f.path);
    } catch (e) {
      skipped.push({ file, reason: `unreadable: ${e instanceof Error ? e.message : String(e)}` });
      return undefined;
    }
    const dirPart = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    const s: Omit<InstrumentSample, "note" | "noteSource" | "confidence"> = {
      path: f.path,
      file,
      ...(f.url ? { url: f.url } : {}),
      ...(f.title ? { title: f.title } : {}),
      ...(parsed.layer !== undefined ? { layer: parsed.layer, layerRank: parsed.layerRank } : {}),
      ...(parsed.rr !== undefined ? { rr: parsed.rr } : {}),
      numbers: parsed.numbers,
      words: parsed.words,
      dir: dirPart,
      ...(header.smpl?.loop ? { loop: header.smpl.loop } : {}),
    };
    if (parsed.note !== undefined) {
      if (header.smpl && header.smpl.note !== 60 && header.smpl.note !== parsed.note) {
        warnings.push(`${file}: name says ${noteName(parsed.note)} but the smpl chunk says ${noteName(header.smpl.note)}; using the name`);
      }
      return { ...s, note: parsed.note, noteSource: "filename", confidence: 1 };
    }
    if (header.smpl) {
      const cents = header.smpl.fraction ? -Math.round(header.smpl.fraction * 100) : 0;
      return { ...s, note: header.smpl.note, noteSource: "smpl", confidence: 1, ...(cents ? { tuneCents: cents } : {}) };
    }
    if (header.acid !== undefined) return { ...s, note: header.acid, noteSource: "acid", confidence: 1 };
    if (header.aiff !== undefined) return { ...s, note: header.aiff, noteSource: "aiff", confidence: 1 };
    if (detect) {
      const p = await detectRoot(f.path);
      if (p && p.confidence >= minConf) return { ...s, note: p.note, noteSource: "pitch", confidence: p.confidence, ...(p.cents && Math.abs(p.cents) >= 5 ? { tuneCents: -p.cents } : {}) };
      skipped.push({ file, reason: p ? `no note in the name or header; pitch detection unsure (${noteName(p.note)}, confidence ${p.confidence})` : "no note in the name or header, and no clear pitch" });
      return undefined;
    }
    skipped.push({ file, reason: "no note in the name or header" });
    return undefined;
  });
  const samples = resolved.filter((s): s is InstrumentSample => s !== undefined);

  // Every header saying the same note is a default left by the editor, not a real root.
  const fromSmpl = samples.filter((s) => s.noteSource === "smpl" || s.noteSource === "acid" || s.noteSource === "aiff");
  if (detect && fromSmpl.length >= 3 && new Set(fromSmpl.map((s) => s.note)).size === 1) {
    const checks = await pool(fromSmpl, 8, (s) => detectRoot(s.path));
    let changed = 0;
    checks.forEach((p, i) => {
      const s = fromSmpl[i]!;
      if (p && p.confidence >= minConf && p.note !== s.note) {
        Object.assign(s, { note: p.note, noteSource: "pitch" as const, confidence: p.confidence });
        delete s.tuneCents;
        changed++;
      }
    });
    if (changed) warnings.push(`all ${fromSmpl.length} header root notes were ${noteName(fromSmpl[0]!.note)} (an editor default?); ${changed} replaced by detected pitch`);
  }

  // Whole-octave naming offsets (C3 = 60 packs).
  if (opts.verifyOctave && detect) {
    const named = samples.filter((s) => s.noteSource === "filename");
    const picks = [0, 0.5, 1].map((q) => named[Math.round(q * (named.length - 1))]).filter((s, i, a): s is InstrumentSample => !!s && a.indexOf(s) === i);
    const diffs = (await pool(picks, 3, (s) => detectRoot(s.path))).map((p, i) => (p && p.confidence >= minConf ? p.note - picks[i]!.note : undefined));
    const d = diffs[0];
    if (d !== undefined && d !== 0 && d % 12 === 0 && diffs.every((x) => x === d)) {
      for (const s of named) s.note = Math.max(0, Math.min(127, s.note + d));
      warnings.push(`file names are ${Math.abs(d / 12)} octave(s) ${d > 0 ? "low" : "high"} against detected pitch; shifted all name-derived notes by ${d > 0 ? "+" : ""}${d}`);
    }
  }
  return { samples, skipped, warnings, found: files.length };
}

/**
 * Build an instrument from a folder (or a list of files): resolve roots,
 * map zones, and render SFZ, Decent Sampler and the summary. Throws when no
 * file has a usable root note.
 */
export async function buildInstrument(input: string | InstrumentFileInput[], opts: InstrumentOptions = {}): Promise<InstrumentBuild> {
  const r = await resolveSamples(input, opts);
  if (!r.samples.length) {
    const why = r.skipped.slice(0, 3).map((s) => `${s.file}: ${s.reason}`).join("; ");
    throw new Error(r.found ? `no playable samples: no root note found for any of ${r.found} file(s)${why ? ` (${why})` : ""}` : "no audio files found");
  }
  const name = opts.name ?? (typeof input === "string" && !r.samples[0]!.words.length ? basename(resolve(input)) : undefined);
  const map = mapInstrument(r.samples, { ...opts, name });
  return { map, sfz: toSfz(map), dspreset: toDecentSampler(map), summary: instrumentSummary(map, { found: r.found, skipped: r.skipped, warnings: r.warnings }) };
}

/** File-system-safe base name for the instrument files. */
export function instrumentFileBase(name: string): string {
  return name.normalize("NFKD").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "instrument";
}

/** Write `<name>.sfz`, `<name>.dspreset` and `<name>.instrument.json` into `dir` (the folder sample paths are relative to). */
export async function writeInstrument(build: InstrumentBuild, dir: string, opts: { basename?: string } = {}): Promise<{ sfz: string; dspreset: string; json: string }> {
  const b = opts.basename ?? instrumentFileBase(build.map.name);
  await mkdir(dir, { recursive: true });
  const paths = { sfz: join(dir, `${b}.sfz`), dspreset: join(dir, `${b}.dspreset`), json: join(dir, `${b}.instrument.json`) };
  await writeFile(paths.sfz, build.sfz);
  await writeFile(paths.dspreset, build.dspreset);
  await writeFile(paths.json, `${JSON.stringify(build.summary, null, 2)}\n`);
  return paths;
}
