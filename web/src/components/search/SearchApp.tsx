import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setNonce } from "get-nonce";
import { ArrowUpRight, Filter, Keyboard, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { categoryPath, formLabel } from "@/lib/vocab";
import { api, getKey, safeUrl, setKey, UnauthorizedError, type Provider, type ProviderReport, type Sample, type SearchResponse } from "./api";
import { BpmInput, CategoryChips, FormToggle, KeyPicker, SourcePicker } from "./Filters";
import { pauseAll, play, toggle } from "./player";
import { SampleDetail } from "./SampleDetail";
import { SampleRow, rowKey } from "./SampleRow";

const PAGE = 30;
const EXAMPLES = ["punchy kick", "808 in F minor", "vocal chop 140 bpm", "riser", "vinyl crackle", "rain ambience"];

// The server sends a per-request CSP nonce; the detail sheet's scroll lock
// injects a <style> tag and must carry it.
if (typeof document !== "undefined") {
  const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content;
  if (nonce) setNonce(nonce);
}

interface Filters {
  q: string;
  categories: string[];
  form: string;
  bpm: string;
  key: string;
  commercial: boolean;
  free: boolean;
  downloadable: boolean;
  sources: string[] | null;
}
const EMPTY: Filters = { q: "", categories: [], form: "", bpm: "", key: "", commercial: false, free: false, downloadable: false, sources: null };

function readUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const list = (k: string) => (p.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    q: p.get("q") ?? "",
    categories: list("category"),
    form: p.get("form") ?? "",
    bpm: p.get("bpm") ?? "",
    key: p.get("key") ?? "",
    commercial: p.get("commercial") === "true",
    free: p.get("free") === "true",
    downloadable: p.get("downloadable") === "true",
    sources: p.get("providers") ? list("providers") : null,
  };
}

function toParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.categories.length) p.set("category", f.categories.join(","));
  if (f.form) p.set("form", f.form);
  if (f.bpm) p.set("bpm", f.bpm);
  if (f.key) p.set("key", f.key);
  if (f.commercial) p.set("commercial", "true");
  if (f.free) p.set("free", "true");
  if (f.downloadable) p.set("downloadable", "true");
  if (f.sources) p.set("providers", f.sources.join(","));
  return p;
}

const searchable = (f: Filters) => Boolean(f.q || f.categories.length);

