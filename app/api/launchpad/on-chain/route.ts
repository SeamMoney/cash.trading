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
import { parseSafeUnsigned, unwrapMoveVectorView } from "@/lib/launchpad/move-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const VIEW_TIMEOUT_MS = 5_000;

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      aptos.view({ payload: { function: fn, functionArguments: args } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Aptos indicator lookup timed out")), VIEW_TIMEOUT_MS);
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

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} is not a boolean`);
  return value;
}

function parseScaledVectorView(value: unknown, field: string, scale: number): number[] {
  return unwrapMoveVectorView(value, field).map(
    (entry, index) => parseSafeUnsigned(entry, `${field}[${index}]`) / scale,
  );
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
      const [pricesResult, timestampsResult] = await Promise.all([
        safeView(`${contractAt}::indicator::get_prices`, [indicatorAddress]),
        safeView(`${contractAt}::indicator::get_timestamps`, [indicatorAddress]),
      ]);
      const prices = parseScaledVectorView(pricesResult, "prices", 1e8);
      const timestamps = parseScaledVectorView(timestampsResult, "timestamps", 1);
      if (prices.length !== timestamps.length) {
        throw new Error("price and timestamp vectors are misaligned");
      }
      return NextResponse.json({
        onChain: true,
        prices,
        timestamps,
      }, { headers: NO_STORE_HEADERS });
    }

    if (type === "position") {
      const positionResult = await safeView(
        `${contractAt}::indicator::get_position`,
        [indicatorAddress],
      );
      if (!Array.isArray(positionResult) || positionResult.length !== 4) {
        throw new Error("get_position returned an unexpected tuple");
      }
      const [inPos, entry, gain, loss] = positionResult;
      return NextResponse.json({
        onChain: true,
        inPosition: parseBoolean(inPos, "in position"),
        entryPrice: parseSafeUnsigned(entry, "entry price") / 1e8,
        realizedGainBps: parseSafeUnsigned(gain, "realized gain bps"),
        realizedLossBps: parseSafeUnsigned(loss, "realized loss bps"),
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

    if (
      !Array.isArray(signalResult) || signalResult.length !== 5 ||
      !Array.isArray(statsResult) || statsResult.length !== 3 ||
      !Array.isArray(positionResult) || positionResult.length !== 4
    ) {
      throw new Error("indicator state views returned an unexpected tuple");
    }
    const [sig, fast, slow, price, sigTime] = signalResult;
    const [pushed, signals, graduated] = statsResult;
    const [inPos, entry, gain, loss] = positionResult;
    const parsedSignal = parseSafeUnsigned(sig, "signal");
    if (parsedSignal > 2) throw new Error("signal is outside the expected range");
    const prices = parseScaledVectorView(pricesResult, "prices", 1e8);
    const timestamps = parseScaledVectorView(timestampsResult, "timestamps", 1);
    if (prices.length !== timestamps.length) {
      throw new Error("price and timestamp vectors are misaligned");
    }

    return NextResponse.json({
      onChain: true,
      indicatorAddr: indicatorAddress,
      signal: parsedSignal,
      fastLine: parseSafeUnsigned(fast, "fast line") / 1e8,
      slowLine: parseSafeUnsigned(slow, "slow line") / 1e8,
      lastPrice: parseSafeUnsigned(price, "last price") / 1e8,
      lastSignalTime: parseSafeUnsigned(sigTime, "last signal time"),
      totalPushed: parseSafeUnsigned(pushed, "total pushed"),
      totalSignals: parseSafeUnsigned(signals, "total signals"),
      isGraduated: parseBoolean(graduated, "graduated"),
      inPosition: parseBoolean(inPos, "in position"),
      entryPrice: parseSafeUnsigned(entry, "entry price") / 1e8,
      realizedGainBps: parseSafeUnsigned(gain, "realized gain bps"),
      realizedLossBps: parseSafeUnsigned(loss, "realized loss bps"),
      prices,
      timestamps,
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    if (isMissingIndicator(err)) {
      return NextResponse.json(
        { onChain: false, unavailable: false, reason: "indicator_not_found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const message = err instanceof Error ? err.message : "Indicator lookup failed";
    console.warn("[launchpad-on-chain] lookup failed:", message);
    return NextResponse.json(
      { onChain: false, unavailable: true, reason: "aptos_testnet_unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
