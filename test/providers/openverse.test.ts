import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openverse, resetOpenverseToken } from "../../src/providers/openverse.js";
import type { HttpRequestInit, ProviderContext, SampleQuery } from "../../src/core/types.js";
import { fixtureHttp } from "../helpers.js";

type Route = [string | RegExp, string];

const FS_ID = "03fa3080-bcb3-423f-a781-47dc20bedd59";
const WM_ID = "e497e069-1b73-4b9a-8ec3-b7fc2f9f4777";

const routes: Route[] = [
  ["/v1/auth_tokens/token/", "openverse/token.json"],
  ["/v1/audio/stats/", "openverse/stats.json"],
  [`/v1/audio/${FS_ID}/`, "openverse/detail_freesound.json"],
  [`/v1/audio/${WM_ID}/`, "openverse/detail_wikimedia.json"],
  [/\/v1\/audio\/\?q=kick\+drum/, "openverse/search_wikimedia.json"],
  [/\/v1\/audio\/\?q=kick/, "openverse/search_kick.json"],
  [/\/v1\/audio\/\?q=zzqx/, "openverse/empty.json"],
];

function ctxWith(r: Route[] = routes) {
  const http = fixtureHttp(r);
  const calls: { url: string; init: HttpRequestInit }[] = [];
  const rec = (url: string, init?: HttpRequestInit) => calls.push({ url, init: init ?? {} });
  const ctx: ProviderContext = {
    fetch: {
      json: async <T>(url: string, init?: HttpRequestInit) => (rec(url, init), http.json<T>(url, init)),
      text: async (url, init) => (rec(url, init), http.text(url, init)),
      raw: async (url, init) => (rec(url, init), http.raw(url, init)),
    },
  };
  return { ctx, calls };
}

const q = (over: Partial<SampleQuery> = {}): SampleQuery => ({ query: "kick", limit: 10, ...over });

