---
title: "How to find samples by BPM and key"
description: "Search loops, 808s and melodic samples by tempo and key, why half-time and relative keys match, and how to check a sample's real BPM and root note."
answer: "Filter by tempo and key, then verify. On Sound Server, type it in the query (“vocal chop 140 bpm”, “808 in F minor”) or use the BPM and key filters; half and double tempo and the relative major or minor also match, because they fit the same track. Not every source labels tempo and key, so unlabelled sounds are kept but ranked lower unless you switch on strict matching."
section: Production
kind: howto
steps:
  - name: "Know your project's tempo and key"
    text: "Read the BPM from your DAW and identify the key from your chords or bassline. If you're starting from a sample, use its tempo and key as the project's."
  - name: "Search with them"
    text: "Add them to the query, for example 'piano loop 90 bpm A minor', or use the BPM (a number or a range like 120-128) and key filters. Combine with a category such as keys or vocals.chop."
  - name: "Decide on strict matching"
    text: "By default, sounds with unknown tempo or key stay in the results, ranked lower. Turn on strict to keep only labelled ones when you need a guaranteed match."
  - name: "Verify before you commit"
    text: "Check the loop's length lines up with whole bars at your tempo, and play pitched samples against your bassline. Labels on community sites are sometimes wrong."
  - name: "Adjust what's close"
    text: "Time-stretch loops a few BPM either way and pitch-shift up to two or three semitones. Beyond that, quality drops, so look for a closer match instead."
faq:
  - q: "Why does a 70 BPM search return 140 BPM loops?"
    a: "Because they fit. A 140 BPM loop plays at half time over a 70 BPM beat, and trap and drill are often labelled either way. Sound Server matches half and double tempo for that reason."
  - q: "Why do A minor results include C major?"
    a: "A minor and C major use the same notes; they are relative keys. A sample in one usually works over a track in the other, so both match."
  - q: "How does Sound Server know a sample's key?"
    a: "From the source when it records it (Freesound analyses tempo and key, many packs label them in file names), from words in the title, and, when you ask for details with analysis, by measuring the audio."
  - q: "Do drum one-shots have a key?"
    a: "Kicks, toms and 808s have a clear pitch and benefit from tuning. Snares, claps and hats are mostly noise; their key matters much less."
searches:
  - { label: "808 in F minor", href: "/search?q=808&category=bass.808&key=F+minor" }
  - { label: "Vocal chops at 140 BPM", href: "/search?q=vocal+chop&category=vocals.chop&bpm=140" }
  - { label: "Piano loops at 90 BPM", href: "/search?q=piano&category=keys&form=loop&bpm=90" }
  - { label: "House drum loops, 120-128 BPM", href: "/search?q=drum+loop&category=drums&form=loop&bpm=120-128" }
collections: [free-808-samples, free-lofi-loops, free-guitar-loops, free-vocal-chops]
related: [one-shots-vs-loops, what-is-an-808, build-a-drum-kit-from-free-samples]
cites: []
published: 2026-10-23
updated: 2026-10-23
order: 9
---

## Tempo and key in a search

Matching tempo and key is what makes a sample drop into a project without fighting it. Sound Server reads both from your query and from filters:

- **BPM**: "140 bpm" in the query or `bpm=140`; ranges such as `bpm=120-128` for house. Half and double time match (a 70 BPM search returns 140 BPM loops).
- **Key**: "F minor", "F#m", "Eb" or "A major", in the query or as `key=`. The relative key matches too (F minor with A♭ major).
- **Strict**: `strict=true` drops sounds whose tempo or key is unknown, instead of ranking them lower.

The same parameters work on the [REST API](/docs/api) and in the MCP tool `search_samples`, so an AI agent can ask for "a dark 808 in F minor" and get tuned results.

## Where the numbers come from

Sources label tempo and key in different ways. Freesound analyses every upload and publishes the results, sample packs usually put tempo and key in file names, and many community uploads give nothing. Sound Server combines what the source states with what the title says, and can measure duration, BPM, key, root note and loudness on demand when you open a sample's details (`analyze=true` on the API).

## Checking a loop by ear

A quick test for tempo: set your project to the stated BPM and drop the loop at bar 1. If it ends exactly on a bar line after one, two, four or eight bars, the tempo is right. If it ends halfway, the real tempo is half or double. For key, loop a bass note of your key under the sample: if they sit together without beating, you're in key; if not, try the relative key or a shift of a semitone or two.

## Collections to start from

The [808 collection](/samples/free-808-samples) shows root notes where known, and the [lo-fi](/samples/free-lofi-loops) and [guitar loop](/samples/free-guitar-loops) collections show BPM and key. Each card plays in the page, so you can audition before downloading.
