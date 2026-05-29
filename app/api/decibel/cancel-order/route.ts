import { NextRequest, NextResponse } from "next/server";
import {
  buildDecibelCancelOrderPayload,
  getDecibelMarketConfigFromRegistry,
} from "@/lib/decibel";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { subaccount, marketName, marketAddress, orderId } = await req.json();

    if (!subaccount || !orderId || (!marketName && !marketAddress)) {
      return NextResponse.json(
        { error: "Missing required fields: subaccount, orderId, and marketName or marketAddress" },
        { status: 400 }
      );
    }

    const resolvedMarketAddress = marketAddress
      ? marketAddress
      : (
          await getDecibelMarketConfigFromRegistry(marketName, {
            signal: req.signal,
          })
        ).config.address;

    const { payload, marketAddress: payloadMarketAddress } =
      buildDecibelCancelOrderPayload({
        subaccount,
        marketName,
        marketAddress: resolvedMarketAddress,
        orderId,
      });

    return NextResponse.json({
      payload,
      meta: {
        orderId,
        marketName: marketName ?? null,
        marketAddress: payloadMarketAddress,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build cancel order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