function describe(f: Filters): string {
  const bits = [f.q && `“${f.q}”`, ...f.categories.map(categoryPath), f.form && formLabel(f.form), f.bpm && `${f.bpm} BPM`, f.key].filter(Boolean);
  return bits.join(" · ");
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default function SearchApp() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [results, setResults] = useState<Sample[]>([]);
  const [reports, setReports] = useState<ProviderReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [needKey, setNeedKey] = useState(false);
  const [canMore, setCanMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState<Sample | null>(null);
  const offset = useRef(0);
  const seen = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const request = useRef(0);
  // The server already sends a unique <title> for the URL the page loaded with;
  // only searches the user runs afterwards update it.
  const firstRun = useRef(true);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const providerName = useCallback((id: string) => providers.find((p) => p.id === id)?.name ?? id, [providers]);

  const writeUrl = useCallback((f: Filters, sample?: string | null) => {
    const qs = toParams(f);
    const s = sample === undefined ? new URLSearchParams(window.location.search).get("sample") : sample;
    if (s) qs.set("sample", s);
    const str = qs.toString();
    window.history.replaceState(null, "", `/search${str ? `?${str}` : ""}`);
  }, []);

  const run = useCallback(
    async (f: Filters, append: boolean) => {
      const mine = ++request.current;
      if (!append) {
        offset.current = 0;
        seen.current = new Set();
        setResults([]);
        setReports([]);
        setSelectedId(null);
        pauseAll();
      }
      writeUrl(f);
      if (!searchable(f)) {
        setSearched(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(undefined);
      setSearched(true);
      if (!firstRun.current) document.title = `${describe(f) || "Search"}: samples · Sound Server`;
      firstRun.current = false;
      try {
        const params = toParams(f);
        params.set("limit", String(PAGE));
        if (offset.current) params.set("offset", String(offset.current));
        const res = await api<SearchResponse>(`/v1/search?${params.toString()}`);
        if (mine !== request.current) return;
        const fresh = res.results.filter((a) => !seen.current.has(a.id) && seen.current.add(a.id));
        setResults((prev) => (append ? [...prev, ...fresh] : fresh));
        setReports(res.providers);
        setCanMore(fresh.length > 0 && res.providers.some((r) => r.status === "ok" && r.count >= PAGE));
        offset.current += PAGE;
      } catch (e) {
        if (mine !== request.current) return;
        if (e instanceof UnauthorizedError) setNeedKey(true);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mine === request.current) setLoading(false);
      }
    },
    [writeUrl],
  );

  /** Open (or close) the detail sheet and keep `?sample=` in the URL, so the address bar is a share link. */
  const openSample = useCallback(
    (s: Sample | null) => {
      setOpen(s);
      if (s) setSelectedId(s.id);
      writeUrl(filtersRef.current, s ? s.id : null);
    },
    [writeUrl],
  );
  useEffect(() => {
    const f = readUrl();
    setFilters(f);
    setDraft(f.q);
    const shared = new URLSearchParams(window.location.search).get("sample");
    api<{ providers: Provider[] }>("/v1/providers")
      .then((r) => setProviders(r.providers))
      .catch((e) => e instanceof UnauthorizedError && setNeedKey(true));
    if (searchable(f)) void run(f, false);
    else if (!shared) inputRef.current?.focus();
    if (shared) {
      api<Sample>(`/v1/samples/${encodeURIComponent(shared)}`)
        .then((s) => openSample(s))
        .catch(() => undefined);
    }
  }, [run, openSample]);

  const update = (patch: Partial<Filters>, rerun = true) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (rerun) void run(next, false);
  };

  // Keyboard: ↑/↓ select and audition, space plays/pauses, Enter opens the detail sheet.
  const selectIndex = useCallback(
    (i: number, audition = true) => {
      const s = results[i];
      if (!s) return;
      setSelectedId(s.id);
      const el = listRef.current?.querySelector(`[data-sample="${CSS.escape(s.id)}"]`);
      el?.scrollIntoView({ block: "nearest" });
      if (audition) void play(rowKey(s.id));
    },
    [results],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = selectedId ? results.findIndex((r) => r.id === selectedId) : -1;
      if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (isTyping(e.target)) {
        // From the search box, ↓ moves into the results.
        if (e.key === "ArrowDown" && e.target === inputRef.current && results.length) {
          e.preventDefault();
          inputRef.current?.blur();
          selectIndex(Math.max(0, idx));
        }
        return;
      }
      const onControl = e.target instanceof HTMLElement && /^(BUTTON|A)$/.test(e.target.tagName);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        selectIndex(Math.min(results.length - 1, idx + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        if (idx <= 0) {
          setSelectedId(null);
          pauseAll();
          inputRef.current?.focus();
        } else selectIndex(idx - 1);
      } else if (e.key === " " && !onControl && selectedId) {
        e.preventDefault();
        void toggle(rowKey(selectedId));
      } else if (e.key === "Enter" && !onControl && idx >= 0) {
        e.preventDefault();
        openSample(results[idx]!);
      } else if (e.key === "Escape") {
        pauseAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, selectedId, selectIndex, openSample]);

  const okReports = useMemo(() => reports.filter((r) => r.status !== "skipped"), [reports]);
  const linkReports = okReports.filter((r) => r.status === "link");
  const searchedReports = okReports.filter((r) => r.status !== "link");
  const selectSample = useCallback((id: string) => setSelectedId(id), []);

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <div className="z-30 -mx-4 border-b border-border/60 bg-background/85 px-4 pb-3 pt-4 backdrop-blur-xl sm:-mx-6 sm:px-6 md:sticky md:top-14">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: draft.trim() });
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="punchy kick, 808 in F minor, vocal chop 140 bpm…"
                aria-label="Search samples"
                className="h-11 rounded-xl pl-10 text-base"
              />
            </div>
            <Button type="submit" size="lg" className="h-11 rounded-xl px-5" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span className="sr-only">Searching…</span>
                </>
              ) : (
                "Search"
              )}
            </Button>
          </form>

          <div className="mt-3">
            <CategoryChips value={filters.categories} onChange={(categories) => update({ categories })} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <FormToggle value={filters.form} onChange={(form) => update({ form })} />
            <BpmInput value={filters.bpm} onChange={(bpm) => update({ bpm })} />
            <KeyPicker value={filters.key} onChange={(key) => update({ key })} />
            <Switch label="Commercial-safe" labelClassName="text-xs font-medium text-muted-foreground" checked={filters.commercial} onCheckedChange={(v) => update({ commercial: v })} title="Only samples cleared for a commercial release (green verdicts)" />
            <Switch label="Free only" labelClassName="text-xs font-medium text-muted-foreground" checked={filters.free} onCheckedChange={(v) => update({ free: v })} />
            <Switch label="Direct download" labelClassName="text-xs font-medium text-muted-foreground" checked={filters.downloadable} onCheckedChange={(v) => update({ downloadable: v })} />
            <span className="ml-auto">
              <SourcePicker providers={providers} value={filters.sources} onApply={(sources) => update({ sources })} />
            </span>
          </div>

          {needKey && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get("key");
                setKey(String(v ?? ""));
                setNeedKey(false);
                void run(filters, false);
              }}
            >
              <span>This server needs an API key.</span>
              <Input name="key" type="password" defaultValue={getKey()} className="h-8 w-56" placeholder="API key" aria-label="API key" />
              <Button size="sm" type="submit">Save</Button>
            </form>
          )}
        </div>

        {searchedReports.length > 0 && (
          <div className="-mx-4 mt-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 text-xs [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label="Sources searched">
            {searchedReports.map((r) => {
              const failed = r.status === "error" || r.status === "timeout";
              const url = safeUrl(r.searchUrl);
              const cls = cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5", failed ? "border-destructive/30 text-destructive" : "text-muted-foreground");
              const body = (
                <>
                  {r.name}
                  {failed ? ` ${r.status}` : <b className="font-semibold text-foreground">{r.count}{r.total !== undefined && r.total > r.count ? <span className="font-normal text-muted-foreground">/{r.total.toLocaleString("en")}</span> : null}</b>}
                </>
              );
              const title = r.error ?? `${r.count} results in ${r.tookMs} ms${r.filteredLocally ? " (filtered here)" : ""}${url ? `. Open this search on ${r.name}` : ""}`;
              return url ? (
                <a key={r.provider} href={url} target="_blank" rel="noopener noreferrer" className={cn(cls, "hover:border-primary/40")} title={title}>{body}</a>
              ) : (
                <span key={r.provider} className={cls} title={title}>{body}</span>
              );
            })}
          </div>
        )}
        {linkReports.length > 0 && (
          <p className="-mx-4 mt-2 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 text-xs text-muted-foreground [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <span className="shrink-0">Also look on:</span>
            {linkReports.map((r) => {
              const url = safeUrl(r.searchUrl);
              return url ? (
                <a key={r.provider} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md border border-primary/30 px-2 py-0.5 text-primary hover:bg-primary/10">
                  {r.name} <ArrowUpRight className="size-3" />
                </a>
              ) : null;
            })}
          </p>
        )}

        {error && <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}

        {(results.length > 0 || loading) && (
          <div className="mt-4 overflow-hidden rounded-xl border bg-card/30">
            <ul ref={listRef} aria-label="Results" className="[&>li:last-child]:border-b-0">
              {results.map((s) => (
                <SampleRow key={s.id} sample={s} providerName={providerName(s.provider)} selected={s.id === selectedId} onSelect={selectSample} onOpen={openSample} />
              ))}
              {loading &&
                Array.from({ length: results.length ? 4 : 10 }).map((_, i) => (
                  <li key={`s${i}`} className="grid grid-cols-[2.25rem_1fr] items-center gap-3 border-b border-border/60 px-3 py-2.5 md:grid-cols-[2.25rem_14rem_1fr]">
                    <Skeleton className="size-9 rounded-full" />
                    <Skeleton className="hidden h-8 md:block" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}
        {results.length > 0 && (
          <p className="mt-2 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <Keyboard className="size-3.5" aria-hidden="true" /> <kbd className="rounded border px-1">↑</kbd>
            <kbd className="rounded border px-1">↓</kbd> audition · <kbd className="rounded border px-1">Space</kbd> play/pause · <kbd className="rounded border px-1">Enter</kbd> details ·{" "}
            <kbd className="rounded border px-1">/</kbd> search
          </p>
        )}

        {!loading && !error && searched && results.length === 0 && (
          <div className="mt-16 text-center text-muted-foreground">
            <Filter className="mx-auto size-8 opacity-50" />
            <p className="mt-3">No results. Try fewer words, drop the BPM or key filter{filters.commercial ? ", turn off Commercial-safe" : ""}, or open the source links above.</p>
          </div>
        )}
        {!searched && (
          <div className="mt-16 text-center text-muted-foreground">
            <Sparkles className="mx-auto size-8 text-primary/70" />
            <p className="mt-3">Search {providers.length ? `${providers.length} sample sites` : "every sample site"} at once. Try:</p>
            <p className="mt-3 flex flex-wrap justify-center gap-2 text-sm">
              {EXAMPLES.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => {
                    setDraft(x);
                    update({ q: x });
                  }}
                  className="rounded-full border px-3 py-0.5 transition hover:border-primary/40 hover:text-foreground"
                >
                  {x}
                </button>
              ))}
            </p>
          </div>
        )}
        {canMore && !loading && (
          <div className="mt-8 text-center">
            <Button variant="outline" onClick={() => void run(filters, true)}>Load more</Button>
          </div>
        )}

        <Sheet open={Boolean(open)} onOpenChange={(o) => !o && openSample(null)}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
            {open && (
              <>
                <SheetHeader className="px-4 pt-6 sm:px-6">
                  <SheetDescription>
                    {providerName(open.provider)} · {categoryPath(open.category)}
                    {open.form ? ` · ${formLabel(open.form)}` : ""}
                  </SheetDescription>
                  <SheetTitle className="pr-8 text-xl">{open.title}</SheetTitle>
                </SheetHeader>
                <SampleDetail sample={open} providerName={providerName(open.provider)} />
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
