import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/api/app.js";
import { analyzeAudio, clearAnalysisCache, setAnalysisCacheBackend, type AudioAnalysis } from "../src/core/analyze.js";
import { cosine, l2normalize, type Embedder, type EmbedderStatus } from "../src/core/embeddings.js";
import { SampleService, rankResults } from "../src/core/service.js";
import { EmbeddingIndex, SimilarUnavailableError, VectorIndex, categoryPrompts, findSimilar, indexCatalogue, zeroShotRank } from "../src/core/similar.js";
import { SampleStore, modelDirFromEnv, resetStoreFromEnv, storeFromEnv } from "../src/core/store.js";
import type { HttpClient, Provider, Sample } from "../src/core/types.js";
import { makeSample } from "../src/core/util.js";
import { freesound } from "../src/providers/freesound.js";
import { fakeProvider, KICK } from "./fakes.js";
import { FIXTURES, fixtureHttp } from "./helpers.js";

// ---------------------------------------------------------------------------
// A deterministic fake embedder: 16 dimensions; "kick"/"hat"/"snare" words own
// axes 0/1/2, everything else hashes onto axes 3..15. Audio "PCM" carries its
// vector in the first 16 values.

const DIM = 16;
const AXES: [RegExp, number][] = [
  [/kick|bass drum/, 0],
  [/hat/, 1],
  [/snare/, 2],
];

function textVector(text: string): Float32Array {
  const v = new Float32Array(DIM);
  const t = text.toLowerCase();
  const axis = AXES.find(([re]) => re.test(t));
  if (axis) v[axis[1]] = 1;
  else {
    let h = 2166136261;
    for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    for (let i = 3; i < DIM; i++) {
      h = Math.imul(h ^ i, 2654435761) >>> 0;
      v[i] = (h % 1000) / 1000 - 0.5;
    }
  }
  return l2normalize(v);
}

/** PCM whose first 16 values are `vec`. */
function pcmOf(vec: number[]): Float32Array {
  const pcm = new Float32Array(48_000);
  pcm.set(vec);
  return pcm;
}

class FakeEmbedder implements Embedder {
  readonly model = "fake-clap";
  audioCalls = 0;
  textCalls = 0;
  warmed: string[] = [];
  unavailable?: (kind: "audio" | "text") => string | undefined;
  constructor(private text = true) {}
  async embedAudio(pcm: Float32Array) {
    this.audioCalls++;
    return l2normalize(Float32Array.from(pcm.subarray(0, DIM)));
  }
  async embedText(texts: string[]) {
    this.textCalls++;
    return texts.map(textVector);
  }
  textReady() {
    return this.text;
  }
  audioReady() {
    return true;
  }
  warm(kind: "audio" | "text") {
    this.warmed.push(kind);
  }
  status(): EmbedderStatus {
    return { model: this.model, audio: "ready", text: this.text ? "ready" : "idle", audioEmbeds: this.audioCalls, textEmbeds: this.textCalls };
  }
}

const axis = (i: number, noise = 0): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : j === 5 ? noise : 0));

function sample(nativeId: string, over: Partial<Sample> = {}): Sample {
  return {
    ...makeSample({
      provider: "fake",
      nativeId,
      title: nativeId,
      tags: [],
      url: `https://fake.example/${nativeId}`,
      previewUrl: `https://cdn.fake.example/${nativeId}.mp3`,
      downloadable: true,
      durationSec: 1,
    }),
    ...over,
  };
}

const memStore = () => new SampleStore(":memory:");

// ---------------------------------------------------------------------------

