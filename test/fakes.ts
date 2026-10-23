import { creativeCommons, license } from "../src/core/licence.js";
import type { HttpClient, Provider, SampleDetails } from "../src/core/types.js";
import { filterLocal, makeSample, paginate } from "../src/core/util.js";

/** A CC0 kick with an original WAV and an MP3 preview. */
export const KICK: SampleDetails = {
  ...makeSample({
    provider: "fake",
    nativeId: "kick",
    title: "Deep Kick 01",
    tags: ["kick", "808", "drums"],
    url: "https://fake.example/kick",
    previewUrl: "https://cdn.fake.example/kick.mp3",
    license: license("CC0-1.0"),
    price: { free: true },
    durationSec: 0.42,
    downloadable: true,
  }),
  files: [
    { url: "https://cdn.fake.example/kick.mp3", filename: "kick.mp3", format: "mp3", role: "preview", sizeBytes: 4 },
    { url: "https://cdn.fake.example/kick.wav", filename: "kick.wav", format: "wav", role: "original", sampleRate: 44100, bitDepth: 24, sizeBytes: 4 },
    { url: "https://cdn.fake.example/kick.flac", filename: "kick.flac", format: "flac", role: "original", sizeBytes: 4 },
  ],
};

/** A CC BY-NC vocal loop: never commercial-safe. */
export const VOCAL: SampleDetails = {
  ...makeSample({
    provider: "fake",
    nativeId: "vocal",
    title: "Vocal Chop Loop 140 BPM F minor",
    tags: ["vocal", "chop"],
    url: "https://fake.example/vocal",
    previewUrl: "https://cdn.fake.example/vocal.mp3",
    license: creativeCommons({ nc: true }),
    price: { free: true },
    durationSec: 6.9,
    downloadable: true,
  }),
  files: [{ url: "https://cdn.fake.example/vocal.wav", filename: "vocal.wav", format: "wav", role: "original", sizeBytes: 4 }],
};

/** A pack that needs a login to download. */
const PACK = makeSample({
  provider: "fake",
  nativeId: "pack",
  title: "Trap Drum Kit",
  tags: ["trap", "drum kit"],
  url: "https://fake.example/pack",
  license: license("CC0-1.0"),
  price: { free: true },
  downloadable: false,
});

export const fakeProvider: Provider = {
  id: "fake",
  name: "Fake",
  homepage: "https://fake.example",
  description: "Test provider",
  categories: ["drums", "vocals"],
  access: "api",
  pricing: "free",
  supportsDownload: true,
  buildSearchUrl: (q) => `https://fake.example/search?q=${encodeURIComponent(q.query)}`,
  async search(q) {
    const items = filterLocal([KICK, VOCAL, PACK], q);
    return { samples: paginate(items, q), total: items.length };
  },
  async getSample(id) {
    return id === "kick" ? KICK : id === "vocal" ? VOCAL : null;
  },
};

export const brokenProvider: Provider = {
  ...fakeProvider,
  id: "broken",
  name: "Broken",
  getSample: undefined,
  async search() {
    throw new Error("boom");
  },
};

export const slowProvider: Provider = {
  ...fakeProvider,
  id: "slow",
  name: "Slow",
  search: () => new Promise(() => undefined),
};

/** HttpClient that serves the bytes "data:<file>" for any URL and records requests. */
export function bytesHttp(): HttpClient & { requests: string[] } {
  const requests: string[] = [];
  const body = (url: string) => new TextEncoder().encode(`data:${url.slice(url.lastIndexOf("/") + 1)}`);
  return {
    requests,
    async raw(url) {
      requests.push(url);
      return new Response(body(url));
    },
    async text(url) {
      requests.push(url);
      return new TextDecoder().decode(body(url));
    },
    async json() {
      throw new Error("not used");
    },
  };
}
