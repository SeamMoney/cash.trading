/**
 * pine-visual.ts — Extract visual rendering instructions from a parsed PineScript AST.
 *
 * Pure function, no side effects. Walks the parsed AST and collects all visual
 * configuration (plots, fills, hlines, markers, trend lines, boxes, bgcolors)
 * so the frontend can render overlays on a price chart.
 */

import type { ParsedPine, Expr } from "./pine-parser";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DynamicColor =
  | { kind: "static"; value: string }
  | { kind: "conditional"; condition: any; trueColor: string; falseColor: string };

export interface PlotConfig {
  id: string;
  source: string;         // variable name being plotted
  sourceExpr: any;        // raw Expr for computing the series
  title?: string;
  color: DynamicColor;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  visible: boolean;       // false when display=display.none (used as fill anchors)
}

export interface FillConfig {
  plot1Id: string;
  plot2Id: string;
  color: DynamicColor;
  opacity: number;
}

export interface BgColorConfig {
  conditionExpr: any;
  color: DynamicColor;
}

export interface HLineConfig {
  price: number;
  title?: string;
  color: string;
  lineStyle: "solid" | "dashed" | "dotted";
  lineWidth: number;
}

export interface MarkerConfig {
  conditionExpr: any;
  style: string;
  location: "abovebar" | "belowbar";
  color: DynamicColor;
  text?: string;
  size: number;
}

export interface TrendLineConfig {
  x1: any;
  y1: any;
  x2: any;
  y2: any;
  color: string;
  lineWidth: number;
  lineStyle: string;
}

export interface BoxConfig {
  left: any;
  top: any;
  right: any;
  bottom: any;
  borderColor: string;
  bgColor: string;
}

export interface VisualConfig {
  plots: PlotConfig[];
  fills: FillConfig[];
  bgColors: BgColorConfig[];
  hlines: HLineConfig[];
  markers: MarkerConfig[];
  lines: TrendLineConfig[];
  boxes: BoxConfig[];
}

// ─── PineScript Color Constants ─────────────────────────────────────────────

const PINE_COLORS: Record<string, string> = {
  green: "#26a69a",
  red: "#ef5350",
  blue: "#2196f3",
  orange: "#ff9800",
  yellow: "#ffeb3b",
  purple: "#9c27b0",
  white: "#ffffff",
  black: "#000000",
  gray: "#787b86",
  silver: "#b2b5be",
  aqua: "#00bcd4",
  fuchsia: "#e040fb",
  lime: "#00e676",
  maroon: "#880e4f",
  navy: "#1a237e",
  olive: "#827717",
  teal: "#00897b",
};

// Visual function names — used to detect visual calls in assign statements
const VISUAL_FN_NAMES = new Set([
  "plot", "plotshape", "plotchar", "plotarrow", "fill",
  "bgcolor", "barcolor", "hline",
]);

