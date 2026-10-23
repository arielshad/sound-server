import { describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { l2normalize, type Embedder, type EmbedderStatus } from "../src/core/embeddings.js";
import { license } from "../src/core/licence.js";
import { SampleService } from "../src/core/service.js";
import { EmbeddingIndex, findSimilar } from "../src/core/similar.js";
import { layoutMap, layoutMapAsync, nearestNeighbours, rng } from "../src/core/soundmap.js";
import type { Provider, Sample } from "../src/core/types.js";
import { makeSample } from "../src/core/util.js";

const DIM = 16;

class FakeEmbedder implements Embedder {
  readonly model = "fake-clap";
  async embedAudio(pcm: Float32Array) {
    return l2normalize(Float32Array.from(pcm.subarray(0, DIM)));
  }
  async embedText(texts: string[]) {
    return texts.map(() => new Float32Array(DIM));
  }
  textReady() {
    return false;
  }
  audioReady() {
    return true;
  }
  warm() {}
  status(): EmbedderStatus {
    return { model: this.model, audio: "ready", text: "idle", audioEmbeds: 0, textEmbeds: 0 };
  }
}

const newIndex = () => new EmbeddingIndex({ embedder: new FakeEmbedder(), perMinute: 0 });

/** A unit vector near `axis`, nudged by `noise` in a seeded direction. */
function near(axis: number, noise: number, seed: number): Float32Array {
  const r = rng(seed);
  const v = new Float32Array(DIM);
  v[axis] = 1;
  for (let i = 0; i < DIM; i++) v[i]! += (r() - 0.5) * noise;
  return l2normalize(v);
}

function sample(provider: string, id: string, extra: Partial<Parameters<typeof makeSample>[0]> = {}): Sample {
  return makeSample({
    provider,
    nativeId: id,
    title: `${provider} ${id}`,
    tags: ["kick"],
    url: `https://${provider}.example/${id}`,
    previewUrl: `https://${provider}.example/${id}.mp3`,
    license: license("CC0-1.0"),
    durationSec: 1,
    downloadable: true,
    ...extra,
  });
}

describe("layoutMap", () => {
  it("keeps clusters apart and coordinates inside 0..1", () => {
    const vectors = [...Array.from({ length: 30 }, (_, i) => near(0, 0.3, i)), ...Array.from({ length: 30 }, (_, i) => near(5, 0.3, 100 + i))];
    const xy = layoutMap(vectors);
    expect(xy.length).toBe(120);
    for (const c of xy) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    const centre = (from: number) => {
      let x = 0, y = 0;
      for (let i = from; i < from + 30; i++) {
        x += xy[i * 2]! / 30;
        y += xy[i * 2 + 1]! / 30;
      }
      return [x, y] as const;
    };
    const spread = (from: number, [cx, cy]: readonly [number, number]) => {
      let s = 0;
      for (let i = from; i < from + 30; i++) s += Math.hypot(xy[i * 2]! - cx, xy[i * 2 + 1]! - cy) / 30;
      return s;
    };
    const a = centre(0);
    const b = centre(30);
    const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(gap).toBeGreaterThan(3 * Math.max(spread(0, a), spread(30, b)));
  });

  it("is deterministic and handles tiny inputs", async () => {
    const vectors = Array.from({ length: 12 }, (_, i) => near(i % 3, 0.5, i));
    expect(Array.from(layoutMap(vectors))).toEqual(Array.from(layoutMap(vectors)));
    expect(Array.from(layoutMap(vectors))).toEqual(Array.from(await layoutMapAsync(vectors)));
    expect(layoutMap([]).length).toBe(0);
    expect(Array.from(layoutMap([near(0, 0, 1)]))).toEqual([0.5, 0.5]);
    expect(layoutMap([near(0, 0, 1), near(1, 0, 2)]).length).toBe(4);
  });

  it("finds nearest neighbours by cosine", () => {
    const rows = [near(0, 0, 1), near(0, 0.1, 2), near(3, 0, 3)];
    expect(Array.from(nearestNeighbours(rows, 1)[0]!)).toEqual([1]);
    expect(Array.from(nearestNeighbours(rows, 5)[2]!)).toHaveLength(2);
  });
});

describe("same sound on two sources", () => {
  const kickA = sample("alpha", "k1");
  const kickB = sample("beta", "k1");
  const kickBLong = sample("beta", "k2", { durationSec: 3 });
  const kickASecond = sample("alpha", "k3");
  const hat = sample("beta", "h1");

  function seeded() {
    const index = newIndex();
    index.remember(kickA, near(0, 0, 1));
    index.remember(kickB, near(0, 0.01, 2));
    index.remember(kickBLong, near(0, 0.01, 3));
    index.remember(kickASecond, near(0, 0.01, 4));
    index.remember(hat, near(1, 0, 5));
    return index;
  }

  it("merges search results into the earlier source's copy", () => {
    const index = seeded();
    const items = [kickB, kickA, kickBLong, kickASecond, hat, sample("beta", "novector")].map((s) => ({ sample: s, provider: { id: s.provider } }));
    const merged = index.mergeDuplicates(items, ["alpha", "beta"]).map((it) => it.sample);
    const ids = merged.map((s) => s.id);
    // beta:k1 folds into alpha:k1; a different duration, the same source, another sound or no vector stay.
    expect(ids).toEqual(["alpha:k1", "beta:k2", "alpha:k3", "beta:h1", "beta:novector"]);
    expect(merged[0]!.sameAs).toEqual(["beta:k1"]);
    expect(kickA.sameAs).toBeUndefined();
  });

  it("asks for a closer match when a duration is missing", () => {
    const index = newIndex();
    const a = sample("alpha", "x", { durationSec: undefined });
    const b = sample("beta", "x", { durationSec: undefined });
    index.remember(a, near(0, 0, 1));
    index.remember(b, near(0, 0.15, 2));
    expect(index.vectors.cosine(a.id, b.id)!).toBeGreaterThan(0.985);
    expect(index.vectors.cosine(a.id, b.id)!).toBeLessThan(0.9925);
    expect(index.mergeDuplicates([a, b].map((s) => ({ sample: s, provider: { id: s.provider } })), ["alpha", "beta"])).toHaveLength(2);
  });

  it("find_similar lists the same recording apart from the results", async () => {
    const index = seeded();
    const service = new SampleService({ providers: [], embeddings: index });
    const res = await findSimilar(service, kickA.id, { limit: 5 });
    expect(res.sameSound).toEqual(["beta:k1"]);
    const ids = res.results.map((s) => s.id);
    expect(ids).not.toContain("beta:k1");
    expect(ids.slice(0, 2).sort()).toEqual(["alpha:k3", "beta:k2"]);
  });

  it("merges duplicates in a live search", async () => {
    const index = seeded();
    const fake = (id: string, samples: Sample[]): Provider => ({
      id,
      name: id,
      homepage: `https://${id}.example`,
      description: "test",
      categories: ["drums"],
      access: "api",
      pricing: "free",
      supportsDownload: true,
      buildSearchUrl: () => `https://${id}.example/search`,
      search: async () => ({ samples }),
    });
    const service = new SampleService({ providers: [fake("alpha", [kickA]), fake("beta", [kickB, hat])], embeddings: index });
    const res = await service.search({ query: "kick" });
    const ids = res.results.map((s) => s.id);
    expect(ids).toContain("alpha:k1");
    expect(ids).not.toContain("beta:k1");
    expect(res.results.find((s) => s.id === "alpha:k1")!.sameAs).toContain("beta:k1");
  });
});

describe("sound map", () => {
  function filled() {
    const index = newIndex();
    for (let i = 0; i < 20; i++) index.remember(sample("alpha", `k${i}`, { tags: ["kick"], title: `Kick ${i}` }), near(0, 0.3, i));
    for (let i = 0; i < 20; i++) index.remember(sample("beta", `h${i}`, { tags: ["hi-hat"], title: `Hi hat ${i}` }), near(4, 0.3, 50 + i));
    // A mirror of alpha:k0: shown once.
    index.remember(sample("beta", "mirror", { sameAs: ["alpha:k0"] }), near(0, 0.3, 0));
    return index;
  }

  it("lays out one point per sound with filters and a cache", async () => {
    const index = filled();
    const all = await index.map();
    expect(all.points).toHaveLength(40);
    expect(all.indexed).toBe(41);
    const p = all.points[0]!;
    expect(p).toMatchObject({ id: "alpha:k0", provider: "alpha", category: "drums.kick", verdict: "yes", durationSec: 1 });
    expect(index.map()).toBe(index.map());
    expect(await index.map()).toBe(all);
    expect((await index.map({ provider: "beta" })).points.every((q) => q.provider === "beta")).toBe(true);
    expect((await index.map({ category: "drums.hat" })).points.map((q) => q.category)).toEqual(Array(20).fill("drums.hat"));
    const thin = await index.map({ limit: 10 });
    expect(thin.points).toHaveLength(10);
    expect(thin.matching).toBe(40);
    index.remember(sample("alpha", "new"), near(0, 0.3, 99));
    expect(await index.map()).not.toBe(all);
  });

  it("serves /v1/map, and says when embeddings are off", async () => {
    const off = createApp(new SampleService({ providers: [] }));
    expect(await (await off.request("/v1/map")).json()).toEqual({ enabled: false, points: [] });
    expect((await off.request("/v1/map?category=nope")).status).toBe(400);
    expect((await off.request("/v1/map?provider=nope")).status).toBe(400);
    const on = createApp(new SampleService({ providers: [], embeddings: filled() }));
    const res = await on.request("/v1/map?category=drums&limit=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; points: { x: number; y: number }[]; matching: number };
    expect(body.enabled).toBe(true);
    expect(body.points).toHaveLength(5);
    expect(body.matching).toBe(40);
  });
});
