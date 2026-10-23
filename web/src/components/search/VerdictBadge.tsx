import { CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VERDICT_LABELS, verdictTone, type Tone, type Verdict } from "@/lib/vocab";
import type { License } from "./api";

export const TONE_CLASS: Record<Tone, string> = {
  green: "border-success/40 bg-success/10 text-success",
  amber: "border-warning/40 bg-warning/10 text-warning",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
};
const ICON = { green: CircleCheck, amber: CircleAlert, red: CircleX };

/** Short badge text for dense rows. */
const SHORT: Record<string, string> = {
  yes: "Commercial OK",
  "yes-with-credit": "OK with credit",
  restricted: "Restricted",
  "clearance-required": "Needs clearance",
  "check-terms": "Check terms",
  no: "Non-commercial",
};

/** Green / amber / red licence verdict, with the licence name and note in a tooltip. */
export function VerdictBadge({ license, size = "sm", className }: { license?: License; size?: "sm" | "lg"; className?: string }) {
  const verdict = (license?.verdict ?? "check-terms") as Verdict;
  const tone = verdictTone(verdict);
  const Icon = ICON[tone];
  const label = VERDICT_LABELS[verdict] ?? verdict;
  const badge = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-sm",
        TONE_CLASS[tone],
        className,
      )}
      tabIndex={size === "sm" ? 0 : undefined}
      aria-label={`Licence: ${license?.name ?? "not stated"}. ${label}`}
    >
      <Icon className={size === "sm" ? "size-3" : "size-4"} aria-hidden="true" />
      {size === "sm" ? SHORT[verdict] ?? label : label}
    </span>
  );
  if (size === "lg") return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" align="end">
        <p className="font-medium">{label}</p>
        <p className="mt-1 text-muted-foreground">{license ? license.name : "No licence stated"}</p>
        {license?.note && <p className="mt-1 text-muted-foreground">{license.note}</p>}
        {license?.assertedBy === "uploader" && <p className="mt-1 text-warning">Stated by the uploader, not verified by the source.</p>}
      </TooltipContent>
    </Tooltip>
  );
}
