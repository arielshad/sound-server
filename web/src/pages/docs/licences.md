---
layout: ../../layouts/DocsLayout.astro
title: Sample licences explained
crumb: Sample licences explained
description: What CC0, CC BY, share-alike, NC, ND, Sampling+ and royalty-free licences mean for music samples, how credit lines work, and how Sound Server decides each verdict.
---

# Sample licences explained

A sample is only useful if you can release the music you make with it. Licences for sounds are written for many uses (films, games, archives, remixes), so the same words mean different things for a producer. This page explains the licences you will meet on free sample sites, what each one means for a track you release, and how Sound Server turns them into one verdict per sound.

This is a practical guide, not legal advice. When a release matters, read the licence itself (every result links to it) and, for anything large, ask a lawyer.

## The verdicts

Every result carries a `verdict` that answers one question: **can this go into a commercially released track?** "Commercial" includes selling the track, streaming it on paid platforms and putting it in a monetised video.

| Badge | `verdict` | What you can do |
| --- | --- | --- |
| Commercial use OK | `yes` | Use it in a release. No credit required. |
| Commercial use OK with credit | `yes-with-credit` | Use it in a release and credit the author. |
| Restricted: read the conditions | `restricted` | Commercial use comes with conditions that usually rule out a normal release. |
| Needs paid clearance per release | `clearance-required` | A real recording whose owners clear each release, usually for a fee. |
| Unclear: check the terms | `check-terms` | Nobody verified the licence. Read the terms first. |
| Non-commercial only | `no` | Practice, study and personal projects only. |

The **Commercial-safe** switch on the search page, `commercial=true` on the API and the MCP default (`commercial_only=true`) keep only the first two.

## Public domain and CC0

**CC0** is a waiver: the creator gives up their rights as far as the law allows. Sounds marked **public domain** have no owner to ask. Both are verdict `yes`: use them, change them, release them, no credit needed. Crediting the recordist is still good manners.

## CC BY: credit the author

**CC BY** (Attribution) allows commercial use as long as you give credit. For music that means naming the sound, its author, where it came from and the licence, in a place listeners can find: release notes, a Bandcamp or YouTube description, the credits of a game. Verdict: `yes-with-credit`.

Sound Server builds the credit line for you. It looks like this:

```text
“Deep Kick 01” by Jane Doe (Freesound), https://freesound.org/s/123456/, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
```

Copy it from the detail view, take it from the `attribution` field of the API, or download with `bundle=true` to get `ATTRIBUTION.md` and `credits.json` with every sound. Local MCP downloads keep one `ATTRIBUTION.md` per folder, so the credits for a release are in one place.

## Share-alike (BY-SA): your track inherits the licence

**CC BY-SA** allows commercial use, but anything you make from the sound must be released under the same licence. For a song, that arguably means the whole track has to be CC BY-SA, so anyone could reuse it commercially. Labels and distributors usually won't accept that. Verdict: `restricted`. Fine for open projects that are happy to be CC BY-SA themselves.

## Non-commercial (NC)

**CC BY-NC**, **BY-NC-SA** and similar licences forbid commercial use. A track on Spotify, a paid download, a beat you lease or a monetised YouTube video are all commercial. Verdict: `no`. Use these for practice, sketches and study, then replace them before release. Some broadcaster archives, such as the BBC's RemArc licence, are personal and educational use only and get the same verdict.

## No derivatives (ND)

**CC BY-ND** lets people share the sound only unchanged. Putting a sample inside a track makes a new work built on it, which is a derivative. Verdict: `no`.

## Sampling+

**CC Sampling+ 1.0** was written for sampling but has been retired by Creative Commons. It allows commercial use only once the sound is transformed into a new work, never in advertising, and never selling the sound itself. **NC Sampling+** adds a non-commercial clause. Verdicts: `restricted` and `no`. You will mostly meet it on older uploads to ccMixter and similar sites.

## Royalty free: use it, don't share it

Sample packs and sound effect sites often use their own **royalty-free** licence: you may use the sounds in your music, commercial releases included, without paying per use. What you may not do is **redistribute the samples themselves**: no reposting them in a pack, a public repository, a sample library or a dataset, even for free. Verdict: `yes` (or `yes-with-credit` when the site asks for credit). The `redistribution: false` flag on the licence marks this.

Subscription services (Splice, Loopcloud and others) license sounds to subscribers under their own terms. Sound Server only links to those sites, and treats subscription terms as `check-terms` where they vary.

## Uploader-asserted licences

On some sites anyone can upload anything and type in a licence. The Internet Archive is the best-known example: its collections include genuine public-domain recordings and also music the uploader had no right to give away. Sound Server marks these with `assertedBy: "uploader"` and never rates them better than `check-terms`, even when the stated licence is CC0. A licence recorded by the source per item (`assertedBy: "source"`, as on Freesound or Wikimedia Commons) or set by a site for all its sounds (`assertedBy: "site"`) is trusted more.

## Clearance

A few services sell the right to sample real records. Using one of those recordings is legal only once the sample is cleared for your release, usually for a fee that depends on how the release is distributed. Verdict: `clearance-required`. Fine for sketching; budget for clearance before you release.

## Content ID and fingerprinting

A licence protects you legally, but it does not stop automated systems from flagging your track. YouTube Content ID, distributor checks and similar systems compare audio fingerprints, and popular free samples are sometimes registered by someone else, or appear in many tracks that are. If your release gets a claim for a sample you are allowed to use, dispute it with the licence and the source URL (the credit line has both). Using less common sounds, or processing them heavily, reduces the chance of a false match.

## How verdicts are decided

1. Each source tells Sound Server the licence of a sound, per item (Freesound, Wikimedia Commons, Openverse) or for the whole site (royalty-free libraries).
2. The licence is normalised to an SPDX-style id (`CC0-1.0`, `CC-BY-4.0`, `CC-BY-NC-4.0`, `LicenseRef-…`) by one shared parser, so the same licence gets the same verdict on every source.
3. The verdict follows fixed rules: CC0 and public domain `yes`; BY `yes-with-credit`; SA `restricted`; NC and ND `no`; Sampling+ `restricted`, NC Sampling+ `no`; site royalty-free licences `yes` or `yes-with-credit`; unknown or unclassifiable licences `check-terms`.
4. Uploader-asserted licences are capped at `check-terms`.
5. A short `note` explains each verdict, and the full licence is always linked.

The rules live in one module of the open-source server (`src/core/licence.ts`), with tests for every licence. If a verdict looks wrong, [open an issue](https://github.com/arielshad/sound-server/issues) with the sample id.

## What agents are told

AI agents using the [MCP server](/docs/mcp) or the [agent guide](/AGENTS.md) get the same rules: search commercial-safe by default, report the verdict of every suggestion, never present `no` or `check-terms` sounds as cleared, and pass on the credit line whenever one is needed.
