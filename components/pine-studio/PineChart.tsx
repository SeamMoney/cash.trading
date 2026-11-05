"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Bar, OrderIntent } from "../../lib/pine-solana/ir";

export interface PineChartOverlay {
  name: string;
  color: string;
  /** Values are aligned to the full bars array, including missing samples. */
  values: readonly (number | null)[];
}

export interface PineChartProps {
  bars: readonly Bar[];
  overlays?: readonly PineChartOverlay[];
  intents?: readonly OrderIntent[];
  onInspect?: (bar: Bar | null, index: number | null) => void;
  /** Clear the crosshair when the surrounding workspace resets selection. */
  inspectionKey?: number;
}

const UP = "#88bdac";
const DOWN = "#d68e87";
const ACCENT = "#ff6a3d";
const MONO = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
const AXIS_WIDTH = 61;

function validBar(bar: Bar | undefined): bar is Bar {
  return !!bar && [bar.open, bar.high, bar.low, bar.close, bar.volume, bar.time].every(Number.isFinite)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close) && bar.volume >= 0;
}

function price(value: number, range = 1): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000_000_000) return value.toExponential(2);
  if (magnitude >= 10_000) return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  if (magnitude > 0 && magnitude < 0.0001) return value.toExponential(2);
  const digits = range < 0.01 ? 5 : range < 1 ? 3 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function timeLabel(time: number, includeDate = false): string {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return "—";
  const clock = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return includeDate ? `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} · ${clock} UTC` : clock;
}

function signalLabel(intent: OrderIntent): string {
  const action = intent.kind === "entry" ? (intent.side > 0 ? "Long" : "Short") : "Close";
  return `${action} signal · ${intent.id || "all positions"}${intent.quantity === null ? "" : ` · ${intent.quantity} units`}`;
}

