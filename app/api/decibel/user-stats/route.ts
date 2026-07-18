import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { getAccountVaultPerformance } from "@/lib/decibel-api";
import { getFastOverview, getFastPositions, getFastSubaccounts } from "@/lib/decibel-chain";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";
import { getDecibelOwnerPoints } from "@/lib/decibel-points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "decibel-user-stats", 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const rawAccount = request.nextUrl.searchParams.get("account");
  if (!isValidAptosAddress(rawAccount)) {
    return NextResponse.json(
      { error: "A valid Aptos owner address is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const owner = normalizeAptosAddress(rawAccount, "account");

  try {
    const [points, subaccountsResult, vaultsResult] = await Promise.all([
      getDecibelOwnerPoints(owner),
      getFastSubaccounts(owner, "mainnet").then(
        (value) => ({ value, unavailable: false as const }),
        () => ({ value: [], unavailable: true as const }),
      ),
      getAccountVaultPerformance(owner, "mainnet", true).then(
        (value) => ({ value, unavailable: false as const }),
        () => ({ value: [], unavailable: true as const }),
      ),
    ]);

    const primary =
      subaccountsResult.value.find((subaccount) => subaccount.isPrimary) ??
      subaccountsResult.value[0] ??
      null;
    const [overviewResult, positionsResult] = primary
      ? await Promise.all([
          getFastOverview(primary.address, "mainnet").then(
            (value) => ({ value, unavailable: false as const }),
            () => ({ value: null, unavailable: true as const }),
          ),
          getFastPositions(primary.address, "mainnet").then(
            (value) => ({ value, unavailable: false as const }),
            () => ({ value: [], unavailable: true as const }),
          ),
        ])
      : [
          { value: null, unavailable: subaccountsResult.unavailable },
          { value: [], unavailable: subaccountsResult.unavailable },
        ];

    const vaults = vaultsResult.value.map((performance) => ({
      address: performance.vault.address,
      name: performance.vault.name,
      vaultType: performance.vault.vault_type,
      deposited: performance.total_deposited,
      currentValue: performance.current_value_of_shares,
      shares: performance.current_num_shares,
      pnl: performance.all_time_earned,
      returnPct: performance.all_time_return,
    }));

    return NextResponse.json(
      {
        owner,
        points: {
          rank: points.rank || null,
          total: points.totalAmps,
          trading: points.tradingAmps,
          vault: points.vaultAmps,
          referral: points.referralAmps,
          streak: points.streakAmps,
          bonus: points.bonusAmps,
          realizedPnl: points.realizedPnl,
        },
        account: {
          primarySubaccount: primary?.address ?? null,
          subaccounts: subaccountsResult.value.length,
          overview: overviewResult.value,
          openPositions: positionsResult.value,
        },
        vaults,
        unavailable: {
          account: subaccountsResult.unavailable,
          overview: overviewResult.unavailable,
          positions: positionsResult.unavailable,
          vaults: vaultsResult.unavailable,
        },
        season: 1,
        fetchedAt: Date.now(),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Decibel user lookup failed";
    console.error("Error fetching public Decibel user stats:", message);
    return NextResponse.json(
      { unavailable: true, error: "Decibel user stats are temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
