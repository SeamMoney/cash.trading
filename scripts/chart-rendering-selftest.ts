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
  interpolated[1].close > interpolated[0].close
    && interpolated[2].close > interpolated[1].close,
  "placeholder seconds must bridge toward the next trade instead of forming a staircase",
);

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
