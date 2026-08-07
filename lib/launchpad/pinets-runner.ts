/**
 * PineTS integration — runs PineScript through the PineTS runtime
 * and returns structured visual data for the local chart renderer.
 */

import type { Candle } from "./types";
import { parsePine } from "./pine-parser";
import { executeRuntime, type RuntimeLog } from "./pine-runtime";

// ─── Output types for chart rendering ────────────────────────────────────────

export interface PineTSPlot {
  title: string;
  data: Array<{ time: number; value: number | null; color: string }>;
  lineWidth?: number;
  visible: boolean;
  /** `histogram` draws bars from zero — MACD's third series, not a line. */
  style?: "line" | "histogram";
  /** The colour the script asked for. Honoured verbatim by the renderer. */
  color?: string;
}

/** A constant level from `hline()` — the 30/70 bands an RSI script is unreadable without. */
export interface PineTSGuide {
  title: string;
  value: number;
  color: string;
}

export interface PineTSFill {
  title: string;
  data: Array<{ time: number; value: number | null; color: string }>;
  options?: { plot1?: string; plot2?: string; color?: string };
}

export interface PineTSLabel {
  time: number;
  price: number;
  text: string;
  style: string;
  color: string;
  textColor: string;
}

export interface PineTSLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  style: string;
}

export interface PineTSResult {
  plots: PineTSPlot[];
  fills: PineTSFill[];
  labels: PineTSLabel[];
  lines: PineTSLine[];
  guides: PineTSGuide[];
  indicatorTitle: string;
  overlay: boolean;
  logs: RuntimeLog[];
}

// ─── Run through our own pine-runtime (primary) ──────────────────────────────

