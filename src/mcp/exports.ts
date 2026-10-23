/**
 * Instrument and MIDI exports for agents and the API:
 * - a multisample pack → a playable SFZ / Decent Sampler instrument (local only:
 *   it needs the pack's files on disk next to the instrument file);
 * - a melodic loop → a monophonic MIDI file.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pickAnalysisFile } from "../core/analyze.js";
import { recordCredits } from "../core/credits-file.js";
import { downloadSample, fetchFile, formatBytes, safeFilename, sampleFolderName, selectFiles } from "../core/download.js";
import { buildInstrument, instrumentFileBase, writeInstrument } from "../core/instrument.js";
import { extractMidi, type MidiExtraction } from "../core/midi.js";
import type { SampleService } from "../core/service.js";
import type { SampleDetails } from "../core/types.js";

/** Largest file fetched for MIDI extraction. */
export const MIDI_MAX_BYTES = 25 * 1024 * 1024;

/** Fetch a sample's audio (the best playable file under the cap) into memory. */
async function audioBytes(service: SampleService, sample: SampleDetails, signal?: AbortSignal): Promise<Uint8Array> {
  const file = pickAnalysisFile(sample, { maxBytes: MIDI_MAX_BYTES });
  if (!file) throw new Error("This sample has no single audio file to transcribe (packs need a file from inside the pack).");
  const res = await fetchFile(service.http, file.url, "headers" in file ? file.headers : undefined, signal);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MIDI_MAX_BYTES) throw new Error(`Audio is larger than ${formatBytes(MIDI_MAX_BYTES)}.`);
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export interface MidiResult {
  extraction: MidiExtraction;
  filename: string;
}

/** Transcribe a sample's melody to MIDI (one note at a time). */
export async function midiForSample(
  service: SampleService,
  sample: SampleDetails,
  opts: { bpm?: number; quantize?: number | false; signal?: AbortSignal } = {},
): Promise<MidiResult> {
  const buffer = await audioBytes(service, sample, opts.signal);
  const extraction = await extractMidi(
    { buffer },
    { bpm: opts.bpm ?? sample.bpm, quantize: opts.quantize, name: sample.title.slice(0, 60), signal: opts.signal },
  );
  return { extraction, filename: `${safeFilename(`${sample.provider}-${sample.title}`.slice(0, 80)).replace(/\.[^.]*$/, "")}.mid` };
}

/** Notes as agents read them. */
export function midiSummary(r: MidiResult) {
  const e = r.extraction;
  return {
    filename: r.filename,
    bpm: e.bpm,
    bpmSource: e.bpmSource,
    quantized: e.quantized,
    durationSec: Math.round(e.durationSec * 100) / 100,
    mode: e.mode,
    noteCount: e.notes.length,
    notes: e.notes.slice(0, 200).map((n) => ({ name: n.name, pitch: n.pitch, start: Math.round(n.start * 1000) / 1000, end: Math.round(n.end * 1000) / 1000, tick: n.tick, durationTicks: n.durationTicks, velocity: n.velocity })),
    warnings: e.warnings.length ? e.warnings : undefined,
  };
}

/** Write a sample's MIDI next to the user's samples (local use). */
export async function writeMidiForSample(service: SampleService, sample: SampleDetails, destDir: string, opts: { bpm?: number; quantize?: number | false } = {}) {
  const r = await midiForSample(service, sample, opts);
  const dir = resolve(destDir, "midi");
  await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
  const path = join(dir, r.filename);
  await writeFile(path, r.extraction.midi);
  return { ...midiSummary(r), path };
}

/**
 * Download a multisample pack and build a playable instrument from it: the
 * pack goes to `<destDir>/instruments/<name>/`, the .sfz / .dspreset /
 * summary JSON next to its files, and the credits into that folder.
 */
export async function instrumentForSample(
  service: SampleService,
  sample: SampleDetails,
  destDir: string,
  opts: { variant?: string; octaveOffset?: number; sourceNames: Record<string, string>; maxBytes?: number },
) {
  const files = selectFiles(sample, { all: true }).filter((f) => f.role === "pack" || f.role === "original");
  if (!files.length) throw new Error(`${sample.title} has no downloadable files; get it from ${sample.url}`);
  const dir = resolve(destDir, "instruments", sampleFolderName(sample));
  const downloaded = await downloadSample(service.http, sample, files, dir, { extract: true, maxBytes: opts.maxBytes });
  const build = await buildInstrument(dir, { name: sample.title, relativeTo: dir, variant: opts.variant, octaveOffset: opts.octaveOffset });
  const written = await writeInstrument(build, dir, { basename: instrumentFileBase(sample.title) });
  await recordCredits(dir, [sample], opts.sourceNames);
  const { zones: _zones, ...summary } = build.summary as typeof build.summary & { zones?: unknown };
  return {
    directory: dir,
    downloaded: formatBytes(downloaded.bytes),
    sfz: written.sfz,
    dspreset: written.dspreset,
    summary: written.json,
    instrument: summary,
    credits: join(dir, "ATTRIBUTION.md"),
  };
}

/** For tests and the CLI: run `fn` with a scratch folder that is removed afterwards. */
export async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "sound-export-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
