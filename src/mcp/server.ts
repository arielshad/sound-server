import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzeSample } from "../core/analyze.js";
import { clientFamily, noopAnalytics, type Analytics } from "../core/analytics.js";
import { recordCredits } from "../core/credits-file.js";
import { downloadSample, formatBytes, isPreviewOnly, samplePath, selectFiles, totalBytes } from "../core/download.js";
import { planKit, type KitPlan } from "../core/kit.js";
import { VERDICT_LABELS } from "../core/licence.js";
import { formatKey, keyFromText } from "../core/query.js";
import { SampleService, errorMessage } from "../core/service.js";
import { findSimilar } from "../core/similar.js";
import type { Sample, SampleDetails, SampleFile } from "../core/types.js";
import { compact } from "../core/util.js";
import { CATEGORIES, SAMPLE_FORMS, type Category } from "../core/vocab.js";
import { versionLabel } from "./attribution.js";
import { instrumentForSample, midiSummary, midiForSample, writeMidiForSample } from "./exports.js";
import { kitExports } from "./kit-export.js";

export interface McpOptions {
  /** Allow tools to write to the local filesystem (stdio / trusted local use). */
  allowLocalDownload: boolean;
  /** Default destination for downloads. */
  downloadDir?: string;
  /** Public base URL of the HTTP API, used to offer download and preview links. */
  publicBaseUrl?: string;
  /** Where tool calls are recorded (defaults to no-op). */
  analytics?: Analytics;
  /**
   * Client family of the caller, for analytics only. The HTTP endpoint sets it
   * per request (src/mcp/attribution.ts). Without it, the family of the name
   * the client declared when it connected is used (stdio).
   */
  client?: string;
  /** More about the HTTP caller, for analytics only. */
  attribution?: {
    network: string;
    consistency: string;
    /** True on this caller's first tool call today (counts distinct callers). */
    newCaller?: (client: string) => boolean;
  };
}

export const VERSION = "0.1.0";

const categoryEnum = z.enum(CATEGORIES as [Category, ...Category[]]);
const formEnum = z.enum(SAMPLE_FORMS);

const LICENCE_RULES =
  "Licences matter more for music than anywhere else: every result has license.verdict. " +
  "'yes' = usable in a commercial release; 'yes-with-credit' = usable if you credit the author (use the `attribution` line); " +
  "'restricted', 'clearance-required' and 'check-terms' = tell the user to read the terms before release; 'no' = non-commercial only. " +
  "Never present a 'no' or 'check-terms' sample as cleared. Searches are commercial-safe by default (commercial_only=true); " +
  "set commercial_only=false only when the user says the project is personal or non-commercial.";

