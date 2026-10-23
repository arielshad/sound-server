import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiHeaders, getKey, sampleBase } from "@/components/search/api";
import { previewBlob } from "@/components/search/player";
import { TONE_CLASS } from "@/components/search/VerdictBadge";
import { cn } from "@/lib/utils";
import { TOP_CATEGORIES, VERDICT_LABELS, categoryLabel, topCategory, verdictTone, type Verdict } from "@/lib/vocab";

/** GET /v1/map (see the soundMap operation in /openapi.json). */
interface MapPoint {
  id: string;
  x: number;
  y: number;
  provider: string;
  title?: string;
  category?: string;
  durationSec?: number;
  verdict?: Verdict;
}
type MapResponse = { enabled: false } | { enabled: true; model: string; indexed: number; matching: number; points: MapPoint[]; generatedAt: string };

/** One colour per top-level category (distinct in light and dark themes). */
const COLOURS: Record<string, string> = {
  drums: "#e4572e",
  bass: "#7b2cbf",
  vocals: "#f4a259",
  fx: "#2a9d8f",
  foley: "#8d6e63",
  ambience: "#4ea8de",
  keys: "#e76f9a",
  guitar: "#bc6c25",
  synth: "#06d6a0",
  strings: "#c1121f",
  brass: "#e9c46a",
  woodwind: "#90be6d",
  mallets: "#9b5de5",
  other: "#8a8f98",
};
const colourOf = (category?: string) => COLOURS[topCategory(category ?? "other")] ?? COLOURS.other!;

const RADIUS = 4;

