/**
 * Trade attribution reader — reads on-chain TradeLog from indicator::get_trades()
 * and indicator::get_trade_stats().
 *
 * GET /api/launchpad/trades?addr=<indicator_addr>[&pkg=<package_addr>]
 * Returns: { stats, trades[] } where trades include entry/exit prices, P&L, signal type
 */
import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";
import {
  pairOnChainTrades,
  parseOnChainTradeVectors,
  parseSafeUnsigned,
} from "@/lib/launchpad/move-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const VIEW_TIMEOUT_MS = 5_000;

const CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";
const apiKey = process.env.GEOMI_API_KEY_TESTNET ?? process.env.APTOS_API_KEY_TESTNET;
const aptos = new Aptos(new AptosConfig({
  network: Network.TESTNET,
  ...(apiKey ? { clientConfig: { API_KEY: apiKey } } : {}),
}));

type ViewFn = `${string}::${string}::${string}`;

async function safeView(fn: ViewFn, args: string[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      aptos.view({ payload: { function: fn, functionArguments: args } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Aptos trade lookup timed out")), VIEW_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isMissingIndicator(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  const message = error instanceof Error ? error.message : String(error);
  return status === 404 || /not found|resource_not_found|does not exist|failed to borrow global resource/i.test(message);
}

function isUnsupportedTradeHistory(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not find view function|function_not_found|get_trade_(stats|trades).*not found/i.test(message);
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
  const pkgParam = url.searchParams.get("pkg");

  if (!isValidAptosAddress(addr) || (pkgParam !== null && !isValidAptosAddress(pkgParam))) {
    return NextResponse.json(
      { error: "a valid addr and pkg are required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const indicatorAddress = normalizeAptosAddress(addr, "addr");
  const contractAt = pkgParam ? normalizeAptosAddress(pkgParam, "pkg") : CONTRACT;

  try {
    const [statsResult, tradesResult] = await Promise.all([
      safeView(`${contractAt}::indicator::get_trade_stats` as ViewFn, [indicatorAddress]),
      safeView(`${contractAt}::indicator::get_trades` as ViewFn, [indicatorAddress]),
    ]);

    // get_trade_stats returns (total_trades, win_trades, loss_trades, total_gain_bps, total_loss_bps)
    if (!Array.isArray(statsResult) || statsResult.length !== 5) {
      throw new Error("get_trade_stats returned an unexpected tuple");
    }
    const totalTrades = parseSafeUnsigned(statsResult[0], "total trades");
    const winTrades = parseSafeUnsigned(statsResult[1], "win trades");
    const lossTrades = parseSafeUnsigned(statsResult[2], "loss trades");
    const totalGainBps = parseSafeUnsigned(statsResult[3], "total gain bps");
    const totalLossBps = parseSafeUnsigned(statsResult[4], "total loss bps");

    // Aptos serializes vector<u8> as a single 0x-prefixed byte string. Decode
    // it before aligning it with the five ordinary vectors.
    const trades = parseOnChainTradeVectors(tradesResult);
    const pairs = pairOnChainTrades(trades);
    const completedTrades = winTrades + lossTrades;

    const winRate = completedTrades > 0
      ? Math.round((winTrades / completedTrades) * 100)
      : 0;

    const avgGainBps = winTrades > 0
      ? Math.round(totalGainBps / winTrades)
      : 0;

    const avgLossBps = lossTrades > 0
      ? Math.round(totalLossBps / lossTrades)
      : 0;

    return NextResponse.json({
      onChain: true,
      indicatorAddr: indicatorAddress,
      stats: {
        totalTrades,
        completedTrades,
        winTrades,
        lossTrades,
        totalGainBps,
        totalLossBps,
        winRate,
        avgGainBps,
        avgLossBps,
        netPnlBps: totalGainBps - totalLossBps,
      },
      trades,
      pairs,
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    if (isUnsupportedTradeHistory(err)) {
      return NextResponse.json(
        { onChain: true, unavailable: true, reason: "trade_history_not_supported", trades: [], pairs: [] },
        { status: 501, headers: NO_STORE_HEADERS },
      );
    }
    if (isMissingIndicator(err)) {
      return NextResponse.json(
        { onChain: false, unavailable: false, reason: "indicator_not_found", trades: [], pairs: [] },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const message = err instanceof Error ? err.message : "Trade history lookup failed";
    console.warn("[launchpad-trades] lookup failed:", message);
    return NextResponse.json(
      { onChain: false, unavailable: true, reason: "aptos_testnet_unavailable", trades: [], pairs: [] },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
