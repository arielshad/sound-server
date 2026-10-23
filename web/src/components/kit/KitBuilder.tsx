import { useMemo, useState } from "react";
import { setNonce } from "get-nonce";
import { AlertTriangle, ArrowUpRight, Check, Copy, Download, Loader2, Pause, Play, Plus, Shuffle, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TOP_CATEGORIES, VERDICTS, VERDICT_LABELS, categoryLabel, categoryPath, durationText, subCategories, verdictTone, type Verdict } from "@/lib/vocab";
import { api, UnauthorizedError, type License, type Sample } from "@/components/search/api";
import { KeyPicker } from "@/components/search/Filters";
import { Placeholder } from "@/components/search/SampleRow";
import { useSamplePlayer } from "@/components/search/useSamplePlayer";
import { TONE_CLASS, VerdictBadge } from "@/components/search/VerdictBadge";
import { CopyButton } from "@/components/home/AgentSetup";

if (typeof document !== "undefined") {
  const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content;
  if (nonce) setNonce(nonce);
}

/** The server's default kit (src/core/kit.ts DEFAULT_SLOTS), as category ids. */
const DEFAULT_SLOTS = ["drums.kick", "drums.snare", "drums.clap", "drums.hat.closed", "drums.hat.open", "bass.808"];
const STYLES = ["dark trap", "lofi dusty", "90s boom bap", "hard techno", "deep house", "drill"];
/** Categories offered as extra slots: drum and bass parts, then a few FX and vocal ones. */
const SLOT_GROUPS = ["drums", "bass", "fx", "vocals"].filter((t) => TOP_CATEGORIES.includes(t));

/** A pick as /v1/kits returns it (a summary; full Sample fields are accepted too). */
interface KitItem {
  id: string;
  title: string;
  category: string;
  form?: string;
  duration?: number;
  durationSec?: number;
  key?: string | { tonic: string; mode: string };
  source?: string;
  provider?: string;
  url: string;
  preview?: string;
  previewUrl?: string;
  previewNeedsReferer?: boolean;
  license?: string | License;
  verdict?: string;
  attribution?: string;
}
interface KitSlotResult {
  slot: string;
  category: string;
  pick?: KitItem;
  alternatives: KitItem[];
  reason: string;
}
interface KitResponse {
  name?: string;
  bpm?: number;
  key?: string;
  slots: KitSlotResult[];
  warnings?: string[];
  licences?: Partial<Record<string, number>>;
  creditsNeeded?: boolean;
  credits?: string[];
  strudel?: { map?: Record<string, string | string[]>; snippet: string; note?: string };
  gm?: { map?: unknown; bySlot?: Record<string, number>; sfz: string };
}

/** Normalise a kit item to the Sample fields the players and badges use. */
function toSample(i: KitItem): Sample {
  const license: License | undefined =
    typeof i.license === "object" ? i.license : { id: "", name: (i.license ?? "").split(":")[0] || "Licence not stated", verdict: i.verdict ?? "check-terms" };
  let key: Sample["key"];
  if (typeof i.key === "string") {
    const [tonic, mode] = i.key.split(" ");
    if (tonic && (mode === "major" || mode === "minor")) key = { tonic, mode };
  } else key = i.key as Sample["key"];
  return {
    id: i.id,
    provider: i.provider ?? i.source ?? i.id.split(":")[0] ?? "",
    title: i.title,
    url: i.url,
    tags: [],
    category: i.category,
    form: i.form,
    durationSec: i.durationSec ?? i.duration,
    key,
    previewUrl: i.previewUrl ?? i.preview,
    previewNeedsReferer: i.previewNeedsReferer,
    license,
    attribution: i.attribution,
    downloadable: true,
  };
}

/** strudel.cc reads code from the URL hash (base64 of the UTF-8 text). */
function strudelLink(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `https://strudel.cc/#${encodeURIComponent(btoa(bin))}`;
}

