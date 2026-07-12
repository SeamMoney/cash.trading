"use client";

import { curveLinear } from "@visx/curve";
import { GridColumns, GridRows } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { memo, useMemo } from "react";

export type LaunchpadIndicatorPoint = { time: number; value: number };

export type LaunchpadIndicatorLine = {
  id: string;
  color: string;
  data: LaunchpadIndicatorPoint[];
};

type LaunchpadIndicatorPaneProps = {
  domain?: [number, number];
  guides?: Array<{ id: string; value: number; color: string }>;
  histogram?: LaunchpadIndicatorPoint[];
  label: string;
  lines: LaunchpadIndicatorLine[];
};

function formatValue(value: number) {
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 0 : absolute >= 1 ? 2 : 4;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function Pane({
  domain,
  guides = [],
  histogram = [],
  label,
  lines,
  width,
  height,
}: LaunchpadIndicatorPaneProps & { width: number; height: number }) {
  const margin = { top: 8, right: 52, bottom: 8, left: 8 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);
  const allPoints = useMemo(
    () => [...lines.flatMap((line) => line.data), ...histogram]
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value)),
    [histogram, lines],
  );

  const timeDomain = useMemo<[number, number]>(() => {
    if (allPoints.length === 0) {
      const now = Date.now();
      return [now - 1_000, now];
    }
    const min = Math.min(...allPoints.map((point) => point.time * 1_000));
    const max = Math.max(...allPoints.map((point) => point.time * 1_000));
    return min === max ? [min - 500, max + 500] : [min, max];
  }, [allPoints]);

  const valueDomain = useMemo<[number, number]>(() => {
    if (domain) return domain;
    const values = [
      ...allPoints.map((point) => point.value),
      ...guides.map((guide) => guide.value),
    ];
    if (values.length === 0) return [-1, 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.12 || Math.max(1, Math.abs(max) * 0.1);
    return [min - padding, max + padding];
  }, [allPoints, domain, guides]);

  const xScale = useMemo(() => scaleTime({
    domain: timeDomain,
    range: [0, innerWidth],
  }), [innerWidth, timeDomain]);
  const yScale = useMemo(() => scaleLinear({
    domain: valueDomain,
    range: [innerHeight, 0],
    nice: !domain,
  }), [domain, innerHeight, valueDomain]);

  if (innerWidth < 20 || innerHeight < 20 || allPoints.length === 0) return null;

  const yTicks = yScale.ticks(3);
  const histogramWidth = Math.max(1, Math.min(8, innerWidth / Math.max(histogram.length, 1) * 0.68));
  const zeroY = yScale(0);

  return (
    <svg aria-hidden="true" height={height} width={width}>
      <g transform={`translate(${margin.left},${margin.top})`}>
        <GridRows
          height={innerHeight}
          numTicks={3}
          scale={yScale}
          stroke="var(--chart-grid)"
          width={innerWidth}
        />
        <GridColumns
          height={innerHeight}
          numTicks={5}
          scale={xScale}
          stroke="var(--chart-grid)"
          width={innerWidth}
        />
        {guides.map((guide) => {
          const y = yScale(guide.value);
          return (
            <line
              key={guide.id}
              stroke={guide.color}
              strokeDasharray="4 4"
              strokeWidth={1}
              x1={0}
              x2={innerWidth}
              y1={y}
              y2={y}
            />
          );
        })}
        {histogram.map((point) => {
          const x = xScale(new Date(point.time * 1_000));
          const y = yScale(point.value);
          const top = Math.min(y, zeroY);
          const barHeight = Math.max(1, Math.abs(zeroY - y));
          return (
            <rect
              fill={point.value >= 0 ? "#22c55e" : "#ef4444"}
              fillOpacity={0.25}
              height={barHeight}
              key={`${point.time}:${point.value}`}
              width={histogramWidth}
              x={x - histogramWidth / 2}
              y={top}
            />
          );
        })}
        {lines.map((line) => (
          <LinePath
            curve={curveLinear}
            data={line.data}
            key={line.id}
            stroke={line.color}
            strokeWidth={1.75}
            x={(point) => xScale(new Date(point.time * 1_000))}
            y={(point) => yScale(point.value)}
          />
        ))}
        <text fill="var(--chart-label, #7f7f7f)" fontSize={9} x={4} y={11}>{label}</text>
        {yTicks.map((tick) => (
          <text
            dominantBaseline="middle"
            fill="var(--chart-label, #7f7f7f)"
            fontFamily="monospace"
            fontSize={9}
            key={tick}
            x={innerWidth + 8}
            y={yScale(tick)}
          >
            {formatValue(tick)}
          </text>
        ))}
      </g>
    </svg>
  );
}

export const LaunchpadIndicatorPane = memo(function LaunchpadIndicatorPane(
  props: LaunchpadIndicatorPaneProps,
) {
  const hasData = props.lines.some((line) => line.data.length > 0)
    || (props.histogram?.length ?? 0) > 0;
  if (!hasData) return null;

  return (
    <div
      aria-label={`${props.label} indicator chart`}
      className="h-[120px] w-full border-t border-[#1e1e1e]"
      role="img"
    >
      <ParentSize debounceTime={10}>
        {({ width, height }) => <Pane {...props} height={height} width={width} />}
      </ParentSize>
    </div>
  );
});
