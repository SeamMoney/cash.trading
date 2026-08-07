"use client";

import { useEffect, useMemo, useState } from "react";

import {
  BklitCandlePlot,
  type BklitPlotFill,
  type BklitPlotLine,
  type BklitPlotMarker,
  type BklitPlotZone,
} from "@/components/trade/BklitCandlePlot";
import { buildIndicatorVisualEffects } from "@/lib/launchpad/indicator-effects";
import { runOwnRuntime, runPineTS, type PineTSPlot, type PineTSResult } from "@/lib/launchpad/pinets-runner";
import type { Candle } from "@/lib/launchpad/types";

import { LaunchpadIndicatorPane, type LaunchpadIndicatorLine } from "./LaunchpadIndicatorPane";

const CHART_BG = "#0d0d14";

/** Fallback palette for plots the script never coloured. Distinct, in order. */
const FALLBACK_COLORS = ["#39ff14", "#4da3ff", "#ffb020", "#ff6b6b", "#b98cff", "#7c8496"];

function detectAsset(script: string): string {
  if (/\bETH\b/i.test(script)) return "ETH/USD";
  if (/\bSOL\b/i.test(script)) return "SOL/USD";
  if (/\bAPT\b/i.test(script)) return "APT/USD";
  return "BTC/USD";
}

/** PineTS colors are not always strings — conditional colors arrive as objects
 *  and palette indices as numbers, so `color?.toLowerCase()` threw and crashed
 *  the whole Deploy tab on mount (the default preset produces a fill with a
 *  non-string color). Coerce first; non-strings fall through to the default. */
function colorString(color: unknown): string | undefined {
  return typeof color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : undefined;
}

function displayPriceDecimals(price: number) {
  if (price >= 100) return 2;
  if (price >= 1) return 4;
  return 6;
}

/** A plot's typical magnitude, ignoring the warmup NaNs at the front. */
function medianOf(values: number[]): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return NaN;
  return finite[Math.floor(finite.length / 2)];
}

/**
 * Which pane a series belongs in.
 *
 * A moving average sits on top of price; RSI (0–100) and MACD (±hundreds) do not.
 * Drawing them all against the price axis is why an RSI script rendered as a bare
 * candle chart — the line was there, three orders of magnitude off screen. Rather
 * than trusting `overlay=`, which says nothing about any individual series, compare
 * each plot's own magnitude to the price it would be drawn against.
 */
function isPriceScale(plot: PineTSPlot, priceMedian: number): boolean {
  if (!Number.isFinite(priceMedian) || priceMedian <= 0) return true;
  const m = medianOf(plot.data.map((d) => d.value ?? NaN));
  if (!Number.isFinite(m)) return false;
  if (m <= 0) return false; // negative or zero-centred ⇒ oscillator
  const ratio = m / priceMedian;
  return ratio > 0.25 && ratio < 4;
}

interface PaneSpec {
  key: string;
  label: string;
  lines: LaunchpadIndicatorLine[];
  histogram?: Array<{ time: number; value: number }>;
  guides: Array<{ id: string; value: number; color: string }>;
}

interface Layers {
  adapted: boolean;
  dashboard: Array<{ label: string; value: string; tone?: "positive" | "negative" | "neutral" }>;
  fills: BklitPlotFill[];
  lines: BklitPlotLine[];
  markers: BklitPlotMarker[];
  levels: Array<{ id: string; price: number; color: string }>;
  panes: PaneSpec[];
  legend: Array<{ title: string; color: string; pane: string }>;
  zones: BklitPlotZone[];
}

const EMPTY: Layers = {
  adapted: false,
  dashboard: [],
  fills: [],
  lines: [],
  markers: [],
  levels: [],
  panes: [],
  legend: [],
  zones: [],
};

/** A vault fill, so the chart shows what the strategy actually did with real money. */
export interface PreviewTrade {
  timestamp: number;
  price: number;
  isBuy: boolean;
  reduceOnly?: boolean;
}

