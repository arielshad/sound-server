/**
 * A 2-D layout of audio embeddings for the sound map: sounds that sound alike
 * land close together.
 *
 * 1. A seeded random projection shrinks the vectors (512 dims for CLAP) to 48,
 *    which keeps distances close enough for finding neighbours and makes the
 *    next step about ten times cheaper.
 * 2. Each point's k nearest neighbours by cosine (brute force).
 * 3. A UMAP-style layout: start from the first two principal components, then
 *    pull neighbours together and push random other points apart for a few
 *    hundred passes.
 *
 * Deterministic for the same input (seeded), no dependencies, about 1.5 s for
 * 2,500 points; layoutMapAsync spreads that over many short turns of the event
 * loop. Coordinates come back scaled to 0..1.
 */

export interface LayoutOptions {
  /** Neighbours per point (default 12). */
  neighbours?: number;
  /** Layout passes (default 200; fewer for big inputs). */
  epochs?: number;
  seed?: number;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Project `vectors` to `dims` dimensions with a seeded Gaussian matrix, rows L2-normalised. */
export function randomProject(vectors: Float32Array[], dims: number, seed: number): Float32Array[] {
  const d = vectors[0]?.length ?? 0;
  if (d <= dims) return vectors.map((v) => normalise(Float32Array.from(v)));
  const rand = rng(seed);
  const m = new Float32Array(d * dims);
  for (let i = 0; i < m.length; i++) m[i] = gaussian(rand);
  return vectors.map((v) => {
    const out = new Float32Array(dims);
    for (let j = 0; j < d; j++) {
      const x = v[j]!;
      if (x === 0) continue;
      const o = j * dims;
      for (let k = 0; k < dims; k++) out[k]! += x * m[o + k]!;
    }
    return normalise(out);
  });
}

function normalise(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

/** Indices of each point's `k` most similar points (cosine of normalised rows), best first. */
export function nearestNeighbours(rows: Float32Array[], k: number): Int32Array[] {
  const steps = neighbourSteps(rows, k);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

function* neighbourSteps(rows: Float32Array[], k: number): Generator<void, Int32Array[]> {
  const n = rows.length;
  const kk = Math.min(k, n - 1);
  const d = rows[0]?.length ?? 0;
  // Best-first top lists, filled from both ends of each pair.
  const topIdx = Array.from({ length: n }, () => new Int32Array(kk).fill(-1));
  const topSim = Array.from({ length: n }, () => new Float32Array(kk).fill(-Infinity));
  const offer = (i: number, j: number, s: number) => {
    const sims = topSim[i]!;
    if (s <= sims[kk - 1]!) return;
    const idx = topIdx[i]!;
    let at = kk - 1;
    while (at > 0 && sims[at - 1]! < s) {
      sims[at] = sims[at - 1]!;
      idx[at] = idx[at - 1]!;
      at--;
    }
    sims[at] = s;
    idx[at] = j;
  };
  const rowsPerYield = Math.max(1, Math.floor(2_000_000 / Math.max(1, n * d)));
  for (let i = 0; i < n; i++) {
    if (i % rowsPerYield === 0) yield;
    const a = rows[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = rows[j]!;
      let s = 0;
      for (let t = 0; t < d; t++) s += a[t]! * b[t]!;
      offer(i, j, s);
      offer(j, i, s);
    }
  }
  return topIdx.map((idx) => idx.filter((j) => j >= 0));
}

/** First two principal components of `rows` (power iteration with deflation). */
export function pca2(rows: Float32Array[], seed: number): Float64Array {
  const steps = pcaSteps(rows, seed);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

function* pcaSteps(rows: Float32Array[], seed: number): Generator<void, Float64Array> {
  const n = rows.length;
  const d = rows[0]?.length ?? 0;
  const mean = new Float64Array(d);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j]! += r[j]! / n;
  const centred = rows.map((r) => Float64Array.from(r, (x, j) => x - mean[j]!));
  const rand = rng(seed ^ 0x9e3779b9);
  const comps: Float64Array[] = [];
  for (let c = 0; c < 2; c++) {
    let v = Float64Array.from({ length: d }, () => rand() - 0.5);
    for (let it = 0; it < 30; it++) {
      if (it % 5 === 0) yield;
      const next = new Float64Array(d);
      for (const r of centred) {
        let p = 0;
        for (let j = 0; j < d; j++) p += r[j]! * v[j]!;
        for (let j = 0; j < d; j++) next[j]! += p * r[j]!;
      }
      for (const prev of comps) {
        let p = 0;
        for (let j = 0; j < d; j++) p += next[j]! * prev[j]!;
        for (let j = 0; j < d; j++) next[j]! -= p * prev[j]!;
      }
      let norm = 0;
      for (let j = 0; j < d; j++) norm += next[j]! * next[j]!;
      norm = Math.sqrt(norm);
      if (norm < 1e-12) break;
      for (let j = 0; j < d; j++) next[j]! /= norm;
      v = next;
    }
    comps.push(v);
  }
  const out = new Float64Array(n * 2);
  centred.forEach((r, i) => {
    for (let c = 0; c < 2; c++) {
      let p = 0;
      for (let j = 0; j < d; j++) p += r[j]! * comps[c]![j]!;
      out[i * 2 + c] = p;
    }
  });
  return out;
}

// UMAP's curve parameters for min_dist 0.1, spread 1.
const A = 1.577;
const B = 0.895;

const clip = (x: number) => (x > 4 ? 4 : x < -4 ? -4 : x);

/**
 * 2-D coordinates (x0, y0, x1, y1, …, each 0..1) for `vectors`, which should
 * be L2-normalised embeddings of equal length.
 */
export function layoutMap(vectors: Float32Array[], opts: LayoutOptions = {}): Float64Array {
  const steps = layoutSteps(vectors, opts);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * The same layout, giving the event loop a turn every ~20 ms of work so a
 * server stays responsive while a big map is computed.
 */
export async function layoutMapAsync(vectors: Float32Array[], opts: LayoutOptions = {}): Promise<Float64Array> {
  const steps = layoutSteps(vectors, opts);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** The layout as a generator: yields between chunks of work, returns the coordinates. */
function* layoutSteps(vectors: Float32Array[], opts: LayoutOptions): Generator<void, Float64Array> {
  const n = vectors.length;
  const seed = opts.seed ?? 42;
  if (n === 0) return new Float64Array(0);
  if (n === 1) return Float64Array.from([0.5, 0.5]);
  const rows: Float32Array[] = [];
  for (let i = 0; i < n; i += 250) {
    rows.push(...randomProject(vectors.slice(i, i + 250), 48, seed));
    yield;
  }
  const y = yield* pcaSteps(rows, seed);
  scaleTo(y, 10);
  if (n > 3) {
    const knn = yield* neighbourSteps(rows, opts.neighbours ?? 12);
    // Symmetric edge list.
    const seen = new Set<number>();
    const edges: number[] = [];
    knn.forEach((nb, i) =>
      nb.forEach((j) => {
        const key = i < j ? i * n + j : j * n + i;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push(i, j);
      }),
    );
    const epochs = opts.epochs ?? (n > 1000 ? 120 : 200);
    const rand = rng(seed + 1);
    const negatives = 4;
    const perYield = Math.max(1, Math.floor(60_000 / edges.length));
    for (let e = 0; e < epochs; e++) {
      if (e % perYield === 0) yield;
      const alpha = 1 - e / epochs;
      for (let t = 0; t < edges.length; t += 2) {
        const i = edges[t]!;
        const j = edges[t + 1]!;
        let dx = y[i * 2]! - y[j * 2]!;
        let dy = y[i * 2 + 1]! - y[j * 2 + 1]!;
        let d2 = dx * dx + dy * dy;
        if (d2 > 0) {
          const p = Math.pow(d2, B);
          const coef = (-2 * A * B * (p / d2)) / (1 + A * p);
          const gx = clip(coef * dx) * alpha;
          const gy = clip(coef * dy) * alpha;
          y[i * 2]! += gx;
          y[i * 2 + 1]! += gy;
          y[j * 2]! -= gx;
          y[j * 2 + 1]! -= gy;
        }
        for (let s = 0; s < negatives; s++) {
          const k = Math.floor(rand() * n);
          if (k === i) continue;
          dx = y[i * 2]! - y[k * 2]!;
          dy = y[i * 2 + 1]! - y[k * 2 + 1]!;
          d2 = dx * dx + dy * dy;
          const coef = (2 * B) / ((0.001 + d2) * (1 + A * Math.pow(d2, B)));
          y[i * 2]! += (d2 > 0 ? clip(coef * dx) : 4) * alpha;
          y[i * 2 + 1]! += (d2 > 0 ? clip(coef * dy) : 4) * alpha;
        }
      }
    }
  }
  scaleTo(y, 1, 0.02);
  return y;
}

/** Scale x and y together into 0..size (keeping the aspect ratio), with `pad` on each side. */
function scaleTo(y: Float64Array, size: number, pad = 0): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < y.length; i += 2) {
    minX = Math.min(minX, y[i]!);
    maxX = Math.max(maxX, y[i]!);
    minY = Math.min(minY, y[i + 1]!);
    maxY = Math.max(maxY, y[i + 1]!);
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const inner = size * (1 - 2 * pad);
  const offX = size * pad + (inner - ((maxX - minX) / span) * inner) / 2;
  const offY = size * pad + (inner - ((maxY - minY) / span) * inner) / 2;
  for (let i = 0; i < y.length; i += 2) {
    y[i] = offX + ((y[i]! - minX) / span) * inner;
    y[i + 1] = offY + ((y[i + 1]! - minY) / span) * inner;
  }
}
