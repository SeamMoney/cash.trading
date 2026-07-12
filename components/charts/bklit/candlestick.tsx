"use client";

import { memo, useMemo } from "react";
import { useChart } from "./chart-context";
import { useChartLegendHover } from "./chart-legend-hover";

const DEFAULT_POSITIVE = "var(--chart-candle-up)";
const DEFAULT_NEGATIVE = "var(--chart-candle-down-stroke)";

const SOLID_POSITIVE = "var(--chart-candle-up)";
const SOLID_NEGATIVE = "var(--chart-candle-down-stroke)";
const MAX_WICK_WIDTH = 1.75;

export interface CandlestickProps {
  /** Direction color for positive (close >= open) candles. */
  positiveFill?: string;
  /** Direction color for negative candles. */
  negativeFill?: string;
  /** Body fill overrides. Useful for hollow, outlined candles. */
  positiveBodyFill?: string;
  negativeBodyFill?: string;
  /** Body outline colors. Defaults to the direction color. */
  positiveStroke?: string;
  negativeStroke?: string;
  /** Wick colors. Defaults to the direction color. */
  positiveWickFill?: string;
  negativeWickFill?: string;
  /** Body outline width. Default: 1px. */
  bodyStrokeWidth?: number;
  /** Optional pattern URL for body only (e.g. url(#pattern)). When set, body is drawn solid first, then pattern overlaid and masked to the body rect. */
  bodyPatternPositive?: string;
  /** Optional pattern URL for negative candle body. */
  bodyPatternNegative?: string;
  /** Inner border width on the body (drawn inside so it does not expand the shape). Default: 0 (off). */
  insideStrokeWidth?: number;
  /** Opacity when another candle is hovered. Default: 0.3 */
  fadedOpacity?: number;
  /** Dim non-hovered candles on hover. Default: true */
  showHoverFade?: boolean;
}

interface CandleGeometry {
  time: number;
  centerX: number;
  bodyTop: number;
  bodyHeight: number;
  bodyLeft: number;
  candleWidth: number;
  wickTop: number;
  wickHeight: number;
  wickLeft: number;
  wickWidth: number;
  bodyRadius: number;
  bodySolidFill: string;
  bodyStroke: string;
  bodyStrokeWidth: number;
  wickFill: string;
  bodyPattern?: string;
  insideStrokeWidth: number;
  isPositive: boolean;
}

interface ResolvedCandleStyle {
  positiveFill: string;
  negativeFill: string;
  positiveBodyFill?: string;
  negativeBodyFill?: string;
  positiveStroke?: string;
  negativeStroke?: string;
  positiveWickFill?: string;
  negativeWickFill?: string;
  bodyStrokeWidth: number;
}

function getSolidColor(isPositive: boolean): string {
  return isPositive ? SOLID_POSITIVE : SOLID_NEGATIVE;
}