function buildLayers(
  result: PineTSResult | null,
  candles: Candle[],
  trades: PreviewTrade[],
  source: string,
  title?: string,
): Layers {
  if (candles.length === 0) return EMPTY;

  const priceMedian = medianOf(candles.map((c) => c.close));
  const firstTime = candles[0]?.timestamp ?? 0;
  const lastTime = candles.at(-1)?.timestamp ?? Number.POSITIVE_INFINITY;

  const lines: BklitPlotLine[] = [];
  const levels: Layers["levels"] = [];
  const legend: Layers["legend"] = [];
  const overlayPlots: PineTSPlot[] = [];
  const panePlots: PineTSPlot[] = [];

  for (const plot of result?.plots ?? []) {
    if (!plot.visible) continue;
    if (plot.data.every((d) => d.value === null || !Number.isFinite(d.value))) continue;
    (isPriceScale(plot, priceMedian) ? overlayPlots : panePlots).push(plot);
  }

  const colorFor = (plot: PineTSPlot, index: number) =>
    colorString(plot.color) ?? colorString(plot.data.find((d) => d.color)?.color)
    ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];

  // ── Price pane: one polyline per series, in the colour the script asked for ──
  // These used to be emitted as one two-point segment per bar, recoloured blue or
  // white by whether the value ticked up. That is 400 SVG paths for one moving
  // average, and it threw away the script's own palette — two EMAs came out
  // indistinguishable, which reads as "the indicator isn't drawing".
  const byTitle = new Map<string, PineTSPlot>();
  for (const [index, plot] of overlayPlots.entries()) {
    const color = colorFor(plot, index);
    byTitle.set(plot.title, plot);
    const data = plot.data
      .filter((p): p is typeof p & { value: number } =>
        p.value !== null && Number.isFinite(p.value) && Number.isFinite(p.time))
      .map((p) => ({ time: p.time, value: p.value }));
    if (data.length < 2) continue;
    lines.push({ id: `plot-${plot.title}`, color, width: Math.max(1, Math.min(3, plot.lineWidth ?? 2)), data });
    legend.push({ title: plot.title, color, pane: "price" });
  }

  // Free-standing segments from label.new/line.new drawing calls.
  for (const [index, segment] of (result?.lines ?? []).slice(-250).entries()) {
    if (![segment.x1, segment.x2, segment.y1, segment.y2].every(Number.isFinite)
      || segment.y1 <= 0 || segment.y2 <= 0) continue;
    lines.push({
      id: `segment-${index}`,
      color: colorString(segment.color) ?? "#7c8496",
      dash: segment.style === "solid" ? undefined : segment.style === "dotted" ? "2 3" : "4 4",
      width: Math.max(1, Math.min(2, segment.width || 1)),
      data: [
        { time: segment.x1, value: segment.y1 },
        { time: segment.x2, value: segment.y2 },
      ],
    });
  }

  // ── Shaded bands between two plots — `fill(upper, lower)` ───────────────────
  const fills: BklitPlotFill[] = (result?.fills ?? []).flatMap((fill, index) => {
    const first = byTitle.get(fill.options?.plot1 ?? "");
    const second = byTitle.get(fill.options?.plot2 ?? "");
    if (!first || !second) return [];
    const secondByTime = new Map(second.data.map((p) => [p.time, p.value]));
    const pairs = first.data.flatMap((p) => {
      const other = secondByTime.get(p.time);
      if (p.value === null || other === null || other === undefined
        || !Number.isFinite(p.value) || !Number.isFinite(other)) return [];
      return [{ time: p.time, first: p.value, second: other }];
    });
    if (pairs.length < 2) return [];
    return [{
      id: `fill-${index}`,
      color: colorString(fill.options?.color)?.slice(0, 7) ?? "#4da3ff",
      opacity: 0.14,
      upperData: pairs.map((p) => ({ time: p.time, value: Math.max(p.first, p.second) })),
      lowerData: pairs.map((p) => ({ time: p.time, value: Math.min(p.first, p.second) })),
    }];
  });

  // Pine `box.new()` objects are price/time regions, not screenshots. Keeping them as live
  // chart geometry means order blocks, liquidity zones and risk/reward areas move and scale
  // with the same candles as every other overlay.
  const zones: BklitPlotZone[] = (result?.boxes ?? []).slice(-80).flatMap((box, index) => {
    const startTime = Math.min(box.left, box.right);
    const endTime = Math.max(box.left, box.right);
    const low = Math.min(box.top, box.bottom);
    const high = Math.max(box.top, box.bottom);
    if (![startTime, endTime, low, high].every(Number.isFinite)
      || startTime <= 0 || endTime <= startTime || low <= 0 || high <= low) return [];
    return [{
      id: `pine-box-${startTime}-${index}`,
      startTime,
      endTime,
      low,
      high,
      color: colorString(box.borderColor) ?? colorString(box.backgroundColor) ?? "#4da3ff",
      label: box.text || undefined,
      opacity: 0.09,
    }];
  });

  // ── Oscillator panes ────────────────────────────────────────────────────────
  // Grouped by order of magnitude so RSI (0–100) and MACD (±500) never share an
  // axis; a shared axis flattens the smaller of the two into a straight line.
  const paneGroups = new Map<string, PineTSPlot[]>();
  for (const plot of panePlots) {
    const m = Math.abs(medianOf(plot.data.map((d) => d.value ?? NaN)));
    const bucket = Number.isFinite(m) && m > 0 ? String(Math.round(Math.log10(m + 1))) : "0";
    const group = paneGroups.get(bucket) ?? [];
    group.push(plot);
    paneGroups.set(bucket, group);
  }

  const panes: PaneSpec[] = [];
  for (const [bucket, group] of paneGroups) {
    const paneLines: LaunchpadIndicatorLine[] = [];
    let histogram: PaneSpec["histogram"];
    for (const [index, plot] of group.entries()) {
      const color = colorFor(plot, index);
      const data = plot.data
        .filter((p): p is typeof p & { value: number } =>
          p.value !== null && Number.isFinite(p.value) && Number.isFinite(p.time))
        .map((p) => ({ time: p.time, value: p.value }));
      if (data.length === 0) continue;
      legend.push({ title: plot.title, color, pane: bucket });
      if (plot.style === "histogram") histogram = data;
      else paneLines.push({ id: `pane-${plot.title}`, color, data });
    }
    if (paneLines.length === 0 && !histogram) continue;
    const label = group.map((p) => p.title).join(" · ");
    const values = [...paneLines.flatMap((l) => l.data), ...(histogram ?? [])].map((p) => p.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    panes.push({
      key: bucket,
      label,
      lines: paneLines,
      histogram,
      // Only the guides that belong to THIS pane's range — an hline(0) drawn on an
      // RSI axis is a floor nobody asked for.
      guides: (result?.guides ?? [])
        .filter((g) => g.value >= lo - (hi - lo) * 0.5 && g.value <= hi + (hi - lo) * 0.5)
        .map((g) => ({ id: `g-${bucket}-${g.value}`, value: g.value, color: colorString(g.color) ?? "#7c8496" })),
    });
  }

  // Guides that land on the price axis stay on the price chart.
  for (const g of result?.guides ?? []) {
    if (panes.some((p) => p.guides.some((pg) => pg.value === g.value))) continue;
    if (!Number.isFinite(priceMedian) || g.value < priceMedian * 0.25 || g.value > priceMedian * 4) continue;
    levels.push({ id: `level-${g.value}`, price: g.value, color: colorString(g.color) ?? "#7c8496" });
  }

  // ── Markers ─────────────────────────────────────────────────────────────────
  const candleByTime = new Map(candles.map((c) => [c.timestamp, c]));
  const markers: BklitPlotMarker[] = (result?.labels ?? [])
    .filter((label) => Boolean(label.text) && label.time >= firstTime && label.time <= lastTime)
    .slice(-60)
    .flatMap((label, index) => {
      const buy = label.style.includes("up") || label.style.includes("buy");
      const candle = candleByTime.get(label.time);
      const price = label.price > 0 ? label.price : buy ? candle?.low ?? 0 : candle?.high ?? 0;
      if (!Number.isFinite(price) || price <= 0) return [];
      return [{
        id: `label-${label.time}-${index}`,
        time: label.time,
        price,
        side: buy ? ("buy" as const) : ("sell" as const),
        color: buy ? "#39ff14" : "#ff6b6b",
        label: label.text,
      }];
    });

  // Real fills last, so they draw over the simulated ones. These are the trades the
  // vault actually made with depositor money — labelled so nobody mistakes a
  // backtest arrow for a position they are paying funding on.
  for (const [index, t] of trades.entries()) {
    if (!Number.isFinite(t.timestamp) || !Number.isFinite(t.price) || t.price <= 0) continue;
    if (t.timestamp < firstTime || t.timestamp > lastTime) continue;
    markers.push({
      id: `trade-${t.timestamp}-${index}`,
      time: t.timestamp,
      price: t.price,
      side: t.isBuy ? "buy" : "sell",
      color: t.isBuy ? "#00e5ff" : "#ff9f1c",
      label: `${t.reduceOnly ? "CLOSE" : t.isBuy ? "LONG" : "SHORT"} @ ${t.price.toLocaleString()}`,
    });
  }

  const visual = buildIndicatorVisualEffects({ candles, source, title: title ?? result?.indicatorTitle });
  const runtimeMarks = lines.length + fills.length + markers.length
    + zones.length
    + panes.reduce((count, pane) => count + pane.lines.length + (pane.histogram ? 1 : 0), 0);
  const enrich = visual.family === "liquidity"
    || visual.family === "structure"
    || runtimeMarks < 2;

  if (enrich) {
    lines.push(...visual.lines);
    fills.push(...visual.fills);
    markers.push(...visual.markers);
    panes.push(...visual.panes);
    zones.push(...visual.zones);
    legend.push(...visual.legend.map((item) => ({ ...item, pane: "price" })));
  }

  return {
    adapted: enrich,
    dashboard: enrich ? visual.dashboard : [],
    fills,
    lines,
    markers,
    levels,
    panes,
    legend,
    zones,
  };
}

