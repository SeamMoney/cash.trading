import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  CASH_DECIMALS,
  CASH_LEGACY_COIN_TYPE,
  CASH_METADATA_ADDRESS,
  USDC_DECIMALS,
  USDC_METADATA_ADDRESS,
} from "@/lib/cash-orderbook";
import {
  assertFreshMainnetAptosTimestamp,
  fetchMainnetAptos,
  isValidAptosAddressText,
  mainnetAptosStatePath,
  normalizeAptosAddressText,
  readFreshMainnetAptosLedger,
  requireMainnetAptosResponse,
} from "@/lib/aptos-server-lite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const APT_COIN_TYPE = "0x1::aptos_coin::AptosCoin";
const APT_DECIMALS = 8;

async function aptosFetch(path: string, init: RequestInit = {}) {
  return fetchMainnetAptos(path, init, {
    clientName: "cash-trading/cash-swap-balances",
    timeoutMs: 4_000,
  });
}

function atomicToDisplay(raw: string, decimals: number) {
  if (!/^\d+$/.test(raw)) throw new Error("Aptos returned an invalid balance");
  const atomic = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = atomic / scale;
  const fraction = atomic % scale;
  return Number(whole) + Number(fraction) / Number(scale);
}

async function readPrimaryFungibleAssetBalance(
  address: string,
  metadata: string,
  decimals: number,
  ledgerVersion: string,
) {
  const response = await aptosFetch(mainnetAptosStatePath("/view", ledgerVersion), {
    method: "POST",
    body: JSON.stringify({
      function: "0x1::primary_fungible_store::balance",
      type_arguments: ["0x1::fungible_asset::Metadata"],
      arguments: [address, metadata],
    }),
  });
  await requireMainnetAptosResponse(response, ledgerVersion);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Fungible-asset balance lookup failed (${response.status})`);
  }
  const result = await response.json() as unknown;
  if (
    !Array.isArray(result)
    || result.length !== 1
    || typeof result[0] !== "string"
    || !/^\d+$/.test(result[0])
  ) {
    throw new Error("Fungible-asset balance lookup returned malformed data");
  }
  const raw = result[0];
  return { raw, value: atomicToDisplay(raw, decimals) };
}

async function readCoinStoreBalance(
  address: string,
  coinType: string,
  decimals: number,
  ledgerVersion: string,
) {
  const resourceType = `0x1::coin::CoinStore<${coinType}>`;
  const response = await aptosFetch(
    mainnetAptosStatePath(
      `/accounts/${address}/resource/${encodeURIComponent(resourceType)}`,
      ledgerVersion,
    ),
  );
  await requireMainnetAptosResponse(response, ledgerVersion);
  if (response.status === 404) {
    await response.body?.cancel();
    return { raw: "0", value: 0 };
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Coin balance lookup failed (${response.status})`);
  }
  const resource = await response.json() as {
    data?: { coin?: { value?: string } };
  };
  const raw = resource.data?.coin?.value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new Error("Coin balance lookup returned malformed data");
  }
  return { raw, value: atomicToDisplay(raw, decimals) };
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "cash-orderbook-balances", 90, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many balance requests. Try again shortly." },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rate.retryAfterS ?? 60),
        },
      },
    );
  }

  const rawAddress = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!isValidAptosAddressText(rawAddress)) {
    return NextResponse.json(
      { error: "A valid Aptos address is required." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const ledger = await readFreshMainnetAptosLedger({
      clientName: "cash-trading/cash-swap-balances",
      timeoutMs: 4_000,
    });
    const address = normalizeAptosAddressText(rawAddress);
    const [cash, usdc, legacyCash, apt] = await Promise.all([
      readPrimaryFungibleAssetBalance(address, CASH_METADATA_ADDRESS, CASH_DECIMALS, ledger.version),
      readPrimaryFungibleAssetBalance(address, USDC_METADATA_ADDRESS, USDC_DECIMALS, ledger.version),
      readCoinStoreBalance(address, CASH_LEGACY_COIN_TYPE, CASH_DECIMALS, ledger.version),
      readCoinStoreBalance(address, APT_COIN_TYPE, APT_DECIMALS, ledger.version),
    ]);
    assertFreshMainnetAptosTimestamp(ledger.timestampUsec);

    return NextResponse.json({
      network: "mainnet",
      address,
      ledgerVersion: ledger.version,
      balances: {
        CASH: cash.value,
        USDC: usdc.value,
        legacyCash: legacyCash.value,
        APT: apt.value,
      },
      raw: {
        CASH: cash.raw,
        USDC: usdc.raw,
        legacyCash: legacyCash.raw,
        APT: apt.raw,
      },
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[cash-orderbook-balances] mainnet balance read failed:", error);
    return NextResponse.json(
      { error: "Wallet balances are temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
