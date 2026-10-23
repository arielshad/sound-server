---
title: "How to credit CC BY samples in a song"
description: "The credit line a CC BY sample needs (title, author, source, licence, changes), where to put it on Bandcamp, YouTube and streaming, with copy-paste examples."
answer: "Name the sound, its author, where it came from and its licence with a link, and say that you modified it, for example: “Deep Kick 01” by Jane Doe (Freesound, https://freesound.org/s/123456/), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), pitched and processed. Put it wherever listeners can find the credits: release notes, the video description, the game's credits or a credits page you link to."
section: Licensing
kind: howto
steps:
  - name: "Collect the facts when you download"
    text: "Note the sample's title, the author's name or username, the URL of the sample page and the exact licence with its version. Sound Server's attribution field and ATTRIBUTION.md contain all four."
  - name: "Write one line per sample"
    text: "Use the TASL pattern: Title, Author, Source, Licence. Add a link to the licence and a word about changes, such as 'pitched', 'chopped' or 'processed'."
  - name: "Put the credits where listeners look"
    text: "On Bandcamp, in the album or track credits. On YouTube and SoundCloud, in the description. In a game or app, in the credits screen. On streaming services, which have no free-text credits, on a page you link from your profile or press notes."
  - name: "Keep the paperwork"
    text: "Store the credit lines and licence links in the project folder. If a distributor or Content ID claim asks where a sound came from, you can answer in minutes."
faq:
  - q: "Do I have to credit CC BY samples on Spotify?"
    a: "The licence requires credit in a reasonable manner for the medium. Spotify has no field for sample credits, so the common practice is a credits page on your website or Bandcamp, linked from your artist profile, plus credits in any video or social post that uses the track."
  - q: "What if the author's real name isn't given?"
    a: "Use the name or username they publish under. CC BY asks you to credit the creator in the way they asked to be credited, if they did."
  - q: "Do I need to credit CC0 samples?"
    a: "No, but you can. A short 'samples from Freesound (CC0)' line is a courtesy that some producers include."
  - q: "Is a credit enough for CC BY-SA or CC BY-NC samples?"
    a: "No. A credit satisfies CC BY. Share-alike adds the obligation to license your work the same way, and non-commercial forbids commercial use whatever you credit."
searches:
  - { label: "CC BY drums with ready credit lines", href: "/search?category=drums&commercial=true" }
  - { label: "Vocals cleared with credit", href: "/search?category=vocals&commercial=true" }
collections: [free-acapellas, free-vocal-chops, free-forest-ambience]
related: [freesound-samples-commercial-use, cc0-vs-cc-by-vs-royalty-free, sample-clearance-and-content-id]
cites:
  - { name: "CC BY 4.0 legal code, section 3(a): attribution", url: "https://creativecommons.org/licenses/by/4.0/legalcode.en#s3a" }
  - { name: "Creative Commons: recommended practices for attribution", url: "https://wiki.creativecommons.org/wiki/Recommended_practices_for_attribution" }
published: 2026-10-23
updated: 2026-10-23
order: 3
---

## What CC BY asks for

The Attribution licences ask you to keep four things with the work: who made it, what it is called, where it is published and which licence it is under, plus a note if you changed it. Creative Commons calls this TASL: **T**itle, **A**uthor, **S**ource, **L**icence. Version 4.0 is flexible about format: credit may be given "in any reasonable manner based on the medium, means, and context", and a link to a page that holds the credits is acceptable.

## Copy-paste examples

One sample, in a release description:

```text
Contains “Deep Kick 01” by Jane Doe (https://freesound.org/s/123456/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Pitched and processed.
```

Several samples, as a credits block:

```text
Samples used
- “Rain on tin roof” by fieldrec (Wikimedia Commons), CC BY 4.0, https://creativecommons.org/licenses/by/4.0/
- “Vox chop 3” by singer42 (ccMixter), CC BY 3.0, https://creativecommons.org/licenses/by/3.0/
- Kick and hats from Kenney's audio packs (CC0)
```

The names above are examples. Sound Server writes the real line for every sample: copy it from the result's detail view, read the `attribution` field from the API, or download with `bundle=true` to get `ATTRIBUTION.md` and `credits.json`.

## Where the credit goes

- **Bandcamp**: the credits field of the album or track.
- **YouTube, SoundCloud, TikTok**: the description of each upload that contains the sample.
- **Streaming platforms**: there is no description field, so keep a public credits page and link it from your bio, website or press kit.
- **Games, apps and films**: the credits screen or an in-app "licences" page.
- **Physical releases**: the liner notes.

## Common mistakes

Crediting only the website ("sounds from Freesound") is not enough for CC BY: name the author and the sound. Dropping the licence link is the other frequent gap. And a credit doesn't turn a non-commercial sound into a commercial one; check the verdict before you rely on a credit.
