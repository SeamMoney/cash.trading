/**
 * Trade attribution reader — reads on-chain TradeLog from indicator::get_trades()
 * and indicator::get_trade_stats().
 *
 * GET /api/launchpad/trades?addr=<indicator_addr>
 * Returns: { stats, trades[] } where trades include entry/exit prices, P&L, signal type
 */
import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";
const apiKey = process.env.GEOMI_API_KEY_TESTNET ?? process.env.APTOS_API_KEY_TESTNET;
const aptos = new Aptos(new AptosConfig({
  network: Network.TESTNET,
  ...(apiKey ? { clientConfig: { API_KEY: apiKey } } : {}),
}));

type ViewFn = `${string}::${string}::${string}`;

async function safeView(fn: ViewFn, args: string[]) {
  return aptos.view({ payload: { function: fn, functionArguments: args } });
}

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-trades", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const url = new URL(req.url);
  const addr = url.searchParams.get("addr");

  if (!isValidAptosAddress(addr)) {
    return NextResponse.json(
      { error: "a valid addr is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const indicatorAddress = normalizeAptosAddress(addr, "addr");

  try {
    const [statsResult, tradesResult] = await Promise.all([
      safeView(`${CONTRACT}::indicator::get_trade_stats` as ViewFn, [indicatorAddress]),
      safeView(`${CONTRACT}::indicator::get_trades` as ViewFn, [indicatorAddress]),
    ]);

    // get_trade_stats returns (total_trades, win_trades, loss_trades, total_gain_bps, total_loss_bps)
    const [totalTrades, winTrades, lossTrades, totalGainBps, totalLossBps] = statsResult as [
      string, string, string, string, string
    ];

    // get_trades returns 6 parallel vectors:
    // (ids, signals, prices, gains_bps, losses_bps, timestamps)
    const [ids, signals, prices, gainsBps, lossesBps, timestamps] = tradesResult as [
      string[], number[], string[], string[], string[], string[]
    ];

    const trades = ids.map((id, i) => ({
      tradeId: Number(id),
      signal: Number(signals[i]),        // 1=BUY entry, 2=SELL exit
      price: Number(prices[i]) / 1e8,    // USD
      gainBps: Number(gainsBps[i]),
      lossBps: Number(lossesBps[i]),
      timestamp: Number(timestamps[i]),
      // Derived fields for UI
      type: Number(signals[i]) === 1 ? "BUY" : "SELL",
      pnlBps: Number(signals[i]) === 1
        ? 0                              // entries have no P&L yet
        : Number(gainsBps[i]) > 0
          ? Number(gainsBps[i])          // positive for gains
          : -Number(lossesBps[i]),       // negative for losses
    }));

    // Pair BUY entries with subsequent SELL exits for display
    const pairs: Array<{
      entryTrade: typeof trades[0];
      exitTrade: typeof trades[0] | null;
      pnlBps: number;
      pnlPct: number;
    }> = [];

    let i = 0;
    while (i < trades.length) {
      if (trades[i].signal === 1) {
        // BUY entry
        const entry = trades[i];
        const exit = trades[i + 1]?.signal === 2 ? trades[i + 1] : null;
        pairs.push({
          entryTrade: entry,
          exitTrade: exit,
          pnlBps: exit?.pnlBps ?? 0,
          pnlPct: exit ? (exit.pnlBps / 100) : 0,
        });
        i += exit ? 2 : 1;
      } else {
        // Orphan SELL (e.g., migrated indicator where entry wasn't tracked)
        i++;
      }
    }

    const winRate = Number(totalTrades) > 0
      ? Math.round((Number(winTrades) / Number(totalTrades)) * 100)
      : 0;

    const avgGainBps = Number(winTrades) > 0
      ? Math.round(Number(totalGainBps) / Number(winTrades))
      : 0;

    const avgLossBps = Number(lossTrades) > 0
      ? Math.round(Number(totalLossBps) / Number(lossTrades))
      : 0;

    return NextResponse.json({
      indicatorAddr: indicatorAddress,
      stats: {
        totalTrades: Number(totalTrades),
        winTrades: Number(winTrades),
        lossTrades: Number(lossTrades),
        totalGainBps: Number(totalGainBps),
        totalLossBps: Number(totalLossBps),
        winRate,
        avgGainBps,
        avgLossBps,
        netPnlBps: Number(totalGainBps) - Number(totalLossBps),
      },
      trades,
      pairs,
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trade history lookup failed";
    console.warn("[launchpad-trades] lookup failed:", message);
    return NextResponse.json(
      { onChain: false, trades: [], pairs: [] },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }
}
