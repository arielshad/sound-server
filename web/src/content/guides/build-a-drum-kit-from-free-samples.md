---
title: "How to build a drum kit from free samples"
description: "Pick a kick, snare, clap, hats and 808 that suit each other, check every licence, then play the kit in Strudel or any sampler via an SFZ or General MIDI map."
answer: "Choose one sound per slot (kick, snare, clap, closed hat, open hat and, for trap or hip hop, an 808) that suit your style, tempo and key, check that every one is cleared for a release, then map them to pads: General MIDI drum notes for a DAW, an SFZ file for samplers, or a Strudel sample map to play it in the browser. Sound Server's kit builder does all of this in one step and gives you the credits."
section: Production
kind: howto
steps:
  - name: "Decide the style, tempo and key"
    text: "A dark trap kit at 140 BPM in F minor needs different sounds from a 124 BPM house kit. Tempo guides decay lengths; key guides the kick, toms and 808."
  - name: "Pick one sound per slot"
    text: "Kick, snare, clap, closed hat, open hat and an 808 cover most beats. Audition them together, not solo: the kick and 808 should share a root, and the snare and clap should complement each other."
  - name: "Check every licence"
    text: "Keep only sounds whose verdict is 'Commercial use OK' or 'OK with credit' if the track may be released, and save the credit lines for the ones that need them."
  - name: "Map the kit"
    text: "Use General MIDI drum notes (kick 36, snare 38, clap 39, closed hat 42, open hat 46) so patterns work in any DAW, or load the SFZ file into a sampler such as sfizz or Sforzando."
  - name: "Play it"
    text: "Program a pattern in your DAW, or paste the Strudel snippet into strudel.cc to hear the kit in a loop straight away."
faq:
  - q: "What is an SFZ file?"
    a: "A plain-text format that tells a sampler which audio file to play for which note and velocity. It's open and supported by free samplers such as sfizz, so a kit described in SFZ works in many hosts."
  - q: "What is Strudel?"
    a: "A browser-based live-coding environment for music, a JavaScript port of TidalCycles. You load samples into it with a sample map and write patterns such as s(\"bd sd [~ bd] sd\")."
  - q: "How many kicks should I audition?"
    a: "Five to ten is plenty. The kit builder offers alternatives for every slot, so you can swap one sound without starting over."
searches:
  - { label: "Commercial-safe kicks", href: "/search?q=kick&category=drums.kick&form=one-shot&commercial=true" }
  - { label: "Commercial-safe snares", href: "/search?q=snare&category=drums.snare&form=one-shot&commercial=true" }
  - { label: "Commercial-safe 808s", href: "/search?q=808&category=bass.808&commercial=true" }
collections: [free-kick-samples, free-snare-samples, free-clap-samples, free-hi-hat-samples, free-open-hi-hat-samples, free-808-samples]
related: [what-is-an-808, one-shots-vs-loops, ai-agents-find-and-license-samples]
cites:
  - { name: "Strudel", url: "https://strudel.cc/" }
  - { name: "SFZ format", url: "https://sfzformat.com/" }
  - { name: "General MIDI percussion key map (MIDI Association)", url: "https://midi.org/general-midi" }
published: 2026-10-23
updated: 2026-10-23
order: 10
---

## The slots

A typical kit has six parts:

| Slot | Job | General MIDI note |
| --- | --- | --- |
| Kick | The pulse, the low punch | 36 (C1) |
| Snare | The backbeat on 2 and 4 | 38 (D1) |
| Clap | Layered with or replacing the snare | 39 (D#1) |
| Closed hat | Eighths or sixteenths | 42 (F#1) |
| Open hat | Offbeats and accents | 46 (A#1) |
| 808 | Tuned bass (trap, drill, hip hop) | Played chromatically |

Add toms, a crash, a ride and percussion when the style calls for them. Note names for MIDI numbers vary between DAWs (some call note 36 C2), but the numbers are standard.

## With the kit builder

The [kit builder](/kit) runs one search per slot for your style, tempo and key, and returns a pick for each slot with alternatives and the reason it was chosen. It searches commercial-safe by default. The result includes:

- a licence summary (how many picks are cleared, how many need credit);
- the credit lines to paste into your release;
- a **Strudel** sample map and snippet that load the previews through Sound Server, so the kit plays in strudel.cc as is;
- a **General MIDI / SFZ** drum map for samplers.

The same kit is one call on the REST API (`POST /v1/kits`) or the MCP tool `build_kit`; run locally, the MCP tool downloads the files with an SFZ and ATTRIBUTION.md into your project.

## By hand

Search each slot with the [Commercial-safe](/guides/what-counts-as-commercial-use) switch on, starting from the [kick](/samples/free-kick-samples), [snare](/samples/free-snare-samples), [clap](/samples/free-clap-samples), [hi-hat](/samples/free-hi-hat-samples) and [808](/samples/free-808-samples) collections. Download the originals, name the files by slot, and load them into your DAW's drum rack. A minimal SFZ file for a sampler looks like this:

```text
<region> key=36 sample=kick.wav
<region> key=38 sample=snare.wav
<region> key=39 sample=clap.wav
<region> key=42 sample=hat-closed.wav group=2
<region> key=46 sample=hat-open.wav group=1 off_by=2
```

The `group` and `off_by` settings make the closed hat (group 2) cut off the open one, like a drummer's foot closing the hi-hat.

## Playing it in Strudel

Strudel loads samples from a map of names to URLs and plays patterns written in mini-notation:

```js
samples({ bd: "kick.wav", sd: "snare.wav", hh: "hat-closed.wav", oh: "hat-open.wav" }, "https://example.com/my-kit/")
s("bd hh [bd sd] hh, ~ ~ ~ oh")
```

The kit builder writes this map for you with working URLs. Strudel also ships its own drum machine banks (`.bank("RolandTR909")`), which Sound Server indexes as a source.
