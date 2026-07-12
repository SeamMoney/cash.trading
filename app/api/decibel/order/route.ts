import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import {
  buildDecibelOrderPayload,
  getDecibelPackage,
  getDecibelMarketConfigFromRegistry,
  PRICE_DECIMALS,
  resolveDecibelNetwork,
  TAKER_FEE,
  MAKER_REBATE,
  type DecibelNetwork,
  type MarketConfig,
} from "@/lib/decibel";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

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
  const marketName = req.nextUrl.searchParams.get("marketName");
  const marketAddress = req.nextUrl.searchParams.get("marketAddress");
  const network = getRequestNetwork(req.nextUrl.searchParams.get("network"));
  const lookupKey = marketAddress ?? marketName;

  if (!lookupKey) {
    return NextResponse.json(
      { error: "Missing marketName or marketAddress" },
      { status: 400, headers: NO_STORE_HEADERS }
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
    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE_HEADERS }
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
  try {
    const body = await req.json();
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
    const network = getRequestNetwork(rawNetwork);

    if ((!marketName && !marketAddress) || size === undefined || isBuy === undefined || !subaccount) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: marketName or marketAddress, size, isBuy, subaccount",
        },
        { status: 400 }
      );
    }

    if (orderType === "limit" && !price) {
      return NextResponse.json(
        { error: "Limit orders require a price" },
        { status: 400 }
      );
    }

    const { marketName: resolvedMarketName, config: resolvedMarketConfig } =
      await resolveMarketConfig(
        marketAddress || marketName,
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
        { status: 409 }
      );
    }
    const orderPrice =
      orderType === "limit" ? price : marketState.markPrice ?? price;
    if (!orderPrice) {
      return NextResponse.json(
        { error: "Market orders require a Decibel mark price or reference price" },
        { status: 400 }
      );
    }

    const { payload, marketConfig, sizeRaw, priceRaw } =
      buildDecibelOrderPayload({
        marketName: resolvedMarketName,
        marketConfig: resolvedMarketConfig,
        price: orderPrice,
        size,
        isBuy,
        orderType: orderType === "limit" ? "limit" : "market",
        reduceOnly,
        subaccount,
        network,
      });

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
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build order";
    const code = /stale|oracle/i.test(message)
      ? "STALE_ORACLE_DENIED"
      : undefined;
    return NextResponse.json({ error: message, code }, { status: 500 });
  }
}
