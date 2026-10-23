import { tallySamples } from "../core/census.js";
import { creativeCommons, customLicense, isCommercialSafe, license } from "../core/licence.js";
import type { Category, License, Provider, ProviderContext, Sample, SampleDetails, SampleForm, SampleQuery } from "../core/types.js";
import { filterLocal, formatFromFilename, makeSample, paginate, wantsCategory } from "../core/util.js";
import { categoryLabel } from "../core/vocab.js";

/**
 * Strudel / TidalCycles sample banks (https://strudel.cc/learn/samples/).
 *
 * Strudel loads samples from `strudel.json` manifests on raw GitHub:
 * `{"_base": "https://raw.githubusercontent.com/.../", "bd": ["bd/BT0AADA.wav", ...], ...}`, or, for
 * pitched instruments, `{"piano": {"A0": "A0v8.mp3", ...}}` (a note may also map to a list).
 * Every file is one listing here (mostly one-shots). The bank suffix of the drum-machine collection
 * (`RolandTR808_bd`, `_sd`, `_hh`, ...) names the drum, so those categories come from the source.
 *
 * Only manifests on the allow-list below are indexed, each with the licence its repository states.
 * Collections of copyrighted breakbeats or ripped records are left out (see EXCLUDED_MANIFESTS).
 * The catalogue (~7k files) is built once per manifest body and cached with the manifest (6h).
 */

const MANIFEST_TTL = 6 * 60 * 60_000;
const HOMEPAGE = "https://strudel.cc/learn/samples/";

export interface StrudelManifest {
  /** Stable key used in native ids: `<key>/<bank>/<index>`. */
  key: string;
  /** Display name of the collection. */
  name: string;
  url: string;
  /** Human page for the collection (its repository). */
  repo: string;
  author?: string;
  license: License;
  /** Banks named `<Machine>_<drum>` (tidal-drum-machines). */
  machineBanks?: boolean;
  /** Banks left out because they are copyrighted recordings (breakbeats, record samples). */
  excludeBanks?: RegExp;
  /** Top-level categories when the whole collection is one kind of instrument; lets a search skip it. */
  categories?: Category[];
  /** A category every file gets (set by us from what the collection is). */
  category?: Category;
  /** Strip this prefix from bank names before reading words out of them (Dough-Fox: "fdarkkick"). */
  bankPrefix?: string;
  tags: string[];
}

function unknownLicence(note: string): License {
  return { ...license("LicenseRef-Unknown"), note };
}