export function runOwnRuntime(
  pineScript: string,
  candles: Candle[],
  onError?: (message: string) => void,
): PineTSResult | null {
  if (!pineScript || candles.length === 0) return null;
  try {
    const ast = parsePine(pineScript);
    const { plots, signals, guides, fills, logs } = executeRuntime(ast, candles);

    // Need at least plots or signals to show something useful
    if (plots.length === 0 && signals.length === 0 && logs.length === 0) return null;

    // Detect overlay from script ("overlay=true" in indicator/strategy call)
    const overlay = /(?:indicator|strategy)\s*\([^)]*overlay\s*=\s*true/.test(pineScript);

    // Detect title
    const titleMatch = pineScript.match(/(?:indicator|strategy)\s*\(\s*["']([^"']+)["']/);
    const indicatorTitle = titleMatch?.[1] ?? "Strategy";

    const pineTSPlots: PineTSPlot[] = plots.map(p => ({
      title: p.title,
      lineWidth: p.lineWidth,
      style: p.style,
      color: p.color,
      visible: true,
      data: p.data.map(d => ({ time: d.time, value: d.value, color: d.color })),
    }));

    // `fill(u, l)` names plots; the renderer resolves band edges by plot title.
    const pineTSFills: PineTSFill[] = fills.map(f => ({
      title: f.title,
      data: [],
      options: { plot1: f.upper, plot2: f.lower, color: f.color },
    }));

    // Convert strategy signals → labels (rendered as chart markers)
    // Deduplicate signals: skip consecutive buy→buy or sell→sell on adjacent bars
    const labels: PineTSLabel[] = [];
    let lastType: "buy" | "sell" | null = null;
    for (const sig of signals) {
      if (sig.type === lastType) continue; // skip duplicate consecutive signals
      lastType = sig.type;
      labels.push({
        time: sig.time,
        price: sig.price,
        text: sig.type === "buy" ? "▲" : "▼",
        style: sig.type === "buy" ? "label_up" : "label_down",
        color: sig.type === "buy" ? "#2962ff" : "#ffffff",
        textColor: sig.type === "buy" ? "#2962ff" : "#ffffff",
      });
    }

    return {
      plots: pineTSPlots,
      fills: pineTSFills,
      labels,
      lines: [],
      guides,
      indicatorTitle,
      overlay,
      logs,
    };
  } catch (error) {
    onError?.(error instanceof Error ? error.message : "Pine preview runtime failed");
    return null;
  }
}

// ─── Run PineScript through PineTS (external library, fallback) ──────────────

export async function runPineTS(
  pineScript: string,
  candles: Candle[],
): Promise<PineTSResult | null> {
  if (!pineScript || candles.length === 0) return null;

  try {
    // Dynamic import to avoid SSR issues
    const { PineTS } = await import("pinets");

    // Convert candles to PineTS format
    const pineTSCandles = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
      openTime: (c.timestamp < 1e12 ? c.timestamp * 1000 : c.timestamp),
    }));

    const pts = new PineTS(pineTSCandles);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: any = await pts.run(pineScript);

    if (!ctx || !ctx.plots) return null;

    const plots: PineTSPlot[] = [];
    const fills: PineTSFill[] = [];
    const labels: PineTSLabel[] = [];
    const lines: PineTSLine[] = [];

    let indicatorTitle = ctx.indicator?.title ?? "Indicator";
    const overlay = ctx.indicator?.overlay ?? true;

    // Extract plots
    for (const [key, plotObj] of Object.entries(ctx.plots)) {
      if (key.startsWith("__")) {
        // Special collections: __labels__, __lines__, __boxes__
        if (key === "__labels__") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const labelData = (plotObj as any)?.data;
          if (Array.isArray(labelData)) {
            for (const bar of labelData) {
              if (Array.isArray(bar.value)) {
                for (const lbl of bar.value) {
                  labels.push({
                    time: bar.time / 1000, // ms to seconds
                    price: lbl.y ?? 0,
                    text: lbl.text ?? "",
                    style: lbl.style ?? "",
                    color: lbl.bgcolor ?? "transparent",
                    textColor: lbl.textcolor ?? "#ffffff",
                  });
                }
              }
            }
          }
        }
        if (key === "__lines__") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lineData = (plotObj as any)?.data;
          if (Array.isArray(lineData)) {
            for (const bar of lineData) {
              if (Array.isArray(bar.value)) {
                for (const ln of bar.value) {
                  lines.push({
                    x1: ln.x1 ?? 0,
                    y1: ln.y1 ?? 0,
                    x2: ln.x2 ?? 0,
                    y2: ln.y2 ?? 0,
                    color: ln.color ?? "#ffffff",
                    width: ln.width ?? 1,
                    style: ln.style ?? "solid",
                  });
                }
              }
            }
          }
        }
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const po = plotObj as any;
      if (!po?.data || !Array.isArray(po.data)) continue;

      if (key === "fill" || key.startsWith("fill_") || key.startsWith("Fill") ||
          po.options?.style === "fill") {
        fills.push({
          title: po.title ?? key,
          data: po.data.map((d: { time: number; value: number | null; options?: { color?: string } }) => ({
            time: d.time / 1000,
            value: d.value,
            color: d.options?.color ?? "#ffffff20",
          })),
          options: po.options ? {
            plot1: po.options.plot1,
            plot2: po.options.plot2,
            color: po.options.color,
          } : undefined,
        });
      } else {
        // Check if this is a hidden plot (display=display.none)
        const isHidden = po.options?.display === "none" ||
          po.data.every((d: { value: number | null }) => d.value === null);

        plots.push({
          title: po.title ?? key,
          data: po.data.map((d: { time: number; value: number | null; options?: { color?: string } }) => ({
            time: d.time / 1000,
            value: d.value,
            color: d.options?.color ?? "#ffffff",
          })),
          lineWidth: po.options?.linewidth ?? 1,
          visible: !isHidden,
        });
      }
    }

    return { plots, fills, labels, lines, guides: [], indicatorTitle, overlay, logs: [] };
  } catch (err) {
    // Expected for scripts the PineTS library can't parse — the caller falls
    // back to our own runtime's result, so this is a soft miss, not an error.
    console.debug("[pinets-runner] PineTS fallback could not render (using own runtime):", err instanceof Error ? err.message : err);
    return null;
  }
}
