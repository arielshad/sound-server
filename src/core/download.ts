import { createReadStream, createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { once } from "node:events";
import { lookup } from "node:dns/promises";
import { mkdir, rm, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough } from "fflate";
import type { HttpClient, SampleDetails, SampleFile } from "./types.js";
import { AUDIO_FORMATS } from "./vocab.js";

export interface FileSelection {
  /** Desired format, e.g. "wav", "flac", "mp3", "zip". */
  format?: string;
  /** Desired role. Default: the original, else the pack, else a preview. */
  role?: SampleFile["role"];
  /** Return every file that can be fetched (ignores the smart defaults). */
  all?: boolean;
}

/** Best quality first. Lossy previews only when nothing better can be fetched. */
const FORMAT_RANK = new Map<string, number>([...AUDIO_FORMATS, "zip", "mid", "midi"].map((f, i) => [f, i]));
const ROLE_ORDER: SampleFile["role"][] = ["original", "pack", "stem", "midi", "preview"];

function formatRank(f: SampleFile): number {
  return FORMAT_RANK.get(f.format) ?? 50;
}

function matchesFormat(f: SampleFile, fmt: string): boolean {
  const want = fmt.toLowerCase().replace(/^\./, "");
  const norm = want === "aif" ? "aiff" : want;
  return f.format === norm || (norm === "aiff" && f.format === "aif");
}

/**
 * Pick the files to download for a sample.
 * Default: the best original we can fetch (wav > aiff > flac > ogg > mp3),
 * else the pack archive, else the stems/MIDI of a construction kit, else the
 * best preview. Files that need a login are never picked.
 */
export function selectFiles(sample: Pick<SampleDetails, "files">, sel: FileSelection = {}): SampleFile[] {
  let files = sample.files.filter((f) => !f.requiresAuth);
  if (sel.all || files.length <= 1) return files;
  if (sel.role) files = files.filter((f) => f.role === sel.role);
  if (sel.format) files = files.filter((f) => matchesFormat(f, sel.format!));
  if (!files.length) return [];

  for (const role of ROLE_ORDER) {
    const hit = files.filter((f) => f.role === role);
    if (!hit.length) continue;
    // Construction kits: every stem and MIDI file belongs together.
    if (role === "stem" || role === "midi") return files.filter((f) => f.role === "stem" || f.role === "midi");
    hit.sort((a, b) => formatRank(a) - formatRank(b) || (b.sampleRate ?? 0) - (a.sampleRate ?? 0) || (b.bitDepth ?? 0) - (a.bitDepth ?? 0));
    return [hit[0]!];
  }
  return files.slice(0, 1);
}

/** True when the selection is only a lower-quality preview. */
export function isPreviewOnly(files: SampleFile[]): boolean {
  return files.length > 0 && files.every((f) => f.role === "preview");
}

export function totalBytes(files: SampleFile[]): number | undefined {
  let sum = 0;
  for (const f of files) {
    if (f.sizeBytes === undefined) return undefined;
    sum += f.sizeBytes;
  }
  return sum;
}

/** Normalise a relative path and refuse anything that escapes its root. */
export function safeRelative(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  if (parts.some((s) => s === "..")) throw new Error(`Unsafe path in file list: ${p}`);
  const joined = parts.join("/");
  if (!joined) throw new Error(`Empty path in file list`);
  return joined;
}

/** A file name that is safe on every OS. */
export function safeFilename(name: string, fallback = "sample"): string {
  const base = basename(name.replace(/\\/g, "/"));
  const ext = extname(base).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
  const stem = base
    .slice(0, base.length - extname(base).length)
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${stem || fallback}${ext}`;
}

// ---------------------------------------------------------------------------
// Outbound URL safety (scraped pages and manifests are untrusted)

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
const PRIVATE_V4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/;

function isPrivateAddress(addr: string): boolean {
  const a = addr.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(a) === 4) return PRIVATE_V4.test(a);
  if (isIP(a) === 6) {
    if (a === "::1" || a === "::") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return PRIVATE_V4.test(mapped[1]!);
    // URL parsing rewrites ::ffff:10.0.0.1 as ::ffff:a00:1.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return PRIVATE_V4.test(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^(f[cd]|fe[89ab])/.test(a);
  }
  return false;
}

/** Refuse non-http(s) URLs and obvious internal targets, by name and literal address. */
export function assertPublicUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`Refusing non-HTTP URL: ${url}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (PRIVATE_HOST.test(host)) throw new Error(`Refusing internal host: ${host}`);
  if (isPrivateAddress(host)) throw new Error(`Refusing private address: ${host}`);
  return u;
}

type HostResolver = (host: string) => Promise<string[]>;
let resolveHost: HostResolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/** Tests swap the DNS resolver. */
export function setHostResolver(fn: HostResolver): void {
  resolveHost = fn;
}

/**
 * Like assertPublicUrl, and also resolves the host and refuses names that
 * point at private addresses. A name that doesn't resolve locally (e.g. behind
 * an egress proxy) is allowed: the fetch itself fails if it is unreachable.
 */
export async function assertPublicHost(url: string): Promise<URL> {
  const u = assertPublicUrl(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return u;
  let addrs: string[] = [];
  try {
    addrs = await resolveHost(host);
  } catch {
    return u;
  }
  if (addrs.some(isPrivateAddress)) throw new Error(`Refusing ${host}: it resolves to a private address`);
  return u;
}

const MAX_REDIRECTS = 5;
export const DOWNLOAD_IDLE_TIMEOUT_MS = Number(process.env.SOUND_SERVER_DOWNLOAD_IDLE_MS ?? 30_000);

/** GET a file, re-checking every redirect hop; the body is watched for stalls, not capped in time. */
export async function fetchFile(http: HttpClient, url: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current);
    const res = await http.raw(current, {
      headers: { accept: "*/*", ...headers },
      redirect: "manual",
      idleTimeoutMs: DOWNLOAD_IDLE_TIMEOUT_MS,
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) throw new Error(`Redirect without Location from ${current}`);
      current = new URL(loc, current).toString();
      // Credentials stay with the host they were meant for.
      if (new URL(current).host !== new URL(url).host) headers = withoutAuth(headers);
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects for ${url}`);
}

function withoutAuth(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).filter(([k]) => k.toLowerCase() !== "authorization"));
}

// ---------------------------------------------------------------------------
// Local downloads (stdio MCP / CLI)

export interface DownloadOptions {
  /** Extract .zip archives into a folder (and delete the zip). */
  extract?: boolean;
  /** Abort when the download exceeds this many bytes. */
  maxBytes?: number;
  overwrite?: boolean;
  signal?: AbortSignal;
}

export interface DownloadedFile {
  path: string;
  bytes: number;
  role: SampleFile["role"];
}

export interface DownloadResult {
  directory: string;
  files: DownloadedFile[];
  bytes: number;
  /** True when only a preview could be fetched (the original needs a login). */
  previewOnly: boolean;
}

export const DEFAULT_MAX_DOWNLOAD_BYTES = Number(process.env.SOUND_SERVER_MAX_DOWNLOAD_BYTES ?? 2 * 1024 ** 3);
export const MAX_ZIP_ENTRIES = Number(process.env.SOUND_SERVER_MAX_ZIP_ENTRIES ?? 20_000);

/**
 * Where one sample goes inside the download folder: packs get their own
 * folder under `packs/`, single sounds are filed by category
 * (`drums/kick/freesound-12345 Deep Kick.wav`) so a project's sample folder
 * stays browsable.
 */
export function samplePath(sample: Pick<SampleDetails, "provider" | "nativeId" | "title" | "category" | "unit">, file: SampleFile): string {
  const slug = safeFilename(`${sample.provider}-${shortId(sample.nativeId)} ${sample.title}`.slice(0, 90)).replace(/\.[^.]*$/, "");
  if (sample.unit !== "sample" || file.role === "pack") {
    const folder = `packs/${slug}`;
    return file.role === "pack" ? `${folder}/${safeFilename(file.filename, "pack.zip")}` : `${folder}/${safeFilename(file.filename)}`;
  }
  const ext = file.format ? `.${file.format}` : extname(file.filename);
  const dir = sample.category.split(".").slice(0, 2).join("/");
  const suffix = file.role === "preview" ? " (preview)" : "";
  return `${dir}/${slug}${suffix}${ext}`;
}

function shortId(id: string): string {
  const s = id.replace(/[^\w-]+/g, "_");
  return s.length > 24 ? s.slice(-24) : s;
}

/** Download the chosen files of one sample into `destDir`. */
export async function downloadSample(
  http: HttpClient,
  sample: SampleDetails,
  files: SampleFile[],
  destDir: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const known = totalBytes(files);
  if (known !== undefined && known > maxBytes) {
    throw new Error(`Selection is ${formatBytes(known)}, above the ${formatBytes(maxBytes)} limit.`);
  }
  const root = resolve(destDir);
  await mkdir(root, { recursive: true });
  const written: DownloadedFile[] = [];
  let bytes = 0;

  for (const file of files) {
    const rel = safeRelative(samplePath(sample, file));
    const target = resolve(root, rel);
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`Unsafe path: ${rel}`);
    if (!opts.overwrite && (await exists(target))) {
      written.push({ path: target, bytes: (await stat(target)).size, role: file.role });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    const res = await fetchFile(http, file.url, file.headers, opts.signal);
    if (!res.body) throw new Error(`Empty response for ${file.url}`);
    let received = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        received += chunk.byteLength;
        if (bytes + received > maxBytes) ctrl.error(new Error(`Download exceeded ${formatBytes(maxBytes)} limit`));
        else ctrl.enqueue(chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(target));
    } catch (e) {
      await rm(target, { force: true });
      throw e;
    }
    bytes += received;

    if (opts.extract && (file.format === "zip" || target.toLowerCase().endsWith(".zip"))) {
      const outDir = target.slice(0, -4);
      const extracted = await extractZip(target, outDir, { maxBytes });
      await rm(target, { force: true });
      for (const e of extracted) written.push({ path: e.path, bytes: e.bytes, role: "pack" });
    } else {
      written.push({ path: target, bytes: received, role: file.role });
    }
  }
  return { directory: root, files: written, bytes, previewOnly: isPreviewOnly(files) };
}

/**
 * Extract a zip by streaming it from disk: entries are inflated chunk by
 * chunk straight to files, with caps on entry count and total size, and
 * entries that would escape the folder (zip-slip) or are macOS metadata skipped.
 */
export async function extractZip(
  zipPath: string,
  outDir: string,
  opts: { maxBytes?: number; maxEntries?: number } = {},
): Promise<{ path: string; bytes: number }[]> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const maxEntries = opts.maxEntries ?? MAX_ZIP_ENTRIES;
  const root = resolve(outDir);
  await mkdir(root, { recursive: true });
  const out: { path: string; bytes: number }[] = [];
  const writes: Promise<void>[] = [];
  const open = new Set<WriteStream>();
  let total = 0;
  let entries = 0;
  let failure: Error | undefined;

  const unzip = new Unzip((file) => {
    if (failure) return;
    if (file.name.endsWith("/") || file.name.startsWith("__MACOSX/") || basename(file.name).startsWith("._")) return;
    if (++entries > maxEntries) {
      failure = new Error(`Archive has more than ${maxEntries} files`);
      return;
    }
    let rel: string;
    try {
      rel = safeRelative(file.name);
    } catch {
      return; // zip-slip entry
    }
    const target = join(root, rel);
    if (!target.startsWith(root + sep)) return;
    mkdirSync(dirname(target), { recursive: true });
    const stream = createWriteStream(target);
    open.add(stream);
    let size = 0;
    writes.push(
      new Promise<void>((res, rej) => {
        stream.on("error", rej);
        stream.on("finish", () => {
          open.delete(stream);
          out.push({ path: target, bytes: size });
          res();
        });
        // A stream destroyed after a failure never finishes; settle on close instead.
        stream.on("close", () => {
          open.delete(stream);
          res();
        });
      }).catch((e: Error) => {
        failure ??= e;
      }),
    );
    file.ondata = (err, chunk, final) => {
      if (err) {
        failure ??= err;
        stream.destroy();
        return;
      }
      size += chunk.byteLength;
      total += chunk.byteLength;
      if (total > maxBytes) {
        failure ??= new Error(`Archive expands beyond ${formatBytes(maxBytes)}`);
        file.terminate();
        stream.destroy();
        return;
      }
      stream.write(chunk);
      if (final) stream.end();
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough as never);

  for await (const chunk of createReadStream(zipPath, { highWaterMark: 256 * 1024 })) {
    if (failure) break;
    unzip.push(chunk as Uint8Array);
    // Backpressure: let slow disks catch up before inflating more.
    for (const s of open) if (s.writableNeedDrain) await once(s, "drain");
  }
  if (!failure) unzip.push(new Uint8Array(0), true);
  if (failure) for (const s of open) s.destroy();
  await Promise.all(writes);
  if (failure) throw failure;
  return out;
}

// ---------------------------------------------------------------------------
// One zip for the browser (HTTP API)

export interface BundleEntry {
  path: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * Stream files as a single zip (no recompression: audio barely compresses),
 * plus small generated entries (ATTRIBUTION.md, credits.json). Stops with an
 * error once `maxBytes` of source data have been streamed.
 */
export function zipStream(
  http: HttpClient,
  entries: BundleEntry[],
  folder: string,
  opts: { extra?: { path: string; content: string }[]; maxBytes?: number; signal?: AbortSignal } = {},
): ReadableStream<Uint8Array> {
  const prefix = safeRelative(folder);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  let zip: Zip | undefined;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      let total = 0;
      try {
        for (const x of opts.extra ?? []) {
          const entry = new ZipPassThrough(`${prefix}/${safeRelative(x.path)}`);
          zip.add(entry);
          entry.push(new TextEncoder().encode(x.content), true);
        }
        const used = new Set<string>();
        for (const item of entries) {
          let path = safeRelative(item.path);
          for (let n = 2; used.has(path); n++) path = path.replace(/(\.[^./]*)?$/, ` (${n})$1`);
          used.add(path);
          const res = await fetchFile(http, item.url, item.headers, opts.signal);
          const entry = new ZipPassThrough(`${prefix}/${path}`);
          zip.add(entry);
          const reader = res.body!.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel();
              throw new Error(`Bundle exceeded ${formatBytes(maxBytes)} limit`);
            }
            entry.push(value);
          }
          entry.push(new Uint8Array(0), true);
        }
        zip.end();
      } catch (e) {
        zip.terminate();
        controller.error(e);
      }
    },
    cancel() {
      zip?.terminate();
    },
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Folder name for a sample bundle: `<provider>-<slug>`. */
export function sampleFolderName(sample: { provider: string; nativeId: string }): string {
  const slug = basename(sample.nativeId.replace(/\\/g, "/")).replace(/[^\w.-]+/g, "_").slice(0, 80) || "sample";
  return `${sample.provider}-${slug}`;
}
