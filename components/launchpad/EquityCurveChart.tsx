"use client";

import { useEffect, useRef, useState } from "react";

interface Point {
  t: number; // unix seconds
  v: number; // equity value
}

interface EquityCurveChartProps {
  data: Point[];
  initialCapital?: number;
}

export function EquityCurveChart({ data, initialCapital = 10000 }: EquityCurveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts")["createChart"]> | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);

    if (!containerRef.current || data.length === 0) return;

    let chart: ReturnType<typeof import("lightweight-charts")["createChart"]>;
    let revealTimer: ReturnType<typeof setTimeout>;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle }) => {
      if (!containerRef.current) return;
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

      const isProfit = data[data.length - 1]?.v >= initialCapital;

      chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 160,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#71717a",
        },
        grid: {
          vertLines: { color: "#27272a", style: LineStyle.Dashed },
          horzLines: { color: "#27272a", style: LineStyle.Dashed },
        },
        rightPriceScale: {
          borderColor: "#3f3f46",
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: "#3f3f46",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: { mode: 1 },
        handleScroll: false,
        handleScale: false,
      });

      chartRef.current = chart;

      const series = chart.addLineSeries({
        color: isProfit ? "#4ade80" : "#f87171",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      // Baseline (initial capital horizontal line)
      const baseSeries = chart.addLineSeries({
        color: "#3f3f46",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      const chartData = data.map((p) => ({
        time: p.t as unknown as import("lightweight-charts").Time,
        value: p.v,
      }));

      series.setData(chartData);
      baseSeries.setData([
        { time: chartData[0].time, value: initialCapital },
        { time: chartData[chartData.length - 1].time, value: initialCapital },
      ]);

      chart.timeScale().fitContent();

      // Trigger the draw-in animation after a short delay to let the chart render
      revealTimer = setTimeout(() => setRevealed(true), 80);

      const observer = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    });

    return () => {
      clearTimeout(revealTimer);
      setRevealed(false);
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [data, initialCapital]);

  if (data.length === 0) return null;

  const finalValue = data[data.length - 1]?.v ?? initialCapital;
  const pct = ((finalValue - initialCapital) / initialCapital) * 100;

  return (
    <div>
      <div
        style={{ opacity: revealed ? 1 : 0, transition: 'opacity 0.4s ease 0.6s' }}
        className="flex items-center justify-between mb-1"
      >
        <span className="text-[10px] text-zinc-500">Equity Curve (baseline run, $10k start)</span>
        <span className={`text-xs font-mono font-semibold ${pct >= 0 ? "text-green-400" : "text-red-400"}`}>
          {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
        </span>
      </div>
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden"
        style={{
          clipPath: revealed ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)',
          transition: revealed ? 'clip-path 0.85s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
        }}
      />
    </div>
  );
}
