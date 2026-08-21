"use client";

import { curveLinear } from "@visx/curve";
import { GridColumns, GridRows } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { memo, useMemo } from "react";

/**
 * The vault's own price trace, with the vault's own fills on it.
 *
 * Both series come from the chain: the trace is the price the contract signed on
 * each bar, the fills are read out of the tick transactions that produced them.
 * Nothing here is a candle feed or a redrawn approximation — if a mark sits at a
 * price, that is the price the contract recorded when it placed the order.
 *
 * This is deliberately not the preview chart. The preview shows what a strategy
 * WOULD do on a market feed; this shows what the vault DID, and the two must never
 * be confusable once a depositor has money at stake.
 */

export interface TraceFill {
  seq: number;
  timestamp: number;
  /** 1e8-scaled, matching the trace. */
  price: number;
  isBuy: boolean;
  reduceOnly: boolean;
  size: number;
}

interface Props {
  /** 1e8-scaled prices, oldest first. */
  trace: number[];
  traceTimestamps: number[];
  fills?: TraceFill[];
  height?: number;
}

const PRICE_SCALE = 1e8;

function fmt(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 });
}

function Plot({
  trace,
  traceTimestamps,
  fills = [],
  width,
  height,
}: Props & { width: number; height: number }) {
  const margin = { top: 10, right: 62, bottom: 20, left: 8 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);

  const points = useMemo(
    () =>
      trace
        .map((p, i) => ({ t: traceTimestamps[i], v: p / PRICE_SCALE }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0),
    [trace, traceTimestamps],
  );

  const visibleFills = useMemo(() => {
    if (points.length === 0) return [];
    const first = points[0].t;
    const last = points[points.length - 1].t;
    // A fill outside the trace window would be drawn at the edge, implying the vault
    // traded at a time it did not. Drop it rather than clamp it.
    return fills.filter(
      (f) => f.timestamp >= first && f.timestamp <= last && f.price > 0,
    );
  }, [fills, points]);

  const xScale = useMemo(() => {
    const first = points[0]?.t ?? 0;
    const last = points.at(-1)?.t ?? first + 1;
    return scaleTime({
      domain: [(first === last ? first - 60 : first) * 1_000, last * 1_000],
      range: [0, innerWidth],
    });
  }, [innerWidth, points]);

  const yScale = useMemo(() => {
    const values = [
      ...points.map((p) => p.v),
      ...visibleFills.map((f) => f.price / PRICE_SCALE),
    ];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.12 || Math.max(1, max * 0.01);
    return scaleLinear({ domain: [min - pad, max + pad], range: [innerHeight, 0], nice: true });
  }, [innerHeight, points, visibleFills]);

  if (innerWidth < 40 || innerHeight < 40 || points.length < 2) return null;

  return (
    <svg height={height} role="img" aria-label="Vault price trace with its own fills" width={width}>
      <g transform={`translate(${margin.left},${margin.top})`}>
        <GridRows height={innerHeight} numTicks={4} scale={yScale} stroke="var(--chart-grid)" width={innerWidth} />
        <GridColumns height={innerHeight} numTicks={5} scale={xScale} stroke="var(--chart-grid)" width={innerWidth} />

        <LinePath
          curve={curveLinear}
          data={points}
          stroke="var(--chart-foreground-muted)"
          strokeWidth={1.25}
          x={(p) => xScale(new Date(p.t * 1_000))}
          y={(p) => yScale(p.v)}
        />

        {visibleFills.map((f) => {
          const x = xScale(new Date(f.timestamp * 1_000));
          const y = yScale(f.price / PRICE_SCALE);
          // Opens are filled, closes are hollow — you can read the position lifecycle
          // off the chart without a legend lookup for every mark.
          const color = f.reduceOnly ? "var(--chart-foreground-muted)" : f.isBuy ? "var(--success)" : "var(--danger)";
          const size = 4.5;
          const pts = f.isBuy
            ? `${x},${y - size} ${x - size},${y + size} ${x + size},${y + size}`
            : `${x},${y + size} ${x - size},${y - size} ${x + size},${y - size}`;
          return (
            <polygon
              fill={f.reduceOnly ? "none" : color}
              key={`${f.seq}-${f.timestamp}-${f.reduceOnly ? "c" : "o"}`}
              points={pts}
              stroke={color}
              strokeWidth={1.25}
            >
              <title>
                {`${f.reduceOnly ? "Close" : f.isBuy ? "Open long" : "Open short"} at ${fmt(f.price / PRICE_SCALE)} · bar ${f.seq}`}
              </title>
            </polygon>
          );
        })}

        {yScale.ticks(4).map((tick) => (
          <text
            dominantBaseline="middle"
            fill="var(--chart-label)"
            fontFamily="monospace"
            fontSize={9}
            key={tick}
            x={innerWidth + 8}
            y={yScale(tick)}
          >
            {fmt(tick)}
          </text>
        ))}
      </g>
    </svg>
  );
}

export const SealedTraceChart = memo(function SealedTraceChart(props: Props) {
  const { trace, traceTimestamps, fills = [], height = 220 } = props;
  if (trace.length < 2 || traceTimestamps.length !== trace.length) return null;

  const opens = fills.filter((f) => !f.reduceOnly).length;
  const closes = fills.filter((f) => f.reduceOnly).length;

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-card-border bg-chart-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border bg-background-secondary px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
          On-chain trace · last {trace.length} bars
        </span>
        <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-success" />
            {opens} open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full border border-zinc-500" />
            {closes} close
          </span>
        </div>
      </div>
      <div style={{ height }}>
        <ParentSize debounceTime={10}>
          {({ width, height: h }) => <Plot {...props} height={h} width={width} />}
        </ParentSize>
      </div>
      {fills.length === 0 && (
        <p className="border-t border-card-border px-3 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-500">
          The price series the contract signed on every bar. No fills are plotted —
          either this vault has not traded yet, or its creator runs their own attestor
          and we never saw the transactions.
        </p>
      )}
    </div>
  );
});
