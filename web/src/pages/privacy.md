---
layout: ../layouts/PageLayout.astro
title: Privacy
description: What Sound Server records (search text in server logs, anonymous counters, which AI tools call MCP), what stays in your browser, and who else you contact.
schemaType: WebPage
---

# Privacy

Sound Server has no accounts, no sign-up, no advertising and no cookies. This page explains what the public service at https://sound.shep.bot records and why.

## What the service records

- **Search events.** For each search the server writes a log line with the search text, the filters, the number of results, which interface was used (website, API or MCP) and a coarse client family derived from the User-Agent (for example "browser", "curl" or "claude-code"). It does not put your IP address, API key or any cookie in these lines. They are used to improve ranking, to find searches that return nothing and to choose topics for the [sample collections](/samples). Logs are deleted after a short retention period. A collection page never shows who searched or how often.
- **Aggregate metrics.** Counters such as searches per minute, downloads per source, page views per page and per-source error rates. They contain no search text and no personal data. Their totals are public on the [statistics](/stats) page.
- **Which AI tools use the MCP server.** For MCP requests the server records the name and version the AI tool declares when it connects (for example "claude-code 2") and, where configured, a network category (an AI company's cloud, a cloud provider or an internet provider) looked up locally from your IP address. The address itself is not stored or logged. To count distinct callers per day, the server keeps a one-way hash of your IP address and User-Agent in memory, mixed with a random value that is replaced every day and never saved.
- **Request logs.** Like any website, the hosting infrastructure keeps standard request logs (which include IP addresses and User-Agents) for security and operations, for a limited time.
- **Rate limiting.** To keep the free service fair, the server counts requests per client IP address in memory for one minute at a time. These counters are never written to disk.

## Website visit counts

If the operator configures it, the website loads a self-hosted [Umami](https://umami.is) script, which counts page views without cookies: the page address, the referring site, browser, operating system, device type, screen size, language and an approximate country. Before anything is sent, the page strips everything except `utm_*` tags from addresses, so what you search for is never part of it. If your browser sends Do Not Track, nothing is sent, and blocking the script does not break the site. No analytics company such as Google receives anything.

## If you run it yourself

When you run Sound Server on your own machine or server (from source, with the `ghcr.io/arielshad/sound-server` Docker image, or as a local MCP server), **telemetry is off by default**. It is only sent if you opt in by setting `SOUND_SERVER_TELEMETRY=1` (and a telemetry website id). Then it sends anonymous event counts only: one per search, sample lookup, download and MCP tool call, with fixed labels (interface, client family, source, category filter, outcome, version and operating system). Never what you search for, sample ids, file paths, URLs, API keys or your machine's name. `DO_NOT_TRACK=1` always turns it off.

## What stays in your browser

The website stores two optional preferences in your browser's local storage: your light/dark theme choice and, only on self-hosted servers that require one, the API key you entered. The API key is sent only to the same server, in a request header.

## Third parties you contact

- **Previews** play directly from the sample sites (Freesound, Wikimedia Commons and others) when the site allows it, so those sites see your IP address while you audition sounds. Previews that need special headers are fetched for you by this server instead.
- **Downloads** of single files redirect to the source's servers. Zips are assembled by this server from the source files.
- **Links** to source pages and to linked searches (such as Splice or Looperman) take you to those sites, which have their own privacy policies.

## Your choices and contact

Because no account or profile exists, there is nothing to export or delete for an individual visitor beyond the time-limited logs above. Questions or requests: see [Contact](/contact). This policy may change as the service evolves; the current version always lives at https://sound.shep.bot/privacy.
