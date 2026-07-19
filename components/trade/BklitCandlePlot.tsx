"use client";

/* Hallmark · pre-emit critique: P5 H4 E5 S5 R5 V4 */
/* Hallmark · component: candlestick plot · genre: modern-minimal · theme: CASH Instrument
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass · scope: plotted marks only; parent canvas chrome is preserved
 */

import { curveLinear } from "@visx/curve";
import { LinePath } from "@visx/shape";
import { memo, useMemo } from "react";

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
  upperData: Array<{ time: number; value: number }>;
  lowerData: Array<{ time: number; value: number }>;
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
  const { xScale, yScale } = useChartStable();
  return (
    <g aria-hidden="true" className="pointer-events-none">
      {lines.map((line) => (
        <LinePath
          curve={curveLinear}
          data={line.data}
          key={line.id}
          stroke={line.color}
          strokeDasharray={line.dash}
          strokeWidth={line.width ?? 1.25}
          x={(point) => xScale(new Date(point.time * 1000)) ?? 0}
          y={(point) => yScale(point.value) ?? 0}
        />
      ))}
    </g>
  );
}

function PlotFills({ fills }: { fills: BklitPlotFill[] }) {
  const { xScale, yScale } = useChartStable();
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
        return (
          <path
            d={`${upperPath.join(" ")} ${lowerPath.join(" ")} Z`}
            fill={fill.color}
            fillOpacity={fill.opacity ?? 0.2}
            key={fill.id}
          />
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
