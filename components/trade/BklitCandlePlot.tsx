"use client";

/* Hallmark · pre-emit critique: P5 H4 E5 S5 R5 V4 */
/* Hallmark · component: candlestick plot · genre: modern-minimal · theme: CASH Instrument
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass · scope: plotted marks only; parent canvas chrome is preserved
 */

import { curveLinear } from "@visx/curve";
import { LinePath } from "@visx/shape";
import { memo, useId, useMemo } from "react";

import { Background } from "@/components/charts/bklit/background";
import { CandlestickChart } from "@/components/charts/bklit/candlestick-chart";
import { Candlestick } from "@/components/charts/bklit/candlestick";
import { ChartTooltip } from "@/components/charts/bklit/chart-tooltip";
import { useChartStable } from "@/components/charts/bklit/chart-context";
import type { ChartCandle } from "@/lib/trade/candleSeries";

export type BklitPlotCandle = ChartCandle;

export type BklitPlotLine = {
  id: string;
  color: string;
  dash?: string;
  width?: number;
  /** Neon halo behind the stroke — for the one or two series that carry the signal. */
  glow?: boolean;
  /** End-anchored tag rendered at the last point, TradingView structure-label style. */
  label?: string;
  data: Array<{ time: number; value: number }>;
};

export type BklitPlotMarker = {
  id: string;
  time: number;
  price: number;
  side: "buy" | "sell";
  color?: string;
  label?: string;
};

export type BklitPlotFill = {
  id: string;
  color: string;
  opacity?: number;
  /** Fade the fill from color at the upper edge to transparent at the lower edge. */
  gradient?: boolean;
  upperData: Array<{ time: number; value: number }>;
  lowerData: Array<{ time: number; value: number }>;
};

export type BklitPlotZone = {
  id: string;
  startTime: number;
  endTime: number;
  low: number;
  high: number;
  color: string;
  label?: string;
  opacity?: number;
};

type BklitCandlePlotProps = {
  candles: BklitPlotCandle[];
  currentPrice?: number;
  intervalSeconds: number;
  fills?: BklitPlotFill[];
  levels?: Array<{ id: string; price: number; color: string }>;
  lines?: BklitPlotLine[];
  markers?: BklitPlotMarker[];
  priceDecimals: number;
  zones?: BklitPlotZone[];
};

type PlotPoint = BklitPlotCandle & { date: Date };

function formatPrice(value: number, decimals: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatTime(value: Date, intervalSeconds: number) {
  if (intervalSeconds >= 86_400) {
    return value.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return value.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: intervalSeconds < 60 ? "2-digit" : undefined,
    timeZone: "UTC",
  });
}

