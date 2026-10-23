/**
 * Note-name helpers shared by the instrument builder and MIDI extraction.
 * Scientific pitch notation: C4 = MIDI 60, A4 = 69 (440 Hz), C-1 = 0.
 * Pure TS, no deps.
 */

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
const LETTER: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * One note token → MIDI number. Accepts `C4`, `C#3`, `Db3`, `A-1`, `Bb0`,
 * `As4`/`Cs4` (Philharmonia's "s" for sharp), `C♯4`, `D♭4`, lowercase
 * (`c4`, `bb3`). Returns undefined for anything else or outside 0..127.
 */
export function parseNoteName(name: string): number | undefined {
  const m = /^([A-Ga-g])(#|♯|s|b|♭)?(-?\d)$/.exec(name.trim());
  if (!m) return undefined;
  const acc = m[2] === "#" || m[2] === "♯" || m[2] === "s" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  const n = (Number(m[3]) + 1) * 12 + LETTER[m[1]!.toLowerCase()]! + acc;
  return n >= 0 && n <= 127 ? n : undefined;
}

/** 60 → "C4", 61 → "C#4" (or "Db4" with `flats`). */
export function noteName(midi: number, opts: { flats?: boolean } = {}): string {
  const n = Math.round(midi);
  const names = opts.flats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Fractional MIDI note for a frequency. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}
