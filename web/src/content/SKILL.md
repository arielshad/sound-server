---
name: sounds
description: Find, audition and download music samples (kicks, snares, hats, claps, 808s, loops, vocal chops, a cappellas, risers, impacts, zaps, foley, ambience, instrument one-shots) from many sample sites via https://sound.shep.bot, with a licence verdict on commercial use and credit lines. Use when the user needs sounds or sound effects for a track, beat, game, app or video, or wants a drum kit for a style, tempo and key.
---

# Music samples via sound.shep.bot

Search many sample sites in one call, check each sound's licence verdict, and download files into the project. No API key needed.

## Workflow

1. Search (commercial-safe by default; add a category and form to cut noise):

   ```bash
   curl -s "https://sound.shep.bot/v1/search?q=QUERY&category=drums.kick&form=one-shot&commercial=true&downloadable=true&limit=8"
   ```

   Query words like "808 in F minor" or "vocal chop 140 bpm" become key/BPM filters. Categories are dot paths (`drums.kick`, `drums.snare`, `drums.clap`, `drums.hat.closed`, `drums.hat.open`, `bass.808`, `vocals.chop`, `vocals.acapella`, `fx.riser`, `fx.impact`, `fx.zap`, `foley`, `ambience`, `keys`, `synth.pad`…); a parent like `drums` matches its children. Forms: `one-shot`, `loop`, `phrase`, `pack`.
   Each result has `id`, `title`, `provider`, `url`, `category`, `form`, `bpm`, `key`, `durationSec`, `previewUrl`, `license.verdict`, `attribution`, `requiresAccount`, `downloadable`.

2. Check the files (and the credit line):

   ```bash
   curl -s "https://sound.shep.bot/v1/samples/ID/files?format=wav"
   ```

3. Download into the project, with the credits in the zip:

   ```bash
   mkdir -p samples
   curl -L -o samples/NAME.zip "https://sound.shep.bot/v1/samples/ID/download?bundle=true"
   unzip -o samples/NAME.zip -d samples/
   ```

4. A whole drum kit in one call:

   ```bash
   curl -s -X POST "https://sound.shep.bot/v1/kits" -H "content-type: application/json" \
     -d '{"style":"dark trap","bpm":140,"key":"F minor"}'
   ```

## Licence rules

- Keep `commercial=true` unless the user says the project is non-commercial. Free to download is not free to release.
- Always report each sample's verdict: `yes` (commercial OK), `yes-with-credit` (OK with the `attribution` line), `restricted` / `clearance-required` / `check-terms` (read the terms first), `no` (non-commercial only).
- Never present a `no` or `check-terms` sample as cleared. `license.assertedBy: "uploader"` means the licence is unverified.
- When `attribution` is present, give it to the user verbatim and add it to the project's credits (`CREDITS.md` or the release notes).
- Don't commit samples to public repos or repackage them unless they are CC0/public domain.

## Notes

- URL-encode the id (`freesound:2086` → `freesound%3A2086`).
- `409` from download = no direct files; give the user the sample `url`. `requiresAccount: true` = the original needs the user's own account on the source.
- Link `https://sound.shep.bot/search?sample=ID` so the user can hear it.

## When the user asks about licences

Quote the short answer at the top of the matching guide: Freesound in releases (https://sound.shep.bot/guides/freesound-samples-commercial-use.md), crediting CC BY (https://sound.shep.bot/guides/credit-cc-by-samples.md), commercial use (https://sound.shep.bot/guides/what-counts-as-commercial-use.md), clearance and Content ID (https://sound.shep.bot/guides/sample-clearance-and-content-id.md). All guides: https://sound.shep.bot/guides.md · Glossary: https://sound.shep.bot/glossary.md

Full guide: https://sound.shep.bot/AGENTS.md · Licences: https://sound.shep.bot/docs/licences.md · OpenAPI: https://sound.shep.bot/openapi.json