/** The allow-list. Order is browse order (the drum machines first). */
export const STRUDEL_MANIFESTS: StrudelManifest[] = [
  {
    key: "tidal-drum-machines",
    name: "Tidal Drum Machines",
    url: "https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json",
    repo: "https://github.com/ritchse/tidal-drum-machines",
    machineBanks: true,
    license: unknownLicence(
      "Recordings of ~70 hardware drum machines (ROM and machine dumps). The repository states no licence, and the sounds belong to the machines' makers: check before releasing.",
    ),
    tags: ["drum machine", "tidal", "strudel"],
  },
  {
    key: "dirt-samples",
    name: "Dirt-Samples",
    url: "https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/strudel.json",
    repo: "https://github.com/tidalcycles/Dirt-Samples",
    // Amen/break cut-ups and the rave bank are slices of commercial records.
    excludeBanks: /^(amencutup|breaks\d+|rave)$/,
    license: unknownLicence(
      "SuperDirt's default sample set, collected from many sources over the years. The repository states no licence: treat it as all rights reserved.",
    ),
    tags: ["tidal", "superdirt", "strudel"],
  },
  {
    key: "vcsl",
    name: "VCSL",
    url: "https://raw.githubusercontent.com/felixroos/dough-samples/main/vcsl.json",
    repo: "https://github.com/sgossner/VCSL",
    author: "Versilian Studios",
    license: license("CC0-1.0"),
    tags: ["vcsl", "versilian", "orchestral", "acoustic", "strudel"],
  },
  {
    key: "piano",
    name: "Salamander Grand Piano",
    url: "https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json",
    repo: "https://archive.org/details/SalamanderGrandPianoV3",
    author: "Alexander Holm",
    license: creativeCommons({}, "3.0"),
    categories: ["keys"],
    category: "keys",
    tags: ["salamander", "grand piano", "yamaha c5", "strudel"],
  },
  {
    key: "mridangam",
    name: "Mridangam",
    url: "https://raw.githubusercontent.com/felixroos/dough-samples/main/mridangam.json",
    repo: "https://github.com/yaxu/mrid",
    author: "Arthur Carabott (performer: Harishankar V Menon)",
    license: creativeCommons({ sa: true }, "4.0"),
    categories: ["drums"],
    category: "drums.perc",
    tags: ["mridangam", "carnatic", "indian", "hand drum", "world", "strudel"],
  },
  {
    key: "uzu-drumkit",
    name: "uzu drumkit",
    url: "https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/strudel.json",
    repo: "https://github.com/tidalcycles/uzu-drumkit",
    author: "Switch Angel, Mot4i, Ludens",
    // `brk` is a processed amen break.
    excludeBanks: /^brk$/,
    license: {
      ...customLicense("The Unlicense", {
        url: "https://unlicense.org/",
        verdict: "yes",
        commercialUse: true,
        attributionRequired: false,
        assertedBy: "source",
        note: "Public-domain dedication in the repository's LICENSE file.",
      }),
      redistribution: true,
    },
    tags: ["uzu", "electronic", "strudel"],
  },
  {
    key: "dough-samples",
    name: "Dough Samples",
    url: "https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Samples/main/strudel.json",
    repo: "https://github.com/Bubobubobubobubo/Dough-Samples",
    license: customLicense("GPL-3.0 (repository licence)", {
      url: "https://www.gnu.org/licenses/gpl-3.0.html",
      verdict: "check-terms",
      assertedBy: "source",
      note: "The repository carries a GPL-3.0 licence file but does not say where the samples come from or how the GPL applies to audio.",
    }),
    tags: ["topos", "dough", "strudel"],
  },
  {
    key: "dough-fox",
    name: "Dough-Fox (FoxDot samples)",
    url: "https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Fox/main/strudel.json",
    repo: "https://github.com/Bubobubobubobubo/Dough-Fox",
    author: "FoxDot (Ryan Kirkbride)",
    bankPrefix: "f",
    license: {
      ...creativeCommons({ sa: true }, "4.0"),
      note: "FoxDot's default samples; FoxDot's repository is CC BY-SA 4.0, but where each sample came from is not documented. Share-alike: a track that uses it must carry the same licence.",
    },
    tags: ["foxdot", "dough", "strudel"],
  },
];

/** Manifests we looked at and left out, with the reason (kept here so nobody adds them back by accident). */
export const EXCLUDED_MANIFESTS: { url: string; reason: string }[] = [
  { url: "https://raw.githubusercontent.com/yaxu/clean-breaks/main/strudel.json", reason: "Copyrighted breakbeats (Funky Drummer, Use Me, Amen...)." },
  { url: "https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Amen/main/strudel.json", reason: "Amen break cut-ups (copyrighted recording)." },
  { url: "https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Amiga/main/strudel.json", reason: "Ultimate Soundtracker disks: many samples were lifted from records and synths; no licence; 10k files." },
  { url: "https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Waveforms/main/strudel.json", reason: "AKWF single-cycle waveforms (4k files), not samples people search for." },
  { url: "https://raw.githubusercontent.com/emptyflash/samples/main/strudel.json", reason: "Personal grab bag (meme sounds, third-party packs), no licence." },
  { url: "https://raw.githubusercontent.com/yaxu/spicule/main/strudel.json", reason: "Album sample set with no licence and unclear origins." },
  { url: "https://raw.githubusercontent.com/felixroos/samples/main/strudel.json", reason: "Mixed personal set (includes film/song excerpts), no licence." },
  { url: "https://raw.githubusercontent.com/felixroos/dough-samples/main/EmuSP12.json", reason: "Duplicate of the EmuSP12 banks in tidal-drum-machines." },
  { url: "https://raw.githubusercontent.com/felixroos/dough-samples/main/Dirt-Samples.json", reason: "Subset of Dirt-Samples." },
];

