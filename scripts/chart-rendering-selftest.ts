import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  aggregateChartCandles,
  appendLivePriceCandle,
  interpolateOneSecondCandles,
  mergeCanonicalCandles,
} from "../lib/trade/candleSeries";
import {
  candlesToCloseLinePoints,
  clipLineWindow,
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

const interpolated = interpolateOneSecondCandles([
  { time: 100, open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { time: 101, open: 100, high: 100, low: 100, close: 100, volume: 0 },
  { time: 102, open: 100, high: 100, low: 100, close: 100, volume: 0 },
  { time: 104, open: 104, high: 105, low: 103, close: 105, volume: 2 },
]);
assert.deepEqual(
  interpolated.map((candle) => candle.time),
  [100, 101, 102, 103, 104],
  "the 1s chart must contain one candle for every second",
);
for (let index = 1; index < interpolated.length; index += 1) {
  assert.equal(
    interpolated[index].open,
    interpolated[index - 1].close,
    "interpolated 1s candles must join without visual price gaps",
  );
}
assert.ok(
  interpolated[1].close !== interpolated[0].close,
  "placeholder seconds must bridge toward the next trade instead of staying flat",
);

const filledFlatRun = interpolateOneSecondCandles([
  { time: 200, open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { time: 204, open: 100, high: 100, low: 100, close: 100, volume: 1 },
]);
assert.deepEqual(
  filledFlatRun.map((candle) => candle.time),
  [200, 201, 202, 203, 204],
  "flat sparse runs must still contain one candle per second",
);
assert.ok(
  filledFlatRun.slice(1, -1).every((candle) => candle.open !== candle.close),
  "flat placeholder seconds must render candle bodies instead of a horizontal doji rail",
);
assert.equal(filledFlatRun[0].close, 100);
assert.equal(filledFlatRun.at(-1)?.open, 100, "the visual bridge must return to the real anchor price");
assert.ok(
  filledFlatRun.every((candle) => Math.abs(candle.close - 100) < 0.001),
  "flat interpolation must remain visually subtle and materially price-neutral",
);

const variedBridge = interpolateOneSecondCandles([
  { time: 300, open: 110, high: 110, low: 110, close: 110, volume: 1 },
  { time: 320, open: 100, high: 101, low: 99, close: 100, volume: 1 },
]);
const generatedBridge = variedBridge.slice(1, -1);
const directions = generatedBridge.map((candle) => Math.sign(candle.close - candle.open));
assert.ok(
  directions.some((direction) => direction > 0)
    && directions.some((direction) => direction < 0),
  "a long interpolated move must contain varied candles instead of a one-way box staircase",
);
assert.ok(
  generatedBridge.every((candle) => (
    candle.high > Math.max(candle.open, candle.close)
    && candle.low < Math.min(candle.open, candle.close)
  )),
  "interpolated candles must include upper and lower wicks",
);
assert.equal(variedBridge.at(-1)?.open, 100, "the varied bridge must preserve its real endpoint");

const fiveSecond = aggregateChartCandles(interpolated, 5);
assert.equal(fiveSecond.length, 1);
assert.equal(fiveSecond[0].open, 100);
assert.equal(fiveSecond[0].close, 105);

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
const lineChartSource = readFileSync("components/trade/BtcPerpsChart.tsx", "utf8");
assert.ok(!proChartSource.includes("lightweight-charts"), "the active candle chart must not use TradingView");
assert.ok(
  plotSource.includes("@/components/charts/bklit/candlestick"),
  "the active candle renderer must use the local bklit primitives",
);
assert.ok(
  plotSource.includes("minBodyHeight={intervalSeconds < 60 ? 1.5 : 1}"),
  "low-timeframe dojis must retain a visible candle body",
);
assert.ok(!lineChartSource.includes("fillLineWindowGaps"), "the broken line gap filler must stay removed");
assert.ok(
  proChartSource.includes('addEventListener("wheel", preventPageScroll, { passive: false })'),
  "candle zoom must lock page scrolling with a non-passive wheel listener",
);
assert.ok(
  lineChartSource.includes('addEventListener("wheel", preventPageScroll, { passive: false })'),
  "line zoom must lock page scrolling with a non-passive wheel listener",
);

console.log("chart rendering self-test: passed");
