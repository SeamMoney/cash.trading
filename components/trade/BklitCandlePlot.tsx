"use client";

/* Hallmark · pre-emit critique: P5 H4 E5 S5 R5 V4 */
/* Hallmark · component: candlestick plot · genre: modern-minimal · theme: CASH Instrument
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass · scope: plotted marks only; parent canvas chrome is preserved
 */

import { curveLinear } from "@visx/curve";
import { GridColumns, GridRows } from "@visx/grid";
import { LinePath } from "@visx/shape";
import { memo, useEffect, useMemo } from "react";

import { CandlestickChart } from "@/components/charts/bklit/candlestick-chart";
import { Candlestick } from "@/components/charts/bklit/candlestick";
import {
  useChartHover,
  useChartStable,
} from "@/components/charts/bklit/chart-context";
import type { ChartCandle } from "@/lib/trade/candleSeries";

export type BklitPlotCandle = ChartCandle;

export type BklitPlotLine = {
  id: string;
  color: string;
  data: Array<{ time: number; value: number }>;
};

type BklitCandlePlotProps = {
  candles: BklitPlotCandle[];
  currentPrice?: number;
  intervalSeconds: number;
  levels?: Array<{ id: string; price: number; color: string }>;
  lines?: BklitPlotLine[];
  onInspect?: (candle: BklitPlotCandle | null) => void;
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

function PlotGrid() {
  const { innerHeight, innerWidth, xScale, yScale } = useChartStable();
  return (
    <g aria-hidden="true">
      <GridRows
        height={innerHeight}
        numTicks={Math.max(3, Math.min(5, Math.floor(innerHeight / 78)))}
        scale={yScale}
        stroke="var(--chart-grid)"
        width={innerWidth}
      />
      <GridColumns
        height={innerHeight}
        numTicks={Math.max(2, Math.min(6, Math.floor(innerWidth / 120)))}
        scale={xScale}
        stroke="var(--chart-grid)"
        width={innerWidth}
      />
    </g>
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
          strokeWidth={1.25}
          x={(point) => xScale(new Date(point.time * 1000)) ?? 0}
          y={(point) => yScale(point.value) ?? 0}
        />
      ))}
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

function PlotAxes({ intervalSeconds, priceDecimals }: { intervalSeconds: number; priceDecimals: number }) {
  const { innerHeight, innerWidth, xScale, yScale } = useChartStable();
  const xTicks = xScale.ticks(Math.max(2, Math.min(6, Math.floor(innerWidth / 120))));
  const yTicks = yScale.ticks(Math.max(3, Math.min(5, Math.floor(innerHeight / 78))));
  return (
    <g aria-hidden="true" className="pointer-events-none font-mono">
      {xTicks.map((tick) => (
        <text
          fill="var(--chart-label)"
          fontSize={10}
          key={tick.getTime()}
          textAnchor="middle"
          x={xScale(tick) ?? 0}
          y={innerHeight + 22}
        >
          {formatTime(tick, intervalSeconds)}
        </text>
      ))}
      {yTicks.map((tick) => (
        <text
          dominantBaseline="middle"
          fill="var(--chart-label)"
          fontSize={10}
          key={tick}
          x={innerWidth + 10}
          y={yScale(tick) ?? 0}
        >
          {formatPrice(tick, priceDecimals)}
        </text>
      ))}
    </g>
  );
}

function PlotInspection({
  onInspect,
  priceDecimals,
}: {
  onInspect?: (candle: BklitPlotCandle | null) => void;
  priceDecimals: number;
}) {
  const { tooltipData } = useChartHover();
  const { innerHeight, innerWidth, yScale } = useChartStable();
  const point = tooltipData?.point as PlotPoint | undefined;

  useEffect(() => {
    onInspect?.(point ?? null);
  }, [onInspect, point]);

  if (!tooltipData || !point) return null;
  const y = yScale(point.close) ?? 0;
  return (
    <g aria-hidden="true" className="pointer-events-none font-mono">
      <line
        stroke="var(--chart-crosshair)"
        strokeDasharray="3 4"
        x1={tooltipData.x}
        x2={tooltipData.x}
        y1={0}
        y2={innerHeight}
      />
      <line
        stroke="var(--chart-crosshair)"
        strokeDasharray="3 4"
        x1={0}
        x2={innerWidth}
        y1={y}
        y2={y}
      />
      <circle
        cx={tooltipData.x}
        cy={y}
        fill="var(--chart-background)"
        r={3.5}
        stroke={point.close >= point.open ? "var(--chart-line-primary)" : "var(--foreground)"}
        strokeWidth={1.5}
      />
      <text
        dominantBaseline="middle"
        fill="var(--chart-tooltip-foreground)"
        fontSize={10}
        fontWeight={700}
        x={innerWidth + 10}
        y={Math.max(10, Math.min(innerHeight - 10, y))}
      >
        {formatPrice(point.close, priceDecimals)}
      </text>
    </g>
  );
}

function CurrentPrice({ candle, price, priceDecimals }: { candle: PlotPoint; price: number; priceDecimals: number }) {
  const { innerHeight, innerWidth, yScale } = useChartStable();
  const y = yScale(price);
  if (y == null) return null;
  const positive = candle.close >= candle.open;
  const color = positive ? "var(--chart-line-primary)" : "var(--foreground)";
  const badgeY = Math.max(10, Math.min(innerHeight - 10, y));
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
        x={innerWidth + 10}
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
  intervalSeconds,
  levels = [],
  lines = [],
  onInspect,
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
        candleGap={0.24}
        className="h-full w-full"
        data={points}
        margin={{ top: 40, right: 80, bottom: 36, left: 8 }}
        maxDataGapMs={intervalSeconds * 4 * 1000}
        maxTooltipDistanceMs={intervalSeconds * 1.5 * 1000}
        selectionEnabled={false}
        style={{ height: "100%" }}
        touchAction="none"
        xDomain={xDomain}
        xDomainSlotCount={xDomainSlotCount}
        yPaddingRatio={0.08}
      >
        <PlotGrid />
        <PlotVolume />
        <Candlestick
          bodyStrokeWidth={1.25}
          fadedOpacity={0.2}
          negativeBodyFill="var(--chart-background)"
          negativeFill="var(--foreground)"
          negativeStroke="var(--foreground)"
          negativeWickFill="var(--foreground)"
          positiveBodyFill="var(--chart-line-primary)"
          positiveFill="var(--chart-line-primary)"
          positiveStroke="var(--chart-line-primary)"
          positiveWickFill="var(--chart-line-primary)"
          showHoverFade={false}
        />
        <PlotLines lines={lines} />
        <PlotLevels levels={levels} />
        <PlotAxes intervalSeconds={intervalSeconds} priceDecimals={priceDecimals} />
        <CurrentPrice
          candle={latest}
          price={Number.isFinite(currentPrice) && (currentPrice ?? 0) > 0 ? currentPrice! : latest.close}
          priceDecimals={priceDecimals}
        />
        <PlotInspection onInspect={onInspect} priceDecimals={priceDecimals} />
      </CandlestickChart>
    </div>
  );
}

export const BklitCandlePlot = memo(BklitCandlePlotComponent);