function computeGeometries(
  renderData: Record<string, unknown>[],
  xScale: (value: Date) => number | undefined,
  yScale: (value: number) => number | undefined,
  xAccessor: (d: Record<string, unknown>) => Date,
  candleWidth: number,
  candleStyle: ResolvedCandleStyle,
  bodyPatternPositive: string | undefined,
  bodyPatternNegative: string | undefined,
  insideStrokeWidth: number
): CandleGeometry[] {
  return renderData.map((d) => {
    const date = xAccessor(d);
    const open = d.open as number;
    const high = d.high as number;
    const low = d.low as number;
    const close = d.close as number;
    const centerX = xScale(date) ?? 0;
    const yHigh = yScale(high) ?? 0;
    const yLow = yScale(low) ?? 0;
    const yOpen = yScale(open) ?? 0;
    const yClose = yScale(close) ?? 0;
    const rawBodyHeight = Math.abs(yClose - yOpen);
    const bodyHeight = Math.max(1, rawBodyHeight);
    const bodyTop = Math.min(yOpen, yClose) - (rawBodyHeight < 1 ? (1 - rawBodyHeight) / 2 : 0);
    const bodyLeft = centerX - candleWidth / 2;
    const wickTop = Math.min(yHigh, yLow);
    const wickHeight = Math.abs(yLow - yHigh) || 1;
    const isPositive = close >= open;
    const fill = isPositive ? candleStyle.positiveFill : candleStyle.negativeFill;
    const explicitBodyFill = isPositive
      ? candleStyle.positiveBodyFill
      : candleStyle.negativeBodyFill;
    const bodyStroke = isPositive
      ? candleStyle.positiveStroke ?? fill
      : candleStyle.negativeStroke ?? fill;
    const wickFill = isPositive
      ? candleStyle.positiveWickFill ?? fill
      : candleStyle.negativeWickFill ?? fill;
    const bodyPattern = isPositive ? bodyPatternPositive : bodyPatternNegative;
    const hasPatternOverlay = Boolean(bodyPattern);
    const bodySolidFill = explicitBodyFill
      ?? (hasPatternOverlay ? getSolidColor(isPositive) : fill);
    const wickWidth = Math.min(MAX_WICK_WIDTH, Math.max(0.75, candleWidth * 0.45));

    return {
      time: date.getTime(),
      centerX,
      bodyTop,
      bodyHeight,
      bodyLeft,
      candleWidth,
      wickTop,
      wickHeight,
      wickLeft: centerX - wickWidth / 2,
      wickWidth,
      bodyRadius: Math.min(0.75, candleWidth * 0.12, bodyHeight / 2),
      bodySolidFill,
      bodyStroke,
      bodyStrokeWidth: Math.min(
        candleStyle.bodyStrokeWidth,
        Math.max(0.5, candleWidth * 0.22),
      ),
      wickFill,
      bodyPattern: hasPatternOverlay ? bodyPattern : undefined,
      insideStrokeWidth,
      isPositive,
    };
  });
}

function geometryDimOpacity(
  geometry: CandleGeometry,
  fadedOpacity: number,
  legendHoveredIndex: number | null,
  hoveredTime: number | null
): number {
  if (legendHoveredIndex !== null) {
    const dimFromLegend =
      (legendHoveredIndex === 0 && !geometry.isPositive) ||
      (legendHoveredIndex === 1 && geometry.isPositive);
    return dimFromLegend ? fadedOpacity : 1;
  }
  if (hoveredTime !== null && geometry.time !== hoveredTime) {
    return fadedOpacity;
  }
  return 1;
}

const CandlestickBody = memo(function CandlestickBody({
  geometry,
}: {
  geometry: CandleGeometry;
}) {
  const {
    wickLeft,
    wickTop,
    wickHeight,
    wickFill,
    wickWidth,
    bodyLeft,
    bodyTop,
    bodyHeight,
    candleWidth,
    bodySolidFill,
    bodyStroke,
    bodyStrokeWidth,
    bodyPattern,
    bodyRadius,
    insideStrokeWidth,
  } = geometry;
  const insideInset = Math.min(
    insideStrokeWidth,
    Math.max(0, bodyHeight - 0.5),
    Math.max(0, candleWidth - 0.5),
  );

  return (
    <>
      <rect
        fill={wickFill}
        height={wickHeight}
        width={wickWidth}
        x={wickLeft}
        y={wickTop}
      />
      <rect
        fill={bodySolidFill}
        height={bodyHeight}
        rx={bodyRadius}
        ry={bodyRadius}
        stroke={bodyStroke}
        strokeWidth={bodyStrokeWidth}
        width={candleWidth}
        x={bodyLeft}
        y={bodyTop}
      />
      {bodyPattern ? (
        <rect
          fill={bodyPattern}
          height={bodyHeight}
          rx={bodyRadius}
          ry={bodyRadius}
          width={candleWidth}
          x={bodyLeft}
          y={bodyTop}
        />
      ) : null}
      {insideInset > 0 ? (
        <rect
          fill="none"
          height={bodyHeight - insideInset}
          rx={bodyRadius}
          ry={bodyRadius}
          stroke={bodyStroke}
          strokeWidth={insideInset}
          width={candleWidth - insideInset}
          x={bodyLeft + insideInset / 2}
          y={bodyTop + insideInset / 2}
        />
      ) : null}
    </>
  );
});

const CandlestickBodies = memo(function CandlestickBodies({
  geometries,
  fadedOpacity,
  legendHoveredIndex,
  hoveredTime,
}: {
  geometries: CandleGeometry[];
  fadedOpacity: number;
  legendHoveredIndex: number | null;
  hoveredTime: number | null;
}) {
  return (
    <>
      {geometries.map((geometry) => (
        <g
          key={geometry.time}
          opacity={geometryDimOpacity(
            geometry,
            fadedOpacity,
            legendHoveredIndex,
            hoveredTime
          )}
        >
          <CandlestickBody geometry={geometry} />
        </g>
      ))}
    </>
  );
});

