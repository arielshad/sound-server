/**
 * The one place the sample vocabulary lives: categories, forms and the words
 * that point at them. The server, scripts and web UI all import from here
 * (the web build reads it from dist/), so the lists never drift apart.
 */

export interface CategoryDef {
  id: string;
  label: string;
  /** Words (lowercase, matched as whole tokens or phrases) that suggest this category. */
  aliases: string[];
}

/**
 * Dot-path categories. A parent ("drums") matches every child ("drums.kick").
 * Order matters for classification ties: more specific entries come after their parent.
 */
export const CATEGORY_DEFS = [
  { id: "drums", label: "Drums", aliases: ["drum", "drums", "percussion", "drumkit", "drum kit", "beat", "beats"] },
  { id: "drums.kick", label: "Kick", aliases: ["kick", "kicks", "kick drum", "bass drum", "bassdrum", "bd", "kik"] },
  { id: "drums.snare", label: "Snare", aliases: ["snare", "snares", "sd", "snare drum", "rimshot"] },
  { id: "drums.clap", label: "Clap", aliases: ["clap", "claps", "handclap", "hand clap", "snap", "snaps", "finger snap"] },
  { id: "drums.hat", label: "Hi-hat", aliases: ["hihat", "hi hat", "hi-hat", "hat", "hats", "hh"] },
  { id: "drums.hat.closed", label: "Closed hat", aliases: ["closed hat", "closed hihat", "closed hi hat", "chh"] },
  { id: "drums.hat.open", label: "Open hat", aliases: ["open hat", "open hihat", "open hi hat", "ohh"] },
  { id: "drums.cymbal", label: "Cymbal", aliases: ["cymbal", "cymbals"] },
  { id: "drums.cymbal.crash", label: "Crash", aliases: ["crash", "crash cymbal", "splash"] },
  { id: "drums.cymbal.ride", label: "Ride", aliases: ["ride", "ride cymbal", "ride bell"] },
  { id: "drums.tom", label: "Tom", aliases: ["tom", "toms", "floor tom", "tom tom"] },
  { id: "drums.perc", label: "Percussion", aliases: ["perc", "percs", "shaker", "tambourine", "conga", "bongo", "cowbell", "woodblock", "rim", "clave", "cabasa", "guiro", "timbale", "djembe", "tabla", "cajon", "triangle", "agogo"] },
  { id: "drums.fill", label: "Drum fill", aliases: ["fill", "fills", "drum fill"] },
  { id: "drums.break", label: "Breakbeat", aliases: ["break", "breaks", "breakbeat", "breakbeats", "amen"] },
  { id: "bass", label: "Bass", aliases: ["bass", "bassline", "basses"] },
  { id: "bass.808", label: "808", aliases: ["808", "808s", "tr808", "tr-808"] },
  { id: "bass.sub", label: "Sub bass", aliases: ["sub", "sub bass", "subbass", "reese"] },
  { id: "vocals", label: "Vocals", aliases: ["vocal", "vocals", "vox", "voice", "voices", "singing", "sung", "singer"] },
  { id: "vocals.acapella", label: "A cappella", aliases: ["acapella", "acapellas", "a cappella", "accapella", "acappella", "a capella"] },
  { id: "vocals.chop", label: "Vocal chop", aliases: ["vocal chop", "vocal chops", "vox chop", "chop", "chops"] },
  { id: "vocals.shout", label: "Vocal shot", aliases: ["shout", "adlib", "ad lib", "ad-lib", "yeah", "hey", "scream", "vocal shot", "vocal hit"] },
  { id: "vocals.spoken", label: "Spoken word", aliases: ["spoken", "speech", "talking", "spoken word", "narration", "dialogue", "whisper"] },
  { id: "vocals.choir", label: "Choir", aliases: ["choir", "choral", "chant"] },
  { id: "fx", label: "FX", aliases: ["fx", "sfx", "effect", "effects", "sound effect", "sound effects"] },
  { id: "fx.riser", label: "Riser", aliases: ["riser", "risers", "uplifter", "build up", "buildup", "rise"] },
  { id: "fx.downlifter", label: "Downlifter", aliases: ["downlifter", "downlifters", "downer", "fall"] },
  { id: "fx.impact", label: "Impact", aliases: ["impact", "impacts", "orchestral hit", "cinematic hit", "boom", "slam", "thud", "braam", "sub drop", "explosion", "explosions", "explode", "blast", "gunshot", "gun shot", "punch"] },
  { id: "fx.sweep", label: "Sweep", aliases: ["sweep", "sweeps", "whoosh", "whooshes", "swoosh", "swish", "woosh"] },
  { id: "fx.zap", label: "Zap", aliases: ["zap", "zaps", "laser", "lasers", "pew", "blaster", "zapper"] },
  { id: "fx.noise", label: "Noise", aliases: ["noise", "white noise", "static", "hiss", "vinyl", "crackle", "vinyl crackle"] },
  { id: "fx.glitch", label: "Glitch", aliases: ["glitch", "glitches", "stutter", "bitcrush"] },
  { id: "fx.transition", label: "Transition", aliases: ["transition", "transitions", "reverse", "reversed", "tape stop"] },
  { id: "foley", label: "Foley", aliases: ["foley", "footstep", "footsteps", "door", "glass", "paper", "cloth", "click", "button", "water", "kitchen", "household"] },
  { id: "ambience", label: "Ambience", aliases: ["ambience", "ambient", "atmosphere", "atmos", "field recording", "soundscape", "room tone", "rain", "wind", "forest", "city", "birds", "ocean", "drone"] },
  { id: "keys", label: "Keys", aliases: ["piano", "keys", "rhodes", "organ", "epiano", "e-piano", "electric piano", "wurlitzer", "harpsichord", "clavinet", "celesta"] },
  { id: "guitar", label: "Guitar", aliases: ["guitar", "guitars", "acoustic guitar", "electric guitar", "strum", "riff", "ukulele", "banjo", "mandolin"] },
  { id: "synth", label: "Synth", aliases: ["synth", "synths", "synthesizer", "analog", "moog", "juno", "arp", "arpeggio"] },
  { id: "synth.pad", label: "Pad", aliases: ["pad", "pads"] },
  { id: "synth.lead", label: "Lead", aliases: ["lead", "leads"] },
  { id: "synth.pluck", label: "Pluck", aliases: ["pluck", "plucks"] },
  { id: "synth.stab", label: "Stab", aliases: ["stab", "stabs", "chord stab"] },
  { id: "strings", label: "Strings", aliases: ["strings", "violin", "viola", "cello", "contrabass", "double bass", "pizzicato", "harp", "orchestral"] },
  { id: "brass", label: "Brass", aliases: ["brass", "trumpet", "trombone", "horn", "french horn", "tuba", "sax", "saxophone"] },
  { id: "woodwind", label: "Woodwind", aliases: ["woodwind", "flute", "clarinet", "oboe", "bassoon", "recorder", "pan flute", "whistle"] },
  { id: "mallets", label: "Mallets", aliases: ["mallet", "mallets", "marimba", "xylophone", "vibraphone", "glockenspiel", "kalimba", "bells", "bell", "chime", "chimes", "music box"] },
  { id: "other", label: "Other", aliases: [] },
] as const satisfies readonly CategoryDef[];

