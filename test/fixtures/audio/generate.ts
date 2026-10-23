/**
 * Regenerate the audio fixtures in this folder (needs ffmpeg on PATH):
 *   npx tsx test/fixtures/audio/generate.ts
 *
 * - kick.wav          0.3 s 55 Hz sine burst, 30 ms lead-in silence, 44.1 kHz / 16-bit mono
 * - tone-a4.mp3       1 s 440 Hz sine (A4, MIDI 69), 22.05 kHz mono
 * - chord-fminor.ogg  3 s Fm – B♭m – C – Fm chord sequence (key: F minor)
 * - loop120.ogg       2 bars at 120 BPM (4 s): kick on beats, hats on off-beats, snare on 2 and 4
 * - smpl-c4.wav       0.25 s C4 tone with a `smpl` chunk (unity note 60, forward loop 1000–5000)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clickLoop, sine, smplChunk, wavFile } from "./riff.js";

const here = dirname(fileURLToPath(import.meta.url));
const ff = (args: string[]) => {
  const r = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-nostdin", "-hide_banner", "-v", "error", "-y", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
};

ff([
  "-f", "lavfi", "-i",
  "aevalsrc='if(between(t,0.03,0.25),0.9*sin(2*PI*55*(t-0.03))*exp(-(t-0.03)*14),0)':s=44100:d=0.3",
  "-ac", "1", "-c:a", "pcm_s16le", join(here, "kick.wav"),
]);

ff(["-f", "lavfi", "-i", "sine=f=440:d=1:r=22050", "-af", "volume=0.5", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k", join(here, "tone-a4.mp3")]);

// Fm (F A♭ C), B♭m (B♭ D♭ F), C (C E G), Fm: 0.75 s each, bass note + triad.
const chords = [
  [87.31, 174.61, 207.65, 261.63],
  [116.54, 233.08, 277.18, 349.23],
  [130.81, 261.63, 329.63, 392.0],
  [87.31, 174.61, 207.65, 261.63],
];
const expr = chords
  .map((c, i) => `between(t,${i * 0.75},${i * 0.75 + 0.7499})*(${c.map((f) => `sin(2*PI*${f}*t)`).join("+")})`)
  .join("+");
ff(["-f", "lavfi", "-i", `aevalsrc='0.2*(${expr})':s=22050:d=3`, "-ac", "1", "-c:a", "libvorbis", "-q:a", "1", join(here, "chord-fminor.ogg")]);

const tmp = mkdtempSync(join(tmpdir(), "fixtures-"));
try {
  const loopWav = join(tmp, "loop.wav");
  writeFileSync(loopWav, wavFile({ pcm: clickLoop(120, 2, 22050), sampleRate: 22050 }));
  ff(["-i", loopWav, "-c:a", "libvorbis", "-q:a", "0", join(here, "loop120.ogg")]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(
  join(here, "smpl-c4.wav"),
  wavFile({ pcm: sine(261.63, 0.25, 22050), sampleRate: 22050, chunks: [smplChunk({ unityNote: 60, sampleRate: 22050, loops: [{ start: 1000, end: 5000 }] })] }),
);
console.log("fixtures written to", here);
