import { NextRequest, NextResponse } from "next/server";
import {
  buildDecibelCancelOrderPayload,
  getDecibelMarketConfigFromRegistry,
  isValidAptosAddress,
  normalizeAptosAddress,
  normalizeU128,
  resolveDecibelNetwork,
  type DecibelNetwork,
} from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function getRequestNetwork(value: unknown): DecibelNetwork {
  return resolveDecibelNetwork(value);
}

export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-cancel-order", 60, 60_000);
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

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "A valid JSON object is required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const { subaccount, marketName, marketAddress, orderId, network: rawNetwork } = body;
    if (rawNetwork !== undefined && rawNetwork !== "testnet" && rawNetwork !== "mainnet") {
      return NextResponse.json(
        { error: "network must be testnet or mainnet" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const network = getRequestNetwork(rawNetwork);

    if (
      !subaccount ||
      orderId === undefined ||
      orderId === null ||
      orderId === "" ||
      (!marketName && !marketAddress)
    ) {
      return NextResponse.json(
        { error: "Missing required fields: subaccount, orderId, and marketName or marketAddress" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (
      !isValidAptosAddress(subaccount) ||
      (marketAddress !== undefined && !isValidAptosAddress(marketAddress)) ||
      (marketName !== undefined &&
        (typeof marketName !== "string" ||
          marketName.length === 0 ||
          marketName.length > 64 ||
          !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(marketName)))
    ) {
      return NextResponse.json(
        { error: "Cancel-order fields are invalid" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    let normalizedOrderId: string;
    try {
      normalizedOrderId = normalizeU128(orderId, "orderId");
    } catch (error) {
      const message = error instanceof Error ? error.message : "orderId is invalid";
      return NextResponse.json(
        { error: message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const normalizedSubaccount = normalizeAptosAddress(subaccount, "subaccount");

    const resolvedMarketAddress = marketAddress
      ? normalizeAptosAddress(marketAddress, "marketAddress")
      : (
          await getDecibelMarketConfigFromRegistry(marketName, {
            network,
            signal: req.signal,
          })
        ).config.address;

    const { payload, marketAddress: payloadMarketAddress } =
      buildDecibelCancelOrderPayload({
        subaccount: normalizedSubaccount,
        marketName,
        marketAddress: resolvedMarketAddress,
        network,
        orderId: normalizedOrderId,
      });

    return NextResponse.json({
      payload,
      meta: {
        orderId: normalizedOrderId,
        network,
        marketName: marketName ?? null,
        marketAddress: payloadMarketAddress,
      },
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build cancel order";
    if (/^Unknown Decibel market:/.test(message)) {
      return NextResponse.json(
        { error: "Unknown Decibel market" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[decibel-cancel-order] lookup failed:", message);
    return NextResponse.json(
      { error: "Decibel cancel preflight is temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
