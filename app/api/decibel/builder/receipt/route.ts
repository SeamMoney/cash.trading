import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { reconcileDecibelBuilderTransaction } from "@/lib/decibel-builder-revenue";
import { resolveDecibelNetwork } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(
    request,
    "decibel-builder-receipt",
    60,
    60_000,
  );
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

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "A valid JSON object is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const input = body as { transactionHash?: unknown; network?: unknown };
  if (
    typeof input.transactionHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash.trim()) ||
    (input.network !== undefined &&
      input.network !== "mainnet" &&
      input.network !== "testnet")
  ) {
    return NextResponse.json(
      { error: "transactionHash or network is invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await reconcileDecibelBuilderTransaction({
      network: resolveDecibelNetwork(input.network),
      transactionHash: input.transactionHash,
      signal: request.signal,
    });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[decibel/builder/receipt] reconciliation failed", error);
    return NextResponse.json(
      { error: "Builder receipt could not be reconciled" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
