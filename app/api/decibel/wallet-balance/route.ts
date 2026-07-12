import { NextRequest, NextResponse } from "next/server";
import {
  getAptosFullnodeApiKey,
  getDecibelCollateralMetadata,
  isValidAptosAddress,
  resolveDecibelNetwork,
  USDC_DECIMALS,
  type DecibelNetwork,
} from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function getRequestNetwork(req: NextRequest): DecibelNetwork {
  return resolveDecibelNetwork(req.nextUrl.searchParams.get("network"));
}

function getFullnodeUrl(network: DecibelNetwork) {
  return network === "mainnet"
    ? process.env.APTOS_NODE_URL_MAINNET ?? "https://api.mainnet.aptoslabs.com/v1"
    : process.env.APTOS_NODE_URL_TESTNET ?? "https://api.testnet.aptoslabs.com/v1";
}

function normalizeAddress(address: string) {
  const trimmed = address.trim();
  if (!isValidAptosAddress(trimmed)) {
    throw new Error("Invalid Aptos address.");
  }
  return trimmed;
}

async function readWalletBalance(address: string, network: DecibelNetwork) {
  const metadata = getDecibelCollateralMetadata(network);
  const body = JSON.stringify({
    function: "0x1::primary_fungible_store::balance",
    type_arguments: ["0x1::fungible_asset::Metadata"],
    arguments: [address, metadata],
  });
  const fetchView = (apiKey?: string) =>
    fetch(`${getFullnodeUrl(network)}/view`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aptos-client": "cash-trading/wallet-balance",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });

  const apiKey = getAptosFullnodeApiKey(network);
  let response = await fetchView(apiKey);
  if (apiKey && (response.status === 401 || response.status === 403)) {
    response = await fetchView();
  }

  if (!response.ok) {
    throw new Error(`USDC balance lookup failed (${response.status})`);
  }

  const result = (await response.json()) as unknown[];
  const raw = String(result[0] ?? "0");
  const balance = Number(raw) / 10 ** USDC_DECIMALS;
  return { balance, raw, metadata };
}

export async function GET(req: NextRequest) {
  const rawAddress = req.nextUrl.searchParams.get("address") ?? "";
  const rate = checkApiRateLimit(req, "decibel-wallet-balance", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  if (!isValidAptosAddress(rawAddress.trim())) {
    return NextResponse.json(
      { error: "A valid Aptos address is required." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const address = normalizeAddress(rawAddress);
    const network = getRequestNetwork(req);
    const { balance, raw, metadata } = await readWalletBalance(address, network);

    return NextResponse.json({
      balance,
      raw,
      decimals: USDC_DECIMALS,
      metadata,
      network,
      symbol: "USDC",
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("[decibel-wallet-balance] balance read failed:", err);
    return NextResponse.json(
      { error: "USDC balance is temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
