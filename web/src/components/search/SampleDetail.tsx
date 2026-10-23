import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Bot, Check, Copy, Download, FileAudio, Info, Loader2, Lock, Pause, Play, Share2, Terminal, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/home/AgentSetup";
import { VERDICT_MEANING, categoryPath, durationText, formLabel, keyText, verdictTone, type Verdict } from "@/lib/vocab";
import { cn } from "@/lib/utils";
import { MCP_NAME } from "@/lib/site";
import { api, download, formatBytes, safeUrl, sampleBase, slugName, type FileSelection, type Sample, type SampleDetails, type SampleFile } from "./api";
import { Placeholder } from "./SampleRow";
import { useSamplePlayer } from "./useSamplePlayer";
import { TONE_CLASS, VerdictBadge } from "./VerdictBadge";

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Big waveform with a play button and time. */
export function BigPlayer({ sample, playerKey }: { sample: Sample; playerKey: string }) {
  const p = useSamplePlayer(playerKey, sample, { height: 88, barWidth: 3, points: 500 });
  const busy = p.playing && p.state === "loading";
  return (
    <div className="rounded-xl border bg-card/60 p-3">
      <div className="relative h-[88px]">
        {p.state !== "ready" && (
          <div className={cn("absolute inset-0", p.state === "loading" && "animate-pulse")} aria-hidden="true">
            {p.state !== "nowave" ? <Placeholder seed={sample.id} bars={80} /> : <div className="flex h-full items-center"><div className="h-px w-full bg-border" /></div>}
          </div>
        )}
        <div ref={p.container} className={cn("h-[88px] w-full", p.state !== "ready" && "invisible")} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Button size="sm" onClick={() => void p.toggle()} aria-label={p.playing ? "Pause preview" : "Play preview"}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : p.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {p.playing ? "Pause" : "Play preview"}
        </Button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {fmtTime(p.time)}
          {p.duration ? ` / ${fmtTime(p.duration)}` : ""}
        </span>
        {p.failed ? (
          <span className="text-xs text-destructive">The preview could not be played here. Listen on the source page.</span>
        ) : (
          p.state === "nowave" && <span className="text-xs text-muted-foreground">No waveform for this one, but it plays.</span>
        )}
      </div>
    </div>
  );
}

function LightCopy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        })
      }
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : label}
    </Button>
  );
}

function fileFacts(f: SampleFile): string {
  return [f.sampleRate ? `${(f.sampleRate / 1000).toLocaleString("en", { maximumFractionDigits: 1 })} kHz` : "", f.bitDepth ? `${f.bitDepth}-bit` : "", f.channels ? (f.channels === 1 ? "mono" : f.channels === 2 ? "stereo" : `${f.channels} ch`) : ""]
    .filter(Boolean)
    .join(" · ");
}

