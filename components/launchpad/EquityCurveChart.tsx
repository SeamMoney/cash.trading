"use client";

import { curveMonotoneX } from "@visx/curve";
import { GridColumns, GridRows } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useEffect, useMemo, useState } from "react";

interface Point {
  t: number;
  v: number;
}

interface EquityCurveChartProps {
  data: Point[];
  initialCapital?: number;
}

function formatEquity(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function EquityPlot({
  data,
  initialCapital,
  width,
  height,
}: {
  data: Point[];
  initialCapital: number;
  width: number;
  height: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const margin = { top: 8, right: 58, bottom: 24, left: 8 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);
  const timeDomain = useMemo<[number, number]>(() => {
    const first = data[0]?.t ?? 0;
    const last = data.at(-1)?.t ?? first + 1;
    return first === last ? [first - 1, last + 1] : [first, last];
  }, [data]);
  const valueDomain = useMemo<[number, number]>(() => {
    const values = [initialCapital, ...data.map((point) => point.v)];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1 || Math.max(1, Math.abs(max) * 0.01);
    return [min - padding, max + padding];
  }, [data, initialCapital]);
  const xScale = useMemo(() => scaleTime({
    domain: timeDomain.map((time) => time * 1_000),
    range: [0, innerWidth],
  }), [innerWidth, timeDomain]);
  const yScale = useMemo(() => scaleLinear({
    domain: valueDomain,
    range: [innerHeight, 0],
    nice: true,
  }), [innerHeight, valueDomain]);

  if (innerWidth < 20 || innerHeight < 20) return null;

  const baselineY = yScale(initialCapital);
  const hovered = hoverIndex == null ? null : data[hoverIndex];
  const isProfit = (data.at(-1)?.v ?? initialCapital) >= initialCapital;

  return (
    <svg
      aria-hidden="true"
      height={height}
      onPointerLeave={() => setHoverIndex(null)}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const chartX = Math.max(0, Math.min(innerWidth, event.clientX - bounds.left - margin.left));
        const targetTime = xScale.invert(chartX).getTime() / 1_000;
        let nearest = 0;
        let distance = Number.POSITIVE_INFINITY;
        data.forEach((point, index) => {
          const nextDistance = Math.abs(point.t - targetTime);
          if (nextDistance < distance) {
            nearest = index;
            distance = nextDistance;
          }
        });
        setHoverIndex(nearest);
      }}
      width={width}
    >
      <g transform={`translate(${margin.left},${margin.top})`}>
        <GridRows
          height={innerHeight}
          numTicks={3}
          scale={yScale}
          stroke="#27272a"
          strokeDasharray="4 4"
          width={innerWidth}
        />
        <GridColumns
          height={innerHeight}
          numTicks={4}
          scale={xScale}
          stroke="#27272a"
          strokeDasharray="4 4"
          width={innerWidth}
        />
        <line
          stroke="#3f3f46"
          strokeDasharray="4 4"
          x1={0}
          x2={innerWidth}
          y1={baselineY}
          y2={baselineY}
        />
        <LinePath
          curve={curveMonotoneX}
          data={data}
          stroke={isProfit ? "#4ade80" : "#f87171"}
          strokeWidth={2}
          x={(point) => xScale(new Date(point.t * 1_000))}
          y={(point) => yScale(point.v)}
        />
        {hovered && (
          <>
            <line
              stroke="#71717a"
              strokeDasharray="3 3"
              x1={xScale(new Date(hovered.t * 1_000))}
              x2={xScale(new Date(hovered.t * 1_000))}
              y1={0}
              y2={innerHeight}
            />
            <circle
              cx={xScale(new Date(hovered.t * 1_000))}
              cy={yScale(hovered.v)}
              fill="#111111"
              r={3.5}
              stroke={hovered.v >= initialCapital ? "#4ade80" : "#f87171"}
              strokeWidth={1.5}
            />
          </>
        )}
        {yScale.ticks(3).map((tick) => (
          <text
            dominantBaseline="middle"
            fill="#71717a"
            fontFamily="monospace"
            fontSize={9}
            key={tick}
            x={innerWidth + 8}
            y={yScale(tick)}
          >
            {formatEquity(tick)}
          </text>
        ))}
        {[data[0], data.at(-1)].filter((point): point is Point => Boolean(point)).map((point) => (
          <text
            fill="#71717a"
            fontFamily="monospace"
            fontSize={9}
            key={point.t}
            textAnchor={point === data[0] ? "start" : "end"}
            x={xScale(new Date(point.t * 1_000))}
            y={innerHeight + 18}
          >
            {new Date(point.t * 1_000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </text>
        ))}
      </g>
    </svg>
  );
}

export function EquityCurveChart({ data, initialCapital = 10_000 }: EquityCurveChartProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
    const timer = setTimeout(() => setRevealed(true), 80);
    return () => clearTimeout(timer);
  }, [data]);

  if (data.length === 0) return null;

  const finalValue = data.at(-1)?.v ?? initialCapital;
  const pct = ((finalValue - initialCapital) / initialCapital) * 100;

  return (
    <div>
      <div
        className="mb-1 flex items-center justify-between"
        style={{ opacity: revealed ? 1 : 0, transition: "opacity 0.4s ease 0.6s" }}
      >
        <span className="text-[10px] text-zinc-500">Equity Curve (baseline run, $10k start)</span>
        <span className={`text-xs font-mono font-semibold ${pct >= 0 ? "text-green-400" : "text-red-400"}`}>
          {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
        </span>
      </div>
      <div
        aria-label="Backtest equity curve"
        className="h-[160px] w-full overflow-hidden rounded-lg"
        role="img"
        style={{
          clipPath: revealed ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
          transition: revealed ? "clip-path 0.85s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
        }}
      >
        <ParentSize debounceTime={10}>
          {({ width, height }) => (
            <EquityPlot data={data} height={height} initialCapital={initialCapital} width={width} />
          )}
        </ParentSize>
      </div>
    </div>
  );
}
