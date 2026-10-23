---
layout: ../layouts/PageLayout.astro
title: About Sound Server
description: What Sound Server is, who runs it, how it finds music samples across many sites, and how it treats licences and the sites it searches.
schemaType: AboutPage
---

# About Sound Server

**Sound Server** (https://sound.shep.bot) is a free search engine and API for music samples. One query searches many sample sites at once, including Freesound, Wikimedia Commons, Openverse, ccMixter and the Internet Archive, sound effect libraries and producer packs, and returns kicks, snares, hats, claps, 808s, loops, vocals, FX, foley, ambience and instrument one-shots. Every result has a preview you can play, its tempo, key and length where known, and a plain verdict on whether you can use it in a track you release.

It exists because finding a usable sample usually means opening a dozen tabs, auditioning sounds one site at a time, and then reading licences that were written for something else. Sound Server does that comparison once and puts the answer next to the sound.

## Who it is for

- **Producers and beatmakers** who want the right kick, 808 or riser now, with a licence they can release under.
- **AI agents** (Claude Code, Cursor, GitHub Copilot, Windsurf, Codex and others) that make music, games or apps and need to find, vet and fetch sounds on their own. The service is an [MCP server](/docs/mcp) and has an [agent guide](/AGENTS.md).
- **Developers and live coders** who call the [REST API](/docs/api) from scripts, DAW extensions or [Strudel](https://strudel.cc).

## Who runs it

Sound Server is open source under the Apache-2.0 licence and developed in the open at [github.com/arielshad/sound-server](https://github.com/arielshad/sound-server). The public instance runs on Shep's infrastructure ([shep.bot](https://shep.bot)) as a free, non-commercial service: no accounts, no ads, no paid tier. It is a sibling of [3d.shep.bot](https://3d.shep.bot), which does the same for game and web assets. Anyone can [self-host](/docs/self-hosting) their own copy.

## How it treats sources and licences

- **Sounds belong to their creators.** The service never re-hosts, mirrors or resells samples. Previews play from the source sites, single-file downloads redirect to the source, and zips are streamed from the source's files with the credits added.
- **Licences come first.** Every result shows its licence, who stated it and a verdict on commercial use, decided by one set of rules for every source ([how verdicts work](/docs/licences)). When a licence is unclear or only asserted by an uploader, the result says so instead of guessing.
- **Accounts stay with the sources.** When a site only gives full-quality originals to logged-in users, as Freesound does, Sound Server plays the preview and sends you to the site to download the original with your own account.
- **Polite access.** The server identifies itself with a descriptive User-Agent, caches responses, deduplicates identical requests and gives every source its own timeout. Sites that don't allow automated search (Splice, Looperman and others) are never scraped; they only get a deep link to their own search.

See [Sources & licences](/docs/sources) for the full list, [Privacy](/privacy) for what the service records, and [Contact](/contact) to reach the maintainers.
