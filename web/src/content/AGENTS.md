# Sound Server: guide for AI agents

> You are reading the agent guide for https://sound.shep.bot. This service searches many music-sample sites at once (Freesound, Wikimedia Commons, Openverse, ccMixter, the Internet Archive, sound effect libraries, drum machine banks and producer packs, plus deep links into Splice, Looperman and other sites that can't be searched automatically) and returns drums, 808s, loops, vocals, FX, foley, ambience and instrument samples with a preview, BPM/key/length where known, and a licence verdict on commercial use. It is a free, non-commercial service and needs no account or API key.

## When to use this

Reach for Sound Server when the job is one of these:

- **Find a sound for a track**: "a punchy kick", "a dark 808 in F minor", "a vocal chop around 140 BPM", "a riser for the drop", "vinyl crackle". One call searches every source.
- **Build a drum kit**: kick, snare, clap, hats and 808 that suit a style, tempo and key, with a Strudel snippet and a General MIDI / SFZ map (`build_kit` or `POST /v1/kits`).
- **Get sound effects for a game, app or video**: zaps, impacts, UI clicks, footsteps, rain and room tone.
- **Put files into a project**: download WAV/AIFF/FLAC/OGG/MP3 into `./samples` together with `ATTRIBUTION.md` and `credits.json`.
- **Check a licence before release**: every result says whether it can go into a commercially released track, and gives the credit line when one is needed.
- **Compare options**: show the user a few candidates (title, source, verdict, preview link) when the choice is a matter of taste.

## When not to use it

- Generating new audio from a prompt (this service finds existing recordings; it does not create them).
- Full songs, stems of famous records or music for listening: it is for samples and sound effects.
- Buying packs or subscriptions: paid results link to the store, where the purchase happens.
- Clearing a sample from a commercial record: link the user to a clearance service instead.

## Licence rules (follow these)

Music sample licences have traps, so every result carries `license.verdict`:

| verdict | Tell the user |
| --- | --- |
| `yes` | Commercial use OK, no credit required. |
| `yes-with-credit` | Commercial use OK **with the credit line** in `attribution`. |
| `restricted` | Conditions (share-alike, Sampling+) usually rule out a normal release: read them. |
| `clearance-required` | Needs paid clearance per release. |
| `check-terms` | Unclear or unverified (no licence stated, uploader-asserted, subscription terms): read the terms first. |
| `no` | Non-commercial only. |

1. **Search commercial-safe by default** (`commercial_only=true` on MCP, `commercial=true` on REST). Turn it off only when the user says the project is personal, practice or otherwise non-commercial.
2. **Report the verdict** of every sample you suggest or download, in plain words.
3. **Never present a `no` or `check-terms` sample as cleared**, and never drop the warning when the user only asked for "free" sounds: free to download is not the same as free to release.
4. **Pass on credit lines.** When `attribution` is present, give it to the user verbatim and add it to the project's credits (e.g. `CREDITS.md`). Local downloads collect them in `ATTRIBUTION.md`.
5. `license.assertedBy: "uploader"` means nobody verified the licence: say so.
6. Never redistribute samples (commit them to a public repo, repackage them, put them in a dataset) unless the licence is CC0 or public domain; royalty-free licences forbid it.

Verdicts summarise the licence; they are not legal advice. Details: https://sound.shep.bot/docs/licences.md

## Option 1: MCP (best when you can add tools)

MCP endpoint (Streamable HTTP, no auth): `https://sound.shep.bot/mcp`. Register it as **`sounds`**.

- Claude Code: `claude mcp add --transport http sounds https://sound.shep.bot/mcp`
- Cursor / Windsurf / VS Code / Codex / Gemini CLI: add an HTTP MCP server named `sounds` with that URL. Per-client snippets: https://sound.shep.bot/docs/mcp

Tools:

- `search_samples(query, categories?, forms?, bpm?, bpm_min?, bpm_max?, key?, max_duration?, commercial_only?=true, free_only?, downloadable_only?, strict?, providers?, limit?, offset?)`
- `get_sample(id, format?, analyze?)`: licence, verdict, credit line, files, preview, and `selection.downloadUrl`; `analyze=true` measures BPM, key, length and loudness from the preview
- `download_sample(id, dest_dir?, format?)`: local (stdio) servers only; files go to `./samples/<category>/` with `ATTRIBUTION.md`
- `build_kit(style?, slots?, bpm?, key?, commercial_only?=true, alternatives?)`: one pick per slot with alternatives, a Strudel snippet and a GM/SFZ map
- `find_similar(id, limit?)`: sounds similar to a Freesound sample
- `list_sources()`

