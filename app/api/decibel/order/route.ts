import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import {
  buildDecibelOrderPayload,
  getDecibelPackage,
  getDecibelMarketConfigFromRegistry,
  isValidAptosAddress,
  normalizeAptosAddress,
  PRICE_DECIMALS,
  resolveDecibelNetwork,
  TAKER_FEE,
  MAKER_REBATE,
  type DecibelNetwork,
  type MarketConfig,
} from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function rateLimited(rate: { retryAfterS?: number }) {
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

function isValidMarketName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  );
}

function isPositiveNumericInput(value: unknown): value is string | number {
  if (typeof value !== "string" && typeof value !== "number") return false;
  if (typeof value === "string" && (value.trim().length === 0 || value.length > 64)) {
    return false;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function hasValidNetwork(value: unknown) {
  return value === undefined || value === "testnet" || value === "mainnet";
}

function getRequestNetwork(value: unknown): DecibelNetwork {
  return resolveDecibelNetwork(value);
}

function getAptos(network: DecibelNetwork) {
  const net = network;
  return new Aptos(new AptosConfig({
    network: net === "mainnet" ? Network.MAINNET : Network.TESTNET,
  }));
}

function moveVariantName(value: unknown): string {
  if (value && typeof value === "object" && "__variant__" in value) {
    return String((value as { __variant__?: unknown }).__variant__);
  }
  return String(value ?? "unknown");
}

function toNumber(value: unknown): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function asMoveFunction(functionId: string) {
  return functionId as `${string}::${string}::${string}`;
}

async function viewFirst(
  network: DecibelNetwork,
  functionId: string,
  functionArguments: unknown[]
) {
  const aptos = getAptos(network);
  const [value] = await aptos.view({
    payload: {
      function: asMoveFunction(functionId),
      functionArguments: functionArguments as string[],
    },
  });
  return value;
}

async function readMarketConfigFromChainAddress(
  marketAddress: string,
  network: DecibelNetwork,
  fallbackName?: string | null
): Promise<{ marketName: string; config: MarketConfig }> {
  const pkg = getDecibelPackage(network);
  const args = [marketAddress];
  const [maxLeverage, minSize, lotSize, tickSize, sizeDecimals] =
    await Promise.all([
      viewFirst(network, `${pkg}::perp_engine::market_max_leverage`, args),
      viewFirst(network, `${pkg}::perp_engine::market_min_size`, args),
      viewFirst(network, `${pkg}::perp_engine::market_lot_size`, args),
      viewFirst(network, `${pkg}::perp_engine::market_ticker_size`, args),
      viewFirst(network, `${pkg}::perp_engine::market_sz_decimals`, args),
    ]);

  return {
    marketName:
      fallbackName && !fallbackName.startsWith("0x") ? fallbackName : marketAddress,
    config: {
      address: marketAddress,
      maxLeverage: toNumber(maxLeverage) ?? 1,
      minSizeRaw: toNumber(minSize) ?? 1,
      sizeDecimals: toNumber(sizeDecimals) ?? 8,
      priceDecimals: PRICE_DECIMALS,
      tickSize: toNumber(tickSize) ?? 1,
      lotSize: toNumber(lotSize) ?? 1,
    },
  };
}

async function resolveMarketConfig(
  lookupKey: string,
  network: DecibelNetwork,
  signal?: AbortSignal,
  fallbackName?: string | null
) {
  try {
    return await getDecibelMarketConfigFromRegistry(lookupKey, {
      network,
      signal,
    });
  } catch (error) {
    if (lookupKey.startsWith("0x")) {
      return readMarketConfigFromChainAddress(lookupKey, network, fallbackName);
    }
    throw error;
  }
}

async function readMarketState(marketConfig: MarketConfig, network: DecibelNetwork): Promise<{
  isOpen: boolean;
  mode: string;
  markPrice: number | null;
}> {
  const aptos = getAptos(network);
  const pkg = getDecibelPackage(network);
  const marketAddress = marketConfig.address;
  const [isOpenRaw, modeRaw, markAndOracle] = await Promise.all([
    aptos.view({
      payload: {
        function: `${pkg}::perp_engine::is_market_open` as `${string}::${string}::${string}`,
        functionArguments: [marketAddress],
      },
    }).then(([value]) => value),
    aptos.view({
      payload: {
        function: `${pkg}::perp_engine::get_market_mode` as `${string}::${string}::${string}`,
        functionArguments: [marketAddress],
      },
    }).then(([value]) => value),
    aptos.view({
      payload: {
        function: `${pkg}::perp_engine::get_mark_and_oracle_price` as `${string}::${string}::${string}`,
        functionArguments: [marketAddress],
      },
    }),
  ]);
  const markRaw = Array.isArray(markAndOracle) ? markAndOracle[0] : null;
  const markPrice = markRaw === null || markRaw === undefined
    ? null
    : Number(markRaw) / Math.pow(10, marketConfig.priceDecimals);

  return {
    isOpen: Boolean(isOpenRaw),
    mode: moveVariantName(modeRaw),
    markPrice:
      markPrice !== null && Number.isFinite(markPrice) && markPrice > 0
        ? markPrice
        : null,
  };
}

function classifyMarketDenial(mode: string): "MARKET_CLOSED" | "STALE_ORACLE_DENIED" {
  return /stale|oracle/i.test(mode) ? "STALE_ORACLE_DENIED" : "MARKET_CLOSED";
}

/**
 * GET /api/decibel/order?marketName=BTC/USD
 *
 * Lightweight preflight used by the trade panel before the user submits.
 */
export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-order-preflight", 120, 60_000);
  if (!rate.allowed) return rateLimited(rate);

  const marketName = req.nextUrl.searchParams.get("marketName")?.trim() || null;
  const marketAddress = req.nextUrl.searchParams.get("marketAddress")?.trim() || null;
  const rawNetwork = req.nextUrl.searchParams.get("network") ?? undefined;
  if (!hasValidNetwork(rawNetwork)) {
    return NextResponse.json(
      { error: "network must be testnet or mainnet" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const network = getRequestNetwork(req.nextUrl.searchParams.get("network"));
  const lookupKey = marketAddress ?? marketName;

  if (!lookupKey) {
    return NextResponse.json(
      { error: "Missing marketName or marketAddress" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (
    (marketAddress !== null && !isValidAptosAddress(marketAddress)) ||
    (marketName !== null && !isValidMarketName(marketName))
  ) {
    return NextResponse.json(
      { error: "marketName or marketAddress is invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { marketName: resolvedMarketName, config } =
      await resolveMarketConfig(lookupKey, network, req.signal, marketName);
    const marketStatus = await readMarketState(config, network);

    return NextResponse.json(
      {
        network,
        market: resolvedMarketName,
        marketAddress: config.address,
        marketStatus,
        code: marketStatus.isOpen ? "MARKET_OPEN" : classifyMarketDenial(marketStatus.mode),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read Decibel market status";
    if (/^Unknown Decibel market:/.test(message)) {
      return NextResponse.json(
        { error: "Unknown Decibel market" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[decibel-order-preflight] lookup failed:", message);
    return NextResponse.json(
      { error: "Decibel market status is temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * POST /api/decibel/order
 *
 * Builds an on-chain transaction payload for the user to sign via wallet adapter.
 * Supports both limit and market orders using Decibel's Move entry functions.
 *
 * Body: {
 *   marketName: "BTC/USD",
 *   price: 95000,       // required for limit, ignored for market
 *   size: 0.01,         // in asset units (e.g. 0.01 BTC)
 *   isBuy: true,
 *   orderType: "limit" | "market",
 *   leverage?: 10,      // optional, default based on market
 *   reduceOnly?: false,
 *   subaccount?: "0x...", // required — user's Decibel subaccount
 * }
 *
 * Returns a Move entry function payload the client signs with signAndSubmitTransaction.
 */
export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-order-build", 60, 60_000);
  if (!rate.allowed) return rateLimited(rate);

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "A valid JSON object is required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const {
      marketName,
      marketAddress,
      price,
      size,
      isBuy,
      orderType,
      reduceOnly = false,
      subaccount,
      network: rawNetwork,
    } = body;
    if (!hasValidNetwork(rawNetwork)) {
      return NextResponse.json(
        { error: "network must be testnet or mainnet" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const network = getRequestNetwork(rawNetwork);

    if ((!marketName && !marketAddress) || size === undefined || isBuy === undefined || !subaccount) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: marketName or marketAddress, size, isBuy, subaccount",
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (
      (marketName !== undefined && !isValidMarketName(marketName)) ||
      (marketAddress !== undefined && !isValidAptosAddress(marketAddress)) ||
      !isValidAptosAddress(subaccount) ||
      !isPositiveNumericInput(size) ||
      typeof isBuy !== "boolean" ||
      (orderType !== "limit" && orderType !== "market") ||
      typeof reduceOnly !== "boolean"
    ) {
      return NextResponse.json(
        { error: "Order fields are invalid" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (orderType === "limit" && !isPositiveNumericInput(price)) {
      return NextResponse.json(
        { error: "Limit orders require a price" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (orderType === "market" && price !== undefined && price !== null && !isPositiveNumericInput(price)) {
      return NextResponse.json(
        { error: "Reference price must be a positive number" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const normalizedSubaccount = normalizeAptosAddress(subaccount, "subaccount");
    const normalizedMarketAddress = marketAddress
      ? normalizeAptosAddress(marketAddress, "marketAddress")
      : undefined;

    const { marketName: resolvedMarketName, config: resolvedMarketConfig } =
      await resolveMarketConfig(
        normalizedMarketAddress || marketName,
        network,
        req.signal,
        marketName,
      );
    const marketState = await readMarketState(resolvedMarketConfig, network);
    if (!marketState.isOpen && !reduceOnly) {
      const code = classifyMarketDenial(marketState.mode);
      return NextResponse.json(
        {
          error: `Decibel market ${resolvedMarketName} is not open (${marketState.mode})`,
          code,
          marketMode: marketState.mode,
          marketStatus: marketState,
        },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }
    const orderPrice =
      orderType === "limit" ? price : marketState.markPrice ?? price;
    if (!orderPrice) {
      return NextResponse.json(
        { error: "Market orders require a Decibel mark price or reference price" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    let builtOrder: ReturnType<typeof buildDecibelOrderPayload>;
    try {
      builtOrder = buildDecibelOrderPayload({
        marketName: resolvedMarketName,
        marketConfig: resolvedMarketConfig,
        price: orderPrice,
        size,
        isBuy,
        orderType: orderType === "limit" ? "limit" : "market",
        reduceOnly,
        subaccount: normalizedSubaccount,
        network,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Order fields are invalid";
      return NextResponse.json(
        { error: message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const { payload, marketConfig, sizeRaw, priceRaw } = builtOrder;

    const adjustedSize = sizeRaw / Math.pow(10, marketConfig.sizeDecimals);
    const adjustedPrice =
      priceRaw > 0
        ? priceRaw / Math.pow(10, marketConfig.priceDecimals)
        : null;
    // Estimate fee
    const notional = adjustedSize * Number(price || adjustedPrice || 0);
    const estimatedFee =
      orderType === "market"
        ? notional * TAKER_FEE
        : notional * -MAKER_REBATE; // Makers get a rebate

    return NextResponse.json({
      payload,
      meta: {
        market: resolvedMarketName,
        network,
        marketAddress: marketConfig.address,
        side: isBuy ? "buy" : "sell",
        orderType,
        requestedSize: Number(size),
        size: adjustedSize,
        sizeRaw,
        minSizeRaw: marketConfig.minSizeRaw,
        lotSize: marketConfig.lotSize,
        requestedPrice: price || "market",
        price: adjustedPrice ?? "market",
        priceRaw,
        markPrice: marketState.markPrice,
        marketMode: marketState.mode,
        marketStatus: {
          isOpen: marketState.isOpen,
          mode: marketState.mode,
          markPrice: marketState.markPrice,
        },
        estimatedFee: estimatedFee.toFixed(4),
        feeType: orderType === "market" ? "taker" : "maker (rebate)",
        maxLeverage: marketConfig.maxLeverage,
      },
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build order";
    if (/^Unknown Decibel market:/.test(message)) {
      return NextResponse.json(
        { error: "Unknown Decibel market" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[decibel-order-build] lookup failed:", message);
    return NextResponse.json(
      { error: "Decibel order preflight is temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