export default function SoundMap({ names }: { names: Record<string, string> }) {
  const [category, setCategory] = useState("");
  const [data, setData] = useState<MapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<MapPoint | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [view, setView] = useState({ scale: 1, dx: 0, dy: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);
  const [size, setSize] = useState(600);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null);
    setError(null);
    setSelected(null);
    setView({ scale: 1, dx: 0, dy: 0 });
    const q = new URLSearchParams({ limit: "2500" });
    if (category) q.set("category", category);
    fetch(`/v1/map?${q}`, { headers: apiHeaders({ accept: "application/json" }), signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? "This server needs an API key (set it on the search page)." : `HTTP ${r.status}`);
        setData((await r.json()) as MapResponse);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [category]);

  // Square canvas that follows the container width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize(Math.max(280, Math.min(900, Math.floor(entry!.contentRect.width)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = data && data.enabled ? data.points : [];
  const toScreen = useCallback((p: MapPoint) => [(p.x * size - size / 2) * view.scale + size / 2 + view.dx, (p.y * size - size / 2) * view.scale + size / 2 + view.dy] as const, [size, view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    for (const p of points) {
      const [x, y] = toScreen(p);
      if (x < -RADIUS || y < -RADIUS || x > size + RADIUS || y > size + RADIUS) continue;
      ctx.beginPath();
      ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = colourOf(p.category);
      ctx.globalAlpha = selected && selected.id !== p.id ? 0.55 : 0.9;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of [hover, selected]) {
      if (!p) continue;
      const [x, y] = toScreen(p);
      ctx.beginPath();
      ctx.arc(x, y, RADIUS + 3, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = getComputedStyle(canvas).color;
      ctx.stroke();
    }
  }, [points, size, toScreen, hover, selected]);

  const pick = (clientX: number, clientY: number): MapPoint | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best: MapPoint | null = null;
    let bestD = (RADIUS + 4) ** 2;
    for (const p of points) {
      const [x, y] = toScreen(p);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  const stop = () => {
    audioRef.current?.pause();
    setPlaying(null);
  };

  const playPoint = async (p: MapPoint) => {
    setSelected(p);
    if (playing === p.id) return stop();
    audioRef.current?.pause();
    const audio = new Audio();
    audioRef.current = audio;
    audio.onended = () => setPlaying((cur) => (cur === p.id ? null : cur));
    try {
      audio.src = getKey() ? URL.createObjectURL(await previewBlob({ id: p.id })) : `${sampleBase(p.id)}/preview`;
      setPlaying(p.id);
      await audio.play();
    } catch {
      setPlaying(null);
    }
  };

  useEffect(() => () => audioRef.current?.pause(), []);

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left - size / 2;
    const my = e.clientY - rect.top - size / 2;
    setView((v) => {
      const scale = Math.min(20, Math.max(1, v.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      const k = scale / v.scale;
      return { scale, dx: scale === 1 ? 0 : mx - (mx - v.dx) * k, dy: scale === 1 ? 0 : my - (my - v.dy) * k };
    });
  };

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of points) c.set(topCategory(p.category ?? "other"), (c.get(topCategory(p.category ?? "other")) ?? 0) + 1);
    return c;
  }, [points]);

  if (error) return <p className="rounded-xl border p-6 text-sm text-destructive">The map could not be loaded: {error}</p>;

  if (data && !data.enabled)
    return (
      <div className="rounded-xl border p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">The sound map is off on this server.</p>
        <p className="mt-2">
          It is drawn from audio embeddings, which this server does not compute (they need about 1.5 GB of memory). Run Sound Server yourself with{" "}
          <code>SOUND_SERVER_EMBEDDINGS=1</code> and <code>SOUND_SERVER_DATA_DIR</code> set, search for a while or run <code>sound-server index</code>, and the map fills in. See{" "}
          <a className="text-primary underline underline-offset-2" href="/docs/self-hosting">self-hosting</a>.
        </p>
      </div>
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="map-category" className="text-sm text-muted-foreground">
            Category
          </label>
          <select id="map-category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">All sounds</option>
            {TOP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          {view.scale > 1 && (
            <Button size="sm" variant="outline" onClick={() => setView({ scale: 1, dx: 0, dy: 0 })}>
              Reset zoom
            </Button>
          )}
          {data?.enabled && (
            <span className="text-xs text-muted-foreground">
              {points.length.toLocaleString("en")} sounds{data.matching > points.length ? ` of ${data.matching.toLocaleString("en")}` : ""}
            </span>
          )}
        </div>
        <div ref={wrapRef} className="relative w-full">
          {!data && <Skeleton className="aspect-square w-full rounded-xl" />}
          {data?.enabled && points.length === 0 && (
            <p className="rounded-xl border p-6 text-sm text-muted-foreground">Nothing is indexed here yet. Sounds are added as people search and open samples.</p>
          )}
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Map of sounds: each dot is a sample; sounds that sound alike are close together. Use the list below the map to browse with a keyboard."
            width={size}
            height={size}
            className={cn("block cursor-crosshair touch-none rounded-xl border text-foreground", (!data || points.length === 0) && "hidden")}
            style={{ width: size, height: size }}
            onMouseMove={(e) => {
              const d = drag.current;
              if (d) {
                const nx = d.dx + e.clientX - d.x;
                const ny = d.dy + e.clientY - d.y;
                if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
                if (d.moved) setView((v) => ({ ...v, dx: nx, dy: ny }));
                return;
              }
              setHover(pick(e.clientX, e.clientY));
            }}
            onMouseLeave={() => {
              drag.current = null;
              setHover(null);
            }}
            onMouseDown={(e) => (drag.current = { x: e.clientX, y: e.clientY, dx: view.dx, dy: view.dy, moved: false })}
            onMouseUp={(e) => {
              const moved = drag.current?.moved;
              drag.current = null;
              if (moved) return;
              const p = pick(e.clientX, e.clientY);
              if (p) void playPoint(p);
            }}
            onWheel={onWheel}
          />
          {hover && (
            <div className="pointer-events-none absolute left-2 top-2 max-w-[16rem] rounded-md border bg-popover px-2 py-1 text-xs shadow">
              <div className="truncate font-medium">{hover.title ?? hover.id}</div>
              <div className="text-muted-foreground">
                {categoryLabel(hover.category)} · {names[hover.provider] ?? hover.provider}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-6">
        <section aria-live="polite">
          <h2 className="text-sm font-semibold">Selected sound</h2>
          {selected ? (
            <div className="mt-2 space-y-2 rounded-xl border p-3 text-sm">
              <p className="font-medium">{selected.title ?? selected.id}</p>
              <p className="text-muted-foreground">
                {categoryLabel(selected.category)} · {names[selected.provider] ?? selected.provider}
                {selected.durationSec !== undefined && ` · ${selected.durationSec < 10 ? selected.durationSec.toFixed(2) : Math.round(selected.durationSec)} s`}
              </p>
              {selected.verdict && (
                <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[verdictTone(selected.verdict)])}>
                  {VERDICT_LABELS[selected.verdict] ?? selected.verdict}
                </span>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={() => void playPoint(selected)}>
                  {playing === selected.id ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                  {playing === selected.id ? "Pause" : "Play"}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/search?sample=${encodeURIComponent(selected.id)}`}>
                    <ExternalLink className="size-4" aria-hidden /> Details
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Click a dot to hear it. Scroll to zoom, drag to move.</p>
          )}
        </section>

        {points.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold">Colours</h2>
            <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
              {[...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([c, n]) => (
                  <li key={c} className="flex items-center gap-2">
                    <span className="inline-block size-3 shrink-0 rounded-full" style={{ backgroundColor: colourOf(c) }} aria-hidden />
                    <span>
                      {categoryLabel(c)} <span className="text-muted-foreground">{n}</span>
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </aside>

      {points.length > 0 && (
        <details className="lg:col-span-2">
          <summary className="cursor-pointer text-sm font-medium">
            <Search className="mr-1 inline size-4" aria-hidden />
            Browse the sounds as a list
          </summary>
          <ul className="mt-3 max-h-96 divide-y overflow-y-auto rounded-xl border text-sm">
            {points.slice(0, 500).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="min-w-0 truncate">
                  {p.title ?? p.id} <span className="text-muted-foreground">· {categoryLabel(p.category)}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void playPoint(p)} aria-label={`${playing === p.id ? "Pause" : "Play"} ${p.title ?? p.id}`}>
                  {playing === p.id ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
