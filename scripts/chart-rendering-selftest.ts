import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  appendLivePriceCandle,
  chartPriceTicksToCandles,
  mergeChartPriceTicks,
  mergeCanonicalCandles,
} from "../lib/trade/candleSeries";
import {
  candlesToCloseLinePoints,
  clipLineWindow,
  sampleLatestPointPerSecond,
} from "../lib/trade/lineData";

const sparseLine = candlesToCloseLinePoints([
  { time: 1_000, open: 100, high: 102, low: 99, close: 101 },
  { time: 1_600, open: 110, high: 112, low: 109, close: 111 },
], 60);
assert.equal(sparseLine.length, 3, "minute history must not fabricate intrabar pivots");
assert.equal(sparseLine[1].time, 1_057.6, "a close stays inside its observed minute");
assert.ok(
  sparseLine.every((point) => point.time < 1_100 || point.time > 1_590),
  "a real outage must not become a flat hold followed by a vertical wall",
);
assert.deepEqual(
  clipLineWindow([], 1_000, 2_000),
  [],
  "an empty line window must remain empty instead of inventing boundary prices",
);
assert.deepEqual(
  sampleLatestPointPerSecond([
    { time: 101.1, value: 100 },
    { time: 101.8, value: 102 },
    { time: 100.9, value: 99 },
    { time: 102.2, value: 101 },
  ]),
  [
    { time: 100.9, value: 99 },
    { time: 101.8, value: 102 },
    { time: 102.2, value: 101 },
  ],
  "the one-minute view must retain one real latest observation per second",
);

const mergedTicks = mergeChartPriceTicks(
  [
    { time: 101.2, value: 100 },
    { time: 100.1, value: 99 },
  ],
  [
    { time: 101.2, value: 101 },
    { time: 102.4, value: 98 },
  ],
);
assert.deepEqual(
  mergedTicks,
  [
    { time: 100.1, value: 99, volume: 0 },
    { time: 101.2, value: 101, volume: 0 },
    { time: 102.4, value: 98, volume: 0 },
  ],
  "exchange ticks must be chronological and same-millisecond updates must replace, not duplicate",
);

const stableTradeIdentity = mergeChartPriceTicks(
  [{ time: 101.2, value: 100, volume: 2, sequence: 0, identity: "fill-1" }],
  [{ time: 101.2, value: 100, volume: 1, sequence: 4, identity: "fill-1" }],
);
assert.deepEqual(stableTradeIdentity, [
  { time: 101.2, value: 100, volume: 2, sequence: 4, identity: "fill-1" },
], "a repeated maker/taker fill must retain one stable trade and must not double-count volume");

const observedCandles = chartPriceTicksToCandles([
  { time: 100.1, value: 100, volume: 1 },
  { time: 100.4, value: 102, volume: 2 },
  { time: 100.9, value: 101 },
  { time: 102.2, value: 99, volume: 3 },
], 1);
assert.deepEqual(
  observedCandles.map((candle) => candle.time),
  [100, 102],
  "a missing exchange second must remain missing instead of becoming a fabricated candle",
);
assert.deepEqual(observedCandles[0], {
  time: 100,
  open: 100,
  high: 102,
  low: 100,
  close: 101,
  volume: 3,
});

const sameMillisecondSweep = chartPriceTicksToCandles(mergeChartPriceTicks([], [
  { time: 200.25, value: 100, volume: 1, sequence: 0 },
  { time: 200.25, value: 104, volume: 2, sequence: 1 },
  { time: 200.25, value: 98, volume: 3, sequence: 2 },
]), 1);
assert.deepEqual(sameMillisecondSweep[0], {
  time: 200,
  open: 100,
  high: 104,
  low: 98,
  close: 98,
  volume: 6,
}, "a same-transaction fill sweep must retain every price for honest candle OHLC");

const fiveSecond = chartPriceTicksToCandles([
  { time: 100.1, value: 100 },
  { time: 100.4, value: 102 },
  { time: 102.2, value: 99 },
], 5);
assert.deepEqual(fiveSecond, [{
  time: 100,
  open: 100,
  high: 102,
  low: 99,
  close: 99,
  volume: 0,
}]);

const merged = mergeCanonicalCandles(
  [{ time: 120, open: 100, high: 102, low: 99, close: 101, volume: 8 }],
  [{ time: 120, open: 100, high: 103, low: 98, close: 102, volume: 3 }],
  60,
);
assert.equal(merged[0].high, 103);
assert.equal(merged[0].low, 98);
assert.equal(merged[0].close, 102);
assert.equal(merged[0].volume, 8, "REST and live volume must not be double-counted");

const afterOutage = appendLivePriceCandle(
  [{ time: 100, open: 100, high: 100, low: 100, close: 100 }],
  110,
  110,
  1,
);
assert.equal(afterOutage.at(-1)?.open, 110, "a new live bar must not bridge an unobserved outage");