describe("SampleStore (node:sqlite)", () => {
  it("keeps analyses until their TTL", () => {
    const store = memStore();
    const a: AudioAnalysis = { durationSec: 1.5, source: { durationSec: "chunk" }, warnings: [], deep: true, tookMs: 3, cached: true };
    store.setAnalysis("url:https://x/a.wav|deep", a, 1000, 10_000);
    expect(store.getAnalysis("url:https://x/a.wav|deep", 10_500)).toEqual({ durationSec: 1.5, source: { durationSec: "chunk" }, warnings: [], deep: true, tookMs: 3 });
    expect(store.getAnalysis("url:https://x/a.wav|deep", 11_001)).toBeUndefined();
    expect(store.getAnalysis("url:nope")).toBeUndefined();
    store.close();
  });

  it("stores samples without their per-search score, and vectors as Float32 blobs", () => {
    const store = memStore();
    store.putSample({ ...sample("a"), score: 0.9 });
    expect(store.getSample("fake:a")).toMatchObject({ id: "fake:a", title: "a" });
    expect(store.getSample("fake:a")!.score).toBeUndefined();

    const vector = l2normalize(Float32Array.from(axis(0, 0.3)));
    store.putEmbedding({ sampleId: "fake:a", provider: "fake", model: "m", vector, title: "a", category: "drums.kick", verdict: "yes", sameAs: ["other:a"], updatedAt: 5 });
    const e = store.getEmbedding("fake:a", "m")!;
    expect(Array.from(e.vector)).toEqual(Array.from(vector));
    expect(e).toMatchObject({ provider: "fake", category: "drums.kick", verdict: "yes", sameAs: ["other:a"] });
    expect(store.getEmbedding("fake:a", "other-model")).toBeUndefined();
    expect([...store.embeddings("m")].map((x) => x.sampleId)).toEqual(["fake:a"]);
    expect(store.stats()).toMatchObject({ samples: 1, embeddings: { m: 1 } });

    store.markFailed("fake:b", "m", "decoded audio is empty", 100);
    expect(store.failedAt("fake:b", "m")).toBe(100);
    store.close();
  });

  it("prunes the oldest seen samples beyond the cap, but never ones with vectors", () => {
    const store = new SampleStore(":memory:", { maxSamples: 2 });
    store.putSample(sample("old"), 1);
    store.putEmbedding({ sampleId: "fake:old", provider: "fake", model: "m", vector: new Float32Array(DIM), updatedAt: 1 });
    store.putSample(sample("b"), 2);
    store.putSample(sample("c"), 3);
    store.putSample(sample("d"), 4);
    store.prune();
    expect(store.getSample("fake:old")).toBeDefined();
    expect(store.getSample("fake:b")).toBeUndefined();
    expect(store.getSample("fake:d")).toBeDefined();
    store.close();
  });
});

