import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearSecretCache, secret } from "../src/core/secrets.js";

describe("secret", () => {
  let dir: string | undefined;
  afterEach(async () => {
    clearSecretCache();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("prefers the environment, then a file in SOUND_SERVER_SECRETS_DIR", async () => {
    dir = await mkdtemp(join(tmpdir(), "secrets-"));
    await writeFile(join(dir, "FREESOUND_API_KEY"), "from-file\n");
    expect(secret("FREESOUND_API_KEY", { FREESOUND_API_KEY: "from-env" })).toBe("from-env");
    expect(secret("FREESOUND_API_KEY", { SOUND_SERVER_SECRETS_DIR: dir })).toBe("from-file");
  });

  it("is undefined when neither is set, and never reads odd names", async () => {
    dir = await mkdtemp(join(tmpdir(), "secrets-"));
    expect(secret("FREESOUND_API_KEY", { SOUND_SERVER_SECRETS_DIR: dir })).toBeUndefined();
    expect(secret("../etc/passwd", { SOUND_SERVER_SECRETS_DIR: dir })).toBeUndefined();
  });
});
