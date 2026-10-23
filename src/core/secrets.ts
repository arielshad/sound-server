/**
 * Credentials from the environment, or from files in SOUND_SERVER_SECRETS_DIR
 * (one file per name, e.g. /var/run/secrets/sound-server/FREESOUND_API_KEY).
 *
 * In Kubernetes the Secret is mounted there as a volume, and the kubelet
 * updates mounted files when the Secret changes, so a key added to the vault
 * later starts working without restarting the pod. Files are re-read at most
 * once a minute.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TTL_MS = 60_000;
const cache = new Map<string, { value: string | undefined; at: number }>();

export function secret(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = env[name]?.trim();
  if (direct) return direct;
  const dir = env.SOUND_SERVER_SECRETS_DIR?.trim();
  if (!dir || !/^[A-Z0-9_]+$/.test(name)) return undefined;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: string | undefined;
  try {
    value = readFileSync(join(dir, name), "utf8").trim() || undefined;
  } catch {
    value = undefined;
  }
  cache.set(name, { value, at: Date.now() });
  return value;
}

/** Tests: forget cached file reads. */
export function clearSecretCache(): void {
  cache.clear();
}
