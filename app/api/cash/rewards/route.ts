import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  isValidAptosAddress,
  normalizeAptosAddress,
  resolveDecibelNetwork,
} from "@/lib/decibel";
import { verifyDecibelSubaccountOwnership } from "@/lib/decibel-account-verification";
import {
  CASH_COIN_TYPE,
  CASH_DECIMALS,
  getCashRewardSnapshot,
} from "@/lib/cash-rewards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "cash-rewards-read", 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rate.retryAfterS ?? 60),
        },
      },
    );
  }

  const ownerInput =
    request.nextUrl.searchParams.get("owner") ??
    request.nextUrl.searchParams.get("userWalletAddress");
  const subaccountInput =
    request.nextUrl.searchParams.get("subaccount") ??
    request.nextUrl.searchParams.get("userSubaccount");
  const network = resolveDecibelNetwork(request.nextUrl.searchParams.get("network"));

  if (!isValidAptosAddress(ownerInput) || !isValidAptosAddress(subaccountInput)) {
    return NextResponse.json(
      { error: "Valid owner and subaccount Aptos addresses are required." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const owner = normalizeAptosAddress(ownerInput, "owner");
  const subaccount = normalizeAptosAddress(subaccountInput, "subaccount");

  try {
    const ownership = await verifyDecibelSubaccountOwnership({
      owner,
      subaccount,
      network,
    });
    if (!ownership.owned) {
      return NextResponse.json(
        ownership.lookupIncomplete
          ? { error: "Decibel account verification is temporarily unavailable." }
          : { error: "That subaccount does not belong to the connected Decibel owner." },
        {
          status: ownership.lookupIncomplete ? 503 : 403,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    const snapshot = await getCashRewardSnapshot({ network, owner, subaccount });
    return NextResponse.json(
      {
        cash: { coinType: CASH_COIN_TYPE, decimals: CASH_DECIMALS },
        ...snapshot,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[cash-rewards] failed to build verified snapshot", error);
    return NextResponse.json(
      { error: "Verified CASH rewards are temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Direct server payouts are disabled. CASH rewards use owner-bound cumulative on-chain claims.",
    },
    {
      status: 405,
      headers: { ...NO_STORE_HEADERS, Allow: "GET" },
    },
  );
}
