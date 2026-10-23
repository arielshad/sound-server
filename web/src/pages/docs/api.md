---
layout: ../../layouts/DocsLayout.astro
title: REST API guide
crumb: REST API guide
description: Search music samples across many sites with one REST call, read licence verdicts and credit lines, play previews with CORS, build drum kits and download files.
---

# Sound Server REST API guide

A small JSON API over HTTPS. No key is needed on `https://sound.shep.bot`. Every endpoint is described in the [OpenAPI 3.1 spec](/openapi.json), which you can explore and try in the [interactive reference](/docs/api/reference).

**Base URL:** `https://sound.shep.bot`

## The flow

1. `GET /v1/search`: find candidates across every source.
2. `GET /v1/samples/{id}`: read the licence verdict, credit line, musical facts and files of one result.
3. `GET /v1/samples/{id}/download`: get the file, or a zip with the credits.

Plus `GET /v1/samples/{id}/preview` to play a preview from a browser or Strudel, and `POST /v1/kits` to assemble a drum kit in one call.

## Search

```bash
curl "https://sound.shep.bot/v1/search?q=punchy+kick&category=drums.kick&form=one-shot&commercial=true&limit=10"
```

| Parameter | Description |
| --- | --- |
| `q` | Free text, written like a producer would: `punchy kick`, `dusty snare`, `vocal chop 140 bpm`, `808 in F minor`. BPM, key and form words become filters. May be empty when `category` is set (browse). |
| `category` | Comma-separated dot-path categories. A parent matches its children: `drums` matches `drums.kick` and `drums.hat.closed`. See the `Category` schema for the full list (drums.kick, drums.snare, drums.clap, drums.hat.closed, bass.808, vocals.chop, fx.riser, fx.impact, foley, ambience, keys, synth.pad…). |
| `form` | Comma-separated: `one-shot`, `loop`, `phrase`, `multisample`, `pack`, `midi`, `preset`. |
| `bpm` | `140` or a range `120-128`. Half and double time also match. |
| `key` | `F minor`, `F#m`, `Eb`, `A major`. Relative major/minor also match. |
| `min_duration`, `max_duration` | Length in seconds (e.g. `max_duration=2` for drum one-shots). |
| `commercial` | `true`: only samples whose licence allows a commercial release (verdict `yes` or `yes-with-credit`). |
| `free` | `true`: exclude paid samples and packs. |
| `downloadable` | `true`: only samples this server can download directly. |
| `strict` | `true`: drop samples whose BPM, key or form is unknown when you filter on them (by default they are kept, ranked lower). |
| `providers` | Comma-separated source ids from `/v1/providers`, e.g. `freesound,openverse`. |
| `limit` | Max results, 1–100 (default 24). |
| `offset` | Per-source offset for the next page (e.g. `24`). |

The response (shortened):

```json
{
  "query": "punchy kick",
  "filters": { "categories": ["drums.kick"], "forms": ["one-shot"], "commercialOnly": true },
  "results": [
    {
      "id": "freesound:2086",
      "provider": "freesound",
      "title": "Punchy Kick 01",
      "url": "https://freesound.org/s/2086/",
      "author": "someone",
      "category": "drums.kick",
      "form": "one-shot",
      "durationSec": 0.42,
      "previewUrl": "https://cdn.freesound.org/previews/2/2086_23-hq.mp3",
      "license": {
        "id": "CC-BY-4.0", "name": "CC BY 4.0", "assertedBy": "source",
        "attributionRequired": true, "verdict": "yes-with-credit",
        "note": "Credit the author in your release notes or description."
      },
      "attribution": "“Punchy Kick 01” by someone (Freesound), https://freesound.org/s/2086/, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
      "requiresAccount": true,
      "downloadable": true
    }
  ],
  "providers": [
    { "provider": "freesound", "name": "Freesound", "status": "ok", "count": 10, "total": 1843, "tookMs": 412 },
    { "provider": "splice", "name": "Splice", "status": "link", "count": 0, "searchUrl": "https://splice.com/sounds/search?q=punchy+kick" }
  ]
}
```

## Licence verdicts

Every `license` has a `verdict` that answers one question: can this go into a commercially released track?

| `verdict` | Meaning |
| --- | --- |
| `yes` | Commercial use OK, no credit required (CC0, public domain, royalty free). |
| `yes-with-credit` | Commercial use OK with a credit line: use `attribution`. |
| `restricted` | Conditions that usually rule out a normal release (share-alike, Sampling+). |
| `clearance-required` | A real recording that needs paid clearance per release. |
| `check-terms` | Unclear: no licence stated, uploader-asserted, or subscription terms. |
| `no` | Non-commercial only. |

`license.assertedBy` says who stated it: `source` (the site records it per item), `site` (one licence for the whole site) or `uploader` (an unverified claim; such licences are never better than `check-terms`). More in [Sample licences explained](/docs/licences).

## Sample details

```bash
curl "https://sound.shep.bot/v1/samples/freesound:2086"
```