const VISUAL_NS_FN_NAMES = new Set([
  "label.new", "line.new", "box.new",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract a numeric value from an Expr, or return a default. */
function exprToNum(e: Expr | undefined, fallback: number): number {
  if (!e) return fallback;
  if (e.k === "num") return e.v;
  return fallback;
}

/** Extract a string value from an Expr, or return a default. */
function exprToStr(e: Expr | undefined, fallback: string): string {
  if (!e) return fallback;
  if (e.k === "str") return e.v;
  if (e.k === "id") return e.name;
  return fallback;
}

/** Apply alpha (0-100 transparency) to a hex color. 0 = fully opaque, 100 = fully transparent. */
function applyAlpha(hex: string, transparency: number): string {
  // Pine transparency is 0 (opaque) to 100 (invisible)
  const alpha = Math.round(((100 - Math.max(0, Math.min(100, transparency))) / 100) * 255);
  const alphaHex = alpha.toString(16).padStart(2, "0");
  // Ensure hex is 6-char format
  const base = hex.startsWith("#") ? hex.slice(1) : hex;
  return `#${base.slice(0, 6)}${alphaHex}`;
}

/** Map Pine linestyle constants to our line style union. */
function resolveLineStyle(e: Expr | undefined): "solid" | "dashed" | "dotted" {
  if (!e) return "solid";
  // hline.style_solid, hline.style_dashed, hline.style_dotted
  // line.style_solid, line.style_dashed, line.style_dotted
  // plot.style_line (treated as solid)
  const s = exprToStr(e, "solid").toLowerCase();
  if (s.includes("dash")) return "dashed";
  if (s.includes("dot")) return "dotted";
  return "solid";
}

/** Map location string constant to our location union. */
function resolveLocation(e: Expr | undefined): "abovebar" | "belowbar" {
  if (!e) return "abovebar";
  const s = exprToStr(e, "abovebar").toLowerCase();
  if (s.includes("below")) return "belowbar";
  return "abovebar";
}

/**
 * Check if an Expr is a color.xxx reference (e.g., color.green).
 * Returns the color name if so, otherwise undefined.
 */
function isColorRef(e: Expr): string | undefined {
  if (e.k === "call" && (e.ns === "color" || e.fn?.startsWith("color."))) {
    // color.green, color.red, etc. — parsed as { k: "call", ns: "color", fn: "green", args: [] }
    const name = e.ns === "color" ? e.fn : e.fn.replace("color.", "");
    return name;
  }
  // Also handle the case where it's parsed as an id like "color" with dot access
  if (e.k === "id" && e.name.startsWith("color.")) {
    return e.name.replace("color.", "");
  }
  return undefined;
}

// ─── Color Resolution ───────────────────────────────────────────────────────

/**
 * Resolve a PineScript color expression to a DynamicColor.
 *
 * Handles:
 *   - color.green             -> static "#26a69a"
 *   - color.new(color.red, 80) -> static "#ef535033" (hex + alpha)
 *   - "#ff0000"               -> static "#ff0000"
 *   - cond ? color.green : color.red -> conditional
 *   - na / missing            -> static white (default)
 */
export function resolvePineColor(expr: Expr): DynamicColor {
  if (!expr) return { kind: "static", value: "#ffffff" };

  // String literal: "#ff0000"
  if (expr.k === "str") {
    const v = expr.v;
    if (v.startsWith("#")) return { kind: "static", value: v };
    // Could be a named color string: "green"
    if (PINE_COLORS[v.toLowerCase()]) {
      return { kind: "static", value: PINE_COLORS[v.toLowerCase()] };
    }
    return { kind: "static", value: v };
  }

  // Identifier: bare color name or variable
  if (expr.k === "id") {
    const name = expr.name;
    // color.green parsed as single id in some cases
    const colorName = name.startsWith("color.") ? name.slice(6) : name;
    if (PINE_COLORS[colorName]) {
      return { kind: "static", value: PINE_COLORS[colorName] };
    }
    // Unknown variable — return white default
    return { kind: "static", value: "#ffffff" };
  }

  // Call expression: color.green, color.new(color.red, 80), color.rgb(r, g, b)
  if (expr.k === "call") {
    const ns = expr.ns;
    const fn = expr.fn;

    // color.green, color.red, etc. — no-arg namespace ref
    if (ns === "color" && expr.args.length === 0 && PINE_COLORS[fn]) {
      return { kind: "static", value: PINE_COLORS[fn] };
    }

    // color.new(baseColor, transparency)
    if ((ns === "color" && fn === "new") || fn === "color.new") {
      const baseExpr = expr.args[0];
      const transExpr = expr.args[1];
      const baseColor = baseExpr ? resolvePineColor(baseExpr) : { kind: "static" as const, value: "#ffffff" };
      const transparency = exprToNum(transExpr, 0);
      if (baseColor.kind === "static") {
        return { kind: "static", value: applyAlpha(baseColor.value, transparency) };
      }
      // Dynamic base with transparency — just return the base
      return baseColor;
    }

    // color.rgb(r, g, b) or color.rgb(r, g, b, transp)
    if ((ns === "color" && fn === "rgb") || fn === "color.rgb") {
      const r = exprToNum(expr.args[0], 0);
      const g = exprToNum(expr.args[1], 0);
      const b = exprToNum(expr.args[2], 0);
      const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      if (expr.args[3]) {
        return { kind: "static", value: applyAlpha(hex, exprToNum(expr.args[3], 0)) };
      }
      return { kind: "static", value: hex };
    }

    // color.green, etc. parsed as call with no args
    if (ns === "color" && PINE_COLORS[fn]) {
      return { kind: "static", value: PINE_COLORS[fn] };
    }
  }

  // Ternary: cond ? color.green : color.red
  if (expr.k === "ternary") {
    const trueColor = resolvePineColor(expr.yes);
    const falseColor = resolvePineColor(expr.no);
    return {
      kind: "conditional",
      condition: expr.cond,
      trueColor: trueColor.kind === "static" ? trueColor.value : "#ffffff",
      falseColor: falseColor.kind === "static" ? falseColor.value : "#ffffff",
    };
  }

  // na
  if (expr.k === "na") {
    return { kind: "static", value: "transparent" };
  }

  // Fallback
  return { kind: "static", value: "#ffffff" };
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/** Try to extract a source variable name from an Expr. */
function extractSourceName(e: Expr): string {
  if (e.k === "id") return e.name;
  if (e.k === "hist") return e.name;
  if (e.k === "call") return `${e.ns ? e.ns + "." : ""}${e.fn}(...)`;
  return "series";
}

/**
 * Determine if a call Expr represents a visual function.
 * Returns the function name (e.g., "plot", "hline", "line.new") or undefined.
 */
function getVisualFnName(e: Expr): string | undefined {
  if (e.k !== "call") return undefined;
  const fullName = e.ns ? `${e.ns}.${e.fn}` : e.fn;
  if (VISUAL_FN_NAMES.has(e.fn)) return e.fn;
  if (VISUAL_NS_FN_NAMES.has(fullName)) return fullName;
  return undefined;
}

/** Internal context for tracking plot IDs during extraction. */
interface ExtractionCtx {
  config: VisualConfig;
  plotCounter: number;
  /** Map from variable name to plot ID, for resolving fill() references. */
  varToPlotId: Map<string, string>;
}

/**
 * Process a visual call: given the function name, positional args, keyword args,
 * and an optional assignee variable name, populate the VisualConfig.
 */
function processVisualCall(
  ctx: ExtractionCtx,
  fn: string,
  args: Expr[],
  kw: Record<string, Expr>,
  assignee?: string,
): void {
  switch (fn) {
    case "plot": {
      const id = assignee ?? `plot_${ctx.plotCounter++}`;
      const sourceExpr = args[0];
      const source = sourceExpr ? extractSourceName(sourceExpr) : "close";
      const title = exprToStr(kw["title"] ?? args[1], undefined as any) || undefined;
      const colorExpr = kw["color"] ?? args[2];
      const color = colorExpr ? resolvePineColor(colorExpr) : { kind: "static" as const, value: "#ffffff" };
      const lineWidth = exprToNum(kw["linewidth"] ?? args[3], 1);
      const lineStyle = resolveLineStyle(kw["style"] ?? args[4]);

      // Check for display=display.none (invisible plot used as fill anchor)
      const displayExpr = kw["display"];
      const displayStr = displayExpr ? exprToStr(displayExpr, "all").toLowerCase() : "all";
      const isDisplayNone = displayStr.includes("none") || (
        displayExpr && (
          (displayExpr.k === "id" && displayExpr.name === "display.none") ||
          (displayExpr.k === "call" && displayExpr.fn === "none")
        )
      );

      // Also treat transparent / fully-transparent colors as invisible
      const resolvedColorStr = color.kind === "static" ? color.value : "";
      const isTransparentColor = resolvedColorStr === "transparent" || resolvedColorStr.endsWith("00");

      const plot: PlotConfig = {
        id,
        source,
        sourceExpr: sourceExpr ?? { k: "na" },
        title,
        color,
        lineWidth,
        lineStyle,
        visible: !isDisplayNone && !isTransparentColor,
      };
      ctx.config.plots.push(plot);
      if (assignee) ctx.varToPlotId.set(assignee, id);
      break;
    }

    case "fill": {
      // fill(plot1, plot2, color=..., transp=...)
      const plot1Expr = args[0];
      const plot2Expr = args[1];
      const plot1Id = plot1Expr
        ? (plot1Expr.k === "id" ? (ctx.varToPlotId.get(plot1Expr.name) ?? plot1Expr.name) : `plot_ref_0`)
        : "unknown";
      const plot2Id = plot2Expr
        ? (plot2Expr.k === "id" ? (ctx.varToPlotId.get(plot2Expr.name) ?? plot2Expr.name) : `plot_ref_1`)
        : "unknown";
      const colorExpr = kw["color"] ?? args[2];
      const color = colorExpr ? resolvePineColor(colorExpr) : { kind: "static" as const, value: "#2196f3" };
      const opacity = exprToNum(kw["transp"] ?? args[3], 90) / 100;

      ctx.config.fills.push({ plot1Id, plot2Id, color, opacity });
      break;
    }

    case "bgcolor": {
      // bgcolor(color) or bgcolor(cond ? color.green : na)
      const colorExpr = kw["color"] ?? args[0];
      if (!colorExpr) break;
      // The color expression itself can serve as the condition for conditional colors
      const color = resolvePineColor(colorExpr);
      ctx.config.bgColors.push({ conditionExpr: colorExpr, color });
      break;
    }

    case "hline": {
      // hline(price, title, color, linestyle, linewidth)
      const price = exprToNum(args[0], 0);
      const title = exprToStr(kw["title"] ?? args[1], undefined as any) || undefined;
      const colorExpr = kw["color"] ?? args[2];
      const color = colorExpr ? resolvePineColor(colorExpr) : { kind: "static" as const, value: "#787b86" };
      const lineStyle = resolveLineStyle(kw["linestyle"] ?? args[3]);
      const lineWidth = exprToNum(kw["linewidth"] ?? args[4], 1);

      ctx.config.hlines.push({
        price,
        title,
        color: color.kind === "static" ? color.value : "#787b86",
        lineStyle,
        lineWidth,
      });
      break;
    }

    case "plotshape":
    case "plotchar":
    case "plotarrow": {
      // plotshape(condition, title, style, location, color, text, size)
      const conditionExpr = args[0] ?? { k: "bool" as const, v: true };
      const style = exprToStr(kw["style"] ?? args[2], fn === "plotarrow" ? "arrow" : "shape");
      const location = resolveLocation(kw["location"] ?? args[3]);
      const colorExpr = kw["color"] ?? args[4];
      const color = colorExpr ? resolvePineColor(colorExpr) : { kind: "static" as const, value: "#ffffff" };
      const text = exprToStr(kw["text"] ?? args[5], undefined as any) || undefined;
      const sizeExpr = kw["size"] ?? args[6];
      const size = exprToNum(sizeExpr, 1);

      ctx.config.markers.push({ conditionExpr, style, location, color, text, size });
      break;
    }

    case "line.new": {
      // line.new(x1, y1, x2, y2, color, width, style, ...)
      const x1 = args[0] ?? kw["x1"];
      const y1 = args[1] ?? kw["y1"];
      const x2 = args[2] ?? kw["x2"];
      const y2 = args[3] ?? kw["y2"];
      const colorExpr = kw["color"] ?? args[4];
      const color = colorExpr ? resolvePineColor(colorExpr) : { kind: "static" as const, value: "#ffffff" };
      const lineWidth = exprToNum(kw["width"] ?? args[5], 1);
      const lineStyle = resolveLineStyle(kw["style"] ?? args[6]);

      ctx.config.lines.push({
        x1: x1 ?? null,
        y1: y1 ?? null,
        x2: x2 ?? null,
        y2: y2 ?? null,
        color: color.kind === "static" ? color.value : "#ffffff",
        lineWidth,
        lineStyle,
      });
      break;
    }

    case "box.new": {
      // box.new(left, top, right, bottom, border_color, bgcolor, ...)
      const left = args[0] ?? kw["left"];
      const top = args[1] ?? kw["top"];
      const right = args[2] ?? kw["right"];
      const bottom = args[3] ?? kw["bottom"];
      const borderColorExpr = kw["border_color"] ?? args[4];
      const bgColorExpr = kw["bgcolor"] ?? args[5];
      const borderColor = borderColorExpr
        ? resolvePineColor(borderColorExpr)
        : { kind: "static" as const, value: "#ffffff" };
      const bgColor = bgColorExpr
        ? resolvePineColor(bgColorExpr)
        : { kind: "static" as const, value: "transparent" };

      ctx.config.boxes.push({
        left: left ?? null,
        top: top ?? null,
        right: right ?? null,
        bottom: bottom ?? null,
        borderColor: borderColor.kind === "static" ? borderColor.value : "#ffffff",
        bgColor: bgColor.kind === "static" ? bgColor.value : "transparent",
      });
      break;
    }

    case "label.new": {
      // label.new(x, y, text, style, color, textcolor, size, ...)
      // We represent labels as markers since they're conceptually similar
      const x = args[0] ?? kw["x"];
      const y = args[1] ?? kw["y"];
      const text = exprToStr(kw["text"] ?? args[2], "");
      const style = exprToStr(kw["style"] ?? args[3], "label");
      const colorExpr = kw["color"] ?? args[4];
      const textColorExpr = kw["textcolor"] ?? args[5];
      const color = colorExpr ? resolvePineColor(colorExpr) : { kind: "static" as const, value: "#2196f3" };
      const textColor = textColorExpr ? resolvePineColor(textColorExpr) : color;
      const size = exprToNum(kw["size"] ?? args[6], 1);

      // Map PineScript label styles to marker location
      // label.style_label_up -> belowbar (label points up from below)
      // label.style_label_down -> abovebar (label points down from above)
      const styleLower = style.toLowerCase();
      let location: "abovebar" | "belowbar" = "abovebar";
      let markerStyle = style;
      if (styleLower.includes("label_up") || styleLower.includes("label.style_label_up")) {
        location = "belowbar";
        markerStyle = "arrowup";
      } else if (styleLower.includes("label_down") || styleLower.includes("label.style_label_down")) {
        location = "abovebar";
        markerStyle = "arrowdown";
      } else if (styleLower.includes("label_left") || styleLower.includes("label_right") || styleLower.includes("label_center")) {
        location = "abovebar";
        markerStyle = "circle";
      }

      // Store as a marker with location derived from label style
      ctx.config.markers.push({
        conditionExpr: { k: "bool", v: true },
        style: markerStyle,
        location,
        color: textColor.kind === "static" ? textColor : color,
        text: text || undefined,
        size,
      });
      break;
    }

    case "barcolor": {
      // barcolor(color) — treated like bgcolor for our purposes
      const colorExpr = kw["color"] ?? args[0];
      if (!colorExpr) break;
      const color = resolvePineColor(colorExpr);
      ctx.config.bgColors.push({ conditionExpr: colorExpr, color });
      break;
    }

    default:
      break;
  }
}

/**
 * Walk the parsed PineScript AST and extract all visual rendering configuration.
 *
 * Handles two patterns:
 *   1. Standalone visual statements:  plot(close, color=color.green)
 *   2. Assigned visual calls:         p1 = plot(close, color=color.green)
 *
 * For standalone `visual` Stmts, the parser stores only positional args (no kw).
 * For assigned calls, the full call Expr (with kw) is preserved on the assign's value.
 */
export function extractVisualConfig(parsed: ParsedPine): VisualConfig {
  const ctx: ExtractionCtx = {
    config: {
      plots: [],
      fills: [],
      bgColors: [],
      hlines: [],
      markers: [],
      lines: [],
      boxes: [],
    },
    plotCounter: 0,
    varToPlotId: new Map(),
  };

  for (const stmt of parsed.statements) {
    // Pattern 1: standalone visual statement { k: "visual", fn, args }
    if (stmt.k === "visual") {
      // The visual stmt only has positional args (kw was discarded by parser).
      // We pass an empty kw and rely on positional-arg extraction.
      processVisualCall(ctx, stmt.fn, stmt.args, {});
      continue;
    }

    // Pattern 2: assigned visual call — p1 = plot(series, color=color.green)
    if (stmt.k === "assign" && stmt.value.k === "call") {
      const callExpr = stmt.value;
      const fnName = getVisualFnName(callExpr);
      if (fnName) {
        const assignee = stmt.targets.length === 1 ? stmt.targets[0] : undefined;
        processVisualCall(ctx, fnName, callExpr.args, callExpr.kw, assignee);
        continue;
      }
    }

    // Pattern 3: expression statement wrapping a visual call
    if (stmt.k === "expr" && stmt.e.k === "call") {
      const callExpr = stmt.e;
      const fnName = getVisualFnName(callExpr);
      if (fnName) {
        processVisualCall(ctx, fnName, callExpr.args, callExpr.kw);
        continue;
      }
    }
  }

  return ctx.config;
}
