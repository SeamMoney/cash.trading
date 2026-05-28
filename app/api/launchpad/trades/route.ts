/**
 * Trade attribution reader — reads on-chain TradeLog from indicator::get_trades()
 * and indicator::get_trade_stats().
 *
 * GET /api/launchpad/trades?addr=<indicator_addr>
 * Returns: { stats, trades[] } where trades include entry/exit prices, P&L, signal type
 */
import { NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

export const runtime = "nodejs";

const CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

type ViewFn = `${string}::${string}::${string}`;

async function safeView(fn: ViewFn, args: string[]) {
  return aptos.view({ payload: { function: fn, functionArguments: args } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const addr = url.searchParams.get("addr");

  if (!addr) return NextResponse.json({ error: "addr required" }, { status: 400 });

  try {
    const [statsResult, tradesResult] = await Promise.all([
      safeView(`${CONTRACT}::indicator::get_trade_stats` as ViewFn, [addr]),
      safeView(`${CONTRACT}::indicator::get_trades` as ViewFn, [addr]),
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
      indicatorAddr: addr,
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
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), onChain: false }, { status: 200 });
  }
}
