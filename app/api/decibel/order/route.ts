import { NextRequest, NextResponse } from "next/server";
import {
  buildDecibelOrderPayload,
  TAKER_FEE,
  MAKER_REBATE,
} from "@/lib/decibel";

export const runtime = "nodejs";

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
      price,
      size,
      isBuy,
      orderType,
      reduceOnly = false,
      subaccount,
    } = body;

    if (!marketName || size === undefined || isBuy === undefined || !subaccount) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: marketName, size, isBuy, subaccount",
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

    if (orderType !== "limit" && !price) {
      return NextResponse.json(
        { error: "Market orders require a reference price for protective IOC execution" },
        { status: 400 }
      );
    }

    const { payload, marketConfig, sizeRaw, priceRaw } =
      buildDecibelOrderPayload({
        marketName,
        price,
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
        market: marketName,
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
