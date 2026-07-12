/**
 * On-chain state reader for indicator contracts.
 *
 * GET /api/launchpad/on-chain?addr=<addr>&type=state|prices|position[&pkg=<package addr>]
 *
 * `pkg` selects which published indicator package defines the object's types
 * (defaults to the legacy launchpad package). The strategy-vault package
 * deployed for trustless Decibel vaults lives at 0x44bccd… — pass it for
 * indicators created by that factory.
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
// Use the testnet API key (same as the crank route) — the default fullnode
// rate-limits anonymous IPs hard (40k CU / 300s), and the feed polls these
// view functions every 15s per visible card, so without a key live reads 429
// under any real load.
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
  const rate = checkApiRateLimit(req, "launchpad-on-chain", 180, 60_000);
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
  const type = url.searchParams.get("type") || "state";
  const pkgParam = url.searchParams.get("pkg");

  if (
    !isValidAptosAddress(addr) ||
    (pkgParam !== null && !isValidAptosAddress(pkgParam)) ||
    !["state", "prices", "position"].includes(type)
  ) {
    return NextResponse.json(
      { error: "addr, pkg, or type is invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const indicatorAddress = normalizeAptosAddress(addr, "addr");
  const contractAt = pkgParam
    ? normalizeAptosAddress(pkgParam, "pkg")
    : CONTRACT;

  try {
    if (type === "prices") {
      const [prices, timestamps] = await Promise.all([
        safeView(`${contractAt}::indicator::get_prices`, [indicatorAddress]),
        safeView(`${contractAt}::indicator::get_timestamps`, [indicatorAddress]),
      ]);
      return NextResponse.json({
        prices: (prices as string[]).map((p) => Number(p) / 1e8),
        timestamps: (timestamps as string[]).map((t) => Number(t)),
      }, { headers: NO_STORE_HEADERS });
    }

    if (type === "position") {
      const [inPos, entry, gain, loss] = await safeView(
        `${contractAt}::indicator::get_position`,
        [indicatorAddress],
      );
      return NextResponse.json({
        inPosition: inPos,
        entryPrice: Number(entry) / 1e8,
        realizedGainBps: Number(gain),
        realizedLossBps: Number(loss),
      }, { headers: NO_STORE_HEADERS });
    }

    // Default: full state including price buffer
    // get_signal_view returns (signal, fast_line, slow_line, last_price, last_signal_time)
    const [
      signalResult,
      statsResult,
      positionResult,
      pricesResult,
      timestampsResult,
    ] = await Promise.all([
      safeView(`${contractAt}::indicator::get_signal_view`, [indicatorAddress]),
      safeView(`${contractAt}::indicator::get_stats`, [indicatorAddress]),
      safeView(`${contractAt}::indicator::get_position`, [indicatorAddress]),
      safeView(`${contractAt}::indicator::get_prices`, [indicatorAddress]),
      safeView(`${contractAt}::indicator::get_timestamps`, [indicatorAddress]),
    ]);

    const [sig, fast, slow, price, sigTime] = signalResult;
    const [pushed, signals, graduated] = statsResult;
    const [inPos, entry, gain, loss] = positionResult;

    return NextResponse.json({
      indicatorAddr: indicatorAddress,
      signal: Number(sig),
      fastLine: Number(fast) / 1e8,
      slowLine: Number(slow) / 1e8,
      lastPrice: Number(price) / 1e8,
      lastSignalTime: Number(sigTime),
      totalPushed: Number(pushed),
      totalSignals: Number(signals),
      isGraduated: graduated as boolean,
      inPosition: inPos as boolean,
      entryPrice: Number(entry) / 1e8,
      realizedGainBps: Number(gain),
      realizedLossBps: Number(loss),
      prices: (pricesResult[0] as string[]).map((p) => Number(p) / 1e8),
      timestamps: (timestampsResult[0] as string[]).map((t) => Number(t)),
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Indicator lookup failed";
    console.warn("[launchpad-on-chain] lookup failed:", message);
    return NextResponse.json(
      { onChain: false, unavailable: true },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }
}