const BY_KEY = new Map(STRUDEL_MANIFESTS.map((m) => [m.key, m]));

// ---------------------------------------------------------------------------
// Bank names → categories

/** tidal-drum-machines suffixes (and Dirt/uzu banks with the same names). `misc` is classified. */
export const DRUM_SUFFIX: Record<string, Category> = {
  bd: "drums.kick",
  sd: "drums.snare",
  hh: "drums.hat.closed",
  oh: "drums.hat.open",
  cp: "drums.clap",
  rim: "drums.perc",
  lt: "drums.tom",
  mt: "drums.tom",
  ht: "drums.tom",
  cr: "drums.cymbal.crash",
  rd: "drums.cymbal.ride",
  cb: "drums.perc",
  perc: "drums.perc",
  sh: "drums.perc",
  tb: "drums.perc",
  fx: "fx",
};

/** Dirt-Samples banks whose names say the drum (beyond the plain suffixes). */
const DIRT_BANKS: Record<string, Category> = {
  "808bd": "drums.kick",
  clubkick: "drums.kick",
  hardkick: "drums.kick",
  popkick: "drums.kick",
  reverbkick: "drums.kick",
  kicklinn: "drums.kick",
  "808sd": "drums.snare",
  sn: "drums.snare",
  hc: "drums.hat.closed",
  "808hc": "drums.hat.closed",
  hh27: "drums.hat.closed",
  ho: "drums.hat.open",
  "808oh": "drums.hat.open",
  linnhats: "drums.hat",
  realclaps: "drums.clap",
  "808cy": "drums.cymbal",
  "808lt": "drums.tom",
  "808mt": "drums.tom",
  "808ht": "drums.tom",
  "808lc": "drums.perc",
  "808mc": "drums.perc",
  tabla: "drums.perc",
  tabla2: "drums.perc",
  tablex: "drums.perc",
};

/** VCSL banks the word rules get wrong or can't see (orchestral percussion, odd instrument names). */
const VCSL_BANKS: [RegExp, Category][] = [
  [/^bassdrum/, "drums.kick"],
  [/^snare/, "drums.snare"],
  [/^tom/, "drums.tom"],
  [/^hihat/, "drums.hat"],
  [/^(sus_cymbal|clash|fingercymbal)/, "drums.cymbal"],
  [/^clap/, "drums.clap"],
  [/^(timpani|gong|oceandrum|framedrum|darbuka|slitdrum|cajon|bongo|conga|anvil|brakedrum|ratchet|slapstick|vibraslap|flexatone|marktrees|sleighbells|belltree|handbells)/, "drums.perc"],
  [/^(siren|trainwhistle|ballwhistle)/, "fx"],
  [/^(harmonica|super64|didgeridoo|ocarina)/, "woodwind"],
  [/^saxello/, "brass"],
  [/^(dantranh|psaltery)/, "strings"],
  [/^strumstick/, "guitar"],
  [/^(wineglass|handchimes|tubularbells)/, "mallets"],
  [/^(kawai|steinway|clavisynth|fmpiano|piano1)/, "keys"],
];