export function Candlestick({
  positiveFill,
  negativeFill,
  positiveBodyFill,
  negativeBodyFill,
  positiveStroke,
  negativeStroke,
  positiveWickFill,
  negativeWickFill,
  bodyStrokeWidth = 1,
  bodyPatternPositive,
  bodyPatternNegative,
  insideStrokeWidth = 0,
  fadedOpacity = 0.3,
  showHoverFade = true,
}: CandlestickProps) {
  const {
    data,
    renderData,
    xScale,
    yScale,
    xAccessor,
    bandWidth,
    columnWidth,
    innerWidth,
    hoveredCandleIndex,
    candlestickPositiveFill,
    candlestickNegativeFill,
  } = useChart();
  const { hoveredIndex: legendHoveredIndex } = useChartLegendHover();
  const resolvedPositiveFill = positiveFill ?? candlestickPositiveFill ?? DEFAULT_POSITIVE;
  const resolvedNegativeFill = negativeFill ?? candlestickNegativeFill ?? DEFAULT_NEGATIVE;
  const resolvedCandleStyle = useMemo<ResolvedCandleStyle>(() => ({
    positiveFill: resolvedPositiveFill,
    negativeFill: resolvedNegativeFill,
    positiveBodyFill,
    negativeBodyFill,
    positiveStroke,
    negativeStroke,
    positiveWickFill,
    negativeWickFill,
    bodyStrokeWidth: Math.max(0, bodyStrokeWidth),
  }), [
    bodyStrokeWidth,
    negativeBodyFill,
    negativeStroke,
    negativeWickFill,
    positiveBodyFill,
    positiveStroke,
    positiveWickFill,
    resolvedNegativeFill,
    resolvedPositiveFill,
  ]);

  const renderColumnWidth = innerWidth / Math.max(renderData.length, 1);
  const preferredWidth = renderData === data
    ? bandWidth ?? columnWidth * 0.8
    : renderColumnWidth * 0.72;
  const candleWidth = Math.max(
    0.75,
    Math.min(preferredWidth, renderColumnWidth * 0.88, 18),
  );

  const geometries = useMemo(
    () =>
      computeGeometries(
        renderData,
        xScale,
        yScale,
        xAccessor,
        candleWidth,
        resolvedCandleStyle,
        bodyPatternPositive,
        bodyPatternNegative,
        insideStrokeWidth
      ),
    [
      renderData,
      xScale,
      yScale,
      xAccessor,
      candleWidth,
      resolvedCandleStyle,
      bodyPatternPositive,
      bodyPatternNegative,
      insideStrokeWidth,
    ]
  );

  const hoveredTime = useMemo(() => {
    if (hoveredCandleIndex == null) {
      return null;
    }
    const point = data[hoveredCandleIndex];
    return point ? xAccessor(point).getTime() : null;
  }, [hoveredCandleIndex, data, xAccessor]);

  const highlightGeometry = useMemo(() => {
    if (hoveredCandleIndex == null) {
      return null;
    }
    const point = data[hoveredCandleIndex];
    if (!point) {
      return null;
    }
    return (
      computeGeometries(
        [point],
        xScale,
        yScale,
        xAccessor,
        candleWidth,
        resolvedCandleStyle,
        bodyPatternPositive,
        bodyPatternNegative,
        insideStrokeWidth
      )[0] ?? null
    );
  }, [
    hoveredCandleIndex,
    data,
    xScale,
    yScale,
    xAccessor,
    candleWidth,
    resolvedCandleStyle,
    bodyPatternPositive,
    bodyPatternNegative,
    insideStrokeWidth,
  ]);

  return (
    <g className="chart-candlesticks">
      <CandlestickBodies
        fadedOpacity={fadedOpacity}
        geometries={geometries}
        hoveredTime={showHoverFade ? hoveredTime : null}
        legendHoveredIndex={legendHoveredIndex}
      />
      {highlightGeometry ? (
        <g>
          <CandlestickBody geometry={highlightGeometry} />
        </g>
      ) : null}
    </g>
  );
}

Candlestick.displayName = "Candlestick";

export default Candlestick;