beforeEach(() => {
  resetOpenverseToken();
  vi.stubEnv("OPENVERSE_CLIENT_ID", "");
  vi.stubEnv("OPENVERSE_CLIENT_SECRET", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("openverse", () => {
  it("searches Freesound + Wikimedia anonymously and maps Freesound items", async () => {
    const { ctx, calls } = ctxWith();
    const r = await openverse.search(q(), ctx);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/audio/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "kick",
      source: "freesound,wikimedia_audio",
      filter_dead: "false",
      page_size: "10",
      page: "1",
    });
    expect(calls[0]!.init.headers).toBeUndefined();
    expect(r.total).toBe(240);
    expect(r.samples).toHaveLength(7);

    const zealous = r.samples.find((s) => s.title === "Kick J.Zealous Hard Club.aif")!;
    expect(zealous).toMatchObject({
      id: "openverse:755251e1-6e09-47b3-9bcd-c49f1484a98a",
      provider: "openverse",
      url: "https://freesound.org/people/J_Zealous/sounds/331589",
      author: "J_Zealous",
      authorUrl: "https://freesound.org/people/J_Zealous",
      category: "drums.kick",
      previewUrl: "https://cdn.freesound.org/previews/331/331589_5820980-hq.mp3",
      license: { id: "CC0-1.0", verdict: "yes" },
      sameAs: ["freesound:331589"],
      durationSec: 2.243,
      sampleRate: 44100,
      formats: ["mp3", "aiff"],
      downloadable: true,
      requiresAccount: true,
    });
    expect(zealous.attribution).toMatch(/^"Kick J\.Zealous Hard Club\.aif" by J_Zealous is marked with CC0 1\.0/);
    expect(zealous.tags).toContain("kickdrum");

    const nc = r.samples.find((s) => s.title === "kick wump.wav")!;
    expect(nc.license).toMatchObject({ id: "CC-BY-NC-4.0", verdict: "no" });
    expect(nc.sameAs).toEqual(["freesound:772"]);
    const by = r.samples.find((s) => s.title === "DNB KICK 008.wav")!;
    expect(by.license).toMatchObject({ id: "CC-BY-4.0", verdict: "yes-with-credit" });
    expect(by.attribution).toContain('"DNB KICK 008.wav" by sandyrb is licensed under CC BY 4.0');
    expect(r.searchUrl).toBe("https://openverse.org/search/audio?q=kick&source=freesound%2Cwikimedia_audio");
  });

  it("maps Wikimedia items: original file, mp3 transcode preview, Commons sameAs", async () => {
    const { ctx } = ctxWith();
    const r = await openverse.search(q({ query: "kick drum" }), ctx);
    const wav = r.samples.find((s) => s.nativeId === WM_ID)!;
    expect(wav).toMatchObject({
      title: "Drums opening and closing a noise gate on a synth pad",
      url: "https://commons.wikimedia.org/w/index.php?curid=190713826",
      license: { id: "CC-BY-SA-4.0", verdict: "restricted" },
      sameAs: ["wikimediacommons:Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav"],
      previewUrl:
        "https://upload.wikimedia.org/wikipedia/commons/transcoded/5/5d/Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav/Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav.mp3",
      formats: ["wav"],
      sampleRate: 48000,
      durationSec: 21.714,
      downloadable: true,
      requiresAccount: false,
    });
    const ogg = r.samples.find((s) => s.formats?.includes("ogg"))!;
    expect(ogg.previewUrl).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/8\/85\/Gated_reverb.*\.ogg$/);
    expect(ogg.previewUrl).not.toContain("utm_");
    const flac = r.samples.find((s) => s.formats?.includes("flac"))!;
    expect(flac.previewUrl).toMatch(/\/transcoded\/.*\.flac\.mp3$/);
  });

  it("maps filters: commercial licences, short sounds, paging", async () => {
    const a = ctxWith();
    await openverse.search(q({ commercialOnly: true, forms: ["one-shot"], limit: 50, offset: 40 }), a.ctx);
    const p = new URL(a.calls[0]!.url).searchParams;
    expect(p.get("license")).toBe("cc0,pdm,by");
    expect(p.get("length")).toBe("shortest");
    expect(p.get("page_size")).toBe("20");
    expect(p.get("page")).toBe("3");
    expect(openverse.buildSearchUrl(q({ commercialOnly: true }))).toContain("license=cc0%2Cpdm%2Cby");

    const b = ctxWith();
    await openverse.search(q({ forms: ["one-shot", "loop"], maxDurationSec: 60 }), b.ctx);
    expect(new URL(b.calls[0]!.url).searchParams.get("length")).toBeNull();
    const c = ctxWith();
    await openverse.search(q({ maxDurationSec: 10 }), c.ctx);
    expect(new URL(c.calls[0]!.url).searchParams.get("length")).toBe("shortest");
    expect(openverse.nativeFilters).toContain("commercialOnly");
  });

  it("does not page past the anonymous 240-result cap", async () => {
    const { ctx, calls } = ctxWith();
    const r = await openverse.search(q({ offset: 240 }), ctx);
    expect(r.samples).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("returns no samples for no results", async () => {
    const { ctx } = ctxWith();
    const r = await openverse.search(q({ query: "zzqx" }), ctx);
    expect(r).toMatchObject({ samples: [], total: 0 });
  });

  it("uses an OAuth client token when configured, and caches it", async () => {
    vi.stubEnv("OPENVERSE_CLIENT_ID", "cid");
    vi.stubEnv("OPENVERSE_CLIENT_SECRET", "csecret");
    const { ctx, calls } = ctxWith();
    await openverse.search(q({ limit: 40 }), ctx);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://api.openverse.org/v1/auth_tokens/token/");
    expect(calls[0]!.init).toMatchObject({ method: "POST", cacheTtlMs: 0 });
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.init.body))).toEqual({
      grant_type: "client_credentials",
      client_id: "cid",
      client_secret: "csecret",
    });
    expect(calls[1]!.init.headers).toEqual({ authorization: "Bearer ov_test_access_token" });
    expect(new URL(calls[1]!.url).searchParams.get("page_size")).toBe("40");

    await openverse.search(q(), ctx);
    expect(calls).toHaveLength(3); // token reused
    expect(calls[2]!.init.headers).toEqual({ authorization: "Bearer ov_test_access_token" });
  });

  it("falls back to anonymous when the token call fails", async () => {
    vi.stubEnv("OPENVERSE_CLIENT_ID", "cid");
    vi.stubEnv("OPENVERSE_CLIENT_SECRET", "csecret");
    const { ctx, calls } = ctxWith(routes.filter(([m]) => m !== "/v1/auth_tokens/token/"));
    const r = await openverse.search(q(), ctx);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(calls[1]!.init.headers).toBeUndefined();
  });

  it("getSample for a Freesound item: preview plus the OAuth-only original", async () => {
    const { ctx, calls } = ctxWith();
    const d = await openverse.getSample!(FS_ID, ctx);
    expect(calls).toHaveLength(1);
    expect(d).toMatchObject({ title: "Snare 4.wav", sameAs: ["freesound:26903"], license: { id: "CC-BY-3.0" } });
    expect(d!.files).toEqual([
      { url: "https://cdn.freesound.org/previews/26/26903_113878-hq.mp3", filename: "26903_113878-hq.mp3", format: "mp3", role: "preview", sizeBytes: 10384 },
      {
        url: "https://freesound.org/apiv2/sounds/26903/download/",
        filename: "Snare 4.wav",
        format: "wav",
        role: "original",
        sampleRate: 44100,
        sizeBytes: 70620,
        requiresAuth: true,
      },
    ]);
  });

  it("getSample for a Wikimedia item: the original file and an mp3 transcode", async () => {
    const d = await openverse.getSample!(WM_ID, ctxWith().ctx);
    expect(d!.files).toEqual([
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/5/5d/Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav",
        filename: "Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav",
        format: "wav",
        role: "original",
        sampleRate: 48000,
        sizeBytes: 6254514,
      },
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/transcoded/5/5d/Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav/Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav.mp3",
        filename: "Drums_opening_and_closing_a_noise_gate_on_a_synth_pad.wav.mp3",
        format: "mp3",
        role: "preview",
      },
    ]);
    expect(d!.files.every((f) => !f.requiresAuth && !f.headers)).toBe(true);
  });

  it("getSample returns null for bad and unknown ids", async () => {
    const { ctx, calls } = ctxWith();
    expect(await openverse.getSample!("not-a-uuid", ctx)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await openverse.getSample!("00000000-0000-0000-0000-000000000000", ctx)).toBeNull();
  });

  it("counts the searched sources from /audio/stats/", async () => {
    const { ctx, calls } = ctxWith();
    const c = await openverse.census!(ctx);
    expect(calls).toHaveLength(1);
    expect(c.total).toBe(591_897 + 3_983_517);
    expect(c.categories).toMatchObject({ Freesound: 591_897, "Wikimedia Commons": 3_983_517, Jamendo: 644_709 });
  });
});
