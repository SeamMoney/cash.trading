"use client";

import { useEffect, useMemo, useState } from "react";

import {
  BklitCandlePlot,
  type BklitPlotFill,
  type BklitPlotLine,
  type BklitPlotMarker,
} from "@/components/trade/BklitCandlePlot";
import { runOwnRuntime, runPineTS, type PineTSResult } from "@/lib/launchpad/pinets-runner";
import type { Candle } from "@/lib/launchpad/types";

const CHART_HEIGHT = 560;
const CHART_BG = "#0d0d14";

function detectAsset(script: string): string {
  if (/\bETH\b/i.test(script)) return "ETH/USD";
  if (/\bSOL\b/i.test(script)) return "SOL/USD";
  if (/\bAPT\b/i.test(script)) return "APT/USD";
  return "BTC/USD";
}

function remapLineColor(color: string | undefined) {
  const normalized = color?.toLowerCase();
  if (["#089981", "#26a69a", "#4caf50"].includes(normalized ?? "")) return "#1e88e5";
  if (["#f23645", "#ef5350", "#ff5252"].includes(normalized ?? "")) return "#ffffff";
  return color || "#ffffff";
}

function remapFillColor(color: string | undefined) {
  const normalized = color?.toLowerCase().slice(0, 7);
  if (["#f23645", "#ef5350", "#ff5252"].includes(normalized ?? "")) return "#606878";
  return "#1a4a8a";
}

function displayPriceDecimals(price: number) {
  if (price >= 100) return 2;
  if (price >= 1) return 4;
  return 6;
}

function buildLayers(result: PineTSResult | null, candles: Candle[]) {
  if (!result || candles.length === 0) {
    return { fills: [] as BklitPlotFill[], lines: [] as BklitPlotLine[], markers: [] as BklitPlotMarker[] };
  }

  const lines: BklitPlotLine[] = [];
  for (const [plotIndex, plot] of result.plots.entries()) {
    if (!plot.visible) continue;
    const points = plot.data
      .filter((point): point is typeof point & { value: number } => (
        point.value !== null && Number.isFinite(point.value) && Number.isFinite(point.time)
      ))
      .map((point) => ({ time: point.time, value: point.value }));
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const current = points[index];
      lines.push({
        id: `plot-${plotIndex}-${index}`,
        color: current.value >= previous.value ? "#1e88e5" : "#ffffff",
        width: Math.max(1, Math.min(3, plot.lineWidth ?? 2)),
        data: [previous, current],
      });
    }
  }

  for (const [index, segment] of result.lines.slice(-250).entries()) {
    if (
      ![segment.x1, segment.x2, segment.y1, segment.y2].every(Number.isFinite)
      || segment.y1 <= 0
      || segment.y2 <= 0
    ) continue;
    lines.push({
      id: `segment-${index}`,
      color: remapLineColor(segment.color),
      dash: segment.style === "solid" ? undefined : segment.style === "dotted" ? "2 3" : "4 4",
      width: Math.max(1, Math.min(2, segment.width || 1)),
      data: [
        { time: segment.x1, value: segment.y1 },
        { time: segment.x2, value: segment.y2 },
      ],
    });
  }

  const resolvePlot = (reference: string | undefined) => {
    if (!reference) return null;
    if (reference.startsWith("#")) {
      const index = Number(reference.slice(1));
      return Number.isInteger(index) ? result.plots[index] ?? null : null;
    }
    return result.plots.find((plot) => plot.title === reference) ?? null;
  };

  const fills: BklitPlotFill[] = result.fills.flatMap((fill, index) => {
    const first = resolvePlot(fill.options?.plot1);
    const second = resolvePlot(fill.options?.plot2);
    if (!first || !second) return [];
    const secondByTime = new Map(second.data.map((point) => [point.time, point.value]));
    const pairs = first.data.flatMap((point) => {
      const other = secondByTime.get(point.time);
      if (
        point.value === null
        || other === null
        || other === undefined
        || !Number.isFinite(point.value)
        || !Number.isFinite(other)
      ) return [];
      return [{ time: point.time, first: point.value, second: other }];
    });
    if (pairs.length < 2) return [];
    const rawColor = fill.data.find((point) => point.color)?.color ?? fill.options?.color;
    return [{
      id: `fill-${index}`,
      color: remapFillColor(rawColor),
      opacity: 0.28,
      upperData: pairs.map((pair) => ({ time: pair.time, value: Math.max(pair.first, pair.second) })),
      lowerData: pairs.map((pair) => ({ time: pair.time, value: Math.min(pair.first, pair.second) })),
    }];
  });

  const firstTime = candles[0]?.timestamp ?? 0;
  const lastTime = candles.at(-1)?.timestamp ?? Number.POSITIVE_INFINITY;
  const candleByTime = new Map(candles.map((candle) => [candle.timestamp, candle]));
  const markers: BklitPlotMarker[] = result.labels
    .filter((label) => (
      Boolean(label.text)
      && label.time >= firstTime
      && label.time <= lastTime
      && label.text !== "im Low"
      && label.text !== "im High"
    ))
    .slice(-50)
    .flatMap((label, index) => {
      const buy = label.style.includes("up");
      const candle = candleByTime.get(label.time);
      const price = label.price > 0
        ? label.price
        : buy ? candle?.low ?? 0 : candle?.high ?? 0;
      if (!Number.isFinite(price) || price <= 0) return [];
      return [{
        id: `label-${label.time}-${index}`,
        time: label.time,
        price,
        side: buy ? "buy" as const : "sell" as const,
        color: remapLineColor(label.textColor),
        label: label.text,
      }];
    });

  return { fills, lines, markers };
}