Returns the sample plus `files[]` (each with `url`, `filename`, `format`, `role` (`original`, `preview`, `pack`, `stem`, `midi`), `sampleRate`, `bitDepth`, `channels`, `sizeBytes`, and `requiresAuth` when it needs an account on the source) and a `shareUrl` that opens it on the website.

## Choose files

```bash
curl "https://sound.shep.bot/v1/samples/freesound:2086/files?format=wav"
```

The files a download would contain for a `format` (`wav`, `aiff`, `flac`, `ogg`, `mp3`, `zip`) or `role`, with `totalBytes`, the licence and the credit line. `all=true` returns everything.

## Download

```bash
curl -L -o kick.zip "https://sound.shep.bot/v1/samples/freesound:2086/download?bundle=true"
```

A single plain file answers with a `302` redirect to the source (so use `-L`). Several files, files that need source headers, or `bundle=true` stream one zip with `ATTRIBUTION.md` and `credits.json` next to the audio. The response carries `X-License` and `X-Attribution` headers. Samples without direct downloads answer `409` with the sample's `url` and `requiresAccount`. The original from Freesound needs a Freesound account: send your own OAuth token as `x-freesound-token`, otherwise only the preview is available.

## Previews

```bash
curl -L "https://sound.shep.bot/v1/samples/freesound:2086/preview" -o preview.mp3
```

Redirects to the source's preview. Sources whose previews need a `Referer`, or `?proxy=1`, are streamed through this server with `Access-Control-Allow-Origin: *`, so browser players, Web Audio and [Strudel](https://strudel.cc) can load them. Only previews are proxied, capped in size: this is not a general proxy.

## Build a kit

```bash
curl -X POST "https://sound.shep.bot/v1/kits" -H "content-type: application/json" \
  -d '{"style":"dark trap","bpm":140,"key":"F minor","slots":["kick","snare","clap","hat.closed","hat.open","808"]}'
```

One pick per slot with alternatives and the reason it was chosen, warnings, a count of picks per verdict, the credit lines, a Strudel sample map and snippet (pointing at the preview proxy, so it plays in strudel.cc as is) and a General MIDI / SFZ drum map. `commercialOnly` defaults to `true`; `perSlot` sets the number of alternatives (0–5). The [kit builder](/kit) is a page on top of this endpoint.

## List sources

```bash
curl "https://sound.shep.bot/v1/providers"
```

## Usage statistics and source health

```bash
curl "https://sound.shep.bot/v1/stats"
```

Aggregate usage (searches by surface, downloads, MCP tool calls, top clients and categories) for the last 24 hours and 7 days, plus each source's success rate and p50/p95 latency. The same data is on the [statistics](/stats) page. `GET /v1/catalog` returns the daily count of what each source holds.

## Examples

### JavaScript / TypeScript

```ts
const base = "https://sound.shep.bot";
const res = await fetch(`${base}/v1/search?` + new URLSearchParams({ q: "riser", category: "fx.riser", commercial: "true" }));
const { results } = await res.json();
const pick = results.find((s) => s.downloadable);
console.log(pick.title, pick.license.verdict, pick.attribution ?? "no credit needed");
new Audio(`${base}/v1/samples/${encodeURIComponent(pick.id)}/preview`).play();
```

### Python

```python
import requests

base = "https://sound.shep.bot"
r = requests.get(f"{base}/v1/search", params={"q": "808", "key": "F minor", "commercial": "true"})
sample = next(s for s in r.json()["results"] if s["downloadable"])

with requests.get(f"{base}/v1/samples/{sample['id']}/download", params={"bundle": "true"}, stream=True) as dl:
    dl.raise_for_status()
    with open("808.zip", "wb") as f:
        for chunk in dl.iter_content(1 << 16):
            f.write(chunk)
```

## Errors

Errors are JSON: `{ "error": "message" }`.

| Status | Meaning |
| --- | --- |
| `400` | Bad parameter (e.g. an unreadable `bpm` or `key`) or unknown source id. |
| `401` | API key required (self-hosted servers with `SOUND_SERVER_API_KEY` only). |
| `404` | Unknown sample, or no file matches the format/role. |
| `409` | The source has no direct downloads; use the returned `url`. |
| `429` | Rate limit exceeded; wait `Retry-After` seconds. |
| `502` | The source site failed. |

## Authentication (self-hosted)

The public server is open. If you run your own with `SOUND_SERVER_API_KEY`, send the key as `Authorization: Bearer <key>` or `x-api-key: <key>`. Keys are accepted in headers only, never as a URL parameter, so they stay out of logs, browser history and `Referer` headers.

## Rate limits and versioning

The public server allows 120 requests per minute per client. Every response carries `RateLimit-Policy` and `RateLimit` headers (plus `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`); going over returns `429` with `Retry-After`. The API is versioned in the path (`/v1`), only grows additively within a version, and announces deprecations with `Deprecation` and `Sunset` headers at least 90 days ahead. Details: [Versioning, deprecation & rate limits](/docs/api/versioning).

## Fair use

Cache results on your side for repeated queries, keep requests to a human pace, and respect each sample's licence. The server already caches source responses for a few minutes and deduplicates identical in-flight requests. Sound Server is a free, non-commercial service and does not re-host or resell sounds.
