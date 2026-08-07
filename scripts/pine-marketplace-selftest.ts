import assert from "node:assert/strict";

import { tokenizePineLine } from "../lib/launchpad/pine-highlight";
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

console.log("pine marketplace self-test passed");
