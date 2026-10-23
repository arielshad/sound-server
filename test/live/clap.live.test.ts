/**
 * Real CLAP smoke test (LIVE=1): downloads Xenova/clap-htsat-unfused (~160 MB,
 * cached in SOUND_SERVER_MODEL_DIR or the OS temp dir), embeds the kick fixture
 * and a synthetic hi-hat, and checks text→audio ranking both ways.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ClapEmbedder, cosine, embedAudioInput } from "../../src/core/embeddings.js";
import { categoryPrompts, zeroShotRank } from "../../src/core/similar.js";
import { FIXTURES } from "../helpers.js";

const dir = mkdtempSync(join(tmpdir(), "clap-live-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("CLAP (live model)", () => {
  const embedder = new ClapEmbedder({ model: process.env.SOUND_SERVER_CLAP_MODEL || undefined, cacheDir: process.env.SOUND_SERVER_MODEL_DIR || join(tmpdir(), "sound-server-models") });

  it("tells a kick from a hi-hat, by text and by zero-shot", { timeout: 600_000 }, async () => {
    const hat = join(dir, "hat.wav");
    const r = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=0.25:a=0.6:c=white", "-af", "highpass=f=7000,afade=t=out:st=0.02:d=0.2", hat]);
    expect(r.status).toBe(0);

    const kickVec = await embedAudioInput(embedder, { path: join(FIXTURES, "audio", "kick.wav") });
    const hatVec = await embedAudioInput(embedder, { path: hat });
    expect(kickVec).toHaveLength(512);
    expect(cosine(kickVec, kickVec)).toBeCloseTo(1, 4);

    const [kickText, hatText] = await embedder.embedText(["This is a sound of a kick drum one-shot.", "This is a sound of a hi-hat cymbal."]);
    expect(cosine(kickVec, kickText!)).toBeGreaterThan(cosine(hatVec, kickText!));
    expect(cosine(hatVec, hatText!)).toBeGreaterThan(cosine(kickVec, hatText!));

    const list = categoryPrompts();
    const vectors = await embedder.embedText(list.map((p) => p.prompt));
    const prompts = list.map((p, i) => ({ category: p.category, vector: vectors[i]! }));
    expect(zeroShotRank(kickVec, prompts)!.category).toBe("drums.kick");
    expect(embedder.status()).toMatchObject({ audio: "ready", text: "ready" });
  });
});
