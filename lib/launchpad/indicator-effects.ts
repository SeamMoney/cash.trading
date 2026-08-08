import type {
  BklitPlotFill,
  BklitPlotLine,
  BklitPlotMarker,
  BklitPlotZone,
} from "@/components/trade/BklitCandlePlot";
import type { Candle } from "@/lib/launchpad/types";

const CASH_GREEN = "#74ff45";
const SKY = "#57b8ff";
const AMBER = "#ffb454";
const RED = "#ff5d73";
const VIOLET = "#b59cff";

export type IndicatorVisualFamily =
  | "liquidity"
  | "structure"
  | "volatility"
  | "trend"
  | "momentum"
  | "generic";

export interface IndicatorVisualEffects {
  adapted: boolean;
  family: IndicatorVisualFamily;
  fills: BklitPlotFill[];
  lines: BklitPlotLine[];
  markers: BklitPlotMarker[];
  panes: Array<{
    key: string;
    label: string;
    lines: Array<{ id: string; color: string; data: Array<{ time: number; value: number }> }>;
    histogram?: Array<{ time: number; value: number }>;
    guides: Array<{ id: string; value: number; color: string }>;
  }>;
  zones: BklitPlotZone[];
  legend: Array<{ title: string; color: string }>;
  dashboard: Array<{ label: string; value: string; tone?: "positive" | "negative" | "neutral" }>;
}

function inputNumber(source: string, name: string, fallback: number, min: number, max: number) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(`\\b${escaped}\\s*=\\s*input\\.(?:int|float)\\(\\s*([0-9.]+)`, "i").exec(source);
  const titled = new RegExp(`input\\.(?:int|float)\\(\\s*([0-9.]+)[^\\n]*['\"]${escaped}['\"]`, "i").exec(source);
  const parsed = Number(direct?.[1] ?? titled?.[1] ?? fallback);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function ema(values: number[], length: number) {
  const result: number[] = [];
  const alpha = 2 / (length + 1);
  let current = values[0] ?? 0;
  for (const value of values) {
    current += alpha * (value - current);
    result.push(current);
  }
  return result;
}

function sma(values: number[], length: number) {
  const result: number[] = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= length) sum -= values[index - length];
    result.push(sum / Math.min(index + 1, length));
  }
  return result;
}

function standardDeviation(values: number[], length: number) {
  const means = sma(values, length);
  return values.map((_, index) => {
    const start = Math.max(0, index - length + 1);
    const mean = means[index];
    const sample = values.slice(start, index + 1);
    return Math.sqrt(sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, sample.length));
  });
}

function rsi(values: number[], length: number) {
  const result = new Array<number>(values.length).fill(50);
  if (values.length < 2) return result;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    if (index <= length) {
      averageGain += gain / length;
      averageLoss += loss / length;
    } else {
      averageGain = (averageGain * (length - 1) + gain) / length;
      averageLoss = (averageLoss * (length - 1) + loss) / length;
    }
    if (index >= length) {
      result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    }
  }
  return result;
}

function atr(candles: Candle[], length: number) {
  const ranges = candles.map((candle, index) => {
    const prior = candles[index - 1]?.close ?? candle.open;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prior), Math.abs(candle.low - prior));
  });
  return ema(ranges, length);
}

function points(candles: Candle[], values: number[]) {
  return candles.flatMap((candle, index) => {
    const value = values[index];
    return Number.isFinite(value) ? [{ time: candle.timestamp, value }] : [];
  });
}