describe("storeFromEnv", () => {
  afterEach(() => resetStoreFromEnv());

  it("is off without SOUND_SERVER_DATA_DIR and opens <dir>/sound-server.db with it", () => {
    expect(storeFromEnv({})).toBeUndefined();
    resetStoreFromEnv();
    const dir = mkdtempSync(join(tmpdir(), "sound-store-"));
    try {
      const store = storeFromEnv({ SOUND_SERVER_DATA_DIR: join(dir, "data") })!;
      store.putSample(sample("a"));
      expect(existsSync(join(dir, "data", "sound-server.db"))).toBe(true);
      expect(storeFromEnv({ SOUND_SERVER_DATA_DIR: "/elsewhere" })).toBe(store); // one per process
      expect(modelDirFromEnv({ SOUND_SERVER_DATA_DIR: "/data" })).toBe("/data/models");
      expect(modelDirFromEnv({ SOUND_SERVER_DATA_DIR: "/data", SOUND_SERVER_MODEL_DIR: "/models" })).toBe("/models");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("persistent analysis cache", () => {
  afterEach(() => {
    setAnalysisCacheBackend(undefined);
    clearAnalysisCache();
  });

  it("answers from the store after the in-process cache is gone", async () => {
    const wav = new Uint8Array(readFileSync(join(FIXTURES, "audio", "kick.wav")));
    let calls = 0;
    const http: HttpClient = {
      raw: async () => (calls++, new Response(wav)),
      text: async () => "",
      json: async () => ({}) as never,
    };
    const store = memStore();
    setAnalysisCacheBackend(store);
    const first = await analyzeAudio({ url: "https://cdn.example/kick.wav" }, { http });
    expect(first.durationSec).toBeGreaterThan(0);
    clearAnalysisCache(); // a restart
    const again = await analyzeAudio({ url: "https://cdn.example/kick.wav" }, { http });
    expect(calls).toBe(1);
    expect(again.cached).toBe(true);
    expect(again.durationSec).toBe(first.durationSec);
  });
});

describe("VectorIndex", () => {
  it("finds the nearest vectors by cosine, best first", () => {
    const idx = new VectorIndex();
    idx.upsert("kick", Float32Array.from(axis(0)), { provider: "fake" });
    idx.upsert("kick2", Float32Array.from(axis(0, 0.5)), { provider: "fake" });
    idx.upsert("hat", Float32Array.from(axis(1)), { provider: "fake" });
    const q = Float32Array.from(axis(0, 0.1));
    expect(idx.nearest(q, 2).map((n) => n.id)).toEqual(["kick", "kick2"]);
    expect(idx.nearest(q, 5, (id) => id === "kick").map((n) => n.id)).toEqual(["kick2", "hat"]);
    expect(idx.nearest(q, 1)[0]!.score).toBeCloseTo(cosine(q, Float32Array.from(axis(0))), 5);
    idx.upsert("kick", Float32Array.from(axis(2)), { provider: "fake" });
    expect(idx.size).toBe(3);
    expect(idx.nearest(Float32Array.from(axis(2)), 1)[0]!.id).toBe("kick");
    expect(() => idx.upsert("bad", new Float32Array(3), { provider: "fake" })).toThrow(/dimensions/);
  });

  it("grows past its initial capacity", () => {
    const idx = new VectorIndex();
    for (let i = 0; i < 300; i++) idx.upsert(`s${i}`, Float32Array.from(axis(i % DIM, i / 300)), { provider: "fake" });
    expect(idx.size).toBe(300);
    expect(idx.get("s299")).toHaveLength(DIM);
  });
});

describe("EmbeddingIndex", () => {
  let store: SampleStore;
  beforeEach(() => {
    store = memStore();
  });

  const vectors: Record<string, number[]> = {
    "https://cdn.fake.example/kick-a.mp3": axis(0, 0.1),
    "https://cdn.fake.example/kick-b.mp3": axis(0, 0.3),
    "https://cdn.fake.example/kick-mirror.mp3": axis(0, 0.12),
    "https://cdn.fake.example/hat.mp3": axis(1),
    "https://other.example/snare.mp3": axis(2),
    "https://cdn.fake.example/kick.mp3": axis(0, 0.2),
  };
  const loadPcm = async (file: { url: string }) => {
    const v = vectors[file.url];
    if (!v) throw new Error(`no audio at ${file.url}`);
    return pcmOf(v);
  };

  it("embeds previews, stores them, and reloads them on start", async () => {
    const embedder = new FakeEmbedder();
    const index = new EmbeddingIndex({ embedder, store, loadPcm, perMinute: 0 });
    const v = await index.index(sample("kick-a"));
    expect(v).toHaveLength(DIM);
    expect(store.getEmbedding("fake:kick-a", "fake-clap")).toBeDefined();
    expect(store.getSample("fake:kick-a")).toMatchObject({ title: "kick-a" });
    // Already stored: no second embedding.
    await index.index(sample("kick-a"));
    expect(embedder.audioCalls).toBe(1);

    const reloaded = new EmbeddingIndex({ embedder: new FakeEmbedder(), store, loadPcm, perMinute: 0 });
    expect(reloaded.size).toBe(1);
    expect(reloaded.vectorFor("fake:kick-a")).toEqual(v);
  });

  it("skips packs, long files and samples without a fetchable preview", async () => {
    const index = new EmbeddingIndex({ embedder: new FakeEmbedder(), store, loadPcm, perMinute: 0 });
    expect(index.skipReason(sample("p", { unit: "pack" }))).toMatch(/pack/);
    expect(index.skipReason(sample("long", { durationSec: 45 }))).toMatch(/30s/);
    expect(index.skipReason(sample("ref", { previewNeedsReferer: true }))).toMatch(/preview/);
    expect(index.skipReason(sample("none", { previewUrl: undefined }))).toMatch(/preview/);
    // With details, a preview that needs a Referer is fetched with its headers.
    const details = { ...sample("ref", { previewNeedsReferer: true }), files: [{ url: "https://cdn.fake.example/ref.mp3", filename: "ref.mp3", format: "mp3", role: "preview" as const, headers: { referer: "https://fake.example/" } }] };
    expect(index.previewFile(details)).toEqual({ url: "https://cdn.fake.example/ref.mp3", headers: { referer: "https://fake.example/" } });
    await expect(index.index(sample("p", { unit: "pack" }))).rejects.toThrow(/pack/);
  });

  it("remembers samples that fail so the background indexer doesn't retry them", async () => {
    const index = new EmbeddingIndex({ embedder: new FakeEmbedder(), store, loadPcm, perMinute: 0 });
    await expect(index.index(sample("missing"))).rejects.toThrow(/no audio/);
    expect(store.failedAt("fake:missing", "fake-clap")).toBeGreaterThan(0);
  });

  it("indexes search hits in the background within the per-minute budget, one fetch per host", async () => {
    let now = 1_000_000;
    let active = new Map<string, number>();
    let overlap = false;
    const slowLoad = async (file: { url: string }) => {
      const host = new URL(file.url).host;
      active.set(host, (active.get(host) ?? 0) + 1);
      if (active.get(host)! > 1) overlap = true;
      await new Promise((r) => setTimeout(r, 5));
      active.set(host, active.get(host)! - 1);
      return loadPcm(file);
    };
    const index = new EmbeddingIndex({ embedder: new FakeEmbedder(), store, loadPcm: slowLoad, perMinute: 2, now: () => now });
    index.observe([sample("kick-a"), sample("kick-b"), sample("hat"), sample("p", { unit: "pack" })]);
    await vi.waitFor(() => expect(index.size).toBe(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(index.size).toBe(2); // budget spent
    expect(index.status().queued).toBe(1);
    now += 60_000; // a minute later the budget refills
    index.observe([]);
    await vi.waitFor(() => expect(index.size).toBe(3));
    expect(overlap).toBe(false);
    index.close();
    active = new Map();
  });

  it("fetches nothing while the model can't load", async () => {
    const embedder = new FakeEmbedder();
    embedder.unavailable = () => "CLAP audio model unavailable: @huggingface/transformers is not installed";
    let fetched = 0;
    const index = new EmbeddingIndex({ embedder, store, loadPcm: async (f) => (fetched++, loadPcm(f)), perMinute: 60 });
    index.observe([sample("kick-a"), sample("hat")]);
    await new Promise((r) => setTimeout(r, 20));
    await expect(index.index(sample("kick-b"))).rejects.toThrow(/not installed/);
    expect(fetched).toBe(0);
    expect(index.status().queued).toBe(2);
    expect(store.failedAt("fake:kick-b", "fake-clap")).toBeUndefined();
    index.close();
  });

  it("finds similar stored samples, excluding the sample itself and its mirrors", async () => {
    const embedder = new FakeEmbedder();
    const index = new EmbeddingIndex({ embedder, store, loadPcm, perMinute: 0 });
    await index.index(sample("kick-a"));
    await index.index(sample("kick-b"));
    await index.index(sample("hat"));
    // A mirror of kick-a on another source (Openverse-style sameAs).
    await index.index(sample("kick-mirror", { sameAs: ["fake:kick-a"] }));
    const service = new SampleService({ providers: [fakeProvider], embeddings: index });

    const res = await findSimilar(service, "fake:kick-a", { limit: 5 });
    expect(res.method).toBe("clap");
    const ids = res.results.map((s) => s.id);
    expect(ids[0]).toBe("fake:kick-b");
    expect(ids).not.toContain("fake:kick-a");
    expect(ids).not.toContain("fake:kick-mirror");
    expect(ids.at(-1)).toBe("fake:hat");
    expect(res.results[0]!.score).toBeGreaterThan(res.results.at(-1)!.score!);
  });

  it("embeds a sample that isn't indexed yet on demand", async () => {
    const embedder = new FakeEmbedder();
    const index = new EmbeddingIndex({ embedder, store, loadPcm, perMinute: 0 });
    await index.index(sample("kick-a"));
    await index.index(sample("hat"));
    const service = new SampleService({ providers: [fakeProvider], embeddings: index });
    const res = await findSimilar(service, "fake:kick", { limit: 2 }); // KICK from fakes.ts, preview kick.mp3
    expect(res.results.map((s) => s.id)).toEqual(["fake:kick-a", "fake:hat"]);
    expect(index.vectorFor("fake:kick")).toBeDefined();
  });

  it("falls back to Freesound's similarity for freesound ids when the index is empty", async () => {
    vi.stubEnv("FREESOUND_API_KEY", "test-key");
    try {
      const http = fixtureHttp([
        ["/similar/", "freesound/similar_331589.json"],
        ["/sounds/331589/", "freesound/sound_331589.json"],
      ]);
      const index = new EmbeddingIndex({ embedder: new FakeEmbedder(), store, loadPcm, perMinute: 0 });
      const service = new SampleService({ providers: [freesound], http, embeddings: index });
      const res = await findSimilar(service, "freesound:331589", { limit: 2 });
      expect(res.method).toBe("freesound");
      expect(res.results.map((s) => s.id)).toEqual(["freesound:41155", "freesound:147994"]);
      expect(res.indexed).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("without embeddings, explains that only Freesound ids work", async () => {
    const service = new SampleService({ providers: [fakeProvider] });
    await expect(findSimilar(service, "fake:kick")).rejects.toBeInstanceOf(SimilarUnavailableError);
  });

  it("pre-indexes a static catalogue, skipping what it can't fetch", async () => {
    const index = new EmbeddingIndex({ embedder: new FakeEmbedder(), store, loadPcm, perMinute: 0 });
    const service = new SampleService({ providers: [fakeProvider], embeddings: index });
    const [r] = await indexCatalogue(service, index, { providers: ["fake"], limit: 10 });
    expect(r).toMatchObject({ provider: "fake", seen: 3, indexed: 1, failed: 1 }); // kick ok; vocal has no audio in the fake
    expect(r!.skipped).toEqual({ "no preview this server can fetch": 1 }); // the login-only pack
    expect(index.vectorFor("fake:kick")).toBeDefined();
  });
});

describe("text→audio re-ranking", () => {
  const item = (s: Sample, rank: number) => ({ sample: s, rank, provider: { id: "fake", access: "api" as const } });

  it("moves results with a matching stored vector up", () => {
    const a = sample("first-listed");
    const b = sample("better-match");
    const plain = rankResults([item(a, 0), item(b, 1)], { query: "" });
    expect(plain.map((s) => s.id)).toEqual(["fake:first-listed", "fake:better-match"]);
    const semantic = new Map([
      ["fake:first-listed", 0.05],
      ["fake:better-match", 0.6],
    ]);
    const reranked = rankResults([item(a, 0), item(b, 1)], { query: "" }, { semantic, weight: 0.15 });
    expect(reranked.map((s) => s.id)).toEqual(["fake:better-match", "fake:first-listed"]);
    // One vector alone says nothing about the others: no change.
    const single = rankResults([item(a, 0), item(b, 1)], { query: "" }, { semantic: new Map([["fake:better-match", 0.9]]) });
    expect(single).toEqual(plain);
  });

  function catalogueProvider(samples: Sample[]): Provider {
    return { ...fakeProvider, id: "cat", name: "Catalogue", search: async () => ({ samples, total: samples.length }), getSample: undefined };
  }

  it("blends the CLAP text-audio score into SampleService.search without fetching audio", async () => {
    const hat = sample("hit-1", { provider: "cat", id: "cat:hit-1", title: "Drum hit 1", tags: ["drum"] });
    const kick = sample("hit-2", { provider: "cat", id: "cat:hit-2", title: "Drum hit 2", tags: ["drum"] });
    const embedder = new FakeEmbedder();
    let fetched = 0;
    const index = new EmbeddingIndex({ embedder, loadPcm: async () => (fetched++, pcmOf(axis(0))), perMinute: 0 });
    index.remember(hat, Float32Array.from(axis(1)));
    index.remember(kick, Float32Array.from(axis(0)));
    const service = new SampleService({ providers: [catalogueProvider([hat, kick])], embeddings: index });

    const before = await new SampleService({ providers: [catalogueProvider([hat, kick])] }).search({ query: "drum hit kick" });
    expect(before.results[0]!.id).toBe("cat:hit-1");
    const res = await service.search({ query: "drum hit kick" });
    expect(res.results[0]!.id).toBe("cat:hit-2");
    expect(fetched).toBe(0);
  });

  it("skips re-ranking (and starts loading the text model) when it isn't ready", async () => {
    const embedder = new FakeEmbedder(false);
    const index = new EmbeddingIndex({ embedder, perMinute: 0 });
    index.remember(sample("a"), Float32Array.from(axis(0)));
    index.remember(sample("b"), Float32Array.from(axis(1)));
    expect(await index.semanticScores("kick", ["fake:a", "fake:b"])).toBeUndefined();
    expect(embedder.warmed).toContain("text");
    expect(embedder.textCalls).toBe(0);
  });
});

describe("zero-shot category fallback", () => {
  it("builds one prompt per useful category from the vocabulary", () => {
    const prompts = categoryPrompts();
    expect(prompts.find((p) => p.category === "drums.kick")!.prompt).toBe("This is a sound of a kick drum one-shot.");
    expect(prompts.find((p) => p.category === "keys")!.prompt).toContain("piano");
    expect(prompts.map((p) => p.category)).not.toContain("other");
    expect(prompts.map((p) => p.category)).not.toContain("drums.hat.open");
  });

  it("relabels an unsure sample with a clear model verdict, and leaves sure ones alone", async () => {
    const embedder = new FakeEmbedder();
    const index = new EmbeddingIndex({ embedder, perMinute: 0 });
    const unsure = sample("mystery", { category: "other", categoryEvidence: { by: "rules", confidence: 0.1 } });
    const sure = sample("labelled", { category: "drums.snare", categoryEvidence: { by: "rules", confidence: 0.8 } });
    const fromSource = sample("source", { category: "drums.snare", categoryEvidence: { by: "source", confidence: 0.2 } });
    for (const s of [unsure, sure, fromSource]) index.remember(s, Float32Array.from(axis(0)));

    // Prompts aren't embedded yet: unchanged, and they start loading.
    expect(index.refine(unsure)).toBe(unsure);
    await vi.waitFor(() => expect(index.zeroShot("fake:mystery")).toBeDefined());

    const z = index.zeroShot("fake:mystery")!;
    expect(z.category).toBe("drums.kick");
    expect(z.margin).toBeGreaterThan(0.3);
    expect(index.refine(unsure)).toMatchObject({ category: "drums.kick", categoryEvidence: { by: "model" } });
    expect(index.refine(sure)).toBe(sure);
    expect(index.refine(fromSource)).toBe(fromSource);
    const noVector = sample("novec", { category: "other", categoryEvidence: { by: "rules", confidence: 0.1 } });
    expect(index.refine(noVector)).toBe(noVector);
  });

  it("does not relabel when the model is torn between unrelated categories", () => {
    const prompts = [
      { category: "drums.kick" as const, vector: Float32Array.from(axis(0)) },
      { category: "drums.snare" as const, vector: Float32Array.from(axis(2)) },
    ];
    const between = Float32Array.from(axis(0).map((x, i) => (i === 2 ? 1 : x)));
    const z = zeroShotRank(between, prompts)!;
    expect(z.margin).toBeLessThan(0.3);
  });

  it("applies in search before category filters", async () => {
    const mystery = sample("thump", { provider: "cat", id: "cat:thump", title: "Thump", category: "other", categoryEvidence: { by: "rules", confidence: 0 } });
    const provider: Provider = { ...fakeProvider, id: "cat", name: "Catalogue", categories: ["drums", "other"], search: async () => ({ samples: [mystery] }), getSample: undefined };
    const index = new EmbeddingIndex({ embedder: new FakeEmbedder(), perMinute: 0 });
    index.remember(mystery, Float32Array.from(axis(0)));
    await index.promptsReady();
    const service = new SampleService({ providers: [provider], embeddings: index });
    const res = await service.search({ query: "", categories: ["drums.kick"] });
    expect(res.results.map((s) => [s.id, s.category, s.categoryEvidence?.by])).toEqual([["cat:thump", "drums.kick", "model"]]);
  });
});

describe("HTTP API", () => {
  it("GET /v1/samples/:id/similar answers from the CLAP index", async () => {
    const index = new EmbeddingIndex({ embedder: new FakeEmbedder(), perMinute: 0 });
    index.remember(KICK, Float32Array.from(axis(0)));
    index.remember(sample("kick-b"), Float32Array.from(axis(0, 0.2)));
    index.remember(sample("hat"), Float32Array.from(axis(1)));
    const app = createApp(new SampleService({ providers: [fakeProvider], embeddings: index }));
    const res = await app.request("/v1/samples/fake:kick/similar?limit=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { method: string; results: Sample[] };
    expect(body.method).toBe("clap");
    expect(body.results.map((s) => s.id)).toEqual(["fake:kick-b"]);

    const status = (await (await app.request("/v1/embeddings")).json()) as { enabled: boolean; vectors: number };
    expect(status).toMatchObject({ enabled: true, vectors: 3 });
  });

  it("answers 501 for non-Freesound ids when embeddings are off, 404 for unknown samples", async () => {
    const app = createApp(new SampleService({ providers: [fakeProvider] }));
    expect((await app.request("/v1/samples/fake:kick/similar")).status).toBe(501);
    expect(await (await app.request("/v1/embeddings")).json()).toEqual({ enabled: false });

    const index = new EmbeddingIndex({ embedder: new FakeEmbedder(), perMinute: 0 });
    const on = createApp(new SampleService({ providers: [fakeProvider], embeddings: index }));
    expect((await on.request("/v1/samples/fake:nope/similar")).status).toBe(404);
  });
});