export function SampleDetail({ sample, providerName }: { sample: Sample; providerName: string }) {
  const [full, setFull] = useState<SampleDetails | null>(null);
  const [failed, setFailed] = useState<string>();
  const [format, setFormat] = useState("");
  const [selection, setSelection] = useState<FileSelection | null>(null);
  const [dlError, setDlError] = useState<string>();

  useEffect(() => {
    setFull(null);
    setFailed(undefined);
    setFormat("");
    api<SampleDetails>(sampleBase(sample.id))
      .then(setFull)
      .catch((e: Error) => setFailed(e.message));
  }, [sample.id]);

  const s: Sample = full ?? sample;
  const files = full?.files ?? [];
  const fetchable = useMemo(() => files.filter((f) => !f.requiresAuth), [files]);
  const formats = useMemo(() => [...new Set(fetchable.filter((f) => f.role !== "midi").map((f) => f.format))], [fetchable]);
  const qs = format ? `?format=${encodeURIComponent(format)}` : "";
  const base = sampleBase(sample.id);

  useEffect(() => {
    if (!fetchable.length) return;
    setSelection(null);
    api<FileSelection>(`${base}/files${qs}`)
      .then(setSelection)
      .catch(() => setSelection(null));
  }, [base, qs, fetchable.length]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = full?.shareUrl ?? `${origin}/search?sample=${encodeURIComponent(sample.id)}`;
  const source = safeUrl(s.url);
  const verdict = (s.license?.verdict ?? "check-terms") as Verdict;
  const tone = verdictTone(verdict);
  const name = slugName(s.title);
  const ext = selection?.files.length === 1 ? selection.files[0]!.format : "zip";
  const curl = `curl -L -o "${name}.${ext}" "${origin}${base}/download${qs}"`;
  const prompt = `Use the ${MCP_NAME} MCP server: get_sample("${sample.id}")${format ? ` as ${format}` : ""}, check its licence verdict, download it into ./samples and add the credit line to CREDITS.md if one is needed.`;
  const credit = s.attribution;
  const lockedOriginal = files.some((f) => f.requiresAuth && f.role === "original");
  const previewOnly = Boolean(selection?.files.length) && selection!.files.every((f) => f.role === "preview");

  const facts: [string, React.ReactNode][] = [
    ["Category", categoryPath(s.category)],
    ["Form", s.unit === "pack" ? `Pack${s.packSize ? ` of ${s.packSize}` : ""}` : formLabel(s.form)],
    ["Tempo", s.bpm ? `${Math.round(s.bpm * 10) / 10} BPM` : undefined],
    ["Key", keyText(s.key) || undefined],
    ["Length", durationText(s.durationSec) || undefined],
    ["Audio", [s.sampleRate ? `${s.sampleRate / 1000} kHz` : "", s.bitDepth ? `${s.bitDepth}-bit` : "", s.channels ? (s.channels === 1 ? "mono" : "stereo") : ""].filter(Boolean).join(" · ") || undefined],
    ["Loudness", s.loudnessLufs !== undefined ? `${s.loudnessLufs.toFixed(1)} LUFS` : undefined],
    ["Formats", s.formats?.length ? s.formats.join(", ").toUpperCase() : undefined],
    [
      "Author",
      s.author ? (
        safeUrl(s.authorUrl) ? (
          <a className="text-primary hover:underline" href={safeUrl(s.authorUrl)} target="_blank" rel="noopener noreferrer">{s.author}</a>
        ) : (
          s.author
        )
      ) : undefined,
    ],
    ["Price", s.price ? (s.price.free ? "Free" : s.price.amount != null ? `${s.price.amount} ${s.price.currency ?? ""}` : "Paid") : undefined],
    ["Sample id", <code className="break-all font-mono text-xs">{s.id}</code>],
  ];

  return (
    <div className="space-y-6 px-4 pb-10 sm:px-6">
      <BigPlayer sample={s} playerKey={`detail:${sample.id}`} />

      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {facts
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
      </dl>

      {/* Licence */}
      <section aria-labelledby="licence-h" className={cn("rounded-xl border p-4", TONE_CLASS[tone].replace(/text-\S+/, ""))}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="licence-h" className="font-medium">Can I use it in a release?</h3>
          <VerdictBadge license={s.license} size="lg" />
        </div>
        <p className="mt-2 text-sm leading-relaxed">{VERDICT_MEANING[verdict] ?? ""}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Licence:{" "}
          {s.license ? (
            safeUrl(s.license.url) ? (
              <a className="text-primary hover:underline" href={safeUrl(s.license.url)} target="_blank" rel="noopener noreferrer">{s.license.name}</a>
            ) : (
              s.license.name
            )
          ) : (
            "not stated by the source"
          )}
          {s.license?.redistribution === false && " · don't share the sample itself"}
        </p>
        {s.license?.note && <p className="mt-1 text-sm text-muted-foreground">{s.license.note}</p>}
        {s.license?.assertedBy === "uploader" && (
          <p className="mt-3 flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span>The licence was stated by whoever uploaded it, and {providerName} does not check it. Uploaders sometimes post sounds they don't own: treat it as unverified.</span>
          </p>
        )}
        {s.license?.assertedBy === "site" && <p className="mt-2 text-xs text-muted-foreground">{providerName} applies one licence to all its sounds.</p>}
        <p className="mt-3 text-xs">
          <a href="/docs/licences" className="text-primary hover:underline">How licence verdicts work</a>
        </p>
      </section>

      {/* Credit line */}
      <section aria-labelledby="credit-h" className="space-y-2">
        <h3 id="credit-h" className="flex items-center gap-2 font-medium"><UserRound className="size-4 text-primary" /> Credit line</h3>
        {credit ? (
          <>
            <p className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed">{credit}</p>
            <div className="flex flex-wrap items-center gap-2">
              <LightCopy text={credit} label="Copy credit" />
              <span className="text-xs text-muted-foreground">Put it in your release notes, video description or CREDITS file.</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {s.license?.attributionRequired === false ? "No credit is required. Crediting the author is still a nice thing to do." : "The source gives no credit line. If you use it, credit the author and link the source page."}
          </p>
        )}
      </section>

      {s.requiresAccount && (
        <p className="flex gap-2 rounded-lg border p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            The full-quality original needs a (free) account on {providerName}. The preview plays here; sign in on{" "}
            {source ? <a className="text-primary hover:underline" href={source} target="_blank" rel="noopener noreferrer">its page</a> : providerName} to download the original.
          </span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {source && (
          <Button variant="outline" asChild>
            <a href={source} target="_blank" rel="noopener noreferrer">Open on {providerName} <ArrowUpRight className="size-4" /></a>
          </Button>
        )}
        <ShareButton title={s.title} url={shareUrl} />
      </div>

      <Separator />

      {/* Files and download */}
      <section aria-labelledby="files-h" className="space-y-3">
        <h3 id="files-h" className="flex items-center gap-2 font-medium"><FileAudio className="size-4 text-primary" /> Files</h3>
        {!full && !failed && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading files…</p>}
        {failed && <p className="text-sm text-destructive">Could not load the details: {failed}</p>}
        {full && !files.length && <p className="text-sm text-muted-foreground">No direct files from this source. Get it on the source page.</p>}
        {files.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Audio</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {files.slice(0, 40).map((f) => (
                  <tr key={f.url + f.filename}>
                    <td className="max-w-[12rem] truncate px-3 py-1.5 font-mono" title={f.filename}>
                      <span className="mr-1.5 rounded bg-muted px-1 py-px font-sans text-[10px] font-semibold uppercase">{f.format}</span>
                      {f.filename}
                    </td>
                    <td className="px-3 py-1.5">{f.role}{f.requiresAuth && <Lock className="ml-1 inline size-3 text-muted-foreground" aria-label="needs an account" />}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{fileFacts(f)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatBytes(f.sizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {fetchable.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {formats.length > 1 && (
                <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                  <option value="">Best format</option>
                  {formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                </select>
              )}
              <Button
                onClick={() => {
                  setDlError(undefined);
                  download(`${base}/download${qs}`, name).catch((e: Error) => setDlError(e.message));
                }}
                disabled={selection !== null && !selection.files.length}
              >
                <Download className="size-4" /> Download{selection?.files.length === 1 ? ` ${selection.files[0]!.format.toUpperCase()}` : ""}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDlError(undefined);
                  download(`${base}/download${qs}${qs ? "&" : "?"}bundle=true`, `${name}.zip`).catch((e: Error) => setDlError(e.message));
                }}
                title="A zip with the audio, ATTRIBUTION.md and credits.json"
              >
                Zip with credits
              </Button>
              {selection?.totalBytes != null && <span className="text-xs text-muted-foreground">{formatBytes(selection.totalBytes)}</span>}
            </div>
            {previewOnly && <p className="text-xs text-muted-foreground">Only the preview can be downloaded here{lockedOriginal ? "; the original needs an account on the source" : ""}.</p>}
            {dlError && <p className="text-xs text-destructive">{dlError}</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="code-h" className="space-y-3">
        <h3 id="code-h" className="flex items-center gap-2 font-medium"><Terminal className="size-4 text-primary" /> From code or an agent</h3>
        <Snippet icon={<Terminal className="size-3.5" />} label="curl" text={curl} />
        <Snippet icon={<Bot className="size-3.5" />} label="Ask your agent" text={prompt} />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" /> Agents connect with <code className="font-mono">claude mcp add --transport http {MCP_NAME} {origin}/mcp</code>. <a href="/docs/mcp" className="text-primary hover:underline">Setup</a>
        </p>
      </section>

      {s.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.tags.slice(0, 16).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
        </div>
      )}
      {s.description && <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{s.description.slice(0, 800)}</p>}
    </div>
  );
}

function Snippet({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <div className="rounded-lg bg-[#0d0d12] p-3 text-zinc-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">{icon}{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed">{text}</pre>
    </div>
  );
}

/** Share link to this sample (`/search?sample=<id>`, which unfurls with its own preview card). */
function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <Button variant="outline" onClick={() => void share()}>
      {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
      {copied ? "Link copied" : "Share"}
    </Button>
  );
}
