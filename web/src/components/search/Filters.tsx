import { useEffect, useState } from "react";
import { ChevronDown, Download, Music2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PITCH_CLASSES, TOP_CATEGORIES, categoryLabel, depth, formLabel, subCategories } from "@/lib/vocab";
import type { Provider } from "./api";

const chip = (on: boolean) =>
  cn(
    "inline-flex h-7 items-center rounded-full border text-xs font-medium transition",
    on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
  );

const inTop = (top: string, c: string) => c === top || c.startsWith(`${top}.`);

/**
 * Top-level category chips; chips with sub-categories open a popover to pick
 * them (Drums ▸ Kick, Snare…). `value` is the list of selected category ids.
 */
export function CategoryChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const tops = TOP_CATEGORIES.filter((t) => t !== "other");
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categories">
      {tops.map((top) => {
        const subs = subCategories(top);
        const picked = value.filter((c) => inTop(top, c));
        const on = picked.length > 0;
        const label = picked.length === 1 && picked[0] !== top ? categoryLabel(picked[0]) : picked.length > 1 ? `${categoryLabel(top)} · ${picked.length}` : categoryLabel(top);
        const toggleTop = () => onChange(on ? value.filter((c) => !inTop(top, c)) : [...value, top]);
        if (!subs.length) {
          return (
            <button key={top} type="button" aria-pressed={on} onClick={toggleTop} className={cn(chip(on), "px-3")}>
              {label}
            </button>
          );
        }
        return (
          <span key={top} className={cn(chip(on), "overflow-hidden")}>
            <button type="button" aria-pressed={on} onClick={toggleTop} className="h-full pl-3 pr-1.5">
              {label}
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label={`${categoryLabel(top)} sub-categories`} className={cn("flex h-full items-center border-l pl-1 pr-2", on ? "border-primary-foreground/30" : "border-border")}>
                  <ChevronDown className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-60 p-2">
                <p className="px-1.5 pb-1.5 text-xs font-medium text-muted-foreground">{categoryLabel(top)}</p>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent">
                  <Checkbox checked={value.includes(top)} onCheckedChange={(v) => onChange(v ? [...value.filter((c) => !inTop(top, c)), top] : value.filter((c) => c !== top))} />
                  All {categoryLabel(top).toLowerCase()}
                </label>
                <div className="max-h-72 overflow-y-auto">
                  {subs.map((sub) => (
                    <label key={sub.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent", depth(sub.id) > 1 && "pl-6")}>
                      <Checkbox
                        checked={value.includes(sub.id)}
                        onCheckedChange={(v) => onChange(v ? [...value.filter((c) => c !== top), sub.id] : value.filter((c) => c !== sub.id))}
                      />
                      {sub.label}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </span>
        );
      })}
      {value.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground">
          <X className="size-3" /> Clear
        </button>
      )}
    </div>
  );
}

/** Any / One-shot / Loop. */
export function FormToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = ["", "one-shot", "loop"];
  return (
    <div role="group" aria-label="Form" className="inline-flex h-7 items-center rounded-full border p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o || "any"}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn("h-full rounded-full px-2.5 font-medium transition", value === o ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {o ? formLabel(o) : "Any"}
        </button>
      ))}
    </div>
  );
}

const BPM_RE = /^\s*(\d{2,3})\s*(?:[-–]\s*(\d{2,3}))?\s*$/;

/** "140" or "120-128"; applied on Enter or blur. */
export function BpmInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = draft.trim() === "" || BPM_RE.test(draft);
  const apply = () => {
    if (!valid) return;
    const m = BPM_RE.exec(draft);
    const next = m ? (m[2] ? `${Math.min(+m[1]!, +m[2])}-${Math.max(+m[1]!, +m[2])}` : m[1]!) : "";
    if (next !== value) onChange(next);
    setDraft(next);
  };
  return (
    <label className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-xs", value ? "border-primary/60" : "", !valid && "border-destructive")}>
      <span className="font-medium text-muted-foreground">BPM</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
        }}
        inputMode="numeric"
        placeholder="any"
        aria-label="Tempo in BPM, e.g. 140 or 120-128"
        aria-invalid={!valid || undefined}
        className="h-full w-[4.75rem] bg-transparent outline-none placeholder:text-muted-foreground/60"
      />
    </label>
  );
}

/** 12 tonics × major/minor. `value` like "F minor" or "". */
export function KeyPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tonic, mode] = value ? (value.split(" ") as [string, string?]) : ["", "minor"];
  const [pickMode, setPickMode] = useState<string>(mode ?? "minor");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(chip(Boolean(value)), "gap-1 px-3")} aria-label={value ? `Key: ${value}` : "Key: any"}>
          <Music2 className="size-3.5" /> {value || "Key"}
          <ChevronDown className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div role="group" aria-label="Mode" className="mb-2 grid grid-cols-2 rounded-md border p-0.5 text-xs">
          {["major", "minor"].map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={pickMode === m}
              onClick={() => {
                setPickMode(m);
                if (tonic) onChange(`${tonic} ${m}`);
              }}
              className={cn("rounded px-2 py-1 font-medium capitalize", pickMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Tonic">
          {PITCH_CLASSES.map((t) => {
            const on = tonic === t && (mode ?? "minor") === pickMode;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onChange(on ? "" : `${t} ${pickMode}`);
                  setOpen(false);
                }}
                className={cn("rounded-md border py-1.5 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40 hover:bg-accent")}
              >
                {t}
                {pickMode === "minor" ? <span className="text-xs opacity-70">m</span> : null}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">Relative keys also match (F minor finds A♭ major). Samples without a known key are kept unless you search strictly.</p>
        {value && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Any key
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Choose which sources to search. `value` null = all. */
export function SourcePicker({ providers, value, onApply }: { providers: Provider[]; value: string[] | null; onApply: (v: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(value);
  useEffect(() => setDraft(value), [value, open]);
  const label = value ? `${value.length} of ${providers.length} sources` : "All sources";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-full text-xs">
          <SlidersHorizontal className="size-3.5" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Sources</p>
          <span className="flex gap-3">
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setDraft(null)}>All</button>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setDraft([])}>None</button>
          </span>
        </div>
        <div className="grid max-h-72 grid-cols-1 gap-0.5 overflow-y-auto">
          {providers.map((p) => {
            const on = !draft || draft.includes(p.id);
            return (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent" title={p.description}>
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) => {
                    const current = draft ?? providers.map((x) => x.id);
                    const next = v ? [...current, p.id] : current.filter((x) => x !== p.id);
                    setDraft(next.length === providers.length ? null : next);
                  }}
                />
                <span className="flex-1">{p.name}</span>
                {p.access === "link" ? (
                  <span className="text-[10px] text-muted-foreground">link</span>
                ) : (
                  p.supportsDownload && <Download className="size-3 text-muted-foreground" aria-label="direct downloads" />
                )}
              </label>
            );
          })}
        </div>
        <Button
          size="sm"
          className="mt-3 w-full"
          disabled={draft !== null && draft.length === 0}
          onClick={() => {
            onApply(draft);
            setOpen(false);
          }}
        >
          Apply
        </Button>
      </PopoverContent>
    </Popover>
  );
}
