import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const DECIBEL_VAULT_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const MAX_VAULT_PAYLOAD_BODY_BYTES = 32_000;

export async function buildDecibelVaultPayloadResponse<T extends object>(
  req: NextRequest,
  routeKey: string,
  builder: (body: T) => unknown,
) {
  const rate = checkApiRateLimit(req, routeKey, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: {
          ...DECIBEL_VAULT_NO_STORE_HEADERS,
          "Retry-After": String(rate.retryAfterS ?? 60),
        },
      },
    );
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_VAULT_PAYLOAD_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large" },
      { status: 413, headers: DECIBEL_VAULT_NO_STORE_HEADERS },
    );
  }

  const text = await req.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > MAX_VAULT_PAYLOAD_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large" },
      { status: 413, headers: DECIBEL_VAULT_NO_STORE_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "A valid JSON object is required" },
      { status: 400, headers: DECIBEL_VAULT_NO_STORE_HEADERS },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "A valid JSON object is required" },
      { status: 400, headers: DECIBEL_VAULT_NO_STORE_HEADERS },
    );
  }

  const network = (body as { network?: unknown }).network;
  if (network !== undefined && network !== "testnet" && network !== "mainnet") {
    return NextResponse.json(
      { error: "network must be testnet or mainnet" },
      { status: 400, headers: DECIBEL_VAULT_NO_STORE_HEADERS },
    );
  }

  try {
    return NextResponse.json(builder(body as T), {
      headers: DECIBEL_VAULT_NO_STORE_HEADERS,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Vault transaction fields are invalid";
    return NextResponse.json(
      { error: message.slice(0, 240) },
      { status: 400, headers: DECIBEL_VAULT_NO_STORE_HEADERS },
    );
  }
}
