import candleFixture from "../../examples/pine-solana/candles.json";
import type { Bar, Evaluation, OrderIntent, ProgramIR } from "./ir";
import { createPineRuntime } from "./runtime";

/** UI fixtures are synthetic sample data, not exchange prices or backtest results. */
export const DEMO_CANDLES: readonly Readonly<Bar>[] = Object.freeze(
  candleFixture.map((bar) => Object.freeze({ ...bar })),
);

export type StudioTimeframe = 1 | 5 | 15;
export type StudioExampleId = "ema" | "rsi" | "macd";

export interface StudioDisplaySeries {
  readonly name: string;
  readonly output: string;
  readonly color: string;
  readonly pane: "price" | "oscillator";
  readonly style: "line" | "histogram";
}

export interface StudioExample {
  readonly id: StudioExampleId;
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly displaySeries: readonly StudioDisplaySeries[];
}

// These sources deliberately match the checked-in examples. Tests guard drift.
const examples: StudioExample[] = [
  {
    id: "ema",
    name: "EMA crossover",
    description: "9 / 21 moving averages",
    source: `//@version=6
strategy("EMA crossover — Solana", overlay=true, default_qty_type=strategy.fixed, default_qty_value=1)
fastLength = input.int(9, "Fast", minval=1, maxval=128)
slowLength = input.int(21, "Slow", minval=1, maxval=128)
fast = ta.ema(close, fastLength)
slow = ta.ema(close, slowLength)
longSignal = ta.crossover(fast, slow)
shortSignal = ta.crossunder(fast, slow)
if longSignal
    strategy.entry("Long", strategy.long)
if shortSignal
    strategy.entry("Short", strategy.short)
plot(fast, "Fast EMA", color=color.aqua)
plot(slow, "Slow EMA", color=color.orange)
`,
    displaySeries: [
      { name: "Fast EMA", output: "fast", color: "#ff703f", pane: "price", style: "line" },
      { name: "Slow EMA", output: "slow", color: "#aca8c8", pane: "price", style: "line" },
    ],
  },
  {
    id: "rsi",
    name: "RSI signals",
    description: "14 periods · 30 / 70 levels",
    source: `//@version=6
strategy("RSI signals — Solana", default_qty_value=1)
length = input.int(14, "RSI length", minval=1, maxval=128)
rsiValue = ta.rsi(close, length)
longSignal = ta.crossover(rsiValue, 30)
shortSignal = ta.crossunder(rsiValue, 70)
if longSignal
    strategy.entry("Long", strategy.long)
if shortSignal
    strategy.entry("Short", strategy.short)
plot(rsiValue, "RSI")
`,
    displaySeries: [
      { name: "RSI", output: "rsiValue", color: "#c3acdf", pane: "oscillator", style: "line" },
    ],
  },
  {
    id: "macd",
    name: "MACD momentum",
    description: "12 / 26 / 9 momentum signals",
    source: `//@version=6
strategy("MACD signals — Solana")
[macdLine, signalLine, histogram] = ta.macd(close, 12, 26, 9)
goLong = ta.crossover(macdLine, signalLine)
goShort = ta.crossunder(macdLine, signalLine)
if goLong
    strategy.entry("Long", strategy.long)
if goShort
    strategy.entry("Short", strategy.short)
plot(histogram, "Histogram")
`,
    displaySeries: [
      { name: "Histogram", output: "histogram", color: "#8bc4b3", pane: "oscillator", style: "histogram" },
    ],
  },
];

export const STUDIO_EXAMPLES: readonly StudioExample[] = Object.freeze(
  examples.map((example) => Object.freeze({
    ...example,
    displaySeries: Object.freeze(example.displaySeries.map((series) => Object.freeze({ ...series }))),
  })),
);

const MINUTE_MS = 60_000;

/**
 * Aggregate consecutive one-minute sample candles. Windows are relative to the
 * first sample, matching the adapter's configurable origin, not an exchange
 * session. Incomplete final windows are omitted: they are not confirmed bars.
 * Gaps are rejected rather than silently filled or merged across.
 */
export function aggregateCandles(
  bars: readonly Readonly<Bar>[],
  timeframeMinutes: StudioTimeframe,
): Bar[] {
  if (![1, 5, 15].includes(timeframeMinutes)) {
    throw new RangeError("Preview timeframe must be 1, 5, or 15 minutes");
  }
  bars.forEach((bar, index) => {
    if (!bar || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      || !Number.isSafeInteger(bar.time) || bar.time < 0
      || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)
      || bar.high < bar.low || bar.volume < 0) {
      throw new Error(`Invalid sample candle at index ${index}`);
    }
    if (index > 0 && bar.time - bars[index - 1].time !== MINUTE_MS) {
      throw new Error("Sample candles must be consecutive one-minute intervals");
    }
  });

  const aggregated: Bar[] = [];
  for (let start = 0; start + timeframeMinutes <= bars.length; start += timeframeMinutes) {
    const result: Bar = { ...bars[start] };
    for (let offset = 1; offset < timeframeMinutes; offset++) {
      const bar = bars[start + offset];
      result.high = Math.max(result.high, bar.high);
      result.low = Math.min(result.low, bar.low);
      result.close = bar.close;
      result.volume += bar.volume;
    }
    if (!Number.isFinite(result.volume)) throw new Error("Sample volume aggregation overflow");
    aggregated.push(result);
  }
  return aggregated;
}

