---
title: "WAV, AIFF, FLAC or MP3: which sample format should you use?"
seoTitle: "WAV vs AIFF vs FLAC vs MP3 for samples"
description: "Use lossless WAV, AIFF or FLAC for production and MP3 or Ogg only for previews. Sample rate and bit depth explained: 44.1 or 48 kHz, 16 or 24-bit."
answer: "Produce with lossless files: WAV or AIFF (uncompressed) or FLAC (compressed without loss). They all sound identical; pick whatever your DAW and sampler read. MP3 and Ogg are lossy and fine for auditioning previews, but avoid them in a release. For sample rate, 44.1 kHz suits music and 48 kHz suits video; for bit depth, 24-bit gives recordings more headroom, while 16-bit is enough for finished one-shots."
section: Production
faq:
  - q: "Can I convert an MP3 back to WAV to improve it?"
    a: "No. Converting a lossy file to WAV makes a bigger file, not a better one: what MP3 encoding removed is gone. Download the original lossless file instead."
  - q: "Do I need 96 kHz samples?"
    a: "Rarely. Higher rates help when you pitch a sound down a lot or do detailed sound design, because more high-frequency content survives. For drums and loops at normal pitch, 44.1 or 48 kHz is fine."
  - q: "Why are Freesound previews MP3?"
    a: "Previews are made for quick listening and streaming. The uploader's original file, often WAV, AIFF or FLAC, is available to logged-in Freesound users."
  - q: "Which format does Strudel need?"
    a: "Strudel plays anything the browser can decode, so WAV, MP3, Ogg and FLAC all work. Smaller files load faster, which is why the kit builder points Strudel at previews."
searches:
  - { label: "Samples with direct WAV download", href: "/search?q=kick&category=drums.kick&downloadable=true" }
  - { label: "Multisampled instruments", href: "/search?q=piano&form=multisample" }
collections: [free-piano-samples, free-string-samples, free-kick-samples]
related: [one-shots-vs-loops, build-a-drum-kit-from-free-samples, freesound-samples-commercial-use]
cites:
  - { name: "Xiph.org: FLAC", url: "https://xiph.org/flac/" }
published: 2026-10-23
updated: 2026-10-23
order: 13
---

## Lossless vs lossy

| Format | Type | Use it for |
| --- | --- | --- |
| WAV | Uncompressed PCM | Production, the universal default |
| AIFF | Uncompressed PCM | Production, common on macOS and in older libraries |
| FLAC | Lossless compression | Production and archiving at roughly half the size |
| MP3 | Lossy | Previews, sketches, sharing |
| Ogg Vorbis / Opus | Lossy | Previews, web and games |

WAV, AIFF and FLAC decode to exactly the same audio. Lossy formats throw away detail the encoder judges inaudible; one generation is often hard to hear, but processing, pitching and re-encoding expose it, and transients such as drum hits suffer first. Always produce from the lossless original.

## Sample rate

The sample rate is how many times per second the audio is measured. 44.1 kHz is the CD and music-streaming standard; 48 kHz is standard for video and most games. Your DAW converts on import, so mixing rates is fine, but setting your project to the rate of its destination avoids an extra conversion at the end.

## Bit depth

Bit depth sets the dynamic range. 16-bit gives about 96 dB, enough for a finished, normalised one-shot. 24-bit gives far more headroom, which matters for quiet field recordings and sounds you will process heavily. 32-bit float files can't clip inside a DAW and are increasingly common in sample packs.

## What Sound Server returns

Every result lists the formats the source offers. Sample details include each file's format, sample rate, bit depth, channels and size where the source states them, plus whether a download needs an account on the source. The `downloadable=true` filter keeps samples this server can fetch directly, and multi-file downloads arrive as a zip with ATTRIBUTION.md.
