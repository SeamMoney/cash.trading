import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  getAptosFullnodeApiKey,
  getReadDex,
  isValidAptosAddress,
  MAINNET_DECIBEL_PACKAGE,
} from "@/lib/decibel";
import { getIndexedPositions, type ChainDecibelPosition } from "@/lib/decibel-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FULLNODE_VIEW = "https://api.mainnet.aptoslabs.com/v1/view";
const REQUEST_TIMEOUT_MS = 8_000;
const RESPONSE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=5, stale-while-revalidate=15",
};
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

interface VaultPosition extends ChainDecibelPosition {
  estimatedPnlPct: number | null;
}

function asFinite(value: unknown): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

async function getVaultPortfolioSubaccounts(
  vaultAddress: string,
  signal: AbortSignal,
): Promise<string[]> {
  const apiKey = getAptosFullnodeApiKey("mainnet");
  const response = await fetch(FULLNODE_VIEW, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      function: `${MAINNET_DECIBEL_PACKAGE}::vault::get_vault_portfolio_subaccounts`,
      type_arguments: [],
      arguments: [vaultAddress],
    }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("vault_subaccounts_unavailable");

  const result = (await response.json()) as unknown;
  const first = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(first)) return [];
  return first.filter(isValidAptosAddress);
}

function enrichPosition(
  position: ChainDecibelPosition,
  marketNames: Map<string, string>,
  markPrices: Map<string, number>,
): VaultPosition {
  const marketAddress = position.marketAddress?.toLowerCase() ?? "";
  const markPrice = markPrices.get(marketAddress) ?? position.markPrice;
  const absoluteSize = Math.abs(position.size);
  const value = markPrice == null ? null : absoluteSize * markPrice;
  const estimatedPnl =
    markPrice == null
      ? null
      : position.isLong
        ? (markPrice - position.entryPrice) * absoluteSize
        : (position.entryPrice - markPrice) * absoluteSize;
  const estimatedPnlPct =
    estimatedPnl == null || position.marginUsed <= 0
      ? null
      : (estimatedPnl / position.marginUsed) * 100;

  return {
    ...position,
    market: marketNames.get(marketAddress) ?? position.market,
    markPrice,
    value,
    estimatedPnl,
    estimatedPnlPct,
  };
}

/**
 * Live open positions for every Decibel portfolio subaccount owned by a vault.
 * SDK market_prices are already human-scaled, so sub-cent assets such as
 * kPEPE remain 0.0027 rather than being re-scaled to 2,700 by guessed decimals.
 */
export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "decibel-vault-positions", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const vaultAddress = request.nextUrl.searchParams.get("vault")?.toLowerCase() ?? "";
  if (!isValidAptosAddress(vaultAddress)) {
    return NextResponse.json(
      { error: "A valid vault address is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const subaccounts = await getVaultPortfolioSubaccounts(vaultAddress, controller.signal);
    if (subaccounts.length === 0) {
      return NextResponse.json(
        { vault: vaultAddress, positions: [], subaccounts: 0, fetchedAt: Date.now() },
        { headers: RESPONSE_HEADERS },
      );
    }

    const dex = getReadDex("mainnet");
    const [positionGroups, markets, prices] = await Promise.all([
      Promise.all(
        subaccounts.map((subaccount) =>
          getIndexedPositions(subaccount, {
            network: "mainnet",
            limit: 1_000,
            signal: controller.signal,
          }),
        ),
      ),
      dex.markets.getAll({ fetchOptions: { signal: controller.signal } }),
      dex.marketPrices.getAll({ fetchOptions: { signal: controller.signal } }),
    ]);

    const marketNames = new Map(
      markets.map((market) => [market.market_addr.toLowerCase(), market.market_name]),
    );
    const markPrices = new Map<string, number>();
    for (const price of prices) {
      const markPrice = asFinite(price.mark_px) ?? asFinite(price.mid_px) ?? asFinite(price.oracle_px);
      if (markPrice != null) markPrices.set(price.market.toLowerCase(), markPrice);
    }

    const positions = positionGroups
      .flat()
      .map((position) => enrichPosition(position, marketNames, markPrices))
      .sort((a, b) => (b.estimatedPnl ?? Number.NEGATIVE_INFINITY) - (a.estimatedPnl ?? Number.NEGATIVE_INFINITY));

    return NextResponse.json(
      {
        vault: vaultAddress,
        subaccounts: subaccounts.length,
        positions,
        fetchedAt: Date.now(),
        source: "decibel-indexer+market-prices",
      },
      { headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "upstream_unavailable";
    return NextResponse.json(
      { error: "Vault positions are temporarily unavailable", reason, positions: [] },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearTimeout(timer);
  }
}
