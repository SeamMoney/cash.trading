import { NextRequest, NextResponse } from "next/server";
import {
  getCctpDomain,
  getSourceTxExplorerUrl,
  isLikelySourceTxHash,
  isValidCctpAttestation,
  normalizeSourceTxHash,
  parseCctpMessage,
} from "@/lib/decibel-cctp";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const MAX_IRIS_RESPONSE_BYTES = 256_000;

type CircleMessage = {
  message?: string;
  attestation?: string;
};

type CircleMessagesResponse = CircleMessage & {
  messages?: CircleMessage[];
};

function getIrisBaseUrl(network: "testnet" | "mainnet") {
  if (network === "testnet") return "https://iris-api-sandbox.circle.com";
  return "https://iris-api.circle.com";
}

function pickCircleMessage(body: CircleMessagesResponse): CircleMessage | null {
  if (typeof body.message === "string") return body;
  const first = body.messages?.find((item) => typeof item.message === "string");
  return first ?? null;
}

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "cctp-status", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const { searchParams } = new URL(req.url);
  const sourceChain = searchParams.get("sourceChain") ?? "";
  const rawNetwork = searchParams.get("network") ?? "mainnet";
  if (rawNetwork !== "testnet" && rawNetwork !== "mainnet") {
    return NextResponse.json(
      { error: "network must be testnet or mainnet" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const network = rawNetwork;
  const txHash = normalizeSourceTxHash(searchParams.get("txHash") ?? "");
  const sourceDomain = getCctpDomain(sourceChain);

  if (!sourceDomain && sourceDomain !== 0) {
    return NextResponse.json(
      { error: "Unsupported CCTP source chain." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!isLikelySourceTxHash(txHash)) {
    return NextResponse.json(
      { error: "Enter a valid transfer transaction hash." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const endpoint = `${getIrisBaseUrl(network)}/v1/messages/${sourceDomain}/${encodeURIComponent(txHash)}`;
    const irisRes = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (irisRes.status === 404) {
      return NextResponse.json(
        {
          error: "Transfer not found yet. Wait for the source-chain transaction to confirm, then retry.",
        },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const rawText = await irisRes.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_IRIS_RESPONSE_BYTES) {
      return NextResponse.json(
        { error: "Circle returned an oversized response." },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
    let data: CircleMessagesResponse;
    try {
      data = JSON.parse(rawText) as CircleMessagesResponse;
    } catch {
      return NextResponse.json(
        { error: "Circle returned an unreadable transfer response." },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    if (!irisRes.ok) {
      console.error("[cctp-status] Circle lookup failed:", irisRes.status);
      return NextResponse.json(
        { error: "Circle transfer status is temporarily unavailable." },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    const message = pickCircleMessage(data);
    if (!message?.message) {
      return NextResponse.json(
        { error: "Transfer not found in Circle Iris yet." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    if (
      message.message.length > 32_000 ||
      (typeof message.attestation === "string" && message.attestation.length > 32_000)
    ) {
      return NextResponse.json(
        { error: "Circle returned an oversized CCTP message." },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    const parsed = parseCctpMessage(message.message);
    if (!parsed) {
      return NextResponse.json(
        { error: "Circle returned an unreadable CCTP message." },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    const hasAttestation = isValidCctpAttestation(message.attestation);
    const destinationIsAptos = parsed.destinationDomain === getCctpDomain("Aptos");

    return NextResponse.json({
      txHash,
      sourceChain: parsed.sourceChain,
      sourceDomain: parsed.sourceDomain,
      destinationChain: parsed.destinationChain,
      destinationDomain: parsed.destinationDomain,
      destinationCaller: parsed.destinationCaller,
      destinationIsAptos,
      amount: parsed.amount,
      mintRecipient: parsed.mintRecipient,
      nonce: parsed.nonce,
      messageBytes: message.message,
      attestation: hasAttestation ? message.attestation : null,
      status: hasAttestation ? "claimable" : "pending",
      explorerUrl: getSourceTxExplorerUrl(sourceChain, txHash),
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "CCTP lookup failed";
    console.error("[cctp-status] lookup failed:", message);
    return NextResponse.json(
      { error: "Failed to look up the CCTP transfer." },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