function CandlestickTooltipContent({
  intervalSeconds,
  point,
  priceDecimals,
}: {
  intervalSeconds: number;
  point: Record<string, unknown>;
  priceDecimals: number;
}) {
  const date = point.date instanceof Date ? point.date : new Date(Number(point.time) * 1000);
  const rows = [
    ["Open", Number(point.open)],
    ["High", Number(point.high)],
    ["Low", Number(point.low)],
    ["Close", Number(point.close)],
  ] as const;

  return (
    <div className="px-3 py-2.5 font-mono">
      <div className="mb-2 text-[10px] text-chart-tooltip-muted">
        {date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })}{" "}
        · {formatTime(date, intervalSeconds)} UTC
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
        {rows.map(([label, value]) => (
          <div className="contents" key={label}>
            <span className="text-chart-tooltip-muted">{label}</span>
            <span className="text-right tabular-nums text-chart-tooltip-foreground">
              {Number.isFinite(value) ? formatPrice(value, priceDecimals) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlotVolume() {
  const { bandWidth, innerHeight, renderData, xAccessor, xScale } = useChartStable();
  const maxVolume = useMemo(
    () => Math.max(0, ...renderData.map((point) => Number(point.volume) || 0)),
    [renderData],
  );
  if (maxVolume <= 0) return null;

  const maxHeight = innerHeight * 0.16;
  const width = Math.max(1, Math.min((bandWidth ?? 4) * 0.76, 9));
  return (
    <g aria-hidden="true">
      {renderData.map((point) => {
        const volume = Number(point.volume) || 0;
        const height = Math.max(1, volume / maxVolume * maxHeight);
        const positive = Number(point.close) >= Number(point.open);
        const x = xScale(xAccessor(point)) ?? 0;
        return (
          <rect
            fill={positive ? "var(--chart-line-primary)" : "var(--foreground)"}
            fillOpacity={positive ? 0.24 : 0.14}
            height={height}
            key={xAccessor(point).getTime()}
            width={width}
            x={x - width / 2}
            y={innerHeight - height}
          />
        );
      })}
    </g>
  );
}

function PlotLines({ lines }: { lines: BklitPlotLine[] }) {
  const { innerHeight, innerWidth, xScale, yScale } = useChartStable();
  return (
    <g aria-hidden="true" className="pointer-events-none font-mono">
      {lines.map((line) => {
        const last = line.data[line.data.length - 1];
        const labelX = last ? Math.min(innerWidth - 2, (xScale(new Date(last.time * 1000)) ?? 0) + 4) : 0;
        const labelY = last ? Math.max(8, Math.min(innerHeight - 2, yScale(last.value) ?? 0)) : 0;
        return (
          <g
            key={line.id}
            style={line.glow ? { filter: `drop-shadow(0 0 4px ${line.color})` } : undefined}
          >
            <LinePath
              curve={curveLinear}
              data={line.data}
              stroke={line.color}
              strokeDasharray={line.dash}
              strokeWidth={line.width ?? 1.25}
              x={(point) => xScale(new Date(point.time * 1000)) ?? 0}
              y={(point) => yScale(point.value) ?? 0}
            />
            {line.label && last && (
              <text fill={line.color} fontSize={8} fontWeight={700} x={labelX} y={labelY}>
                {line.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function PlotFills({ fills }: { fills: BklitPlotFill[] }) {
  const { xScale, yScale } = useChartStable();
  const gradientScope = useId();
  return (
    <g aria-hidden="true" className="pointer-events-none">
      {fills.map((fill) => {
        const lowerByTime = new Map(fill.lowerData.map((point) => [point.time, point.value]));
        const pairs = fill.upperData.flatMap((upper) => {
          const lower = lowerByTime.get(upper.time);
          return lower == null ? [] : [{ time: upper.time, upper: upper.value, lower }];
        });
        if (pairs.length < 2) return null;
        const upperPath = pairs.map((point, index) => {
          const x = xScale(new Date(point.time * 1000)) ?? 0;
          const y = yScale(point.upper) ?? 0;
          return `${index === 0 ? "M" : "L"}${x},${y}`;
        });
        const lowerPath = pairs.slice().reverse().map((point) => {
          const x = xScale(new Date(point.time * 1000)) ?? 0;
          const y = yScale(point.lower) ?? 0;
          return `L${x},${y}`;
        });
        const gradientId = `${gradientScope}-${fill.id}`;
        return (
          <g key={fill.id}>
            {fill.gradient && (
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={fill.color} stopOpacity={fill.opacity ?? 0.28} />
                  <stop offset="100%" stopColor={fill.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
            )}
            <path
              d={`${upperPath.join(" ")} ${lowerPath.join(" ")} Z`}
              fill={fill.gradient ? `url(#${gradientId})` : fill.color}
              fillOpacity={fill.gradient ? 1 : fill.opacity ?? 0.2}
            />
          </g>
        );
      })}
    </g>
  );
}

function PlotZones({ zones }: { zones: BklitPlotZone[] }) {
  const { innerHeight, innerWidth, xScale, yScale } = useChartStable();
  return (
    <g aria-hidden="true" className="pointer-events-none font-mono">
      {zones.map((zone) => {
        const rawX1 = xScale(new Date(zone.startTime * 1000));
        const rawX2 = xScale(new Date(zone.endTime * 1000));
        const rawY1 = yScale(zone.high);
        const rawY2 = yScale(zone.low);
        if ([rawX1, rawX2, rawY1, rawY2].some((value) => value == null)) return null;
        const x1 = Math.max(0, Math.min(innerWidth, rawX1!));
        const x2 = Math.max(0, Math.min(innerWidth, rawX2!));
        const y1 = Math.max(0, Math.min(innerHeight, rawY1!));
        const y2 = Math.max(0, Math.min(innerHeight, rawY2!));
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const width = Math.max(1, Math.abs(x2 - x1));
        const height = Math.max(1, Math.abs(y2 - y1));
        return (
          <g key={zone.id}>
            <rect
              fill={zone.color}
              fillOpacity={zone.opacity ?? 0.1}
              height={height}
              stroke={zone.color}
              strokeDasharray="3 3"
              strokeOpacity={0.45}
              width={width}
              x={x}
              y={y}
            />
            {zone.label && width > 42 && (
              <text fill={zone.color} fontSize={8} fontWeight={700} x={x + 5} y={y + 12}>
                {zone.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function PlotMarkers({ markers }: { markers: BklitPlotMarker[] }) {
  const { innerHeight, xScale, yScale } = useChartStable();
  return (
    <g aria-hidden="true" className="pointer-events-none font-mono">
      {markers.map((marker) => {
        const x = xScale(new Date(marker.time * 1000));
        const rawY = yScale(marker.price);
        if (x == null || rawY == null) return null;
        const buy = marker.side === "buy";
        const y = Math.max(12, Math.min(innerHeight - 12, rawY + (buy ? 8 : -8)));
        const color = marker.color ?? (buy ? "var(--accent)" : "#ef4444");
        const points = buy
          ? `${x},${y - 5} ${x - 4},${y + 2} ${x + 4},${y + 2}`
          : `${x},${y + 5} ${x - 4},${y - 2} ${x + 4},${y - 2}`;
        return (
          <g key={marker.id}>
            <polygon fill={color} points={points} />
            <text
              fill={color}
              fontSize={8}
              fontWeight={800}
              textAnchor="middle"
              x={x}
              y={y + (buy ? 12 : -7)}
            >
              {marker.label ?? (buy ? "B" : "S")}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function PlotLevels({ levels }: { levels: Array<{ id: string; price: number; color: string }> }) {
  const { innerHeight, innerWidth, yScale } = useChartStable();
  return (
    <g aria-hidden="true" className="pointer-events-none">
      {levels.map((level) => {
        const y = yScale(level.price);
        if (y == null || y < 0 || y > innerHeight) return null;
        return (
          <line
            key={level.id}
            stroke={level.color}
            strokeDasharray="4 4"
            strokeOpacity={0.72}
            x1={0}
            x2={innerWidth}
            y1={y}
            y2={y}
          />
        );
      })}
    </g>
  );
}

function PlotAxes({ intervalSeconds }: { intervalSeconds: number }) {
  const { innerHeight, innerWidth, xScale } = useChartStable();
  const xTicks = xScale.ticks(Math.max(2, Math.min(6, Math.floor(innerWidth / 120))));
  return (
    <g aria-hidden="true" className="pointer-events-none font-mono">
      {xTicks.map((tick) => (
        <text
          fill="var(--chart-label, #7f7f7f)"
          fontSize={10}
          key={tick.getTime()}
          textAnchor="middle"
          x={xScale(tick) ?? 0}
          y={innerHeight + 22}
        >
          {formatTime(tick, intervalSeconds)}
        </text>
      ))}
    </g>
  );
}

function CurrentPrice({ candle, price, priceDecimals }: { candle: PlotPoint; price: number; priceDecimals: number }) {
  const { innerHeight, innerWidth, yScale } = useChartStable();
  const y = yScale(price);
  if (y == null) return null;
  const positive = candle.close >= candle.open;
  const color = positive ? "var(--chart-line-primary)" : "var(--foreground)";
  const labelOffset = y < 26 ? 14 : -14;
  const badgeY = Math.max(10, Math.min(innerHeight - 10, y + labelOffset));
  return (
    <g aria-hidden="true" className="pointer-events-none font-mono">
      <line
        stroke={color}
        strokeDasharray="3 4"
        strokeOpacity={0.38}
        x1={0}
        x2={innerWidth}
        y1={y}
        y2={y}
      />
      <circle cx={innerWidth} cy={y} fill={color} r={2.5} />
      <text
        dominantBaseline="middle"
        fill={color}
        fontSize={10}
        fontWeight={700}
        textAnchor="end"
        x={innerWidth - 9}
        y={badgeY}
      >
        {formatPrice(price, priceDecimals)}
      </text>
    </g>
  );
}

function BklitCandlePlotComponent({
  candles,
  currentPrice,
  fills = [],
  intervalSeconds,
  levels = [],
  lines = [],
  markers = [],
  priceDecimals,
  zones = [],
}: BklitCandlePlotProps) {
  const points = useMemo<PlotPoint[]>(() => candles.map((candle) => ({
    ...candle,
    date: new Date(candle.time * 1000),
  })), [candles]);
  const first = points[0];
  const latest = points.at(-1);
  const xDomain = latest && first
    ? [first.date, new Date((latest.time + intervalSeconds * 3) * 1000)] as [Date, Date]
    : undefined;
  const xDomainSlotCount = latest && first
    ? Math.max(points.length + 3, Math.round((latest.time - first.time) / intervalSeconds) + 4)
    : points.length + 3;
  const lineValues = [
    ...lines.flatMap((line) => line.data.map((point) => point.value)),
    ...fills.flatMap((fill) => [
      ...fill.upperData.map((point) => point.value),
      ...fill.lowerData.map((point) => point.value),
    ]),
  ];
  const yDomain = lineValues.length > 0
    ? [
        Math.min(...points.map((point) => point.low), ...lineValues),
        Math.max(...points.map((point) => point.high), ...lineValues),
      ] as [number, number]
    : undefined;

  if (!latest) return null;

  return (
    <div
      aria-label="Candlestick chart. Green candles closed up; white candles closed down."
      className="absolute inset-0"
      role="img"
    >
      <CandlestickChart
        animationDuration={0}
        aspectRatio="auto"
        candleGap={0.3}
        className="h-full w-full"
        data={points}
        margin={{ top: 40, right: 8, bottom: 36, left: 8 }}
        maxDataGapMs={intervalSeconds * 4 * 1000}
        maxTooltipDistanceMs={intervalSeconds * 1.5 * 1000}
        selectionEnabled={false}
        style={{ height: "100%" }}
        touchAction="pan-y"
        xDomain={xDomain}
        xDomainSlotCount={xDomainSlotCount}
        yDomain={yDomain}
        yPaddingRatio={0.08}
      >
        <Background pattern="dots" opacity={0.85} extendTop={40} />
        <PlotVolume />
        <PlotZones zones={zones} />
        <PlotFills fills={fills} />
        <Candlestick
          bodyStrokeWidth={1.25}
          fadedOpacity={0.25}
          negativeBodyFill="var(--chart-background)"
          negativeFill="var(--foreground)"
          negativeStroke="var(--foreground)"
          negativeWickFill="var(--foreground)"
          positiveBodyFill="var(--chart-line-primary)"
          positiveFill="var(--chart-line-primary)"
          positiveStroke="var(--chart-line-primary)"
          positiveWickFill="var(--chart-line-primary)"
        />
        <ChartTooltip
          content={({ point }) => (
            <CandlestickTooltipContent
              intervalSeconds={intervalSeconds}
              point={point}
              priceDecimals={priceDecimals}
            />
          )}
          showCrosshair={false}
          showDots={false}
        />
        <PlotLines lines={lines} />
        <PlotMarkers markers={markers} />
        <PlotLevels levels={levels} />
        <PlotAxes intervalSeconds={intervalSeconds} />
        <CurrentPrice
          candle={latest}
          price={Number.isFinite(currentPrice) && (currentPrice ?? 0) > 0 ? currentPrice! : latest.close}
          priceDecimals={priceDecimals}
        />
      </CandlestickChart>
    </div>
  );
}

export const BklitCandlePlot = memo(BklitCandlePlotComponent);