/** Words hidden inside run-together bank names ("fdarkkick" → "dark kick"). Longest first. */
const BANK_WORDS: [string, string][] = (
  [
    ["tamborine", "tambourine"], ["triangle", "triangle"], ["ambiance", "ambience"], ["cowbell", "cowbell"], ["scratch", "scratch"],
    ["percus", "perc"], ["glitch", "glitch"], ["snare", "snare"], ["tabla", "tabla"], ["conga", "conga"], ["crash", "crash"],
    ["woosh", "whoosh"], ["lazer", "laser"], ["bleep", "bleep"], ["noise", "noise"], ["synth", "synth"], ["drone", "drone"],
    ["vocal", "vocal"], ["shaker", "shaker"], ["impact", "impact"], ["kick", "kick"], ["clap", "clap"], ["snap", "snap"],
    ["ride", "ride"], ["toms", "tom"], ["tom", "tom"], ["stab", "stab"], ["perc", "perc"], ["bass", "bass"], ["bell", "bell"],
    ["loop", "loop"], ["beep", "beep"], ["wood", "woodblock"], ["hits", "hit"], ["hit", "hit"], ["voc", "vocal"], ["zap", "zap"],
    ["cow", "cowbell"], ["rim", "rim"], ["ohh", "open hat"], ["hh", "hihat"], ["hat", "hat"], ["sub", "sub"], ["pad", "pad"],
    ["fx", "fx"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

/** Spell out the words in a bank name so the classifier can read it. */
export function bankWords(bank: string, prefix?: string): string {
  let s = bank.toLowerCase();
  if (prefix && s.startsWith(prefix) && s.length > prefix.length + 1) s = s.slice(prefix.length);
  s = s.replace(/[_-]+/g, " ");
  const out: string[] = [];
  for (const part of s.split(/\s+/).filter(Boolean)) {
    let rest = part;
    const words: string[] = [];
    while (rest) {
      const hit = BANK_WORDS.find(([w]) => rest.startsWith(w));
      if (hit) {
        words.push(hit[1]);
        rest = rest.slice(hit[0].length);
        continue;
      }
      // Keep unknown letters together until the next known word.
      const next = BANK_WORDS.map(([w]) => rest.indexOf(w, 1)).filter((i) => i > 0);
      const cut = next.length ? Math.min(...next) : rest.length;
      words.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    out.push(...words);
  }
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// Drum machine names

/** tidal-drum-machines machine id → display name. Unlisted ids are split on case changes. */
const MACHINE_NAMES: Record<string, string> = {
  AJKPercusyn: "AJK Percusyn",
  AkaiLinn: "Akai Linn",
  AkaiMPC60: "Akai MPC60",
  AkaiXR10: "Akai XR10",
  AlesisHR16: "Alesis HR-16",
  AlesisSR16: "Alesis SR-16",
  BossDR110: "Boss DR-110",
  BossDR220: "Boss DR-220",
  BossDR55: "Boss DR-55",
  BossDR550: "Boss DR-550",
  CasioRZ1: "Casio RZ-1",
  CasioSK1: "Casio SK-1",
  CasioVL1: "Casio VL-1",
  DoepferMS404: "Doepfer MS-404",
  EmuDrumulator: "E-mu Drumulator",
  EmuModular: "E-mu Modular",
  EmuSP12: "E-mu SP-12",
  KorgDDM110: "Korg DDM-110",
  KorgKPR77: "Korg KPR-77",
  KorgKR55: "Korg KR-55",
  KorgKRZ: "Korg KRZ",
  KorgM1: "Korg M1",
  KorgMinipops: "Korg Mini Pops",
  KorgPoly800: "Korg Poly-800",
  KorgT3: "Korg T3",
  Linn9000: "Linn 9000",
  LinnDrum: "LinnDrum",
  LinnLM1: "Linn LM-1",
  LinnLM2: "Linn LM-2",
  MFB512: "MFB 512",
  MPC1000: "Akai MPC1000",
  MoogConcertMateMG1: "Moog Concertmate MG-1",
  OberheimDMX: "Oberheim DMX",
  RhodesPolaris: "Rhodes Polaris",
  RhythmAce: "Ace Tone Rhythm Ace",
  RolandCompurhythm1000: "Roland CR-1000",
  RolandCompurhythm78: "Roland CR-78",
  RolandCompurhythm8000: "Roland CR-8000",
  RolandD110: "Roland D-110",
  RolandD70: "Roland D-70",
  RolandDDR30: "Roland DDR-30",
  RolandJD990: "Roland JD-990",
  RolandMC202: "Roland MC-202",
  RolandMC303: "Roland MC-303",
  RolandMT32: "Roland MT-32",
  RolandR8: "Roland R-8",
  RolandS50: "Roland S-50",
  RolandSH09: "Roland SH-09",
  RolandSystem100: "Roland System-100",
  RolandTR505: "Roland TR-505",
  RolandTR606: "Roland TR-606",
  RolandTR626: "Roland TR-626",
  RolandTR707: "Roland TR-707",
  RolandTR727: "Roland TR-727",
  RolandTR808: "Roland TR-808",
  RolandTR909: "Roland TR-909",
  SakataDPM48: "Sakata DPM-48",
  SequentialCircuitsDrumtracks: "Sequential Circuits Drumtraks",
  SequentialCircuitsTom: "Sequential Circuits Tom",
  SergeModular: "Serge Modular",
  SimmonsSDS400: "Simmons SDS-400",
  SimmonsSDS5: "Simmons SDS-5",
  SoundmastersR88: "Soundmaster SR-88",
  UnivoxMicroRhythmer12: "Univox Micro-Rhythmer 12",
  ViscoSpaceDrum: "Visco Space Drum",
  XdrumLM8953: "Xdrum LM-8953",
  YamahaRM50: "Yamaha RM50",
  YamahaRX21: "Yamaha RX21",
  YamahaRX5: "Yamaha RX5",
  YamahaRY30: "Yamaha RY30",
  YamahaTG33: "Yamaha TG33",
};

export function machineName(id: string): string {
  return MACHINE_NAMES[id] ?? id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
}

/** "Roland TR-808" → ["rolandtr808", "roland", "tr808"]. */
export function machineTags(id: string): string[] {
  const words = machineName(id).split(" ");
  const vendor = words[0]!.toLowerCase();
  const model = words.slice(1).join("").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return [...new Set([id.toLowerCase(), vendor, model || vendor])];
}

// ---------------------------------------------------------------------------
// Manifest parsing

type ManifestJson = Record<string, unknown>;

interface ManifestFile {
  bank: string;
  index: number;
  path: string;
  /** Note name for pitched banks ("A#2", "Ds1"). */
  note?: string;
}

/** Flatten a manifest into files, in Strudel's own order (index = Strudel's `n`). */
export function manifestFiles(json: ManifestJson): ManifestFile[] {
  const out: ManifestFile[] = [];
  for (const [bank, value] of Object.entries(json)) {
    if (bank.startsWith("_")) continue;
    let index = 0;
    const push = (path: unknown, note?: string) => {
      if (typeof path === "string" && path) out.push({ bank, index: index++, path, note });
    };
    if (typeof value === "string") push(value);
    else if (Array.isArray(value)) value.forEach((p) => push(p));
    else if (value && typeof value === "object") {
      for (const [note, v] of Object.entries(value)) {
        if (Array.isArray(v)) v.forEach((p) => push(p, note));
        else push(v, note);
      }
    }
  }
  return out;
}

/** Percent-encode each path segment once (VCSL paths are already encoded, others have raw spaces). */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => {
      let raw = seg;
      try {
        raw = decodeURIComponent(seg);
      } catch {
        /* keep as is */
      }
      return encodeURIComponent(raw);
    })
    .join("/");
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const NOTE_INDEX: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "A#2", "Ds1" (Strudel's sharp spelling), "Eb4", "C4" → MIDI (C4 = 60). */
export function noteToMidi(note: string): number | undefined {
  const m = /^([A-Ga-g])(#|s|b)?(-?\d)$/.exec(note.trim());
  if (!m) return undefined;
  let n = NOTE_INDEX[m[1]!.toLowerCase()]!;
  if (m[2] === "#" || m[2] === "s") n += 1;
  else if (m[2] === "b") n -= 1;
  const midi = (Number(m[3]) + 1) * 12 + n;
  return midi >= 0 && midi <= 127 ? midi : undefined;
}

/** "Ds1" → "D#1" for display. */
function noteLabel(note: string): string {
  return note.replace(/^([A-Ga-g])s(-?\d)$/, "$1#$2");
}

interface Entry {
  sample: Sample;
  fileUrl: string;
  filename: string;
  format: string;
  bank: string;
  index: number;
}

/** raw.githubusercontent.com/OWNER/REPO/BRANCH/prefix → github.com/OWNER/REPO/blob/BRANCH/prefix */
function blobUrl(base: string, path: string): string | undefined {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/.exec(base);
  if (!m) return undefined;
  return `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/${m[4]}${encodePath(path)}`;
}

function bankCategory(m: StrudelManifest, bank: string): { category?: Category; machine?: string; drum?: string } {
  if (m.category) return { category: m.category };
  if (m.machineBanks) {
    const i = bank.indexOf("_");
    const machine = i > 0 ? bank.slice(0, i) : bank;
    const drum = i > 0 ? bank.slice(i + 1).toLowerCase() : "";
    return { category: DRUM_SUFFIX[drum], machine, drum: drum || undefined };
  }
  const b = bank.toLowerCase();
  if (m.key === "vcsl") return { category: VCSL_BANKS.find(([re]) => re.test(b))?.[1] };
  return { category: DIRT_BANKS[b] ?? DRUM_SUFFIX[b] };
}

function toEntry(m: StrudelManifest, base: string, f: ManifestFile): Entry {
  const fileUrl = base + encodePath(f.path);
  const decoded = decodeSafe(f.path);
  const filename = decoded.slice(decoded.lastIndexOf("/") + 1);
  const format = formatFromFilename(filename) || "wav";
  const { category, machine, drum } = bankCategory(m, f.bank);
  const note = f.note ? noteLabel(f.note) : undefined;
  const rootNote = f.note ? noteToMidi(f.note) : undefined;
  const words = bankWords(f.bank, m.bankPrefix);
  const dirs = decoded.split("/").slice(0, -1).filter((d) => d.toLowerCase() !== f.bank.toLowerCase());

  let title: string;
  const tags = [...m.tags, f.bank];
  let form: SampleForm | undefined;
  if (machine) {
    title = `${machineName(machine)} · ${drum || "kit"} · ${f.index}`;
    tags.push("drum machine", ...machineTags(machine));
    form = "one-shot";
  } else {
    title = `${m.name} · ${f.bank}${note ? ` ${note}` : ""} · ${f.index}`;
    if (words && words !== f.bank.toLowerCase()) tags.push(words);
    if (category?.startsWith("drums") || rootNote !== undefined) form = "one-shot";
    if (/\bloop\b/.test(words)) form = "loop";
  }
  if (note) tags.push(note);

  const description = [
    `${filename} from the "${f.bank}" bank of ${m.name}`,
    dirs.length ? `(${dirs.join(" / ")})` : undefined,
  ]
    .filter(Boolean)
    .join(" ")
    .concat(".");

  const sample = makeSample({
    provider: "strudel",
    nativeId: `${m.key}/${f.bank}/${f.index}`,
    title,
    description,
    url: blobUrl(base, f.path) ?? m.repo,
    author: m.author,
    tags,
    category,
    form,
    rootNote,
    sourceCategories: category ? undefined : [words, ...dirs],
    filename,
    sourceName: m.name,
    formats: [format],
    license: m.license,
    price: { free: true },
    previewUrl: fileUrl,
    downloadable: true,
  });
  // A classified drum hit in a bank of hits is a one-shot too (breaks are excluded above).
  if (!sample.form && sample.category.startsWith("drums.") && sample.category !== "drums.break" && sample.category !== "drums.fill") sample.form = "one-shot";
  // Say the category in words too, so "kick" finds "bd" banks in text search.
  const label = categoryLabel(sample.category).toLowerCase();
  if (sample.category !== "other" && !sample.tags.includes(label)) sample.tags.push(label);
  return { sample, fileUrl, filename, format, bank: f.bank, index: f.index };
}

/** Build every listing of one manifest body. */
export function parseManifest(m: StrudelManifest, body: string): Entry[] {
  const json = JSON.parse(body) as ManifestJson;
  const base = typeof json._base === "string" ? json._base : m.url.slice(0, m.url.lastIndexOf("/") + 1);
  return manifestFiles(json)
    .filter((f) => !m.excludeBanks?.test(f.bank))
    .map((f) => toEntry(m, base.endsWith("/") ? base : `${base}/`, f));
}

/** Parsed catalogue per manifest, rebuilt only when the (cached) body changes. */
const memo = new Map<string, { body: string; entries: Entry[] }>();

async function loadManifest(m: StrudelManifest, ctx: ProviderContext): Promise<Entry[]> {
  const body = await ctx.fetch.text(m.url, { cacheTtlMs: MANIFEST_TTL, signal: ctx.signal, headers: { accept: "application/json" } });
  const hit = memo.get(m.key);
  if (hit && hit.body === body) return hit.entries;
  let entries: Entry[];
  try {
    entries = parseManifest(m, body);
  } catch (e) {
    throw new Error(`Invalid Strudel manifest ${m.url}: ${(e as Error).message}`);
  }
  memo.set(m.key, { body, entries });
  return entries;
}

function manifestsFor(q: Pick<SampleQuery, "categories">): StrudelManifest[] {
  return STRUDEL_MANIFESTS.filter((m) => !m.categories || wantsCategory(q, ...m.categories));
}

/** Split `<manifestKey>/<bank>/<index>`. */
function parseNativeId(nativeId: string): { m: StrudelManifest; bank: string; index: number } | null {
  const first = nativeId.indexOf("/");
  const last = nativeId.lastIndexOf("/");
  if (first <= 0 || last <= first + 1) return null;
  const m = BY_KEY.get(nativeId.slice(0, first));
  const index = Number(nativeId.slice(last + 1));
  if (!m || !Number.isInteger(index) || index < 0) return null;
  return { m, bank: nativeId.slice(first + 1, last), index };
}

/**
 * Where a sample lives in Strudel terms, so a kit exporter can write
 * `samples("<manifestUrl>")` and `s("<bank>:<index>")` (index is Strudel's `n`).
 */
export function strudelBankFor(sampleNativeId: string): { manifestUrl: string; bank: string; index: number } | null {
  const p = parseNativeId(sampleNativeId.startsWith("strudel:") ? sampleNativeId.slice("strudel:".length) : sampleNativeId);
  return p ? { manifestUrl: p.m.url, bank: p.bank, index: p.index } : null;
}

export const strudel: Provider = {
  id: "strudel",
  name: "Strudel sample banks",
  homepage: HOMEPAGE,
  description:
    "Sample banks that Strudel and TidalCycles load from GitHub: ~70 classic drum machines, Dirt-Samples, the CC0 VCSL orchestral set and the Salamander piano, one file per listing.",
  categories: ["drums", "bass", "keys", "synth", "strings", "brass", "woodwind", "mallets", "guitar", "vocals", "fx", "foley", "ambience", "other"],
  forms: ["one-shot", "loop"],
  access: "static",
  pricing: "free",
  supportsDownload: true,
  nativeFilters: ["categories", "forms", "commercialOnly", "freeOnly"],

  async census(ctx) {
    const all = (await Promise.all(STRUDEL_MANIFESTS.map((m) => loadManifest(m, ctx)))).flat().map((e) => e.sample);
    return tallySamples(all, `Every file in ${STRUDEL_MANIFESTS.length} allow-listed Strudel manifests`, { unit: "samples" });
  },

  buildSearchUrl() {
    // Strudel has no sample search page; the samples guide lists the banks.
    return HOMEPAGE;
  },

  async search(q, ctx) {
    const searchUrl = this.buildSearchUrl(q);
    const manifests = manifestsFor(q);
    if (!manifests.length) return { samples: [], total: 0, searchUrl };
    let samples = (await Promise.all(manifests.map((m) => loadManifest(m, ctx)))).flat().map((e) => e.sample);
    if (q.commercialOnly) samples = samples.filter((s) => isCommercialSafe(s.license));
    samples = filterLocal(samples, q);
    return { samples: paginate(samples, q), total: samples.length, searchUrl };
  },

  async getSample(nativeId, ctx): Promise<SampleDetails | null> {
    const p = parseNativeId(nativeId);
    if (!p) return null;
    const entry = (await loadManifest(p.m, ctx)).find((e) => e.bank === p.bank && e.index === p.index);
    if (!entry) return null;
    return {
      ...entry.sample,
      files: [{ url: entry.fileUrl, filename: entry.filename, format: entry.format, role: "original" }],
    };
  },
};
