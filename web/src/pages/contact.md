---
layout: ../layouts/PageLayout.astro
title: Contact
description: How to reach the Sound Server maintainers for support, bug reports, security issues, source and licence questions, and requests from sample sites.
schemaType: ContactPage
---

# Contact

Sound Server is maintained in the open. The fastest way to reach the maintainers is GitHub, where every conversation stays public and searchable for the next person with the same question.

## Support and bug reports

Open an issue at [github.com/arielshad/sound-server/issues](https://github.com/arielshad/sound-server/issues). Helpful details: the search query or sample id (for example `freesound:2086`), the URL or MCP tool you called, what you expected and what happened. For API problems, include the response status and body.

## Security issues

Please do not open a public issue for a vulnerability. Report it privately through GitHub's security advisories at [github.com/arielshad/sound-server/security/advisories/new](https://github.com/arielshad/sound-server/security/advisories/new). You will get an acknowledgement, and fixes are released as soon as they are ready.

## Sample sites and licences

If you run one of the sites the service searches and want your source changed, rate-limited further or removed, or if a licence or verdict is shown incorrectly, open an issue with the sample id or source name. Requests from site owners are handled first. Sounds are never hosted here, so questions about using a specific sample go to its creator on the source site.

If you are a creator and believe a sound of yours appears under the wrong licence on a source site, contact that site first: Sound Server shows what the source states, and will mark or hide the result once the source corrects it.

## Integrations and partnerships

Building something on top of the API or the MCP server, or want your sample library added as a source? Open an issue describing the integration. Sources are added only when their terms allow automated search and the integration passes the test suite against the live site.

## Machine-readable entry points

- Agent guide: [/AGENTS.md](/AGENTS.md)
- Site index for LLMs: [/llms.txt](/llms.txt)
- API description: [/openapi.json](/openapi.json)