function formatPrice(value: number) {
  const digits = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function detectFamily(title: string, source: string): IndicatorVisualFamily {
  const haystack = `${title}\n${source}`.toLowerCase();
  if (/\b(?:liquidity|sweep|raid|unswept|pool|wick)\b/.test(haystack)) return "liquidity";
  if (/\b(?:elliott|bos|choch|pivot|support|resistance|swing|breakout)\b|market structure|smart money|\bsmc\b|order block|\bict\b/.test(haystack)) return "structure";
  if (/\b(?:bollinger|keltner|donchian|band|channel|volatility|regression)\b|mean reversion/.test(haystack)) return "volatility";
  if (/\b(?:rsi|macd|stoch|momentum|mfi|cci|williams)\b/.test(haystack)) return "momentum";
  if (/\b(?:supertrend|vwap|ema|sma|trend)\b|moving average/.test(haystack)) return "trend";
  return "generic";
}

function pivotIndexes(candles: Candle[], length: number, side: "high" | "low") {
  const found: number[] = [];
  for (let index = length; index < candles.length - length; index += 1) {
    const value = candles[index][side];
    let pivot = true;
    for (let offset = index - length; offset <= index + length; offset += 1) {
      if (offset === index) continue;
      if (side === "high" ? candles[offset].high >= value : candles[offset].low <= value) {
        pivot = false;
        break;
      }
    }
    if (pivot) found.push(index);
  }
  return found;
}

function crossoverMarkers(
  candles: Candle[],
  fast: number[],
  slow: number[],
  prefix: string,
): BklitPlotMarker[] {
  const markers: BklitPlotMarker[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const crossedUp = fast[index - 1] <= slow[index - 1] && fast[index] > slow[index];
    const crossedDown = fast[index - 1] >= slow[index - 1] && fast[index] < slow[index];
    if (!crossedUp && !crossedDown) continue;
    const candle = candles[index];
    markers.push({
      id: `${prefix}-${candle.timestamp}`,
      time: candle.timestamp,
      price: crossedUp ? candle.low : candle.high,
      side: crossedUp ? "buy" : "sell",
      color: crossedUp ? CASH_GREEN : RED,
      label: crossedUp ? "BUY" : "SELL",
    });
  }
  return markers.slice(-24);
}

function trendEffects(candles: Candle[], source: string, family: IndicatorVisualFamily): IndicatorVisualEffects {
  const close = candles.map((candle) => candle.close);
  const fastLength = Math.round(inputNumber(source, "fastLen", 9, 2, 80));
  const slowLength = Math.round(inputNumber(source, "slowLen", 21, fastLength + 1, 200));
  const fast = ema(close, fastLength);
  const slow = ema(close, slowLength);
  const volumeTotal: number[] = [];
  const typicalVolumeTotal: number[] = [];
  candles.forEach((candle, index) => {
    const typical = (candle.high + candle.low + candle.close) / 3;
    volumeTotal[index] = (volumeTotal[index - 1] ?? 0) + Math.max(candle.volume, 1);
    typicalVolumeTotal[index] = (typicalVolumeTotal[index - 1] ?? 0) + typical * Math.max(candle.volume, 1);
  });
  const vwap = typicalVolumeTotal.map((value, index) => value / volumeTotal[index]);
  const markers = crossoverMarkers(candles, fast, slow, "trend");
  const last = candles.length - 1;
  const bullish = fast[last] >= slow[last];
  return {
    adapted: true,
    family,
    fills: [{
      id: "visual-ema-ribbon",
      color: bullish ? CASH_GREEN : RED,
      opacity: 0.07,
      upperData: points(candles, fast.map((value, index) => Math.max(value, slow[index]))),
      lowerData: points(candles, fast.map((value, index) => Math.min(value, slow[index]))),
    }],
    lines: [
      { id: "visual-fast-ema", color: CASH_GREEN, width: 2, data: points(candles, fast) },
      { id: "visual-slow-ema", color: SKY, width: 1.5, data: points(candles, slow) },
      { id: "visual-vwap", color: AMBER, width: 1.25, dash: "4 4", data: points(candles, vwap) },
    ],
    markers,
    panes: [],
    zones: [],
    legend: [
      { title: `EMA ${fastLength}`, color: CASH_GREEN },
      { title: `EMA ${slowLength}`, color: SKY },
      { title: "VWAP", color: AMBER },
    ],
    dashboard: [
      { label: "Trend", value: bullish ? "BULLISH" : "BEARISH", tone: bullish ? "positive" : "negative" },
      { label: "Last signal", value: markers.at(-1)?.label ?? "WAITING", tone: "neutral" },
    ],
  };
}

function volatilityEffects(candles: Candle[], source: string): IndicatorVisualEffects {
  const close = candles.map((candle) => candle.close);
  const length = Math.round(inputNumber(source, "length", 20, 5, 100));
  const multiplier = inputNumber(source, "mult", 2, 0.5, 5);
  const middle = sma(close, length);
  const deviation = standardDeviation(close, length);
  const upper = middle.map((value, index) => value + deviation[index] * multiplier);
  const lower = middle.map((value, index) => value - deviation[index] * multiplier);
  const width = upper.at(-1)! - lower.at(-1)!;
  const markers: BklitPlotMarker[] = [];
  const zones: BklitPlotZone[] = [];
  const bandWidths = upper.map((value, index) => value - lower[index]);
  const widthBasis = sma(bandWidths, Math.min(40, Math.max(10, length)));
  let squeezeStart = -1;
  for (let index = Math.max(1, length); index < candles.length; index += 1) {
    const squeezed = bandWidths[index] < widthBasis[index] * 0.72;
    if (squeezed && squeezeStart < 0) squeezeStart = index;
    if ((!squeezed || index === candles.length - 1) && squeezeStart >= 0) {
      const end = squeezed ? index : index - 1;
      if (end - squeezeStart >= 3) {
        zones.push({
          id: `visual-squeeze-${candles[squeezeStart].timestamp}`,
          startTime: candles[squeezeStart].timestamp,
          endTime: candles[end].timestamp,
          low: Math.min(...lower.slice(squeezeStart, end + 1)),
          high: Math.max(...upper.slice(squeezeStart, end + 1)),
          color: AMBER,
          label: "SQUEEZE",
          opacity: 0.055,
        });
      }
      squeezeStart = -1;
    }
    const brokeUp = close[index - 1] <= upper[index - 1] && close[index] > upper[index];
    const brokeDown = close[index - 1] >= lower[index - 1] && close[index] < lower[index];
    if (brokeUp || brokeDown) {
      markers.push({
        id: `visual-band-break-${candles[index].timestamp}`,
        time: candles[index].timestamp,
        price: brokeUp ? candles[index].low : candles[index].high,
        side: brokeUp ? "buy" : "sell",
        color: brokeUp ? CASH_GREEN : RED,
        label: brokeUp ? "BREAKOUT" : "BREAKDOWN",
      });
    }
  }
  return {
    adapted: true,
    family: "volatility",
    fills: [{
      id: "visual-volatility-band",
      color: VIOLET,
      opacity: 0.1,
      upperData: points(candles, upper),
      lowerData: points(candles, lower),
    }],
    lines: [
      { id: "visual-upper-band", color: VIOLET, width: 1.25, data: points(candles, upper) },
      { id: "visual-middle-band", color: CASH_GREEN, width: 1.5, data: points(candles, middle) },
      { id: "visual-lower-band", color: VIOLET, width: 1.25, data: points(candles, lower) },
    ],
    markers: markers.slice(-18),
    panes: [],
    zones: zones.slice(-8),
    legend: [{ title: `Volatility band ${length}`, color: VIOLET }],
    dashboard: [
      { label: "Band width", value: formatPrice(width), tone: "neutral" },
      { label: "Position", value: close.at(-1)! > middle.at(-1)! ? "ABOVE BASIS" : "BELOW BASIS", tone: close.at(-1)! > middle.at(-1)! ? "positive" : "negative" },
    ],
  };
}

function momentumEffects(candles: Candle[], source: string): IndicatorVisualEffects {
  const close = candles.map((candle) => candle.close);
  const length = Math.round(inputNumber(source, "rsiLength", inputNumber(source, "length", 14, 2, 100), 2, 100));
  const values = rsi(close, length);
  const signal = ema(values, Math.max(3, Math.round(length / 2)));
  const markers: BklitPlotMarker[] = [];
  const zones: BklitPlotZone[] = [];
  const range = atr(candles, 14);

  for (let index = length + 1; index < candles.length; index += 1) {
    const leavesOversold = values[index - 1] <= 30 && values[index] > 30;
    const leavesOverbought = values[index - 1] >= 70 && values[index] < 70;
    if (!leavesOversold && !leavesOverbought) continue;
    const candle = candles[index];
    const buy = leavesOversold;
    markers.push({
      id: `visual-momentum-${candle.timestamp}`,
      time: candle.timestamp,
      price: buy ? candle.low : candle.high,
      side: buy ? "buy" : "sell",
      color: buy ? CASH_GREEN : RED,
      label: buy ? "MOMENTUM BUY" : "MOMENTUM SELL",
    });
    const padding = Math.max(range[index] * 0.2, candle.close * 0.0001);
    zones.push({
      id: `visual-momentum-zone-${candle.timestamp}`,
      startTime: candle.timestamp,
      endTime: candles[Math.min(candles.length - 1, index + 8)].timestamp,
      low: candle.low - padding,
      high: candle.high + padding,
      color: buy ? CASH_GREEN : RED,
      label: buy ? "OVERSOLD REVERSAL" : "OVERBOUGHT REVERSAL",
      opacity: 0.045,
    });
  }

  const last = values.at(-1) ?? 50;
  return {
    adapted: true,
    family: "momentum",
    fills: [],
    lines: [],
    markers: markers.slice(-16),
    panes: [{
      key: "visual-momentum",
      label: `RSI ${length}`,
      lines: [
        { id: "visual-rsi", color: VIOLET, data: points(candles, values) },
        { id: "visual-rsi-signal", color: CASH_GREEN, data: points(candles, signal) },
      ],
      guides: [
        { id: "visual-rsi-70", value: 70, color: RED },
        { id: "visual-rsi-50", value: 50, color: "#71717a" },
        { id: "visual-rsi-30", value: 30, color: CASH_GREEN },
      ],
    }],
    zones: zones.slice(-8),
    legend: [
      { title: `RSI ${length}`, color: VIOLET },
      { title: "RSI signal", color: CASH_GREEN },
    ],
    dashboard: [
      { label: "RSI", value: last.toFixed(1), tone: last > 70 ? "negative" : last < 30 ? "positive" : "neutral" },
      { label: "State", value: last > 70 ? "OVERBOUGHT" : last < 30 ? "OVERSOLD" : "NEUTRAL", tone: last > 70 ? "negative" : last < 30 ? "positive" : "neutral" },
      { label: "Last signal", value: markers.at(-1)?.label ?? "WAITING", tone: "neutral" },
    ],
  };
}

function structureEffects(candles: Candle[], source: string): IndicatorVisualEffects {
  const pivotLength = Math.round(inputNumber(source, "pivotLen", 5, 2, 24));
  const atrValues = atr(candles, 14);
  const highPivots = pivotIndexes(candles, pivotLength, "high");
  const lowPivots = pivotIndexes(candles, pivotLength, "low");
  const lines: BklitPlotLine[] = [];
  const markers: BklitPlotMarker[] = [];
  const zones: BklitPlotZone[] = [];

  const addStructure = (indexes: number[], side: "high" | "low") => {
    for (const pivotIndex of indexes.slice(-7)) {
      const pivot = candles[pivotIndex];
      const price = pivot[side];
      const breakIndex = candles.findIndex((candle, index) => (
        index > pivotIndex + pivotLength
        && (side === "high" ? candle.close > price : candle.close < price)
      ));
      const endIndex = breakIndex > pivotIndex ? breakIndex : candles.length - 1;
      const bullish = side === "high";
      const color = bullish ? CASH_GREEN : RED;
      lines.push({
        id: `visual-structure-${side}-${pivot.timestamp}`,
        color,
        dash: breakIndex > pivotIndex ? undefined : "4 4",
        width: breakIndex > pivotIndex ? 1.6 : 1,
        data: [
          { time: pivot.timestamp, value: price },
          { time: candles[endIndex].timestamp, value: price },
        ],
      });
      if (breakIndex <= pivotIndex) continue;
      const broken = candles[breakIndex];
      markers.push({
        // Several pivots can break on the same candle. Include the originating pivot so React
        // never receives duplicate keys when those structure signals share a timestamp.
        id: `visual-bos-${side}-${pivot.timestamp}-${broken.timestamp}`,
        time: broken.timestamp,
        price: bullish ? broken.low : broken.high,
        side: bullish ? "buy" : "sell",
        color,
        label: bullish ? "BOS ↑" : "BOS ↓",
      });
      const originIndex = Math.max(pivotIndex, breakIndex - 5);
      const candidates = candles.slice(originIndex, breakIndex);
      const localIndex = candidates.findLastIndex((candle) => (
        bullish ? candle.close < candle.open : candle.close > candle.open
      ));
      const orderBlockIndex = localIndex >= 0 ? originIndex + localIndex : pivotIndex;
      const orderBlock = candles[orderBlockIndex];
      const padding = Math.max(atrValues[orderBlockIndex] * 0.08, orderBlock.close * 0.00008);
      zones.push({
        id: `visual-order-block-${side}-${pivot.timestamp}-${orderBlock.timestamp}`,
        startTime: orderBlock.timestamp,
        endTime: candles[Math.min(candles.length - 1, breakIndex + 28)].timestamp,
        low: Math.min(orderBlock.open, orderBlock.close) - padding,
        high: Math.max(orderBlock.open, orderBlock.close) + padding,
        color,
        label: bullish ? "BULLISH ORDER BLOCK" : "BEARISH ORDER BLOCK",
        opacity: 0.065,
      });
    }
  };
  addStructure(highPivots, "high");
  addStructure(lowPivots, "low");

  const recentHighs = highPivots.slice(-2).map((index) => candles[index].high);
  const recentLows = lowPivots.slice(-2).map((index) => candles[index].low);
  const highState = recentHighs.length === 2 ? (recentHighs[1] > recentHighs[0] ? "HIGHER HIGH" : "LOWER HIGH") : "—";
  const lowState = recentLows.length === 2 ? (recentLows[1] > recentLows[0] ? "HIGHER LOW" : "LOWER LOW") : "—";
  const bullish = highState === "HIGHER HIGH" && lowState === "HIGHER LOW";
  const bearish = highState === "LOWER HIGH" && lowState === "LOWER LOW";
  return {
    adapted: true,
    family: "structure",
    fills: [],
    lines,
    markers: markers.slice(-18),
    panes: [],
    zones: zones.slice(-10),
    legend: [
      { title: "Bullish structure", color: CASH_GREEN },
      { title: "Bearish structure", color: RED },
      { title: "Order blocks", color: AMBER },
    ],
    dashboard: [
      { label: "Structure", value: bullish ? "BULLISH" : bearish ? "BEARISH" : "MIXED", tone: bullish ? "positive" : bearish ? "negative" : "neutral" },
      { label: "Swing high", value: highState, tone: highState === "HIGHER HIGH" ? "positive" : "negative" },
      { label: "Swing low", value: lowState, tone: lowState === "HIGHER LOW" ? "positive" : "negative" },
      { label: "Last break", value: markers.at(-1)?.label ?? "WAITING", tone: markers.at(-1)?.side === "buy" ? "positive" : markers.at(-1)?.side === "sell" ? "negative" : "neutral" },
    ],
  };
}

function liquidityEffects(candles: Candle[], source: string, family: "liquidity" | "structure"): IndicatorVisualEffects {
  const pivotLength = Math.round(inputNumber(source, "pivotLen", family === "liquidity" ? 8 : 5, 2, 30));
  const highPivots = pivotIndexes(candles, pivotLength, "high");
  const lowPivots = pivotIndexes(candles, pivotLength, "low");
  const lastTime = candles.at(-1)!.timestamp;
  const atrValues = atr(candles, 14);
  const lines: BklitPlotLine[] = [];
  const zones: BklitPlotZone[] = [];
  const markers: BklitPlotMarker[] = [];

  const addPools = (indexes: number[], side: "high" | "low") => {
    for (const [poolIndex, candleIndex] of indexes.slice(-8).entries()) {
      const pivot = candles[candleIndex];
      const price = pivot[side];
      const sweptAt = candles.findIndex((candle, index) => (
        index > candleIndex && (side === "high" ? candle.high > price : candle.low < price)
      ));
      const endIndex = sweptAt > candleIndex ? sweptAt : candles.length - 1;
      const color = side === "high" ? RED : SKY;
      lines.push({
        id: `visual-${side}-pool-${pivot.timestamp}-${poolIndex}`,
        color,
        dash: "2 4",
        width: 1,
        data: [
          { time: pivot.timestamp, value: price },
          { time: candles[endIndex].timestamp, value: price },
        ],
      });
      if (sweptAt > candleIndex) {
        const swept = candles[sweptAt];
        const rejected = side === "high" ? swept.close < price : swept.close > price;
        if (!rejected) continue;
        const padding = Math.max(atrValues[sweptAt] * 0.16, price * 0.00015);
        zones.push({
          id: `visual-zone-${side}-${swept.timestamp}`,
          startTime: pivot.timestamp,
          endTime: Math.min(lastTime, candles[Math.min(candles.length - 1, sweptAt + 32)].timestamp),
          low: side === "high" ? price - padding : swept.low,
          high: side === "high" ? swept.high : price + padding,
          color,
          label: side === "high" ? "BUY-SIDE LIQUIDITY" : "SELL-SIDE LIQUIDITY",
          opacity: 0.08,
        });
        markers.push({
          id: `visual-raid-${side}-${swept.timestamp}`,
          time: swept.timestamp,
          price: side === "high" ? swept.high : swept.low,
          side: side === "high" ? "sell" : "buy",
          color: side === "high" ? RED : SKY,
          label: side === "high" ? "RAID SELL" : "RAID BUY",
        });
      }
    }
  };
  addPools(highPivots, "high");
  addPools(lowPivots, "low");

  const above = highPivots.map((index) => candles[index].high).filter((price) => price > candles.at(-1)!.close).sort((a, b) => a - b)[0];
  const below = lowPivots.map((index) => candles[index].low).filter((price) => price < candles.at(-1)!.close).sort((a, b) => b - a)[0];
  return {
    adapted: true,
    family,
    fills: [],
    lines,
    markers: markers.slice(-18),
    panes: [],
    zones: zones.slice(-10),
    legend: [
      { title: "Liquidity above", color: RED },
      { title: "Liquidity below", color: SKY },
      { title: "Confirmed raids", color: CASH_GREEN },
    ],
    dashboard: [
      { label: "Pools above", value: String(Math.min(8, highPivots.length)), tone: "negative" },
      { label: "Pools below", value: String(Math.min(8, lowPivots.length)), tone: "positive" },
      { label: "Nearest above", value: above ? formatPrice(above) : "—", tone: "neutral" },
      { label: "Nearest below", value: below ? formatPrice(below) : "—", tone: "neutral" },
      { label: "Last raid", value: markers.at(-1)?.label ?? "NONE", tone: markers.at(-1)?.side === "buy" ? "positive" : markers.at(-1)?.side === "sell" ? "negative" : "neutral" },
    ],
  };
}

export function buildIndicatorVisualEffects({
  candles,
  source,
  title,
}: {
  candles: Candle[];
  source: string;
  title?: string;
}): IndicatorVisualEffects {
  if (candles.length < 12) {
    return { adapted: false, family: "generic", fills: [], lines: [], markers: [], panes: [], zones: [], legend: [], dashboard: [] };
  }
  const family = detectFamily(title ?? "", source);
  if (family === "liquidity") return liquidityEffects(candles, source, family);
  if (family === "structure") return structureEffects(candles, source);
  if (family === "volatility") return volatilityEffects(candles, source);
  if (family === "momentum") return momentumEffects(candles, source);
  return trendEffects(candles, source, family);
}