interface Props {
  pineScript: string;
}

export function PineVisualPreview({ pineScript }: Props) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [pineTSResult, setPineTSResult] = useState<PineTSResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asset = useMemo(() => detectAsset(pineScript), [pineScript]);
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

    void fetch(
      `/api/launchpad/candles?asset=${encodeURIComponent(asset)}&resolution=60&days=7`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`Candle history returned ${response.status}`);
        return response.json() as Promise<{ candles?: Array<Record<string, number>> }>;
      })
      .then((data) => {
        if (controller.signal.aborted || !Array.isArray(data.candles)) return;
        const valid = data.candles.flatMap((candle) => {
          const timestamp = Number(candle.timestamp ?? candle.time);
          const open = Number(candle.open);
          const high = Number(candle.high);
          const low = Number(candle.low);
          const close = Number(candle.close);
          const volume = Number(candle.volume ?? 0);
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
    const ownResult = runOwnRuntime(pineScript, candles);

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

  const layers = useMemo(() => buildLayers(pineTSResult, candles), [candles, pineTSResult]);
  if (!hasScript) return null;

  const visiblePlots = pineTSResult?.plots.filter((plot) => plot.visible).length ?? 0;
  const hiddenPlots = (pineTSResult?.plots.length ?? 0) - visiblePlots;
  const latestPrice = candles.at(-1)?.close ?? 0;

  return (
    <div className="overflow-hidden rounded-lg border border-[#2a2a2a]">
      <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#181818] px-3 py-1.5">
        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
          {pineTSResult?.indicatorTitle ?? "Indicator Preview"}
        </span>
        <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-600">
          <span>{asset}</span>
          {pineTSResult && (
            <>
              <span>{visiblePlots} plots{hiddenPlots > 0 ? ` (+${hiddenPlots} hidden)` : ""}</span>
              {pineTSResult.fills.length > 0 && <span>{pineTSResult.fills.length} fills</span>}
              {pineTSResult.labels.length > 0 && <span>{pineTSResult.labels.length} labels</span>}
              {pineTSResult.lines.length > 0 && <span>{pineTSResult.lines.length} lines</span>}
            </>
          )}
          {loading && <span className="text-amber-400">loading...</span>}
          {error && <span className="text-red-400">error</span>}
        </div>
      </div>
      <div
        className="relative w-full"
        style={{ height: CHART_HEIGHT, backgroundColor: CHART_BG }}
      >
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
            lines={layers.lines}
            markers={layers.markers}
            priceDecimals={displayPriceDecimals(latestPrice)}
          />
        )}
      </div>
      {error && (
        <div className="border-t border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[9px] font-mono text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