export function createMcpServer(service: SampleService, opts: McpOptions): McpServer {
  const base = opts.publicBaseUrl?.replace(/\/$/, "");
  const server = new McpServer(
    { name: "sound-server", version: VERSION },
    {
      instructions: [
        "Search and download music samples (kicks, snares, hats, claps, 808s, loops, vocals, FX like risers and zaps, foley, ambience, instrument one-shots) from many sources at once",
        "(Freesound, Wikimedia Commons, Openverse, Internet Archive, ccMixter, BBC Sound Effects, Strudel drum machines, MusicRadar SampleRadar, and more).",
        "Queries understand BPM and key words ('140 bpm dark trap 808 in F minor').",
        ...(opts.allowLocalDownload
          ? [
              "Typical flow: search_samples -> get_sample (licence, files, analysed BPM/key) -> download_sample.",
              "build_kit picks and downloads a whole drum kit in one call and writes a Strudel sample map, an SFZ/General MIDI map and the credits.",
            ]
          : [
              "Typical flow: search_samples -> get_sample -> fetch selection.downloadUrl.",
              "This server cannot write to your disk: if you have a shell, download the file yourself",
              "(`curl -L -o \"samples/<selection.filename>\" \"<selection.downloadUrl>\"`); otherwise give the user the link.",
              "build_kit returns a planned kit with download links and a Strudel snippet that plays straight from this server.",
            ]),
        LICENCE_RULES,
        "Results marked downloadable=false must be obtained from their `url` on the source site.",
      ].join(" "),
    },
  );

  const providerIds = service.listProviders().map((p) => p.id);
  const sourceNames = Object.fromEntries(service.listProviders().map((p) => [p.id, p.name]));
  const analytics = opts.analytics ?? noopAnalytics;
  /** The caller's client family: given per request (HTTP), or from the client's declared name (stdio). */
  const clientOf = () => opts.client ?? clientFamily(server.server.getClientVersion()?.name);

  // Over a connection that stays open (stdio), the declared client is known
  // once it has connected. The stateless HTTP endpoint reports connects itself.
  server.server.oninitialized = () => {
    const info = server.server.getClientVersion();
    if (!info || opts.client) return;
    const client = clientFamily(info.name);
    analytics.mcpConnect({ client, clientVersion: versionLabel(client, info.version), clientName: info.name.slice(0, 64) });
  };

  /** Wrap a tool handler so every call is counted and timed. */
  const timed =
    <A>(tool: string, handler: (args: A) => Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> => {
      const started = Date.now();
      let outcome: "ok" | "error" = "error";
      try {
        const res = await handler(args);
        outcome = res.isError ? "error" : "ok";
        return res;
      } finally {
        const client = clientOf();
        const a = opts.attribution;
        analytics.toolCall({
          tool,
          client,
          outcome,
          tookMs: Date.now() - started,
          network: a?.network,
          consistency: a?.consistency,
          newCaller: a?.newCaller?.(client),
        });
      }
    };

  const links = (s: Pick<Sample, "id">) =>
    base
      ? {
          download: `${base}/v1/samples/${encodeURIComponent(s.id)}/download`,
          preview: `${base}/v1/samples/${encodeURIComponent(s.id)}/preview`,
          share: `${base}/search?sample=${encodeURIComponent(s.id)}`,
        }
      : undefined;

  server.registerTool(
    "search_samples",
    {
      title: "Search samples",
      description:
        "Search every sample source at once. Write the query like a producer would: 'punchy kick', 'dusty snare', 'open hat', " +
        "'808 in F minor', 'vocal chop 140 bpm', 'riser', 'laser zap', 'vinyl crackle', 'rain ambience', 'piano C4'. " +
        "BPM ('140 bpm', '120-128 bpm') and key ('F minor', 'F#m') in the query become filters; you can also pass them explicitly. " +
        "Filter with `categories` (e.g. drums.kick, drums.hat.closed, bass.808, vocals.chop, fx.riser, foley, ambience; a parent like 'drums' matches all drums) " +
        "and `forms` (one-shot, loop, phrase, multisample, pack, midi, preset). Results carry category, form, bpm, key, duration, " +
        "a playable preview URL and the licence verdict. The response also lists deep links into sites that can't be searched automatically (Splice, Looperman, …). " +
        LICENCE_RULES,
      inputSchema: {
        query: z.string().describe("What you are looking for, e.g. 'punchy kick', 'dark trap 808 in F minor', 'vocal chop', 'riser'."),
        categories: z.array(categoryEnum).optional().describe("Only these categories (parents match children)."),
        forms: z.array(formEnum).optional().describe("Only these forms, e.g. ['one-shot'] or ['loop']."),
        bpm: z.number().min(40).max(300).optional().describe("Tempo for loops (half/double time also match)."),
        bpm_min: z.number().min(40).max(300).optional(),
        bpm_max: z.number().min(40).max(300).optional(),
        key: z.string().optional().describe("Musical key, e.g. 'F minor', 'F#m', 'C major'. Relative major/minor also match."),
        max_duration: z.number().positive().optional().describe("Max length in seconds (e.g. 2 for drum one-shots)."),
        commercial_only: z.boolean().optional().describe("Only samples usable in a commercial release (default true)."),
        free_only: z.boolean().optional().describe("Exclude paid samples and packs."),
        downloadable_only: z.boolean().optional().describe("Only samples this server can fetch directly."),
        strict: z.boolean().optional().describe("Drop samples whose BPM/key/form is unknown when you filter on them."),
        providers: z.array(z.string()).optional().describe(`Only search these sources. Available: ${providerIds.join(", ")}.`),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 12)."),
        offset: z.number().int().min(0).optional().describe("Per-source offset for paging (e.g. 12 for page 2)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    timed("search_samples", async (args) => {
      try {
        const started = Date.now();
        const key = args.key ? keyFromText(` ${args.key} `) ?? keyFromText(` key of ${args.key} `) : undefined;
        if (args.key && !key) return fail(`Could not read the key "${args.key}". Use e.g. "F minor", "F#m" or "C major".`);
        const bpm =
          args.bpm !== undefined
            ? { min: args.bpm, max: args.bpm }
            : args.bpm_min !== undefined || args.bpm_max !== undefined
              ? { min: args.bpm_min, max: args.bpm_max }
              : undefined;
        const res = await service.search({
          query: args.query,
          categories: args.categories,
          forms: args.forms,
          bpm,
          key: key ? (key.mode ? { tonic: key.tonic, mode: key.mode } : { tonic: key.tonic }) : undefined,
          maxDurationSec: args.max_duration,
          commercialOnly: args.commercial_only ?? true,
          freeOnly: args.free_only,
          downloadableOnly: args.downloadable_only,
          strict: args.strict,
          providers: args.providers,
          limit: args.limit ?? 12,
          offset: args.offset,
        });
        analytics.search({
          surface: "mcp",
          client: clientOf(),
          query: args.query,
          categories: res.filters.categories,
          freeOnly: args.free_only,
          downloadableOnly: args.downloadable_only,
          response: res,
          tookMs: Date.now() - started,
        });
        return json({
          query: res.query,
          filters: res.filters,
          results: res.results.map((s) => summarize(s, links(s)?.preview)),
          sources: res.providers
            .filter((p) => p.status === "ok")
            .map((p) => `${p.provider}: ${p.count}${p.total !== undefined ? `/${p.total}` : ""}`)
            .join(", "),
          skipped: res.providers.filter((p) => p.status === "skipped").map((p) => `${p.provider} (${p.error})`).join(", ") || undefined,
          also_search_on: res.providers.filter((p) => p.status === "link" && p.searchUrl).map((p) => ({ provider: p.name, url: p.searchUrl })),
          unavailable: res.providers
            .filter((p) => p.status === "error" || p.status === "timeout")
            .map((p) => ({ provider: p.provider, reason: p.error, url: p.searchUrl })),
          hint: res.results.length
            ? undefined
            : "Nothing matched. Try fewer words, drop the bpm/key filters, set commercial_only=false for personal projects, or open also_search_on links.",
        });
      } catch (e) {
        return fail(e);
      }
    }),
  );

  server.registerTool(
    "get_sample",
    {
      title: "Get sample details and files",
      description:
        "Full details for a sample id from search_samples (e.g. 'freesound:2086'): licence and credit line, files, preview, and the " +
        "musical facts. With analyze=true the preview is analysed to fill in missing duration, BPM (loops), key, root note and loudness. " +
        (opts.allowLocalDownload
          ? "Use download_sample to fetch it."
          : "selection.downloadUrl fetches the best file (a redirect, so follow redirects)."),
      inputSchema: {
        id: z.string().describe("Sample id in the form '<provider>:<id>'."),
        format: z.string().optional().describe("Preferred format: wav, aiff, flac, ogg, mp3, zip."),
        analyze: z.boolean().optional().describe("Analyse the audio for BPM/key/duration/loudness (a few seconds)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    timed("get_sample", async (args) => {
      try {
        let sample = await service.getSample(args.id);
        analytics.sampleView({ surface: "mcp", client: clientOf(), provider: args.id.split(":")[0] ?? "", found: Boolean(sample) });
        if (!sample) return fail(`Sample not found: ${args.id}`);
        let analysisNote: string | undefined;
        if (args.analyze) {
          const res = await analyzeSample(sample, { http: service.http, deep: true });
          sample = res.sample;
          if (!res.analysis) analysisNote = res.warnings.length ? `Analysis unavailable: ${res.warnings.join("; ")}` : "Nothing to analyse.";
        }
        const selected = sample.files.length ? selectFiles(sample, { format: args.format }) : [];
        const size = totalBytes(selected);
        const l = links(sample);
        return json(
          compact({
            ...summarize(sample, l?.preview),
            description: sample.description?.slice(0, 600),
            files: sample.files.map(describeFile),
            selection: selected.length
              ? compact({
                  files: selected.map((f) => f.filename),
                  totalSize: size !== undefined ? formatBytes(size) : undefined,
                  previewOnly: isPreviewOnly(selected) || undefined,
                  downloadUrl: l ? `${l.download}${args.format ? `?format=${encodeURIComponent(args.format)}` : ""}` : undefined,
                  filename: selected.length === 1 ? samplePath(sample, selected[0]!).split("/").pop() : undefined,
                })
              : undefined,
            note:
              analysisNote ??
              (sample.files.some((f) => f.requiresAuth) && !selected.some((f) => f.role === "original")
                ? "The full-quality original needs an account on the source site; only the preview can be fetched here."
                : sample.files.length
                  ? undefined
                  : "No direct files: get it from the sample's page on the source site."),
            shareUrl: l?.share,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    }),
  );

  if (opts.allowLocalDownload) {
    server.registerTool(
      "download_sample",
      {
        title: "Download a sample",
        description:
          "Download a sample to a local folder (default: ./samples). Single sounds are filed by category " +
          "(samples/drums/kick/…wav); packs go to samples/packs/<name>/ and are extracted. ATTRIBUTION.md and credits.json in the " +
          "folder are updated with every download so the credits for a release are always in one place. " +
          "Only works for samples with downloadable=true.",
        inputSchema: {
          id: z.string().describe("Sample id from search_samples, e.g. 'freesound:2086'."),
          dest_dir: z.string().optional().describe("Destination folder (the project's samples folder)."),
          format: z.string().optional().describe("Preferred format: wav, aiff, flac, ogg, mp3, zip."),
          extract: z.boolean().optional().describe("Extract .zip packs (default true)."),
          all_files: z.boolean().optional().describe("Download every file (stems, MIDI, previews too)."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      timed("download_sample", async (args) => {
        try {
          const sample = await service.getSample(args.id);
          if (!sample) return fail(`Sample not found: ${args.id}`);
          const files = selectFiles(sample, { format: args.format, all: args.all_files });
          if (!files.length) {
            return fail(
              sample.files.length
                ? `No downloadable files match format=${args.format ?? "auto"}. Files: ${JSON.stringify(sample.files.map(describeFile))}`
                : `${sample.title} has no direct downloads. Get it from ${sample.url}`,
            );
          }
          const dir = resolve(args.dest_dir ?? opts.downloadDir ?? "samples");
          const result = await downloadSample(service.http, sample, files, dir, { extract: args.extract ?? true });
          await recordCredits(dir, [sample], sourceNames);
          analytics.download({ surface: "mcp", client: clientOf(), provider: sample.provider, kind: "local" });
          return json(
            compact({
              id: sample.id,
              title: sample.title,
              directory: result.directory,
              files: result.files.slice(0, 50).map((f) => f.path),
              fileCount: result.files.length,
              downloaded: formatBytes(result.bytes),
              previewOnly: result.previewOnly || undefined,
              note: result.previewOnly ? "Only the preview could be downloaded; the original needs an account on the source site." : undefined,
              license: licenceSummary(sample),
              attribution: sample.attribution,
              credits: `${dir}/ATTRIBUTION.md`,
              source: sample.url,
            }),
          );
        } catch (e) {
          return fail(e);
        }
      }),
    );
  }

  server.registerTool(
    "build_kit",
    {
      title: "Build a drum kit",
      description:
        "Pick a matching set of one-shots in one call: one sample per slot (default kick, snare, clap, closed hat, open hat, 808), " +
        "steered by a style ('dark trap', 'lofi', 'techno', '90s boom bap') and optionally a key for pitched slots. Commercial-safe and " +
        "directly downloadable by default. Returns each pick with alternatives, plus a Strudel snippet and a General MIDI/SFZ drum map" +
        (opts.allowLocalDownload ? ". With download=true the kit is saved to dest_dir with the maps and credits." : " with download links."),
      inputSchema: {
        style: z.string().optional().describe("Genre or character, e.g. 'dark trap', 'lofi dusty', 'hard techno'."),
        slots: z
          .array(z.string())
          .optional()
          .describe("Slots to fill, e.g. ['kick','snare','hat.closed','hat.open','clap','808','crash','perc','riser','vocal chop']."),
        bpm: z.number().min(40).max(300).optional(),
        key: z.string().optional().describe("Key for pitched slots (808, bass), e.g. 'F minor'."),
        commercial_only: z.boolean().optional().describe("Default true."),
        providers: z.array(z.string()).optional(),
        alternatives: z.number().int().min(0).max(5).optional().describe("Alternatives per slot (default 3)."),
        ...(opts.allowLocalDownload
          ? {
              download: z.boolean().optional().describe("Download the picks (default false)."),
              dest_dir: z.string().optional().describe("Folder for the kit (default ./samples/kits/<style>)."),
            }
          : {}),
      },
      annotations: { readOnlyHint: !opts.allowLocalDownload, openWorldHint: true },
    },
    timed("build_kit", async (args: Record<string, unknown>) => {
      try {
        const keyText = typeof args.key === "string" ? args.key : undefined;
        const key = keyText ? keyFromText(` ${keyText} `) ?? keyFromText(` key of ${keyText} `) : undefined;
        if (keyText && !key) return fail(`Could not read the key "${keyText}".`);
        const plan: KitPlan = await planKit(service, {
          slots: args.slots as string[] | undefined,
          style: args.style as string | undefined,
          bpm: args.bpm as number | undefined,
          key: key?.mode ? { tonic: key.tonic, mode: key.mode } : undefined,
          commercialOnly: (args.commercial_only as boolean | undefined) ?? true,
          providers: args.providers as string[] | undefined,
          perSlot: (args.alternatives as number | undefined) ?? 3,
        });
        const out = await kitExports(service, plan, {
          download: opts.allowLocalDownload && Boolean(args.download),
          destDir: (args.dest_dir as string | undefined) ?? opts.downloadDir,
          publicBaseUrl: base,
          sourceNames,
        });
        return json(out);
      } catch (e) {
        return fail(e);
      }
    }),
  );

  server.registerTool(
    "find_similar",
    {
      title: "Find similar sounds",
      description:
        "Sounds that sound like a given sample, from any source (e.g. 'strudel:…', 'freesound:2086'). " +
        (service.embeddings
          ? "Compares CLAP audio embeddings of previews against every sound this server has indexed so far (the index grows as samples are searched and opened); " +
            "Freesound ids fall back to Freesound's own similarity when the index has nothing. "
          : "Uses Freesound's audio similarity, so it works for freesound:* ids (audio embeddings for other sources are off on this server). ") +
        "Results carry the same fields as search_samples, with score = similarity (0..1). " +
        LICENCE_RULES,
      inputSchema: {
        id: z.string().describe("A sample id from search_samples, e.g. 'freesound:2086'."),
        limit: z.number().int().min(1).max(30).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    timed("find_similar", async (args) => {
      try {
        const res = await findSimilar(service, args.id, { limit: args.limit ?? 12 });
        return json(
          compact({
            id: res.id,
            method: res.method,
            results: res.results.map((s) => summarize(s, links(s)?.preview)),
            indexed: res.indexed,
            note: res.note,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    }),
  );

  server.registerTool(
    "extract_midi",
    {
      title: "Extract MIDI from a melodic loop",
      description:
        "Transcribe a melodic sample (bass line, lead, arpeggio, vocal line) to MIDI, one note at a time; chords and drums are not " +
        "transcribed. Notes snap to 16ths when the tempo is known (the sample's BPM or the `bpm` you pass). " +
        (opts.allowLocalDownload
          ? "The .mid file is written to <dest_dir>/midi/ and the notes are returned."
          : "Returns the notes; the .mid file is at `midiUrl`."),
      inputSchema: {
        id: z.string().describe("Sample id from search_samples, e.g. 'freesound:2086'."),
        bpm: z.number().min(40).max(300).optional().describe("Tempo of the loop when you know it."),
        quantize: z.union([z.literal(4), z.literal(8), z.literal(false)]).optional().describe("Steps per beat (4 = 16ths, default) or false."),
        ...(opts.allowLocalDownload ? { dest_dir: z.string().optional().describe("Project samples folder (default ./samples).") } : {}),
      },
      annotations: { readOnlyHint: !opts.allowLocalDownload, openWorldHint: true },
    },
    timed("extract_midi", async (args: { id: string; bpm?: number; quantize?: 4 | 8 | false; dest_dir?: string }) => {
      try {
        const sample = await service.getSample(args.id);
        if (!sample) return fail(`Sample not found: ${args.id}`);
        if (opts.allowLocalDownload) {
          return json(await writeMidiForSample(service, sample, args.dest_dir ?? opts.downloadDir ?? "samples", { bpm: args.bpm, quantize: args.quantize }));
        }
        const r = await midiForSample(service, sample, { bpm: args.bpm, quantize: args.quantize, signal: AbortSignal.timeout(60_000) });
        const q = new URLSearchParams();
        if (args.bpm) q.set("bpm", String(args.bpm));
        if (args.quantize !== undefined) q.set("quantize", String(args.quantize));
        return json({
          ...midiSummary(r),
          midiUrl: base ? `${base}/v1/samples/${encodeURIComponent(sample.id)}/midi${q.size ? `?${q}` : ""}` : undefined,
        });
      } catch (e) {
        return fail(e);
      }
    }),
  );

  if (opts.allowLocalDownload) {
    server.registerTool(
      "export_instrument",
      {
        title: "Turn a multisample pack into a playable instrument",
        description:
          "Download a multisample pack (orchestral notes, piano, guitar, synth notes: results with form 'multisample' or unit " +
          "'instrument'/'pack') and build an SFZ instrument and a Decent Sampler preset from it, with key ranges, velocity layers and " +
          "round robins worked out from the file names, embedded root notes or pitch detection. Files go to " +
          "<dest_dir>/instruments/<name>/ with the credits. Warns about missing notes.",
        inputSchema: {
          id: z.string().describe("Sample id of the pack, e.g. 'curated:iowa-mis-cymbals'."),
          variant: z.string().optional().describe("Which articulation/instrument to use when the pack holds several (see the summary)."),
          octave_offset: z.number().int().min(-2).max(2).optional().describe("Shift note names by octaves for packs where C3 = MIDI 60."),
          dest_dir: z.string().optional().describe("Project samples folder (default ./samples)."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      timed("export_instrument", async (args) => {
        try {
          const sample = await service.getSample(args.id);
          if (!sample) return fail(`Sample not found: ${args.id}`);
          return json(
            await instrumentForSample(service, sample, args.dest_dir ?? opts.downloadDir ?? "samples", {
              variant: args.variant,
              octaveOffset: args.octave_offset,
              sourceNames,
            }),
          );
        } catch (e) {
          return fail(e);
        }
      }),
    );
  }

  server.registerTool(
    "list_sources",
    {
      title: "List sample sources",
      description: "Every sample source with what it is best for, categories, pricing, licence and capabilities.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    timed("list_sources", async () =>
      json(
        service.listProviders().map((p) =>
          compact({
            id: p.id,
            name: p.name,
            bestFor: p.description,
            categories: p.categories,
            pricing: p.pricing,
            license: p.license ? `${p.license.name} (${p.license.verdict})` : "per sample",
            search: p.access === "link" ? "deep link only" : p.access,
            downloads: p.supportsDownload,
            enabled: p.enabled ? undefined : `needs ${p.apiKeyEnv}`,
          }),
        ),
      ),
    ),
  );

  return server;
}

function licenceSummary(s: Sample) {
  return s.license
    ? compact({ name: s.license.name, id: s.license.id, verdict: s.license.verdict, meaning: VERDICT_LABELS[s.license.verdict], note: s.license.note, url: s.license.url })
    : { verdict: "check-terms", meaning: VERDICT_LABELS["check-terms"] };
}

export function summarize(s: Sample, proxyPreview?: string) {
  return compact({
    id: s.id,
    title: s.title,
    category: s.category,
    form: s.form,
    unit: s.unit !== "sample" ? s.unit : undefined,
    bpm: s.bpm,
    key: s.key ? formatKey(s.key) : undefined,
    duration: s.durationSec,
    source: s.provider,
    url: s.url,
    preview: s.previewNeedsReferer ? proxyPreview : (s.previewUrl ?? undefined),
    license: licenceSummary(s),
    attribution: s.attribution,
    author: s.author,
    free: s.price ? s.price.free : undefined,
    price: s.price?.amount !== undefined ? `${s.price.amount} ${s.price.currency ?? ""}`.trim() : undefined,
    formats: s.formats?.length ? s.formats : undefined,
    downloadable: s.downloadable,
    needsAccount: s.requiresAccount || undefined,
    tags: s.tags.length ? s.tags.slice(0, 8) : undefined,
    score: s.score,
  });
}

function describeFile(f: SampleFile) {
  return compact({
    filename: f.filename,
    format: f.format,
    role: f.role,
    sampleRate: f.sampleRate,
    bitDepth: f.bitDepth,
    size: f.sizeBytes !== undefined ? formatBytes(f.sizeBytes) : undefined,
    needsLogin: f.requiresAuth || undefined,
  });
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export function json(value: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] };
}

function fail(e: unknown): ToolResult {
  return { isError: true, content: [{ type: "text" as const, text: typeof e === "string" ? e : errorMessage(e) }] };
}

export type { SampleDetails };
