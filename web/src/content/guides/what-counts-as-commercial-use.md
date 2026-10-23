---
title: "What counts as commercial use of a sample?"
description: "Selling, streaming for royalties, monetised videos, beat leases, sync and client work are commercial. How non-commercial (NC) licences apply to music."
answer: "Any use mainly aimed at earning money or commercial advantage. For music that includes selling downloads, streaming on platforms that pay royalties, monetised YouTube or Twitch content, leasing or selling beats, sync placements, games and apps you sell, client work and advertising. Samples under non-commercial (NC) licences can't be used in any of those; they're fine for practice, study and projects that never earn anything."
section: Licensing
faq:
  - q: "Is a free SoundCloud upload commercial?"
    a: "A free, non-monetised upload is usually non-commercial. It becomes commercial if you monetise it, use it to sell something, or later distribute the same track to paid platforms, so replace NC samples before that happens."
  - q: "Is a beat I give away for free with a 'buy to use' tag commercial?"
    a: "Yes. A free beat that promotes paid leases is directed towards commercial advantage, so NC samples don't belong in it."
  - q: "What about a non-profit or charity project?"
    a: "Being a non-profit doesn't settle it: what matters is whether the use is aimed at commercial advantage or money. A charity's fundraising advert is still advertising. When in doubt, ask the creator or use a sound cleared for commercial use."
  - q: "Can I ask the creator for permission instead?"
    a: "Yes. A licence is a standing permission; the creator can grant you different terms directly, in writing. Many Freesound and ccMixter users are happy to be asked."
searches:
  - { label: "Only commercial-safe results", href: "/search?q=kick&category=drums.kick&commercial=true" }
  - { label: "808s cleared for release", href: "/search?q=808&category=bass.808&commercial=true" }
collections: [free-808-samples, free-lofi-loops, free-drum-loops]
related: [freesound-samples-commercial-use, bbc-sound-effects-for-music, cc0-vs-cc-by-vs-royalty-free, sample-clearance-and-content-id]
cites:
  - { name: "CC BY-NC 4.0 legal code, definition of NonCommercial", url: "https://creativecommons.org/licenses/by-nc/4.0/legalcode.en#s1i" }
  - { name: "Creative Commons FAQ: NonCommercial", url: "https://creativecommons.org/faq/#does-my-use-violate-the-noncommercial-clause-of-the-licenses" }
published: 2026-10-23
updated: 2026-10-23
order: 6
---

## The definition

The Creative Commons NonCommercial licences define non-commercial as "not primarily intended for or directed towards commercial advantage or monetary compensation". The test is about the **use**, not about who you are: a hobbyist monetising a video is making commercial use, even though they are not a business. Creative Commons' own guidance adds that edge cases depend on the specific use, so when in doubt, ask the creator.

## Commercial for a producer

| Use | Commercial? |
| --- | --- |
| Selling a track or album, physical or download | Yes |
| Spotify, Apple Music and other royalty-paying streams | Yes |
| A monetised YouTube, Twitch or TikTok video | Yes |
| Leasing or selling beats, including free "tagged" beats | Yes |
| Sync: a track in a film, ad, game or podcast | Yes |
| Client or commissioned work | Yes |
| A sample pack you sell | Yes |
| Practising, studying, school projects | No |
| A free, non-monetised upload that promotes nothing | Usually not |

## Why it matters early

The problem with NC samples is timing. A sketch made for fun becomes a release, and the NC kick in it is now a licence breach. Replacing one sound late is easy; replacing a vocal chop that defines the hook is not. If there's any chance a track will be released, start with sounds cleared for commercial use.

Sound Server makes this a switch: **Commercial-safe** on the search page, `commercial=true` on the API, and the MCP default `commercial_only=true` for AI agents. Each result's verdict says why a sound was kept or left out.
