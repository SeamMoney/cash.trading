import assert from "node:assert/strict";

import { tokenizePineLine } from "../lib/launchpad/pine-highlight";
import { buildIndicatorVisualEffects } from "../lib/launchpad/indicator-effects";
import { parsePine } from "../lib/launchpad/pine-parser";
import { executeRuntime } from "../lib/launchpad/pine-runtime";
import { parseTradingViewPopularPage } from "../lib/launchpad/tradingview-popular";
import { getPineSourceStats } from "../lib/launchpad/tradingview-source";

const cards = parseTradingViewPopularPage(`
  <article>
    <a href="https://www.tradingview.com/script/7J5v2QPQ-Liquidity-Reaper-JOAT/" data-qa-id="ui-lib-card-link-title">Liquidity Reaper [JOAT]</a>
    <a data-qa-id="ui-lib-card-link-paragraph"><span>Liquidity &amp; sweep detection.</span></a>
    <div class="corner-top-right"><span class="content-card">Indicator</span></div>
    <source srcSet="https://s3.tradingview.com/7/7J5v2QPQ_mid.webp?v=1" type="image/webp" />
    <address data-qa-id="ui-lib-card-link-author"><a href="/u/officialjackofalltrades/"><span>by officialjackofalltrades</span></a></address>
    <time dateTime="2026-08-05T14:14:52.000Z"></time>
    <span aria-label="2 comments"></span>
    <span aria-label="701 boosts"></span>
  </article>
`);

assert.equal(cards.length, 1);
assert.equal(cards[0].title, "Liquidity Reaper [JOAT]");
assert.equal(cards[0].description, "Liquidity & sweep detection.");
assert.equal(cards[0].author, "officialjackofalltrades");
assert.equal(cards[0].scriptType, "Indicator");
assert.equal(cards[0].comments, 2);
assert.equal(cards[0].boosts, 701);
assert.ok(cards[0].imageUrl?.startsWith("https://s3.tradingview.com/"));

const highlighted = tokenizePineLine("float atr = ta.atr(14) // volatility");
assert.deepEqual(
  highlighted.filter((token) => token.kind !== "plain").map((token) => [token.kind, token.text]),
  [
    ["type", "float"],
    ["operator", "="],
    ["builtin", "ta"],
    ["function", "atr"],
    ["number", "14"],
    ["comment", "// volatility"],
  ],
);
assert.deepEqual(getPineSourceStats("//@version=6\nindicator('Complete')"), {
  lineCount: 2,
  characterCount: 34,
});

const ast = parsePine(`
//@version=6
indicator("Log test")
log.info("close={0}", close)
log.warning("bar active")
log.error("bad={0}", str.tostring(close))
plot(close)
`);
const runtime = executeRuntime(ast, [
  { timestamp: 1, open: 10, high: 11, low: 9, close: 10, volume: 2 },
  { timestamp: 2, open: 11, high: 12, low: 10, close: 11, volume: 3 },
]);

assert.deepEqual(
  runtime.logs.map((entry) => [entry.level, entry.message]),
  [
    ["info", "close=10"],
    ["warning", "bar active"],
    ["error", "bad=10"],
    ["info", "close=11"],
    ["warning", "bar active"],
    ["error", "bad=11"],
  ],
);

const visualCandles = Array.from({ length: 120 }, (_, index) => {
  const drift = index * 0.18;
  const wave = Math.sin(index / 5) * 7 + Math.sin(index / 13) * 4;
  const close = 100 + drift + wave;
  const open = close - Math.sin(index / 3) * 1.8;
  return {
    timestamp: 1_700_000_000 + index * 3_600,
    open,
    high: Math.max(open, close) + 1.5 + (index % 7 === 0 ? 3 : 0),
    low: Math.min(open, close) - 1.5 - (index % 11 === 0 ? 3 : 0),
    close,
    volume: 100 + (index % 17) * 25,
  };
});

for (const [title, expectedFamily] of [
  ["Liquidity Reaper", "liquidity"],
  ["Institutional SMC Structure", "structure"],
  ["Advanced Bollinger Bands", "volatility"],
  ["RSI Momentum Suite", "momentum"],
  ["Strong Daily Candle", "generic"],
] as const) {
  const effects = buildIndicatorVisualEffects({
    candles: visualCandles,
    source: `//@version=6\nindicator('${title}', overlay=true)`,
    title,
  });
  const visibleLayers = effects.lines.length + effects.fills.length + effects.markers.length
    + effects.zones.length + effects.panes.length;
  assert.equal(effects.family, expectedFamily, `${title} must select the correct visual adapter`);
  assert.ok(visibleLayers > 0, `${title} must produce at least one visible chart effect`);
}

console.log("pine marketplace self-test passed");