interface Props {
  pineScript: string;
  /** Fills the vault actually made. Overlaid on top of the simulated signals. */
  trades?: PreviewTrade[];
  /** Override the auto-detected feed — a vault knows its own market. */
  asset?: string;
  /** The marketplace title improves visual-family detection for complex public scripts. */
  title?: string;
}

export function PineVisualPreview({ pineScript, trades, asset: assetOverride, title }: Props) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [pineTSResult, setPineTSResult] = useState<PineTSResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeIssue, setRuntimeIssue] = useState<string | null>(null);
  const detected = useMemo(() => detectAsset(pineScript), [pineScript]);
  const asset = assetOverride ?? detected;
  const hasScript = pineScript.trim().length > 0;

  useEffect(() => {
    if (!hasScript) {
      setCandles([]);
      setPineTSResult(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setCandles([]);
    setPineTSResult(null);

    const fetchHistory = async () => {
      const decibel = await fetch(
        `/api/decibel/candlesticks?market=${encodeURIComponent(asset)}&interval=1h&bars=168`,
        { signal: controller.signal },
      );
      if (decibel.ok) {
        const payload = await decibel.json() as { candles?: Array<Record<string, number>> };
        if (Array.isArray(payload.candles) && payload.candles.length > 0) return payload;
      }
      const fallback = await fetch(
        `/api/launchpad/candles?asset=${encodeURIComponent(asset)}&resolution=60&days=7`,
        { signal: controller.signal },
      );
      if (!fallback.ok) throw new Error(`Candle history returned ${fallback.status}`);
      return fallback.json() as Promise<{ candles?: Array<Record<string, number>> }>;
    };

    void fetchHistory()
      .then((data) => {
        if (controller.signal.aborted || !Array.isArray(data.candles)) return;
        const valid = data.candles.flatMap((candle) => {
          const rawTimestamp = Number(candle.timestamp ?? candle.time ?? candle.t);
          const timestamp = rawTimestamp > 10_000_000_000 ? Math.floor(rawTimestamp / 1_000) : Math.floor(rawTimestamp);
          const open = Number(candle.open ?? candle.o);
          const high = Number(candle.high ?? candle.h);
          const low = Number(candle.low ?? candle.l);
          const close = Number(candle.close ?? candle.c);
          const volume = Number(candle.volume ?? candle.v ?? 0);
          if (
            !Number.isSafeInteger(timestamp)
            || timestamp <= 0
            || ![open, high, low, close, volume].every(Number.isFinite)
            || open <= 0
            || high <= 0
            || low <= 0
            || close <= 0
            || high < Math.max(open, close)
            || low > Math.min(open, close)
            || volume < 0
          ) return [];
          return [{ timestamp, open, high, low, close, volume }];
        });
        if (valid.length === 0) throw new Error("Candle history returned no valid rows");
        setCandles(valid);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Price history is unavailable");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [asset, hasScript]);

  useEffect(() => {
    if (!pineScript || candles.length === 0) return;
    let cancelled = false;
    setPineTSResult(null);
    setRuntimeIssue(null);
    const ownResult = runOwnRuntime(pineScript, candles, setRuntimeIssue);

    void runPineTS(pineScript, candles)
      .then((pineResult) => {
        if (cancelled) return;
        if (!pineResult) {
          setPineTSResult(ownResult);
          return;
        }
        const ownLabels = ownResult?.labels ?? [];
        setPineTSResult({
          ...pineResult,
          // Our own runtime is the one that understands `hline` and named fills;
          // PineTS supplies richer drawing objects. Take the union rather than
          // letting whichever ran last win.
          guides: pineResult.guides.length > 0 ? pineResult.guides : ownResult?.guides ?? [],
          fills: pineResult.fills.length > 0 ? pineResult.fills : ownResult?.fills ?? [],
          plots: pineResult.plots.length > 0 ? pineResult.plots : ownResult?.plots ?? [],
          logs: ownResult?.logs ?? pineResult.logs,
          labels: [
            ...pineResult.labels,
            ...ownLabels.filter((label) => (
              !pineResult.labels.some((existing) => existing.time === label.time)
            )),
          ],
        });
      })
      .catch(() => {
        if (!cancelled) setPineTSResult(ownResult);
      });

    return () => { cancelled = true; };
  }, [candles, pineScript]);

  const layers = useMemo(
    () => buildLayers(pineTSResult, candles, trades ?? [], pineScript, title),
    [candles, pineScript, pineTSResult, title, trades],
  );
  if (!hasScript) return null;

  const latestPrice = candles.at(-1)?.close ?? 0;
  return (
    <div className="overflow-hidden rounded-lg border border-[#2a2a2a]">
      <div className="flex items-center justify-between gap-2 border-b border-[#2a2a2a] bg-[#181818] px-3 py-1.5">
        <span className="truncate text-[9px] font-mono uppercase tracking-widest text-zinc-500">
          {pineTSResult?.indicatorTitle ?? "Indicator Preview"}
        </span>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[9px] text-zinc-600">
          <span>{asset}</span>
          <span>7d · 1h</span>
          {layers.adapted && <span className="text-sky-300">visual adapter</span>}
          {loading && <span className="text-amber-400">loading…</span>}
          {error && <span className="text-red-400">error</span>}
        </div>
      </div>

      {layers.legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#2a2a2a] bg-[#111] px-3 py-1.5">
          {layers.legend.map((item) => (
            <span key={`${item.pane}-${item.title}`} className="flex items-center gap-1.5 font-mono text-[9px] text-zinc-400">
              <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: item.color }} />
              {item.title}
            </span>
          ))}
          {(trades?.length ?? 0) > 0 && (
            <span className="flex items-center gap-1.5 font-mono text-[9px] text-zinc-400">
              <span className="h-2 w-2 rotate-45 bg-[#00e5ff]" />
              {trades!.length} vault fill{trades!.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {/* Height, not a crop. The preview used to render at a fixed 480px inside a
          `max-h-[280px] overflow-hidden` wrapper on phones, which cut the bottom off the
          chart — including the time axis — so the mobile preview was a chart with its
          scale missing rather than a smaller chart. */}
      <div className="relative h-[300px] w-full sm:h-[480px]" style={{ backgroundColor: CHART_BG }}>
        {candles.length > 0 && (
          <BklitCandlePlot
            candles={candles.map((candle) => ({
              time: candle.timestamp,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            }))}
            currentPrice={latestPrice}
            fills={layers.fills}
            intervalSeconds={3_600}
            levels={layers.levels}
            lines={layers.lines}
            markers={layers.markers}
            priceDecimals={displayPriceDecimals(latestPrice)}
            zones={layers.zones}
          />
        )}
        {layers.dashboard.length > 0 && (
          <div className="pointer-events-none absolute right-3 top-3 hidden min-w-[190px] overflow-hidden rounded-[10px] border border-white/[0.1] bg-[#0b0f16]/90 shadow-xl backdrop-blur md:block">
            <div className="border-b border-white/[0.08] px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-300">
              {title ?? pineTSResult?.indicatorTitle ?? "Indicator state"}
            </div>
            <dl className="divide-y divide-white/[0.05] px-3 py-1.5">
              {layers.dashboard.map((item) => (
                <div className="flex items-center justify-between gap-4 py-1.5 font-mono text-[9px]" key={item.label}>
                  <dt className="text-zinc-500">{item.label}</dt>
                  <dd className={item.tone === "positive" ? "text-accent" : item.tone === "negative" ? "text-red-400" : "text-zinc-200"}>{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {layers.panes.map((pane) => (
        <LaunchpadIndicatorPane
          key={pane.key}
          guides={pane.guides}
          histogram={pane.histogram}
          label={pane.label}
          lines={pane.lines}
        />
      ))}

      {(pineTSResult?.logs.length ?? 0) > 0 && (
        <details className="group border-t border-white/[0.06] bg-[#0d0d0d]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-mono text-[10px] text-zinc-400 hover:text-white">
            <span>Pine logs</span>
            <span className="text-zinc-600">{pineTSResult!.logs.length}</span>
          </summary>
          <div className="max-h-44 overflow-y-auto overscroll-contain border-t border-white/[0.06] px-3 py-2">
            {pineTSResult!.logs.slice(-200).map((entry, index) => (
              <div
                key={`${entry.time}-${entry.barIndex}-${index}`}
                className="grid grid-cols-[72px_54px_minmax(0,1fr)] gap-2 py-0.5 font-mono text-[10px] leading-relaxed"
              >
                <span className="text-zinc-600">bar {entry.barIndex}</span>
                <span className={
                  entry.level === "error"
                    ? "text-red-400"
                    : entry.level === "warning"
                      ? "text-amber-400"
                      : "text-sky-400"
                }>
                  {entry.level}
                </span>
                <span className="break-words text-zinc-300">{entry.message}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {runtimeIssue && (
        <div className="border-t border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 font-mono text-[9px] leading-relaxed text-amber-300/80">
          Preview runtime: {runtimeIssue}
        </div>
      )}

      {error && (
        <div className="border-t border-red-500/20 bg-red-500/10 px-3 py-1.5 font-mono text-[9px] text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