function MiniPlayer({ sample, playerKey }: { sample: Sample; playerKey: string }) {
  const p = useSamplePlayer(playerKey, sample, { height: 32, points: 120 });
  const busy = p.playing && p.state === "loading";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onClick={() => void p.toggle()}
        aria-label={p.playing ? `Pause ${sample.title}` : `Play ${sample.title}`}
        title={p.failed ? "The preview could not be played here" : undefined}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40",
          p.playing ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50 hover:text-primary",
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : p.playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
      </button>
      <div className="relative h-8 min-w-0 flex-1">
        {p.state !== "ready" && (
          <div className="absolute inset-0" aria-hidden="true">
            {p.state === "nowave" ? <div className="flex h-full items-center"><div className="h-px w-full bg-border" /></div> : <Placeholder seed={sample.id} bars={40} />}
          </div>
        )}
        <div ref={p.container} className={cn("h-8 w-full", p.state !== "ready" && "invisible")} />
      </div>
    </div>
  );
}

function SlotCard({ slot, pick, onSwap }: { slot: KitSlotResult; pick?: KitItem; onSwap: (alt: KitItem) => void }) {
  const [showAlts, setShowAlts] = useState(false);
  const s = pick ? toSample(pick) : undefined;
  const alts = [...(slot.pick && slot.pick.id !== pick?.id ? [slot.pick] : []), ...slot.alternatives.filter((a) => a.id !== pick?.id)];
  return (
    <li className="rounded-xl border bg-card/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{categoryLabel(slot.category) || slot.slot}</h3>
        <span className="text-xs text-muted-foreground">{categoryPath(slot.category)}</span>
      </div>
      {s ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <MiniPlayer sample={s} playerKey={`kit:${slot.slot}:${s.id}`} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <a href={`/search?sample=${encodeURIComponent(s.id)}`} className="min-w-0 truncate font-medium hover:text-primary hover:underline" title={s.title}>{s.title}</a>
            <span className="text-xs text-muted-foreground">{s.provider}{s.durationSec ? ` · ${durationText(s.durationSec)}` : ""}</span>
            <span className="ml-auto"><VerdictBadge license={s.license} /></span>
          </div>
          {slot.reason && <p className="mt-1 text-xs text-muted-foreground">{slot.reason}</p>}
        </>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm text-warning"><AlertTriangle className="size-4" /> {slot.reason || "Nothing matched this slot."}</p>
      )}
      {alts.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowAlts(!showAlts)} aria-expanded={showAlts} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <Shuffle className="size-3" /> {showAlts ? "Hide" : "Show"} {alts.length} alternative{alts.length === 1 ? "" : "s"}
          </button>
          {showAlts && (
            <ul className="mt-2 space-y-2 border-l pl-3">
              {alts.map((a) => {
                const as = toSample(a);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <MiniPlayer sample={as} playerKey={`kit-alt:${slot.slot}:${a.id}`} />
                    <span className="flex w-full items-center gap-2 text-xs sm:w-auto">
                      <span className="max-w-[12rem] truncate" title={a.title}>{a.title}</span>
                      <VerdictBadge license={as.license} />
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onSwap(a)}>Use</Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export default function KitBuilder() {
  const [style, setStyle] = useState("dark trap");
  const [bpm, setBpm] = useState("140");
  const [key, setKey] = useState("F minor");
  const [commercial, setCommercial] = useState(true);
  const [slots, setSlots] = useState<string[]>(DEFAULT_SLOTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [kit, setKit] = useState<KitResponse | null>(null);
  /** Slot → the pick the user chose instead (alternatives). */
  const [swaps, setSwaps] = useState<Record<string, KitItem>>({});
  const [copied, setCopied] = useState(false);

  const build = async () => {
    setLoading(true);
    setError(undefined);
    setSwaps({});
    const n = Number(bpm);
    try {
      const res = await api<KitResponse>("/v1/kits", {
        method: "POST",
        body: { style: style.trim() || undefined, bpm: Number.isFinite(n) && n >= 40 && n <= 300 ? n : undefined, key: key || undefined, slots, commercialOnly: commercial, perSlot: 3 },
      });
      setKit(res);
    } catch (e) {
      setError(e instanceof UnauthorizedError ? "This server needs an API key: set it on the search page first." : e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const picks = useMemo(() => (kit?.slots ?? []).map((s) => ({ slot: s, pick: swaps[s.slot] ?? s.pick })), [kit, swaps]);

  /** The Strudel snippet with swapped picks replaced (their URLs embed the sample id). */
  const snippet = useMemo(() => {
    let code = kit?.strudel?.snippet ?? "";
    for (const { slot, pick } of picks) {
      if (!pick || !slot.pick || pick.id === slot.pick.id) continue;
      code = code.split(encodeURIComponent(slot.pick.id)).join(encodeURIComponent(pick.id));
      const oldUrl = slot.pick.previewUrl ?? slot.pick.preview;
      const newUrl = pick.previewUrl ?? pick.preview;
      if (oldUrl && newUrl) code = code.split(oldUrl).join(newUrl);
    }
    return code;
  }, [kit, picks]);

  const licenceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const { pick } of picks) if (pick) {
      const v = toSample(pick).license?.verdict ?? "check-terms";
      counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
  }, [picks]);
  const credits = picks.map(({ pick }) => pick?.attribution).filter((x): x is string => Boolean(x));
  const notCleared = Object.entries(licenceCounts).filter(([v]) => verdictTone(v) !== "green").reduce((n, [, c]) => n + c, 0);

  return (
    <TooltipProvider>
      <div className="grid gap-8 lg:grid-cols-[20rem_1fr]">
        <form
          className="h-fit space-y-5 rounded-2xl border bg-card/40 p-4 sm:p-5 lg:sticky lg:top-20"
          onSubmit={(e) => {
            e.preventDefault();
            void build();
          }}
        >
          <div>
            <label htmlFor="kit-style" className="text-sm font-medium">Style</label>
            <Input id="kit-style" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="dark trap, lofi, techno…" className="mt-1.5" maxLength={80} />
            <div className="mt-2 flex flex-wrap gap-1">
              {STYLES.map((x) => (
                <button key={x} type="button" onClick={() => setStyle(x)} className={cn("rounded-full border px-2 py-0.5 text-xs transition", style === x ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
                  {x}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="kit-bpm" className="text-sm font-medium">Tempo</label>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Input id="kit-bpm" type="number" min={40} max={300} value={bpm} onChange={(e) => setBpm(e.target.value)} className="w-20" />
                <span className="text-sm text-muted-foreground">BPM</span>
              </div>
            </div>
            <div>
              <span className="text-sm font-medium">Key</span>
              <div className="mt-1.5">
                <KeyPicker value={key} onChange={setKey} />
              </div>
            </div>
          </div>
          <div>
            <span className="text-sm font-medium">Slots</span>
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Kit slots">
              {slots.map((sl) => (
                <li key={sl} className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2.5 pr-1 text-xs">
                  {categoryLabel(sl)}
                  <button type="button" onClick={() => setSlots(slots.filter((x) => x !== sl))} aria-label={`Remove ${categoryLabel(sl)}`} className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <X className="size-3" />
                  </button>
                </li>
              ))}
              <li>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" disabled={slots.length >= 16} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
                      <Plus className="size-3" /> Add
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="max-h-80 w-64 overflow-y-auto p-2">
                    {SLOT_GROUPS.map((top) => (
                      <div key={top} className="mb-2">
                        <p className="px-1.5 py-1 text-xs font-medium text-muted-foreground">{categoryLabel(top)}</p>
                        <div className="flex flex-wrap gap-1 px-1">
                          {subCategories(top)
                            .filter((c) => !slots.includes(c.id))
                            .map((c) => (
                              <button key={c.id} type="button" onClick={() => setSlots([...slots, c.id])} className="rounded-full border px-2 py-0.5 text-xs hover:border-primary/40 hover:bg-accent">
                                {c.label}
                              </button>
                            ))}
                        </div>
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
              </li>
            </ul>
            {slots.join() !== DEFAULT_SLOTS.join() && (
              <button type="button" onClick={() => setSlots(DEFAULT_SLOTS)} className="mt-1.5 text-xs text-primary hover:underline">Reset to the default kit</button>
            )}
          </div>
          <Switch label="Commercial-safe picks only" labelClassName="text-sm" checked={commercial} onCheckedChange={setCommercial} />
          <Button type="submit" className="w-full" disabled={loading || !slots.length}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {loading ? "Picking sounds…" : kit ? "Build again" : "Build kit"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Each slot runs its own search, steered by the style, tempo and key, and picks the best match with a direct download. Agents get the same with the <code className="font-mono">build_kit</code> MCP tool.
          </p>
        </form>

        <div className="min-w-0">
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
          {!kit && !loading && !error && (
            <div className="flex h-full min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
              <Wand2 className="size-8 text-primary/70" aria-hidden="true" />
              <p className="mt-3 max-w-md">Pick a style, tempo and key, then build. You get one sound per slot with alternatives, a licence summary and a Strudel snippet that plays the kit in your browser.</p>
            </div>
          )}
          {loading && !kit && (
            <div className="flex min-h-60 items-center justify-center gap-2 rounded-2xl border p-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> Searching every source for {slots.length} slots…
            </div>
          )}
          {kit && (
            <div className={cn("space-y-8", loading && "opacity-60")}>
              <section aria-labelledby="licences-h" className="rounded-xl border p-4">
                <h2 id="licences-h" className="font-medium">Licences in this kit</h2>
                <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                  {VERDICTS.filter((v) => licenceCounts[v]).map((v) => (
                    <li key={v} className={cn("rounded-full border px-2.5 py-0.5 font-medium", TONE_CLASS[verdictTone(v)])}>
                      {licenceCounts[v]} × {VERDICT_LABELS[v as Verdict]}
                    </li>
                  ))}
                </ul>
                {notCleared > 0 && <p className="mt-2 text-sm text-warning">{notCleared} pick{notCleared === 1 ? " is" : "s are"} not cleared for a commercial release. Swap {notCleared === 1 ? "it" : "them"} for an alternative or check the terms.</p>}
                {credits.length > 0 && (
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm">Credits to include with your release:</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void navigator.clipboard.writeText(credits.join("\n")).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1600);
                          })
                        }
                      >
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy credits"}
                      </Button>
                    </div>
                    <ul className="mt-2 space-y-1 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
                      {credits.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                )}
                {kit.warnings?.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {kit.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" />{w}</li>)}
                  </ul>
                ) : null}
              </section>

              <section aria-labelledby="picks-h">
                <h2 id="picks-h" className="text-xl font-semibold tracking-tight">The kit{kit.bpm ? ` · ${kit.bpm} BPM` : ""}{kit.key ? ` · ${kit.key}` : ""}</h2>
                <ul className="mt-4 grid gap-3 xl:grid-cols-2">
                  {picks.map(({ slot, pick }) => (
                    <SlotCard key={slot.slot} slot={slot} pick={pick} onSwap={(alt) => setSwaps((x) => ({ ...x, [slot.slot]: alt }))} />
                  ))}
                </ul>
              </section>

              {snippet && (
                <section aria-labelledby="strudel-h">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="strudel-h" className="text-xl font-semibold tracking-tight">Play it in Strudel</h2>
                    <a href={strudelLink(snippet)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      Open in strudel.cc <ArrowUpRight className="size-3.5" />
                    </a>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Paste this into <a className="text-primary hover:underline" href="https://strudel.cc" target="_blank" rel="noopener noreferrer">strudel.cc</a> and press Ctrl+Enter. {kit.strudel?.note ?? "The samples stream through this server's preview proxy, which allows cross-origin playback."}
                  </p>
                  <div className="mt-3 rounded-lg bg-[#0d0d12] p-3 text-zinc-100">
                    <div className="mb-2 flex justify-end"><CopyButton text={snippet} /></div>
                    <pre className="max-h-96 overflow-auto font-mono text-[12px] leading-relaxed"><code>{snippet}</code></pre>
                  </div>
                </section>
              )}

              {kit.gm?.sfz && (
                <details className="rounded-xl border p-4">
                  <summary className="cursor-pointer font-medium">General MIDI map and SFZ file</summary>
                  <p className="mt-2 text-sm text-muted-foreground">Kick on MIDI note 36, snare 38, clap 39, closed hat 42, open hat 46, 808 on 35. Load the SFZ in any SFZ sampler (sfizz, Sforzando, DecentSampler converts it).</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(new Blob([kit.gm!.sfz], { type: "text/plain" }));
                        a.download = `${kit.name ?? "kit"}.sfz`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
                      }}
                    >
                      <Download className="size-3.5" /> Download .sfz
                    </Button>
                  </div>
                  <div className="mt-3 rounded-lg bg-[#0d0d12] p-3 text-zinc-100">
                    <div className="mb-2 flex justify-end"><CopyButton text={kit.gm.sfz} /></div>
                    <pre className="max-h-72 overflow-auto font-mono text-[12px] leading-relaxed"><code>{kit.gm.sfz}</code></pre>
                  </div>
                </details>
              )}
              <p className="text-xs text-muted-foreground">
                Sounds stay with their creators. Download each pick from its detail page (it opens in the search) or let your agent fetch the whole kit with credits:{" "}
                <a className="text-primary hover:underline" href="/docs/mcp">build_kit with download=true</a> on a local MCP server.
              </p>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