/** A price chart of the supplied candles and computed signals; no live-data or fill assumptions. */
export function PineChart({ bars, overlays = [], intents = [], onInspect, inspectionKey = 0 }: PineChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);
  const callback = useRef(onInspect);
  const [size, setSize] = useState({ width: 640, height: 340 });
  const [inspection, setInspection] = useState<{ index: number; time: number } | null>(null);
  const clipId = `pine-price-${useId().replace(/:/g, "")}`;

  useEffect(() => { callback.current = onInspect; }, [onInspect]);
  useEffect(() => { setInspection(null); callback.current?.(null, null); }, [inspectionKey]);
  useEffect(() => () => { callback.current?.(null, null); }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const width = Math.max(240, size.width);
    const height = Math.max(220, size.height);
    const left = 6;
    const right = width - AXIS_WIDTH;
    const top = 23;
    const bottom = height - 58;
    const count = Math.min(bars.length, Math.max(30, Math.min(100, Math.floor((right - left) / 6.5))));
    const start = Math.max(0, bars.length - count);
    const visible = bars.slice(start).map((bar, offset) => ({ bar, index: start + offset })).filter(({ bar }) => validBar(bar));
    const values = visible.flatMap(({ bar }) => [bar.high, bar.low]);
    for (const overlay of overlays) {
      for (const { index } of visible) {
        const value = overlay.values[index];
        if (typeof value === "number" && Number.isFinite(value)) values.push(value);
      }
    }
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    // Normalize first so even finite, very large inputs cannot overflow a subtraction.
    const scale = Math.max(Math.abs(min), Math.abs(max), Number.MIN_VALUE);
    const normalizedSpan = Math.max((max / scale) - (min / scale), 0.012);
    const low = (min / scale) - normalizedSpan * 0.19;
    const high = (max / scale) + normalizedSpan * 0.19;
    const step = (right - left) / Math.max(count, 1);
    const x = (index: number) => left + (index - start + 0.5) * step;
    const y = (value: number) => top + ((high - value / scale) / (high - low)) * (bottom - top);
    const maxVolume = Math.max(1, ...visible.map(({ bar }) => bar.volume));
    const range = max - min;
    const ticks = Array.from({ length: 5 }, (_, i) => {
      const normalized = high - ((high - low) * i) / 4;
      return { y: top + ((bottom - top) * i) / 4, value: normalized * scale };
    });
    const paths = overlays.map(overlay => {
      let connected = false;
      const segments: string[] = [];
      for (const { index } of visible) {
        const value = overlay.values[index];
        if (typeof value !== "number" || !Number.isFinite(value)) { connected = false; continue; }
        segments.push(`${connected ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`);
        connected = true;
      }
      return { ...overlay, path: segments.join(" ") };
    });
    const groups = new Map<number, OrderIntent[]>();
    for (const intent of intents) {
      if (!Number.isInteger(intent.barIndex) || intent.barIndex < start || intent.barIndex >= bars.length) continue;
      const bar = bars[intent.barIndex];
      if (!validBar(bar) || bar.time !== intent.time) continue;
      const group = groups.get(intent.barIndex);
      if (group) group.push(intent);
      else groups.set(intent.barIndex, [intent]);
    }
    return { width, height, left, right, top, bottom, count, start, visible, x, y, step, maxVolume, ticks, paths, groups, range };
  }, [bars, overlays, intents, size]);

  const { width, height, left, right, top, bottom, start, visible, x, y, step, maxVolume, ticks, paths, groups, range } = geometry;
  const selectedBar = inspection && inspection.index >= start && bars[inspection.index]?.time === inspection.time && validBar(bars[inspection.index]) ? bars[inspection.index] : null;
  const last = visible.at(-1);

  useEffect(() => {
    if (inspection && !selectedBar) {
      setInspection(null);
      callback.current?.(null, null);
    }
  }, [inspection, selectedBar]);

  function select(index: number) {
    const bar = bars[index];
    if (!validBar(bar)) return;
    if (inspection?.index === index && inspection.time === bar.time) return;
    setInspection({ index, time: bar.time });
    callback.current?.(bar, index);
  }

  function clear() {
    setInspection(null);
    callback.current?.(null, null);
  }

  function inspectPointer(event: PointerEvent<HTMLDivElement>) {
    if (!visible.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - bounds.left) / bounds.width) * width;
    const index = Math.max(start, Math.min(bars.length - 1, start + Math.floor((localX - left) / step)));
    const nearest = visible.reduce((best, candidate) => Math.abs(candidate.index - index) < Math.abs(best.index - index) ? candidate : best);
    select(nearest.index);
  }

  function inspectKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!visible.length || event.target !== event.currentTarget) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = [...visible].reverse().find(item => item.index < (inspection?.index ?? bars.length))?.index ?? visible[0].index; break;
      case "ArrowRight": next = visible.find(item => item.index > (inspection?.index ?? start - 1))?.index ?? visible[visible.length - 1].index; break;
      case "Home": next = visible[0].index; break;
      case "End": next = visible[visible.length - 1].index; break;
      case "Escape": event.preventDefault(); clear(); return;
      default: return;
    }
    event.preventDefault();
    select(next);
  }

  const timeIndices = visible.length ? [...new Set([visible[0].index, visible[Math.floor((visible.length - 1) / 2)].index, visible[visible.length - 1].index])] : [];
  const labelY = last ? Math.max(top + 10, Math.min(bottom - 10, y(last.bar.close))) : 0;
  const selectedX = inspection ? x(inspection.index) : 0;
  const selectedY = selectedBar ? y(selectedBar.close) : 0;

  return (
    <div
      ref={container}
      className="pine-chart"
      role="group"
      aria-roledescription="interactive price chart"
      aria-label={`${visible.length} visible candles. Use the left and right arrow keys to inspect, Home or End to jump, and Escape to clear.`}
      tabIndex={0}
      style={{ width: "100%", minHeight: 260, position: "relative", touchAction: "pan-y" }}
      onKeyDown={inspectKeyboard}
      onPointerDown={event => {
        if ((event.target as HTMLElement).closest?.("button")) return;
        activePointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        inspectPointer(event);
      }}
      onPointerMove={event => {
        if ((event.target as HTMLElement).closest?.("button")) return;
        if (event.pointerType === "mouse" || activePointer.current === event.pointerId) inspectPointer(event);
      }}
      onPointerUp={event => {
        activePointer.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { activePointer.current = null; clear(); }}
      onLostPointerCapture={() => { activePointer.current = null; }}
      onPointerLeave={event => { if (event.pointerType === "mouse" && activePointer.current === null) clear(); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clear(); }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Candlestick prices, indicator overlays, volume, and strategy signals"
        style={{ display: "block", overflow: "visible", userSelect: "none" }}
      >
        <defs><clipPath id={clipId}><rect x={left} y={4} width={right - left} height={height - 26} /></clipPath></defs>

        {ticks.map((tick, i) => (
          <g key={i}>
            <line x1={left} x2={right} y1={tick.y} y2={tick.y} stroke="currentColor" strokeOpacity={0.065} strokeDasharray="2 5" />
            <text x={right + 12} y={tick.y + 3.5} fill="#737b7a" fontFamily={MONO} fontSize={10}>{price(tick.value, range)}</text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {visible.map(({ bar, index }) => {
            const color = bar.close >= bar.open ? UP : DOWN;
            const volumeHeight = (bar.volume / maxVolume) * 25;
            return <rect key={`volume-${index}`} x={x(index) - step * 0.34} y={height - 29 - volumeHeight} width={Math.max(1, step * 0.68)} height={volumeHeight} rx={0.8} fill={color} opacity={0.13} />;
          })}

          {visible.map(({ bar, index }) => {
            const rising = bar.close >= bar.open;
            const color = rising ? UP : DOWN;
            const bodyTop = y(Math.max(bar.open, bar.close));
            const bodyHeight = Math.max(1.5, Math.abs(y(bar.open) - y(bar.close)));
            const bodyWidth = Math.max(2, Math.min(8, step * 0.67));
            return (
              <g key={`candle-${index}`}>
                <line x1={x(index)} x2={x(index)} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth={1} opacity={0.78} />
                <rect x={x(index) - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} rx={0.6} fill={color} />
              </g>
            );
          })}

          {paths.map((overlay, index) => <path key={`${overlay.name}-${index}`} d={overlay.path} fill="none" stroke={overlay.color} strokeWidth={1.65} strokeLinejoin="round" strokeLinecap="round" opacity={0.92}><title>{overlay.name}</title></path>)}

          {[...groups.entries()].map(([index, signals]) => {
            const signal = signals[0];
            const bar = bars[index];
            const isLong = signal.kind === "entry" && signal.side > 0;
            const isShort = signal.kind === "entry" && signal.side < 0;
            const centerY = isLong ? y(bar.low) + 13 : isShort ? y(bar.high) - 13 : y(bar.close) - 15;
            return (
              <g key={`signal-${index}`} transform={`translate(${x(index)},${centerY})`}>
                <title>{signals.map(signalLabel).join("; ")}</title>
                <circle r={7.5} fill={isLong ? ACCENT : "#e7e5dd"} stroke="#131716" strokeWidth={1.5} />
                {signal.kind === "entry" ? <path d={isLong ? "M-2.5,0 L0,-2.5 L2.5,0 M0,-2.5 V3" : "M-2.5,0 L0,2.5 L2.5,0 M0,2.5 V-3"} fill="none" stroke="#151a18" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" /> : <path d="M-2,-2 L2,2 M2,-2 L-2,2" stroke="#151a18" strokeWidth={1.3} strokeLinecap="round" />}
                {signals.length > 1 && <text x={8} y={-7} fill="#e7e5dd" fontFamily={MONO} fontSize={8} paintOrder="stroke" stroke="#131716" strokeWidth={2}>+{signals.length - 1}</text>}
              </g>
            );
          })}

          {last && <line x1={left} x2={right} y1={y(last.bar.close)} y2={y(last.bar.close)} stroke={ACCENT} strokeOpacity={0.45} strokeWidth={0.9} strokeDasharray="3 4" />}

          {selectedBar && (
            <g>
              <line x1={selectedX} x2={selectedX} y1={top - 10} y2={height - 27} stroke="#c8ccc7" strokeOpacity={0.55} strokeDasharray="3 4" />
              <line x1={left} x2={right} y1={selectedY} y2={selectedY} stroke="#c8ccc7" strokeOpacity={0.45} strokeDasharray="3 4" />
              <circle cx={selectedX} cy={selectedY} r={4} fill="#e7e5dd" stroke="#161918" strokeWidth={2} />
            </g>
          )}
        </g>

        {last && <g transform={`translate(${right + 3},${labelY - 10})`}>
          <rect width={AXIS_WIDTH - 5} height={21} rx={4} fill={ACCENT} />
          <text x={(AXIS_WIDTH - 5) / 2} y={14} textAnchor="middle" fill="#151412" fontFamily={MONO} fontSize={10} fontWeight={600}>{price(last.bar.close, range)}</text>
        </g>}

        {timeIndices.map((index, position) => <text key={`time-${index}`} x={position === 0 ? left : position === timeIndices.length - 1 ? right : x(index)} y={height - 7} textAnchor={position === 0 ? "start" : position === timeIndices.length - 1 ? "end" : "middle"} fill="#68716f" fontFamily={MONO} fontSize={9.5}>{timeLabel(bars[index].time)}</text>)}
        <text x={right + 16} y={height - 7} fill="#555e5b" fontFamily={MONO} fontSize={8.5}>UTC</text>

        {!visible.length && <text x={width / 2} y={height / 2} textAnchor="middle" fill="#8d9692" fontFamily="inherit" fontSize={13}>Your chart preview will appear here</text>}
      </svg>

      {selectedBar && <div
        className="pine-chart-inspection"
        style={{ position: "absolute", top: 3, left: 7, maxWidth: "calc(100% - 73px)", padding: "8px 11px", border: "1px solid #ffffff12", borderRadius: 9, background: "#101513ed", backdropFilter: "blur(12px)", pointerEvents: "none", fontFamily: MONO, fontSize: 10, lineHeight: 1.7, color: "#d6ddd7", boxShadow: "0 4px 18px #00000020" }}
      >
        <span style={{ display: "block", color: "#9aa69f", fontSize: 9, paddingRight: 27 }}>{timeLabel(selectedBar.time, true)}</span>
        <span style={{ display: "flex", flexWrap: "wrap", columnGap: 10, rowGap: 0 }}>
          {([['O', selectedBar.open], ['H', selectedBar.high], ['L', selectedBar.low], ['C', selectedBar.close]] as const).map(([label, value]) => <span key={label}><span style={{ color: "#78867e", marginRight: 4 }}>{label}</span>{price(value, range)}</span>)}
        </span>
        <button
          type="button"
          aria-label="Clear chart inspection"
          onClick={event => { event.stopPropagation(); clear(); }}
          style={{ position: "absolute", right: -5, top: -8, width: 44, height: 44, display: "grid", placeItems: "center", color: "#acb6b0", background: "transparent", border: 0, cursor: "pointer", pointerEvents: "auto" }}
        >
          <svg width={11} height={11} viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" /></svg>
        </button>
      </div>}

      <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap", border: 0 }}>
        {selectedBar ? `${timeLabel(selectedBar.time, true)}. Open ${price(selectedBar.open, range)}, high ${price(selectedBar.high, range)}, low ${price(selectedBar.low, range)}, close ${price(selectedBar.close, range)}.` : ""}
      </span>
    </div>
  );
}

export default PineChart;
