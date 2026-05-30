import { NextRequest, NextResponse } from "next/server";
import {
  buildDecibelCancelOrderPayload,
  getDecibelMarketConfigFromRegistry,
  type DecibelNetwork,
} from "@/lib/decibel";

export const runtime = "nodejs";

function getRequestNetwork(value: unknown): DecibelNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export async function POST(req: NextRequest) {
  try {
    const { subaccount, marketName, marketAddress, orderId, network: rawNetwork } = await req.json();
    const network = getRequestNetwork(rawNetwork);

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
            network,
            signal: req.signal,
          })
        ).config.address;

    const { payload, marketAddress: payloadMarketAddress } =
      buildDecibelCancelOrderPayload({
        subaccount,
        marketName,
        marketAddress: resolvedMarketAddress,
        network,
        orderId,
      });

    return NextResponse.json({
      payload,
      meta: {
        orderId,
        network,
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
