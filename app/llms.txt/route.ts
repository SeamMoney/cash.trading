import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 3600;

/**
 * Machine-readable API reference for LLM agents (the llms.txt convention).
 * READ-ONLY data endpoints only — transaction-submitting routes are
 * intentionally undocumented here.
 */
const LLMS_TXT = `# cash.trading Data API

> Read-only market and vault data for Decibel, the perps DEX on Aptos.
> Built for LLM agents: no authentication, JSON responses, honest errors.
> Base URL: https://cash.trading

## Conventions

- All endpoints are GET. Live account/market reads use Cache-Control: no-store;
  shared discovery responses may use short CDN caches and stale-while-revalidate.
- \`market\` parameters accept a market name (e.g. \`BTC/USD\`) or a 0x market
  object address. Names are resolved server-side.
- When upstream data is unavailable the non-2xx response carries
  \`{"unavailable": true, "reason": "..."}\` instead of fabricated values.
  \`null\` fields mean "not available", never zero.
- Rate limits are per-IP per-route (HTTP 429 with \`retryAfterS\` when
  exceeded): candlesticks/funding 60/min, vault-history 30/min.
- Timestamps are unix milliseconds unless noted.

## Endpoints

### GET /api/decibel/markets?network=mainnet
All listed perp markets with config, prices, and 24h stats.
Returns: { network, markets: [{ name, address, markPrice, midPrice,
oraclePrice, fundingRateBps, isFundingPositive, openInterest, maxLeverage,
tickSize, minSize, lotSize, mode, szDecimals, pxDecimals,
volume24h /* base units */, volume24hUsd, change24hPct /* percent */ }] }
Note: production defaults to mainnet; pass ?network explicitly in integrations.

### GET /api/decibel/candlesticks?market=BTC/USD&interval=5m&bars=300
OHLCV candles. Intervals: 1m 5m 15m 30m 1h 2h 4h 8h 12h 1d 3d 1w 1mo.
Optional startTime/endTime (unix ms); bars defaults 300, max 1500.
Returns: { market, interval, candles: [{ t, T, o, h, l, c, v, i }], fetchedAt }
(t/T = open/close time unix ms; v = volume in base units.)

### GET /api/decibel/funding?market=BTC/USD
Live funding and prices for one market.
Returns: { market, fundingRateBps /* signed; negative = shorts pay */,
fundingPeriodS, markPx, oraclePx, midPx, openInterest /* base units */,
asOf, fetchedAt }

### GET /api/decibel/vault-history?vault=0x...&range=30d&type=pnl
Historical PnL or account-value series for a Decibel vault.
Ranges: 7d, 30d, all. Types: pnl, account_value.
Returns: { vault, range, type, subaccounts, points: [{ t, v }], fetchedAt }

### GET /api/decibel/vaults
All active Decibel vaults with TVL, returns, and risk stats.
Returns: { vaults: [{ address, name, manager, tvl, volume, all_time_pnl,
all_time_return, apr, sharpe_ratio, max_drawdown, depositors, ... }], fetchedAt }

### GET /api/decibel/depth?market=BTC/USD&network=mainnet
Current order book depth for one market.

## Example: latest BTC candles (curl)

curl "https://cash.trading/api/decibel/candlesticks?market=BTC/USD&interval=1h&bars=24"

## What this API is

cash.trading deploys PineScript strategies as trustless on-chain trading
vaults on Decibel (Aptos). This data API exposes the market/vault reads the
app itself runs on. Strategy deployment and trading endpoints are not part
of this public surface.
`;

export async function GET() {
  return new NextResponse(LLMS_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
