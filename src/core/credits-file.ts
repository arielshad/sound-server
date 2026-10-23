/**
 * Keep ATTRIBUTION.md and credits.json in a download folder up to date: every
 * download merges its samples in, so the credits for a whole project are in
 * one place when the track is released.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { creditsJson, creditsMarkdown, mergeCredits, type CreditsFile } from "./credits.js";
import type { Sample } from "./types.js";

const locks = new Map<string, Promise<unknown>>();

/** Run `fn` after any earlier write to the same folder (downloads can run in parallel). */
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(key, next);
  void next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  }).catch(() => undefined);
  return next;
}

export async function recordCredits(
  dir: string,
  samples: Sample[],
  sourceNames: Record<string, string>,
  files?: Record<string, { path: string }[]>,
): Promise<CreditsFile> {
  return serial(dir, async () => {
    await mkdir(dir, { recursive: true });
    const jsonPath = join(dir, "credits.json");
    let existing: CreditsFile | undefined;
    try {
      const parsed = JSON.parse(await readFile(jsonPath, "utf8")) as CreditsFile;
      if (Array.isArray(parsed?.samples)) existing = parsed;
    } catch {
      existing = undefined;
    }
    const merged = mergeCredits(existing, creditsJson(samples, { sourceNames, files }));
    // Write-then-rename so a crash never leaves half a credits file.
    await writeFile(`${jsonPath}.tmp`, JSON.stringify(merged, null, 2));
    await rename(`${jsonPath}.tmp`, jsonPath);
    await writeFile(join(dir, "ATTRIBUTION.md"), creditsMarkdown(merged));
    return merged;
  });
}
