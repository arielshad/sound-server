/**
 * Turn a kit plan into something an agent can use: a summary per slot, a
 * Strudel sample map and snippet, a General MIDI / SFZ drum map, and (locally)
 * the downloaded files with their credits.
 */
import { writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { recordCredits } from "../core/credits-file.js";
import { downloadSample, safeFilename, selectFiles } from "../core/download.js";
import { gmDrumMap, kitSamples, strudelSampleMap, type KitPlan } from "../core/kit.js";
import { VERDICT_LABELS } from "../core/licence.js";
import { formatKey } from "../core/query.js";
import type { SampleService } from "../core/service.js";
import type { Sample } from "../core/types.js";
import { compact } from "../core/util.js";

export interface KitExportOptions {
  /** Download the picks into `destDir/kits/<name>` (local MCP/CLI only). */
  download?: boolean;
  destDir?: string;
  /** Public base URL: kit maps then point at this server's preview proxy (CORS-enabled). */
  publicBaseUrl?: string;
  sourceNames: Record<string, string>;
}

function brief(s: Sample) {
  return compact({
    id: s.id,
    title: s.title,
    category: s.category,
    form: s.form,
    duration: s.durationSec,
    key: s.key ? formatKey(s.key) : undefined,
    source: s.provider,
    url: s.url,
    preview: s.previewUrl,
    license: s.license ? `${s.license.name}: ${VERDICT_LABELS[s.license.verdict]}` : VERDICT_LABELS["check-terms"],
    verdict: s.license?.verdict ?? "check-terms",
    attribution: s.attribution,
  });
}

export async function kitExports(service: SampleService, plan: KitPlan, opts: KitExportOptions) {
  const base = opts.publicBaseUrl?.replace(/\/$/, "");
  const picks = plan.slots.filter((s) => s.pick);
  const paths: Record<string, string> = {};
  let downloaded: { directory: string; files: string[] } | undefined;
  let credits: string | undefined;

  if (opts.download && picks.length) {
    const dir = resolve(opts.destDir ?? "samples", "kits", safeFilename(plan.name, "kit").replace(/\.[^.]*$/, ""));
    const files: string[] = [];
    const filesById: Record<string, { path: string }[]> = {};
    const samples: Sample[] = [];
    for (const s of picks) {
      const details = await service.getSample(s.pick!.id);
      if (!details) continue;
      const chosen = selectFiles(details);
      if (!chosen.length) continue;
      const res = await downloadSample(service.http, details, chosen, dir, { extract: false });
      const first = res.files[0];
      if (!first) continue;
      paths[s.slot] = relative(dir, first.path).replaceAll("\\", "/");
      files.push(...res.files.map((f) => f.path));
      filesById[details.id] = res.files.map((f) => ({ path: relative(dir, f.path).replaceAll("\\", "/") }));
      samples.push(details);
    }
    const strudel = strudelSampleMap(plan, { paths, baseUrl: "http://localhost:5432/" });
    const gm = gmDrumMap(plan, { paths });
    await writeFile(join(dir, "strudel.json"), JSON.stringify(strudel.json, null, 2));
    await writeFile(join(dir, "kit.sfz"), gm.sfz);
    await writeFile(join(dir, "gm-map.json"), JSON.stringify(gm.bySlot, null, 2));
    await recordCredits(dir, samples, opts.sourceNames, filesById);
    downloaded = { directory: dir, files };
    credits = join(dir, "ATTRIBUTION.md");
    return {
      ...summary(plan),
      strudel: {
        snippet: strudel.snippet,
        note: "Serve the kit folder for Strudel with `npx @strudel/sampler` (port 5432), or replace _base with where you host the files.",
      },
      gm: { bySlot: gm.bySlot, sfz: join(dir, "kit.sfz") },
      downloaded,
      credits,
    };
  }

  // Not downloading: point the maps at playable URLs.
  for (const s of picks) {
    const p = s.pick!;
    paths[s.slot] = base ? `${base}/v1/samples/${encodeURIComponent(p.id)}/preview?proxy=1` : (p.previewUrl ?? p.url);
  }
  const strudel = strudelSampleMap(plan, { paths });
  const gm = gmDrumMap(plan, { paths });
  return {
    ...summary(plan),
    strudel: {
      map: strudel.json,
      snippet: strudel.snippet,
      note: base ? "The map plays the previews through this server (CORS enabled), so it works in strudel.cc as is." : undefined,
    },
    gm: { bySlot: gm.bySlot, sfz: gm.sfz },
  };
}

function summary(plan: KitPlan) {
  const samples = kitSamples(plan);
  return compact({
    name: plan.name,
    style: plan.style,
    bpm: plan.bpm,
    key: plan.key ? formatKey(plan.key) : undefined,
    slots: plan.slots.map((s) =>
      compact({
        slot: s.slot,
        category: s.category,
        pick: s.pick ? brief(s.pick) : undefined,
        alternatives: s.alternatives.map(brief),
        reason: s.reason,
      }),
    ),
    warnings: plan.warnings.length ? plan.warnings : undefined,
    licences: plan.licences,
    creditsNeeded: plan.creditsNeeded,
    credits: samples.filter((s) => s.attribution).map((s) => s.attribution),
  });
}
