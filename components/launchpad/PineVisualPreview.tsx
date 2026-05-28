"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { Candle } from "@/lib/launchpad/types";
import { runPineTS, runOwnRuntime, type PineTSResult } from "@/lib/launchpad/pinets-runner";

const CHART_HEIGHT = 560;
const CHART_BG = "#0d0d14";

function detectAsset(script: string): string {
  if (/\bETH\b/i.test(script)) return "ETH/USD";
  if (/\bSOL\b/i.test(script)) return "SOL/USD";
  if (/\bAPT\b/i.test(script)) return "APT/USD";
  return "BTC/USD";
}

interface Props {
  pineScript: string;
}

export function PineVisualPreview({ pineScript }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [pineTSResult, setPineTSResult] = useState<PineTSResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const asset = useMemo(() => detectAsset(pineScript), [pineScript]);

  // Fetch candles — always, even for strategy scripts with no plot() calls
  useEffect(() => {
    if (!pineScript.trim()) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/launchpad/candles?asset=${encodeURIComponent(asset)}&resolution=60&days=7`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.candles?.length) {
          setCandles(data.candles.map((c: Record<string, number>) => ({
            timestamp: c.timestamp ?? c.time,
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0,
          })));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [asset, pineScript]);

  // Run PineTS when script or candles change — always, for both indicators and strategies
  useEffect(() => {
    if (!pineScript || !candles.length) return;
    let cancelled = false;
    setError(null);

    // Run our runtime synchronously for strategy signals (buy/sell markers)
    const ownResult = runOwnRuntime(pineScript, candles);

    // Run pinets async for indicator plot overlays (labels, fills, line plots)
    // Merge: pinets provides the plot overlay, our runtime provides the strategy markers
    runPineTS(pineScript, candles).then(pinetsResult => {
      if (cancelled) return;

      if (pinetsResult) {
        // Pinets succeeded — use its plots/fills/lines, but merge our runtime's signals as labels
        const ownLabels = ownResult?.labels ?? [];
        const mergedLabels = [
          ...pinetsResult.labels,
          ...ownLabels.filter(l => !pinetsResult.labels.some(pl => pl.time === l.time)),
        ];
        setPineTSResult({ ...pinetsResult, labels: mergedLabels });
      } else {
        // Pinets failed — use our runtime's result only (strategy signals as markers)
        setPineTSResult(ownResult);
      }
    }).catch(() => {
      if (!cancelled) setPineTSResult(ownResult);
    });

    return () => { cancelled = true; };
  }, [pineScript, candles]);

  // Render chart — always when candles are loaded, even if PineTS failed (strategy scripts)
  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;
    let disposed = false;

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (disposed || !chartRef.current) return;
      chartRef.current.innerHTML = "";

      const chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: CHART_HEIGHT,
        layout: {
          background: { type: ColorType.Solid, color: CHART_BG },
          textColor: "#52525b",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: "#1a1a2e" },
          horzLines: { color: "#1a1a2e" },
        },
        rightPriceScale: { borderColor: "#27272a" },
        timeScale: { borderColor: "#27272a", timeVisible: true },
      });

      // Candlestick series
      const candleSeries = chart.addCandlestickSeries({
        upColor: "#2962ff",
        downColor: "#ffffff",
        borderUpColor: "#2962ff",
        borderDownColor: "#2962ff",
        wickUpColor: "#2962ff",
        wickDownColor: "#ffffff",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      candleSeries.setData(candles.map(c => ({
        time: c.timestamp as any,
        open: c.open, high: c.high, low: c.low, close: c.close,
      })));

      // ── Overlay rendering — only if PineTS succeeded (indicator scripts) ──
      const plotsForCanvas: Array<{
        data: Array<{ time: unknown; value: number }>;
        colors: string[];
        lineWidth: number;
      }> = [];

      if (pineTSResult) {
      // Render PineTS plots
      for (const plot of pineTSResult.plots) {
        if (!plot.visible) continue;

        const cleanData = plot.data
          .filter(d => d.value !== null && Number.isFinite(d.value))
          .map(d => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            time: d.time as any,
            value: d.value as number,
            // Per-bar coloring not supported by LineSeries, use first color
          }));

        if (cleanData.length === 0) continue;

        // Remap PineScript default colors to blue/white TradingView theme
        const remapColor = (c: string): string => {
          if (!c || typeof c !== "string") return "#ffffff";
          const lower = c.toLowerCase();
          // Teal/green bullish → bright blue
          if (lower === "#089981" || lower === "#26a69a" || lower === "#4caf50") return "#1e88e5";
          // Red bearish → pure white
          if (lower === "#f23645" || lower === "#ef5350" || lower === "#ff5252") return "#ffffff";
          // Default blue stays blue
          if (lower === "#2962ff") return "#2962ff";
          return c;
        };

        // Get the dominant color — use last bar's color as the static fallback
        const validColors = plot.data.filter(d => d.color && typeof d.color === "string" && d.color !== "#000000");
        const color = remapColor(validColors[validColors.length - 1]?.color || "#ffffff");

        // Create an invisible LineSeries (we draw the colored line on canvas instead)
        const series = chart.addLineSeries({
          color: "transparent",
          lineWidth: 1 as 1,
          priceLineVisible: false,
          lastValueVisible: false,
          pointMarkersVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(cleanData);

        // Store plot data for canvas-based per-bar color rendering
        if (plot.visible) {
          const plotColors = plot.data.map(d => remapColor(typeof d.color === "string" ? d.color : "#ffffff"));
          plotsForCanvas.push({ data: cleanData, colors: plotColors, lineWidth: plot.lineWidth ?? 2 });
        }
      }

      // Render PineTS fills using stacked AreaSeries pairs
      // For each fill between plot1 and plot2:
      // 1. Render an AreaSeries at the UPPER boundary (fills downward with color)
      // 2. Render an AreaSeries at the LOWER boundary (fills downward with background, masking the excess)
      // The trick: render fills in REVERSE order (outermost first) so inner layers cover outer ones
      const fillsToRender: Array<{
        upperData: Array<{ time: unknown; value: number }>;
        lowerData: Array<{ time: unknown; value: number }>;
        color: string;
      }> = [];

      for (const fill of pineTSResult.fills) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fillOptions = (fill as any).options;
        const plot1Ref = fillOptions?.plot1;
        const plot2Ref = fillOptions?.plot2;
        const rawColor = fill.data.find(d => d.color)?.color ?? fillOptions?.color ?? "#2196f340";
        const fillColor = typeof rawColor === "string" ? rawColor : "#2196f340";

        if (!plot1Ref || !plot2Ref) continue;

        const plot1Idx = plot1Ref.startsWith("#") ? parseInt(plot1Ref.slice(1)) : -1;
        const plot2Idx = plot2Ref.startsWith("#") ? parseInt(plot2Ref.slice(1)) : -1;
        const plot1 = plot1Idx >= 0 ? pineTSResult.plots[plot1Idx] : pineTSResult.plots.find(p => p.title === plot1Ref);
        const plot2 = plot2Idx >= 0 ? pineTSResult.plots[plot2Idx] : pineTSResult.plots.find(p => p.title === plot2Ref);

        if (!plot1?.data || !plot2?.data) continue;

        const minLen = Math.min(plot1.data.length, plot2.data.length);
        const upperData: Array<{ time: unknown; value: number }> = [];
        const lowerData: Array<{ time: unknown; value: number }> = [];

        for (let i = 0; i < minLen; i++) {
          const v1 = plot1.data[i]?.value;
          const v2 = plot2.data[i]?.value;
          if (v1 === null || v2 === null || !Number.isFinite(v1) || !Number.isFinite(v2)) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = plot1.data[i].time as any;
          upperData.push({ time: t, value: Math.max(v1, v2) });
          lowerData.push({ time: t, value: Math.min(v1, v2) });
        }

        if (upperData.length > 0) {
          fillsToRender.push({ upperData, lowerData, color: fillColor });
        }
      }

      // Render fills as canvas polygon overlays (true bounded fills)
      // We subscribe to chart changes and redraw the fill polygons on a canvas
      // Canvas overlay for true bounded fills (polygons between two series)
      const dpr = window.devicePixelRatio || 1;
      const fillCanvas = document.createElement("canvas");
      fillCanvas.style.position = "absolute";
      fillCanvas.style.top = "0";
      fillCanvas.style.left = "0";
      fillCanvas.style.pointerEvents = "none";
      fillCanvas.style.zIndex = "1";
      const cw = chartRef.current!.clientWidth;
      fillCanvas.style.width = cw + "px";
      fillCanvas.style.height = CHART_HEIGHT + "px";
      fillCanvas.width = Math.round(cw * dpr);
      fillCanvas.height = Math.round(CHART_HEIGHT * dpr);
      chartRef.current!.style.position = "relative";
      chartRef.current!.appendChild(fillCanvas);

      const drawFills = () => {
        const ctx2d = fillCanvas.getContext("2d");
        if (!ctx2d) return;
        const w = chartRef.current?.clientWidth ?? cw;
        fillCanvas.style.width = w + "px";
        fillCanvas.width = Math.round(w * dpr);
        fillCanvas.height = Math.round(CHART_HEIGHT * dpr);
        ctx2d.scale(dpr, dpr);
        ctx2d.clearRect(0, 0, w, CHART_HEIGHT);

        const ts = chart.timeScale();

        for (let fi = 0; fi < fillsToRender.length; fi++) {
          const { upperData, lowerData, color } = fillsToRender[fi];
          if (upperData.length < 2) continue;

          ctx2d.beginPath();
          let started = false;

          // Trace upper boundary left-to-right
          for (let i = 0; i < upperData.length; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const x = ts.timeToCoordinate(upperData[i].time as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const y = (candleSeries as any).priceToCoordinate(upperData[i].value);
            if (x === null || y === null) continue;
            if (!started) { ctx2d.moveTo(x, y); started = true; }
            else ctx2d.lineTo(x, y);
          }

          // Trace lower boundary right-to-left
          for (let i = lowerData.length - 1; i >= 0; i--) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const x = ts.timeToCoordinate(lowerData[i].time as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const y = (candleSeries as any).priceToCoordinate(lowerData[i].value);
            if (x === null || y === null) continue;
            ctx2d.lineTo(x, y);
          }

          // Don't use the single polygon — instead render per-bar colored vertical strips
          // This gives us per-bar color control (blue bullish, gray bearish)
          // Skip the closePath/fill of the outline polygon

          const BLUE_FILL = "#1a4a8a";
          const GRAY_FILL = "#606878";
          const opacities = [0.75, 0.52, 0.34, 0.20, 0.12, 0.07];
          const layerOpacity = opacities[Math.min(fi, opacities.length - 1)];

          // Get per-bar fill colors from PineTS
          const fillObj = pineTSResult.fills[fi];
          const fillBarColors = fillObj?.data?.map(d => {
            if (!d.color || typeof d.color !== "string") return BLUE_FILL;
            const lower = d.color.toLowerCase().slice(0, 7);
            if (lower === "#089981" || lower === "#26a69a" || lower === "#4caf50") return BLUE_FILL;
            if (lower === "#f23645" || lower === "#ef5350") return GRAY_FILL;
            return BLUE_FILL;
          }) ?? [];

          // Also use slope-based fallback if PineTS colors are all the same
          const mainPlot = plotsForCanvas[0];

          ctx2d.globalAlpha = layerOpacity;

          // Draw filled trapezoids bar-by-bar
          const minLen = Math.min(upperData.length, lowerData.length);
          for (let i = 1; i < minLen; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const x0 = ts.timeToCoordinate(upperData[i - 1].time as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const x1 = ts.timeToCoordinate(upperData[i].time as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const yu0 = (candleSeries as any).priceToCoordinate(upperData[i - 1].value);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const yu1 = (candleSeries as any).priceToCoordinate(upperData[i].value);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const yl0 = (candleSeries as any).priceToCoordinate(lowerData[i - 1].value);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const yl1 = (candleSeries as any).priceToCoordinate(lowerData[i].value);

            if (x0 === null || x1 === null || yu0 === null || yu1 === null || yl0 === null || yl1 === null) continue;

            // Determine color: use PineTS fill color, fallback to slope
            let barColor = fillBarColors[i] || BLUE_FILL;
            if (mainPlot && mainPlot.data.length > i + 2) {
              const slope = mainPlot.data[i].value - mainPlot.data[Math.max(0, i - 3)].value;
              if (fillBarColors.length === 0 || new Set(fillBarColors).size <= 1) {
                barColor = slope >= 0 ? BLUE_FILL : GRAY_FILL;
              }
            }

            ctx2d.beginPath();
            ctx2d.moveTo(x0, yu0);
            ctx2d.lineTo(x1, yu1);
            ctx2d.lineTo(x1, yl1);
            ctx2d.lineTo(x0, yl0);
            ctx2d.closePath();
            ctx2d.fillStyle = barColor;
            ctx2d.fill();
          }
          ctx2d.globalAlpha = 1;
        }

        // Draw the main indicator line with color based on SLOPE DIRECTION
        // Blue (#1e88e5) when line is rising, White (#ffffff) when falling
        // Color changes at inflection points (where slope changes sign)
        const BLUE = "#1e88e5";
        const WHITE = "#ffffff";

        for (const pc of plotsForCanvas) {
          ctx2d.lineWidth = pc.lineWidth;
          ctx2d.lineCap = "round";
          ctx2d.lineJoin = "round";

          if (pc.data.length < 2) continue;

          // Compute slope direction per bar from the actual values
          // Use a small smoothing window (3 bars) to avoid noise
          const slopes: number[] = [];
          for (let i = 0; i < pc.data.length; i++) {
            if (i < 2) { slopes.push(0); continue; }
            // 3-bar smoothed slope
            const v0 = pc.data[Math.max(0, i - 2)]?.value ?? 0;
            const v1 = pc.data[i]?.value ?? 0;
            slopes.push(v1 - v0);
          }

          // Draw continuous colored segments based on slope sign
          let currentIsRising = slopes[0] >= 0;
          ctx2d.beginPath();
          ctx2d.strokeStyle = currentIsRising ? BLUE : WHITE;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const getXY = (i: number) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const x = ts.timeToCoordinate(pc.data[i].time as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const y = (candleSeries as any).priceToCoordinate(pc.data[i].value);
            return { x, y };
          };

          const { x: x0, y: y0 } = getXY(0);
          if (x0 !== null && y0 !== null) ctx2d.moveTo(x0, y0);

          for (let i = 1; i < pc.data.length; i++) {
            const { x, y } = getXY(i);
            if (x === null || y === null) continue;

            const isRising = slopes[i] >= 0;

            if (isRising !== currentIsRising) {
              // Inflection point — draw up to here, then start new color
              ctx2d.lineTo(x, y);
              ctx2d.stroke();
              ctx2d.beginPath();
              ctx2d.strokeStyle = isRising ? BLUE : WHITE;
              ctx2d.moveTo(x, y);
              currentIsRising = isRising;
            } else {
              ctx2d.lineTo(x, y);
            }
          }
          ctx2d.stroke();
        }

        // Draw BOS/ChoCH lines (dotted horizontal segments)
        for (const ln of pineTSResult.lines) {
          if (ln.y1 <= 0 || ln.y2 <= 0) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const x1 = ts.timeToCoordinate(ln.x1 as any);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const x2 = ts.timeToCoordinate(ln.x2 as any);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const y1 = (candleSeries as any).priceToCoordinate(ln.y1);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const y2 = (candleSeries as any).priceToCoordinate(ln.y2);
          if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

          const lnColor = typeof ln.color === "string" ? ln.color : "#2962ff";
          // Remap colors
          const remapped = lnColor.toLowerCase() === "#089981" ? "#4488cc" :
                           lnColor.toLowerCase() === "#f23645" ? "#cc8844" : lnColor;

          ctx2d.beginPath();
          ctx2d.strokeStyle = remapped;
          ctx2d.lineWidth = Math.min(ln.width || 1, 2);
          ctx2d.setLineDash([4, 4]);
          ctx2d.moveTo(x1, y1);
          ctx2d.lineTo(x2, y2);
          ctx2d.stroke();
          ctx2d.setLineDash([]);
        }

        // Labels are rendered via lightweight-charts markers below (not on canvas)
      };

      // Delay initial draw to let chart layout settle
      setTimeout(drawFills, 150);
      setTimeout(drawFills, 600);
      chart.timeScale().subscribeVisibleLogicalRangeChange(drawFills);
      chart.subscribeCrosshairMove(drawFills);

      // Render labels as markers — filter carefully
      const firstCandleTime = candles[0]?.timestamp ?? 0;
      const lastCandleTime = candles[candles.length - 1]?.timestamp ?? Infinity;

      const markers = pineTSResult.labels
        .filter(l => {
          if (!l.text || l.price <= 0) return false;
          // Only include labels within the candle time range
          if (l.time < firstCandleTime || l.time > lastCandleTime) return false;
          // Skip generic/repetitive labels
          if (l.text === "im Low" || l.text === "im High") return false;
          return true;
        })
        .map(l => {
          let rawColor = typeof l.textColor === "string" ? l.textColor : "#ffffff";
          // Remap colors to blue/white theme
          const lower = rawColor.toLowerCase();
          if (lower === "#089981" || lower === "#26a69a") rawColor = "#4488cc";
          if (lower === "#f23645" || lower === "#ef5350") rawColor = "#cc8844";
          if (lower.includes("00e676")) rawColor = "#4488cc";
          if (lower.includes("ff0015")) rawColor = "#cc8844";

          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            time: l.time as any,
            position: l.style.includes("up") || l.style.includes("down")
              ? (l.style.includes("up") ? "belowBar" as const : "aboveBar" as const)
              : "aboveBar" as const,
            color: rawColor,
            shape: l.style.includes("up") ? "arrowUp" as const : "arrowDown" as const,
            text: l.text,
            size: 1,
          };
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a, b) => (a.time as any) - (b.time as any))
        .slice(0, 50); // Limit markers to prevent clutter

      if (markers.length > 0) {
        candleSeries.setMarkers(markers);
      }

      // Skip line.new rendering — they create hundreds of full-width price lines
      // TODO: implement short line segments via custom canvas primitive

      } // end if (pineTSResult)

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth });
      });
      ro.observe(chartRef.current);

      return () => { disposed = true; ro.disconnect(); chart.remove(); };
    });

    return () => { disposed = true; };
  }, [candles, pineTSResult]);

  if (!pineScript.trim()) return null;

  const visiblePlots = pineTSResult?.plots.filter(p => p.visible).length ?? 0;
  const hiddenPlots = (pineTSResult?.plots.length ?? 0) - visiblePlots;

  return (
    <div className="rounded-lg border border-[#2a2a2a] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181818] border-b border-[#2a2a2a]">
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
        ref={chartRef}
        className="w-full"
        style={{ height: CHART_HEIGHT, backgroundColor: CHART_BG }}
      />
      {error && (
        <div className="px-3 py-1.5 bg-red-500/10 border-t border-red-500/20 text-[9px] font-mono text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