export interface StudioReplaySeries {
  name: string;
  output: string;
  nodeIndex: number;
  values: Array<number | null>;
}

export interface StudioReplay {
  bars: Bar[];
  evaluations: Evaluation[];
  intents: OrderIntent[];
  /** Numeric plots explicitly present in the compiled source; never inferred trading rules. */
  series: StudioReplaySeries[];
  latest: Evaluation | null;
}

/** A fresh local replay on exactly the supplied history; intents are not fills or P&L. */
export function replayCompiled(ir: ProgramIR, bars: readonly Readonly<Bar>[]): StudioReplay {
  const runtime = createPineRuntime(ir);
  const candles = bars.map((bar) => ({ ...bar }));
  const evaluations = candles.map((bar) => runtime.push(bar));
  const namedOutputs = Object.entries(ir.outputs);
  const visitedNodes = new Set<number>();
  const series: StudioReplaySeries[] = [];

  for (const [key, nodeIndex] of namedOutputs) {
    if (!/^plot_\d+$/.test(key) || visitedNodes.has(nodeIndex) || ir.nodes[nodeIndex]?.type !== "number") continue;
    visitedNodes.add(nodeIndex);
    const alias = namedOutputs.find(([name, node]) => node === nodeIndex && !/^plot_\d+$/.test(name));
    const output = alias?.[0] ?? key;
    series.push({
      name: alias?.[0] ?? `Plot ${series.length + 1}`,
      output,
      nodeIndex,
      values: evaluations.map((evaluation) => evaluation.values[nodeIndex]),
    });
  }

  return {
    bars: candles,
    evaluations,
    intents: evaluations.flatMap((evaluation) => evaluation.intents),
    series,
    latest: evaluations.at(-1) ?? null,
  };
}

const UTF8_FLAG = 0x0800;
const DOS_DATE_1980_01_01 = 0x0021;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Produce a deterministic, standards-compliant stored ZIP entirely in-browser.
 * UTF-8 file names/content, checksums and central-directory offsets are retained.
 * This packages generated source only; it never creates a deployable binary.
 */
export function packageProject(files: Readonly<Record<string, string>>) {
  const entries = Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (!entries.length || entries.length > 65_535) throw new Error("Project must contain between 1 and 65535 files");
  let archiveSize = 22;
  const encoded = entries.map(([path, source]) => {
    if (!path || path.includes("\\") || path.includes("\0") || path.includes(":")
      || path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Unsafe project path: ${path}`);
    }
    if (typeof source !== "string") throw new TypeError(`Project file must contain text: ${path}`);
    if (source.length > MAX_ARCHIVE_BYTES || path.length > 65_535) throw new Error("Project archive is too large");
    const name = encoder.encode(path), data = encoder.encode(source);
    if (name.length > 65_535) throw new Error("Project file name is too long");
    archiveSize += 30 + name.length + data.length + 46 + name.length;
    if (archiveSize > MAX_ARCHIVE_BYTES) throw new Error("Project archive exceeds 16 MiB");
    return { name, data, crc: crc32(data), offset: 0 };
  });

  const bytes = new Uint8Array(archiveSize);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const file of encoded) {
    file.offset = offset;
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, UTF8_FLAG, true);
    view.setUint16(offset + 12, DOS_DATE_1980_01_01, true);
    view.setUint32(offset + 14, file.crc, true);
    view.setUint32(offset + 18, file.data.length, true);
    view.setUint32(offset + 22, file.data.length, true);
    view.setUint16(offset + 26, file.name.length, true);
    bytes.set(file.name, offset + 30);
    bytes.set(file.data, offset + 30 + file.name.length);
    offset += 30 + file.name.length + file.data.length;
  }

  const centralStart = offset;
  for (const file of encoded) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, UTF8_FLAG, true);
    view.setUint16(offset + 14, DOS_DATE_1980_01_01, true);
    view.setUint32(offset + 16, file.crc, true);
    view.setUint32(offset + 20, file.data.length, true);
    view.setUint32(offset + 24, file.data.length, true);
    view.setUint16(offset + 28, file.name.length, true);
    view.setUint32(offset + 42, file.offset, true);
    bytes.set(file.name, offset + 46);
    offset += 46 + file.name.length;
  }
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, encoded.length, true);
  view.setUint16(offset + 10, encoded.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  return bytes;
}
