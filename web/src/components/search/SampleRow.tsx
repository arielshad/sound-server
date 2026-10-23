import { memo } from "react";
import { CircleAlert, Download, Loader2, Lock, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryLabel, durationText, formLabel, keyText } from "@/lib/vocab";
import { download, sampleBase, slugName, type Sample } from "./api";
import { useSamplePlayer } from "./useSamplePlayer";
import { VerdictBadge } from "./VerdictBadge";

export const rowKey = (id: string) => `row:${id}`;

/** Deterministic placeholder bars (an SVG, so no inline styles) shown until the real waveform loads. */
export function Placeholder({ seed, bars = 48, className }: { seed: string; bars?: number; className?: string }) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const heights = Array.from({ length: bars }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const env = Math.exp(-i / (bars / 2.5));
    return 0.12 + 0.8 * env * (0.4 + ((h >>> 0) % 1000) / 1700);
  });
  return (
    <svg viewBox={`0 0 ${bars * 3} 40`} preserveAspectRatio="none" className={cn("h-full w-full text-muted-foreground/30", className)} aria-hidden="true">
      {heights.map((v, i) => (
        <rect key={i} x={i * 3} y={20 - v * 18} width="2" height={v * 36} rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md bg-muted px-1.5 py-px text-[11px] text-muted-foreground", className)}>{children}</span>;
}

/** The musical facts of a sample as small chips: category · form · BPM · key · duration. */
export function Facts({ s, className }: { s: Sample; className?: string }) {
  const facts = [
    categoryLabel(s.category),
    s.unit === "pack" ? `Pack${s.packSize ? ` · ${s.packSize}` : ""}` : formLabel(s.form),
    s.bpm ? `${Math.round(s.bpm)} BPM` : "",
    keyText(s.key),
    durationText(s.durationSec),
  ].filter(Boolean);
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {facts.map((f) => (
        <Chip key={f}>{f}</Chip>
      ))}
    </span>
  );
}

interface RowProps {
  sample: Sample;
  providerName: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (s: Sample) => void;
}

export const SampleRow = memo(function SampleRow({ sample: s, providerName, selected, onSelect, onOpen }: RowProps) {
  const key = rowKey(s.id);
  const p = useSamplePlayer(key, s);
  const busy = p.playing && p.state === "loading";
  const paid = s.price && !s.price.free;
  return (
    <li
      id={`sample-${s.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
      data-sample={s.id}
      aria-current={selected || undefined}
      onClick={() => onSelect(s.id)}
      className={cn(
        "group grid scroll-mt-64 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-2 py-2 transition-colors sm:px-3",
        "md:grid-cols-[2.25rem_minmax(7rem,14rem)_minmax(0,1fr)_auto_auto] md:gap-y-0",
        selected ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "hover:bg-accent/40",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(s.id);
          void p.toggle();
        }}
        aria-label={p.playing ? `Pause ${s.title}` : `Play ${s.title}`}
        title={p.failed ? "The preview could not be played here; open the source page" : undefined}
        className={cn(
          "row-span-2 flex size-9 items-center justify-center rounded-full border transition md:row-span-1",
          p.playing ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50 hover:text-primary",
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : p.playing ? <Pause className="size-4" /> : p.failed ? <CircleAlert className="size-4 text-warning" /> : <Play className="ml-0.5 size-4" />}
      </button>

      {/* Waveform: second line on phones, its own column on wider screens. */}
      <div className="relative order-last col-span-2 col-start-2 h-9 min-w-0 md:order-none md:col-span-1 md:col-start-auto">
        {p.state !== "ready" && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(s.id);
              void p.play();
            }}
            className={cn("absolute inset-0 cursor-pointer", p.state === "loading" && "animate-pulse")}
          >
            {p.state === "nowave" ? (
              <span className="flex h-full items-center">
                <span className="h-px w-full bg-border" />
              </span>
            ) : (
              <Placeholder seed={s.id} />
            )}
          </button>
        )}
        <div ref={p.container} className={cn("h-9 w-full", p.state !== "ready" && "invisible")} onClick={(e) => {
            e.stopPropagation();
            onSelect(s.id);
          }} />
      </div>

      <div className="min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(s);
          }}
          className="block max-w-full truncate text-left text-sm font-medium hover:text-primary hover:underline focus-visible:underline"
          title={s.title}
        >
          {s.title}
        </button>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
          <Facts s={s} />
          <span className="truncate text-[11px] text-muted-foreground">
            {providerName}
            {s.author ? ` · ${s.author}` : ""}
          </span>
          {paid && <Chip className="text-warning">{s.price!.amount != null ? `${s.price!.amount} ${s.price!.currency ?? ""}` : "Paid"}</Chip>}
        </span>
      </div>

      <div className="hidden md:block">
        <VerdictBadge license={s.license} />
      </div>

      <div className="flex items-center gap-1 justify-self-end">
        <span className="md:hidden">
          <VerdictBadge license={s.license} />
        </span>
        {s.downloadable ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void download(`${sampleBase(s.id)}/download`, slugName(s.title));
            }}
            aria-label={`Download ${s.title}`}
            title={s.requiresAccount ? "Downloads the preview; the original needs an account on the source" : "Download"}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <Download className="size-4" />
          </button>
        ) : (
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Get ${s.title} on ${providerName}`}
            title={s.requiresAccount ? `Needs an account on ${providerName}` : `Get it on ${providerName}`}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            {s.requiresAccount ? <Lock className="size-4" /> : <Download className="size-4 opacity-50" />}
          </a>
        )}
      </div>
    </li>
  );
});
