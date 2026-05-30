import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import {
  buildDecibelOrderPayload,
  getActiveNetwork,
  getDecibelPackage,
  getDecibelMarketConfigFromRegistry,
  TAKER_FEE,
  MAKER_REBATE,
  type MarketConfig,
} from "@/lib/decibel";

export const runtime = "nodejs";

function getAptos() {
  const net = getActiveNetwork();
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

async function readMarketState(marketConfig: MarketConfig): Promise<{
  isOpen: boolean;
  mode: string;
  markPrice: number | null;
}> {
  const aptos = getAptos();
  const pkg = getDecibelPackage();
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
    } = body;

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
      await getDecibelMarketConfigFromRegistry(marketAddress || marketName, {
        signal: req.signal,
      });
    const marketState = await readMarketState(resolvedMarketConfig);
    if (!marketState.isOpen && !reduceOnly) {
      return NextResponse.json(
        {
          error: `Decibel market ${resolvedMarketName} is not open (${marketState.mode})`,
          marketMode: marketState.mode,
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
        estimatedFee: estimatedFee.toFixed(4),
        feeType: orderType === "market" ? "taker" : "maker (rebate)",
        maxLeverage: marketConfig.maxLeverage,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