const proChartSource = readFileSync("components/trade/ProCandleChart.tsx", "utf8");
const plotSource = readFileSync("components/trade/BklitCandlePlot.tsx", "utf8");
const chartShellSource = readFileSync("components/trade/BTCChart.tsx", "utf8");
const lineChartSource = readFileSync("components/trade/BtcPerpsChart.tsx", "utf8");
const launchpadChartSource = readFileSync("components/launchpad/OnChainChart.tsx", "utf8");
const pinePreviewSource = readFileSync("components/launchpad/PineVisualPreview.tsx", "utf8");
const equityCurveSource = readFileSync("components/launchpad/EquityCurveChart.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const fallbackCandleSource = readFileSync("hooks/useBtcCandles.ts", "utf8");
const candleSeriesSource = readFileSync("lib/trade/candleSeries.ts", "utf8");
assert.ok(!proChartSource.includes("lightweight-charts"), "the active candle chart must not use TradingView");
assert.ok(
  plotSource.includes("@/components/charts/bklit/candlestick"),
  "the active candle renderer must use the local bklit primitives",
);
assert.ok(!launchpadChartSource.includes("lightweight-charts"), "the launchpad candle chart must not use TradingView");
assert.ok(
  launchpadChartSource.includes("@/components/trade/BklitCandlePlot"),
  "the launchpad candle chart must share the local bklit renderer",
);
assert.ok(!pinePreviewSource.includes("lightweight-charts"), "the Pine preview must not use TradingView");
assert.ok(
  pinePreviewSource.includes("@/components/trade/BklitCandlePlot"),
  "the Pine preview candles must share the local bklit renderer",
);
assert.ok(!equityCurveSource.includes("lightweight-charts"), "the equity curve must not use TradingView");
assert.ok(!packageSource.includes('"lightweight-charts"'), "TradingView must not remain an installed dependency");
assert.ok(!fallbackCandleSource.includes("generateBackfillTicks"), "fallback lines must not invent price history");
assert.ok(!fallbackCandleSource.includes("ensureBody"), "fallback candles must not mutate real OHLC values for appearance");
assert.ok(!fallbackCandleSource.includes("isOutlier"), "fallback candles must not silently discard observed volatility");
assert.ok(
  chartShellSource.includes("usePriceCandles(\n    marketConfig.id"),
  "the classic fallback must request the selected asset instead of hard-coding BTC",
);
assert.ok(
  !plotSource.includes("minBodyHeight="),
  "real dojis must not be inflated into artificial box bodies",
);
assert.ok(!candleSeriesSource.includes("INTERPOLATION_PHASE_STEP"), "synthetic candle noise must stay removed");
assert.ok(!proChartSource.includes("interpolateOneSecondCandles"), "candle history must use observed ticks only");
assert.ok(!lineChartSource.includes("lineMode="), "the line renderer must not receive candle-morph props");
assert.ok(
  lineChartSource.includes("decibelMarkTicks") && lineChartSource.includes("decibelTradeTicks"),
  "the chart must isolate live mark updates from trade history instead of interleaving price bases",
);
assert.ok(
  lineChartSource.includes("secondCandles={observedTradeSecondCandles}"),
  "the candle renderer must build OHLC from observed Decibel fills, not mark-price line ticks",
);
assert.ok(
  lineChartSource.includes('if (windowSecs <= MIN_LINE_WINDOW_SECS) return "1s";'),
  "only the one-minute line may use Decibel's short raw-tick history",
);
assert.ok(
  lineChartSource.includes("longer windows use real minute closes plus the latest live mark"),
  "longer line windows must not mix a dense raw-tick tail into sparse minute history",
);
assert.ok(
  lineChartSource.includes("lineEndTime == null || lineResolvedEndTime == null"),
  "the live line must not re-anchor its timestamps and jump backward on each new tick",
);
assert.ok(
  lineChartSource.includes("transaction_unix_ms / 1_000"),
  "the realtime chart must retain Decibel's exchange timestamps",
);
assert.ok(!lineChartSource.includes("fillLineWindowGaps"), "the broken line gap filler must stay removed");
assert.ok(
  !chartShellSource.includes('return "0.0010%"')
    && !chartShellSource.includes('?? "-3.41%"')
    && !chartShellSource.includes('?? "$1.46M"'),
  "missing market stats must render unavailable instead of fabricated defaults",
);
assert.ok(
  !lineChartSource.includes("* 1.0004") && !chartShellSource.includes("* 1.0004"),
  "the chart must not invent an oracle price by offsetting the mark price",
);
assert.ok(
  proChartSource.includes('addEventListener("wheel", preventPageScroll, { passive: false })'),
  "candle zoom must lock page scrolling with a non-passive wheel listener",
);
assert.ok(
  lineChartSource.includes('addEventListener("wheel", preventPageScroll, { passive: false })'),
  "line zoom must lock page scrolling with a non-passive wheel listener",
);

console.log("chart rendering self-test: passed");
