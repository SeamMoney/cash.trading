import { NextRequest, NextResponse } from "next/server";
import { getFastSubaccounts } from "@/lib/decibel-chain";
import {
  getDecibelCollateralMetadata,
  getReadDex,
  type DecibelNetwork,
  USDC_DECIMALS,
} from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REST_SUBACCOUNT_TIMEOUT_MS = 2500;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

type RestSubaccount = {
  address: string;
  name: string | null;
  isPrimary: boolean;
  isActive: boolean;
  source: "rest";
};

function getRequestNetwork(req: NextRequest): DecibelNetwork {
  return req.nextUrl.searchParams.get("network") === "mainnet" ? "mainnet" : "testnet";
}

function collateral(network: DecibelNetwork) {
  return {
    symbol: "USDC",
    metadata: getDecibelCollateralMetadata(network),
    decimals: USDC_DECIMALS,
  };
}

function createUrl(network: DecibelNetwork) {
  return network === "mainnet"
    ? "https://decibel.trade"
    : "https://testnet.decibel.trade";
}

function lookupErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("401") || message.includes("Unauthorized")) {
    return "Decibel account lookup is temporarily unavailable.";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "Decibel REST lookup timed out.";
  }
  return message || "Decibel REST lookup failed.";
}

async function fetchRestSubaccounts(address: string, network: DecibelNetwork): Promise<{
  subaccounts: RestSubaccount[];
  error: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_SUBACCOUNT_TIMEOUT_MS);
  try {
    const dex = getReadDex(network);
    const subaccounts = await dex.userSubaccounts.getByAddr({
      ownerAddr: address,
      fetchOptions: { signal: controller.signal },
    });
    const mapped = subaccounts.map(
      (subaccount: {
        subaccount_address: string;
        custom_label: string | null;
        is_primary: boolean;
        is_active?: boolean;
      }) => ({
        address: subaccount.subaccount_address,
        name: subaccount.custom_label,
        isPrimary: subaccount.is_primary,
        isActive: subaccount.is_active !== false,
        source: "rest" as const,
      })
    );
    return { subaccounts: mapped, error: null };
  } catch (error) {
    return { subaccounts: [], error: lookupErrorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/decibel/subaccount?address=0x...
 *
 * Primary path is the Decibel dex_accounts Move view, which reflects the
 * subaccount as soon as the create-subaccount transaction lands.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const network = getRequestNetwork(req);
  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const startedAt = Date.now();
  let chainError: string | null = null;
  const chainSubaccounts = await getFastSubaccounts(address, network).catch((error) => {
    chainError = error instanceof Error ? error.message : "Decibel chain lookup failed.";
    return [];
  });
  const restResult =
    chainSubaccounts.length > 0
      ? { subaccounts: [] as RestSubaccount[], error: null }
      : await fetchRestSubaccounts(address, network);
  const subaccounts =
    chainSubaccounts.length > 0
      ? chainSubaccounts.map((subaccount) => ({
          address: subaccount.address,
          name: subaccount.name,
          isPrimary: subaccount.isPrimary,
          isActive: subaccount.isActive,
          hasAssetsOrPositions: subaccount.hasAssetsOrPositions,
          source: "chain",
        }))
      : restResult.subaccounts;
  const lookupIncomplete =
    subaccounts.length === 0 && Boolean(chainError || restResult.error);

  return NextResponse.json({
    hasSubaccount: subaccounts.length > 0,
    subaccounts,
    collateral: collateral(network),
    createUrl: createUrl(network),
    latencyMs: Date.now() - startedAt,
    lookupError: restResult.error ?? chainError,
    lookupIncomplete,
    network,
    source: chainSubaccounts.length > 0 ? "chain" : "rest-fallback",
  }, { headers: NO_STORE_HEADERS });
}