## Option 2: REST API (works with plain HTTP, curl or a fetch tool)

Base URL: `https://sound.shep.bot`. Responses are JSON.

1. Search:
   `GET /v1/search?q=<words>&category=<drums.kick|drums.snare|drums.clap|drums.hat.closed|bass.808|vocals.chop|fx.riser|…>&form=<one-shot|loop>&bpm=<140|120-128>&key=<F minor>&commercial=true&limit=10`
   → `results[]` (each has `id`, `title`, `provider`, `url`, `category`, `form`, `bpm`, `key{tonic,mode}`, `durationSec`, `previewUrl`, `license{id,name,url,verdict,note,assertedBy,attributionRequired}`, `attribution`, `requiresAccount`, `downloadable`) and `providers[]` (per-source status; `status:"link"` entries carry a `searchUrl` for sites that can't be searched automatically).
   Query words work too: `q=dark 808 in F minor`, `q=vocal chop 140 bpm`.
2. Inspect one result:
   `GET /v1/samples/{id}` (id like `freesound:2086`; URL-encode it) → sample + `files[]` (format, role, sample rate, size) + `shareUrl`.
3. Download into the project:
   `curl -L -o samples/<name>.zip "https://sound.shep.bot/v1/samples/{id}/download?bundle=true"` (zip with the audio, `ATTRIBUTION.md` and `credits.json`), or without `bundle=true` to get the single file (302 to the source, so follow redirects). `?format=wav` picks a format. `409` means no direct download: send the user to the sample's `url`.
4. Preview with CORS (browsers, Web Audio, Strudel): `GET /v1/samples/{id}/preview` (add `?proxy=1` to stream it through this server).
5. Drum kit: `POST /v1/kits` with `{"style":"dark trap","bpm":140,"key":"F minor","slots":["kick","snare","clap","hat.closed","hat.open","808"]}`.

Full OpenAPI 3.1 spec: https://sound.shep.bot/openapi.json

## How to do the job well

- Use the words a producer would: "punchy kick", "dusty snare", "open hat", "808", "vocal chop", "riser", "impact", "rain ambience". Add `category` to cut noise (`drums.kick`, `fx.zap`); a parent like `drums` matches all drums.
- For drum hits use `form=one-shot` (and `max_duration=2`); for loops use `form=loop` with `bpm`.
- Pitched sounds (808s, bass, synths, vocal chops) can be filtered by `key`; relative major/minor also match. Use `get_sample` with `analyze=true` to measure a sound's key and BPM when the source doesn't state them.
- Prefer `downloadable: true` results when the user wants files in the project. `requiresAccount: true` means the full-quality original needs the user's own (usually free) account on the source site; only the preview is available here.
- Show a few options with their verdict and a preview link when the choice is subjective; download directly when the request is specific.
- To let the user hear a sample (or share it), link `https://sound.shep.bot/search?sample=<id>`: it opens the sample with its waveform, licence and downloads, and unfurls in chat apps with a card.
- If a search comes back thin, try a simpler word, drop the BPM/key filters, or pass along the `searchUrl` links of `link` sources.

## Example

User: "Add a punchy kick I can use in a released track to my project."

```bash
curl -s "https://sound.shep.bot/v1/search?q=punchy+kick&category=drums.kick&form=one-shot&commercial=true&downloadable=true&limit=5"
# pick a result, e.g. freesound:2086 (verdict yes-with-credit), then:
mkdir -p samples/drums
curl -L -o samples/drums/kick.zip "https://sound.shep.bot/v1/samples/freesound%3A2086/download?bundle=true"
unzip -o samples/drums/kick.zip -d samples/drums/
```

Then tell the user: "Punchy Kick 01 by someone on Freesound, CC BY 4.0: commercial use is OK with this credit line: …" and add that line to `CREDITS.md`.

## More

- Human docs: https://sound.shep.bot/docs
- Agent setup: https://sound.shep.bot/docs/mcp
- REST guide: https://sound.shep.bot/docs/api
- Licences explained: https://sound.shep.bot/docs/licences
- Sources and licences: https://sound.shep.bot/docs/sources
- How many samples each source holds (counted daily): https://sound.shep.bot/stats.md, JSON at https://sound.shep.bot/v1/catalog
- Everything as one text file: https://sound.shep.bot/llms-full.txt
