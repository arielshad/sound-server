import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApp } from "../src/api/app.js";
import { setHostResolver } from "../src/core/download.js";
import { license } from "../src/core/licence.js";
import { SampleService } from "../src/core/service.js";
import type { HttpClient, Provider, SampleDetails } from "../src/core/types.js";
import { makeSample } from "../src/core/util.js";
import { createMcpServer } from "../src/mcp/server.js";
import { hasFfmpeg, writeKeysPack, writeMelodyWithFfmpeg } from "./fixtures/instrument/make.js";

let work: string;
const bodies = new Map<string, Uint8Array>();

const LOOP: SampleDetails = {
  ...makeSample({ provider: "fake", nativeId: "loop", title: "Synth Lead Loop", tags: ["lead"], url: "https://fake.example/loop", bpm: 120, license: license("CC0-1.0"), downloadable: true }),
  files: [{ url: "https://cdn.fake.example/melody.wav", filename: "melody.wav", format: "wav", role: "original" }],
};
const PACK: SampleDetails = {
  ...makeSample({ provider: "fake", nativeId: "keys", title: "Keys Multisample", tags: ["keys"], url: "https://fake.example/keys", unit: "instrument", form: "multisample", license: license("CC0-1.0"), downloadable: true }),
  files: [{ url: "https://cdn.fake.example/keys.zip", filename: "keys.zip", format: "zip", role: "pack" }],
};

const provider: Provider = {
  id: "fake",
  name: "Fake",
  homepage: "https://fake.example",
  description: "test",
  categories: ["synth", "keys"],
  access: "api",
  pricing: "free",
  supportsDownload: true,
  buildSearchUrl: () => "https://fake.example/search",
  async search() {
    return { samples: [] };
  },
  async getSample(id) {
    return id === "loop" ? LOOP : id === "keys" ? PACK : null;
  },
};

const http: HttpClient = {
  async raw(url) {
    const b = bodies.get(url);
    return b ? new Response(new Uint8Array(b)) : new Response("missing", { status: 404 });
  },
  async text() {
    throw new Error("unused");
  },
  async json() {
    throw new Error("unused");
  },
};

const service = () => new SampleService({ providers: [provider], http });

beforeAll(async () => {
  setHostResolver(async () => ["93.184.216.34"]);
  work = await mkdtemp(join(tmpdir(), "exports-"));
  if (!hasFfmpeg) return;
  writeMelodyWithFfmpeg(join(work, "melody.wav"));
  bodies.set("https://cdn.fake.example/melody.wav", readFileSync(join(work, "melody.wav")));
  const packDir = join(work, "pack");
  writeKeysPack(packDir);
  const entries: Record<string, Uint8Array> = {};
  for (const f of await readdir(packDir)) entries[`Keys/${f}`] = readFileSync(join(packDir, f));
  bodies.set("https://cdn.fake.example/keys.zip", zipSync(entries));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);

async function connect(allowLocalDownload: boolean, downloadDir?: string) {
  const server = createMcpServer(service(), { allowLocalDownload, downloadDir, publicBaseUrl: "https://sound.example" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe.skipIf(!hasFfmpeg)("MIDI export", () => {
  it("serves a .mid file and the notes as JSON", async () => {
    const app = createApp(service(), { siteRoot: join(work, "no-site") });
    const res = await app.request("/v1/samples/fake:loop/midi");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/midi");
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 4))).toBe("MThd");
    const json = (await (await app.request("/v1/samples/fake:loop/midi?format=json")).json()) as { bpm: number; notes: { name: string }[] };
    expect(json.bpm).toBe(120);
    expect(json.notes.map((n) => n.name)).toEqual(["C4", "E4", "G4", "C5"]);
    expect((await app.request("/v1/samples/fake:loop/midi?bpm=999")).status).toBe(400);
  });

  it("extract_midi writes the file locally, or links to it when hosted", async () => {
    const dir = await mkdtemp(join(work, "local-"));
    const local = text(await (await connect(true, dir)).callTool({ name: "extract_midi", arguments: { id: "fake:loop" } }));
    expect(local.path).toBe(join(dir, "midi", "fake-Synth Lead Loop.mid"));
    expect((await readFile(local.path)).subarray(0, 4).toString()).toBe("MThd");
    const hosted = text(await (await connect(false)).callTool({ name: "extract_midi", arguments: { id: "fake:loop", bpm: 120 } }));
    expect(hosted.midiUrl).toBe("https://sound.example/v1/samples/fake%3Aloop/midi?bpm=120");
    expect(hosted.noteCount).toBe(4);
  });
});

describe.skipIf(!hasFfmpeg)("instrument export", () => {
  it("is offered only where it can write files", async () => {
    const { tools } = await (await connect(false)).listTools();
    expect(tools.map((t) => t.name)).not.toContain("export_instrument");
  });

  it("downloads the pack and writes SFZ, Decent Sampler and credits next to it", async () => {
    const dir = await mkdtemp(join(work, "inst-"));
    const r = text(await (await connect(true, dir)).callTool({ name: "export_instrument", arguments: { id: "fake:keys" } }));
    expect(r.directory).toBe(join(dir, "instruments", "fake-keys"));
    const sfz = await readFile(r.sfz, "utf8");
    expect(sfz).toContain("pitch_keycenter=60");
    expect(sfz).toMatch(/lovel=\d+ hivel=\d+/);
    expect(await readFile(r.dspreset, "utf8")).toContain("<DecentSampler");
    expect(r.instrument.layers.length).toBe(2);
    expect(await readFile(join(r.directory, "ATTRIBUTION.md"), "utf8")).toContain("Keys Multisample");
  });
});
