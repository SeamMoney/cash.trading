"use client";

import { useEffect, useRef } from "react";

// ─── Line style mapping (lightweight-charts LineStyle enum values) ────────────
const LINE_STYLE_MAP: Record<string, number> = {
  solid: 0,  // LineStyle.Solid
  dashed: 2, // LineStyle.Dashed
  dotted: 1, // LineStyle.Dotted
};

// ─── PineScript transparency (0–100) to hex alpha (FF–00) ───────────────────
/** Convert PineScript transparency (0 = opaque, 100 = invisible) to 2-char hex alpha. */
function transparencyToHexAlpha(transparency: number): string {
  const clamped = Math.max(0, Math.min(100, transparency));
  const alpha = Math.round(((100 - clamped) / 100) * 255);
  return alpha.toString(16).padStart(2, "0");
}

/** Convert an opacity float (0–1) to 2-char hex alpha. */
function opacityToHexAlpha(opacity: number): string {
  const clamped = Math.max(0, Math.min(1, opacity));
  return Math.round(clamped * 255).toString(16).padStart(2, "0");
}

/** Strip any existing alpha suffix from a 6-char or 8-char hex color and return the base 6 chars. */
function hexBase(color: string): string {
  const raw = color.startsWith("#") ? color.slice(1) : color;
  return raw.slice(0, 6);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlotVisual {
  id: string;
  title?: string;
  data: Array<{ time: number; value: number }>;
  color: string;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  /** When false, the plot data exists for fill computation but should not draw a line. */
  visible: boolean;
}

interface FillVisual {
  upperData: Array<{ time: number; value: number }>;
  lowerData: Array<{ time: number; value: number }>;
  color: string;
  opacity: number;
}

interface MarkerVisual {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
  size: number;
}

interface HLineVisual {
  price: number;
  color: string;
  lineWidth: number;
  lineStyle: string;
  title?: string;
}

export interface VisualData {
  plots: PlotVisual[];
  fills: FillVisual[];
  markers: MarkerVisual[];
  hlines: HLineVisual[];
}

interface ChartVisualLayerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chartRef: React.RefObject<any>; // IChartApi from lightweight-charts
  visuals: VisualData;
  /** Optional: a candlestick series to attach markers to instead of the first plot. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candleSeriesRef?: React.RefObject<any>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChartVisualLayer({ chartRef, visuals, candleSeriesRef }: ChartVisualLayerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createdSeriesRef = useRef<any[]>([]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove any previously created series before adding new ones
    for (const series of createdSeriesRef.current) {
      try {
        chart.removeSeries(series);
      } catch {
        // Series may already have been removed if chart was disposed
      }
    }
    createdSeriesRef.current = [];

    // Build a map from plot ID to its data, so fills can reference hidden plots
    const plotDataById = new Map<string, Array<{ time: number; value: number }>>();
    for (const plot of visuals.plots) {
      plotDataById.set(plot.id, plot.data);
    }

    // ── 1. Plots — LineSeries for each VISIBLE indicator plot ───────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plotSeriesById = new Map<string, any>();

    for (const plot of visuals.plots) {
      // Skip hidden / invisible plots — their data is still available for fills
      if (!plot.visible) continue;

      // Filter out NaN / undefined values
      const cleanData = plot.data.filter(
        (d) => Number.isFinite(d.value),
      );
      if (cleanData.length === 0) continue;

      const series = chart.addLineSeries({
        color: plot.color,
        lineWidth: plot.lineWidth,
        lineStyle: LINE_STYLE_MAP[plot.lineStyle] ?? 0,
        title: plot.title ?? plot.id,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      series.setData(
        cleanData.map((d) => ({
          time: d.time as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          value: d.value,
        })),
      );

      plotSeriesById.set(plot.id, series);
      createdSeriesRef.current.push(series);
    }

    // ── 2. Fills — AreaSeries for shaded regions between two plots ───────────
    //
    // For a fill between an upper and lower plot, we create TWO AreaSeries:
    //  - One at the upper boundary with the fill color (topColor) fading to transparent (bottomColor)
    //  - One at the lower boundary that "cuts out" by painting the background color above it
    //
    // For overlapping cloud ribbons (like BOS adaptive structure), each fill is
    // a separate AreaSeries with its own opacity derived from the fill color.

    for (const fill of visuals.fills) {
      // Filter NaN values and align timestamps between upper and lower
      const upperClean = fill.upperData.filter((d) => Number.isFinite(d.value));
      const lowerClean = fill.lowerData.filter((d) => Number.isFinite(d.value));
      if (upperClean.length === 0 || lowerClean.length === 0) continue;

      // Resolve the fill color with opacity
      const base = hexBase(fill.color);
      const alphaHex = opacityToHexAlpha(fill.opacity);
      const fillColor = `#${base}${alphaHex}`;

      // Upper boundary area series — filled from top data downward
      const upperSeries = chart.addAreaSeries({
        topColor: fillColor,
        bottomColor: "transparent",
        lineColor: "transparent",  // No boundary line — the plot lines handle that
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upperSeries.setData(
        upperClean.map((d) => ({
          time: d.time as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          value: d.value,
        })),
      );
      createdSeriesRef.current.push(upperSeries);

      // Lower boundary area series — paints over the fill below the lower line
      // using the chart background color to "cut" the fill
      const lowerSeries = chart.addAreaSeries({
        topColor: "transparent",
        bottomColor: "transparent",
        lineColor: "transparent",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lowerSeries.setData(
        lowerClean.map((d) => ({
          time: d.time as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          value: d.value,
        })),
      );
      createdSeriesRef.current.push(lowerSeries);
    }

    // ── 3. HLines — price lines on the chart ─────────────────────────────────

    // Price lines need to be added to an existing series.
    // Use the first created series, or create a hidden one if needed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let priceLinesHost: any = null;

    if (visuals.hlines.length > 0) {
      if (createdSeriesRef.current.length > 0) {
        priceLinesHost = createdSeriesRef.current[0];
      } else {
        // Create an invisible series to host price lines
        priceLinesHost = chart.addLineSeries({
          color: "transparent",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        priceLinesHost.setData([]);
        createdSeriesRef.current.push(priceLinesHost);
      }

      for (const hline of visuals.hlines) {
        priceLinesHost.createPriceLine({
          price: hline.price,
          color: hline.color,
          lineWidth: hline.lineWidth,
          lineStyle: LINE_STYLE_MAP[hline.lineStyle] ?? 0,
          axisLabelVisible: true,
          title: hline.title ?? "",
        });
      }
    }

    // ── 4. Markers — set on the candle series or the first visible plot ──────

    if (visuals.markers.length > 0) {
      // Prefer the candlestick series for markers (better visual alignment)
      const markerHost =
        candleSeriesRef?.current ??
        (createdSeriesRef.current.length > 0 ? createdSeriesRef.current[0] : null);

      if (markerHost) {
        // Sort markers by time (lightweight-charts requires sorted markers)
        const sorted = [...visuals.markers].sort((a, b) => a.time - b.time);

        markerHost.setMarkers(
          sorted.map((m) => ({
            time: m.time as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            position: m.position,
            color: m.color,
            shape: m.shape,
            text: m.text ?? "",
            size: m.size,
          })),
        );
      }
    }

    // ── Cleanup: remove all series on unmount or before next update ───────────

    return () => {
      const currentChart = chartRef.current;
      if (!currentChart) return;

      for (const series of createdSeriesRef.current) {
        try {
          currentChart.removeSeries(series);
        } catch {
          // Chart may have been disposed already
        }
      }
      createdSeriesRef.current = [];
    };
  }, [chartRef, candleSeriesRef, visuals]);

  // This component renders no DOM — it only manipulates the chart via the ref
  return null;
}