export type Category = (typeof CATEGORY_DEFS)[number]["id"];
export const CATEGORIES = CATEGORY_DEFS.map((c) => c.id) as Category[];
export const TOP_CATEGORIES = CATEGORIES.filter((c) => !c.includes(".")) as Category[];

const CATEGORY_SET = new Set<string>(CATEGORIES);
export function isCategory(s: string): s is Category {
  return CATEGORY_SET.has(s);
}

export function categoryLabel(id: string): string {
  return CATEGORY_DEFS.find((c) => c.id === id)?.label ?? id;
}

/** "drums.hat.closed" -> "drums" */
export function topCategory(id: string): Category {
  return (id.split(".")[0] ?? "other") as Category;
}

/** Does a sample in `category` satisfy the `wanted` filter? Parents match their children. */
export function categoryMatches(category: string | undefined, wanted?: readonly string[]): boolean {
  if (!wanted?.length) return true;
  if (!category) return false;
  return wanted.some((w) => category === w || category.startsWith(`${w}.`));
}

/**
 * The form of a sample:
 * - one-shot:    a single hit or note (kick, zap, piano C4)
 * - loop:        loops seamlessly at a tempo
 * - phrase:      longer, non-looping performance (a cappella, riff, spoken line)
 * - multisample: a playable instrument (many notes/velocities)
 * - pack:        a zip/kit of many samples
 * - midi:        MIDI file
 * - preset:      synth preset
 */
export const SAMPLE_FORMS = ["one-shot", "loop", "phrase", "multisample", "pack", "midi", "preset"] as const;
export type SampleForm = (typeof SAMPLE_FORMS)[number];

export const FORM_ALIASES: Record<SampleForm, string[]> = {
  "one-shot": ["one shot", "oneshot", "one-shot", "one shots", "oneshots", "single hit", "hit", "single"],
  loop: ["loop", "loops", "looped", "loopable", "groove"],
  phrase: ["phrase", "phrases", "acapella", "a cappella", "performance", "take"],
  multisample: ["multisample", "multisampled", "multi-sample", "sampled instrument", "sfz", "decentsampler", "kontakt", "soundfont", "sf2"],
  pack: ["pack", "sample pack", "kit", "drum kit", "construction kit", "bundle", "collection", "library"],
  midi: ["midi", "mid"],
  preset: ["preset", "presets", "patch", "patches", "serum", "vital"],
};

export const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type PitchClass = (typeof PITCH_CLASSES)[number];

/** Audio formats, best quality first: the order downloads prefer. */
export const AUDIO_FORMATS = ["wav", "aiff", "aif", "flac", "ogg", "opus", "mp3", "m4a"] as const;
export const ARCHIVE_FORMATS = ["zip", "rar", "7z"] as const;
export const OTHER_FORMATS = ["mid", "midi", "sfz", "dspreset", "sf2", "nki", "fxp", "vital", "json"] as const;
