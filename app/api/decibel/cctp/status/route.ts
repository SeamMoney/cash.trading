import { NextRequest, NextResponse } from "next/server";
import {
  getCctpDomain,
  getSourceTxExplorerUrl,
  isLikelySourceTxHash,
  isValidCctpAttestation,
  normalizeSourceTxHash,
  parseCctpMessage,
} from "@/lib/decibel-cctp";

type CircleMessage = {
  message?: string;
  attestation?: string;
};

type CircleMessagesResponse = CircleMessage & {
  messages?: CircleMessage[];
};

function getIrisBaseUrl(network: string | null) {
  if (network === "testnet") return "https://iris-api-sandbox.circle.com";
  return "https://iris-api.circle.com";
}

function pickCircleMessage(body: CircleMessagesResponse): CircleMessage | null {
  if (typeof body.message === "string") return body;
  const first = body.messages?.find((item) => typeof item.message === "string");
  return first ?? null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sourceChain = searchParams.get("sourceChain") ?? "";
  const network = searchParams.get("network") ?? "mainnet";
  const txHash = normalizeSourceTxHash(searchParams.get("txHash") ?? "");
  const sourceDomain = getCctpDomain(sourceChain);

  if (!sourceDomain && sourceDomain !== 0) {
    return NextResponse.json(
      { error: "Unsupported CCTP source chain." },
      { status: 400 }
    );
  }

  if (!isLikelySourceTxHash(txHash)) {
    return NextResponse.json(
      { error: "Enter a valid transfer transaction hash." },
      { status: 400 }
    );
  }

  try {
    const endpoint = `${getIrisBaseUrl(network)}/v1/messages/${sourceDomain}/${encodeURIComponent(txHash)}`;
    const irisRes = await fetch(endpoint, { cache: "no-store" });

    if (irisRes.status === 404) {
      return NextResponse.json(
        {
          error: "Transfer not found yet. Wait for the source-chain transaction to confirm, then retry.",
        },
        { status: 404 }
      );
    }

    const rawText = await irisRes.text();
    let data: CircleMessagesResponse;
    try {
      data = JSON.parse(rawText) as CircleMessagesResponse;
    } catch {
      return NextResponse.json(
        { error: rawText || `Circle Iris lookup failed (${irisRes.status})` },
        { status: irisRes.ok ? 502 : irisRes.status }
      );
    }

    if (!irisRes.ok) {
      return NextResponse.json(
        {
          error:
            typeof (data as { error?: unknown }).error === "string"
              ? (data as { error: string }).error
              : `Circle Iris lookup failed (${irisRes.status})`,
        },
        { status: irisRes.status }
      );
    }

    const message = pickCircleMessage(data);
    if (!message?.message) {
      return NextResponse.json(
        { error: "Transfer not found in Circle Iris yet." },
        { status: 404 }
      );
    }

    const parsed = parseCctpMessage(message.message);
    if (!parsed) {
      return NextResponse.json(
        { error: "Circle returned an unreadable CCTP message." },
        { status: 502 }
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
      destinationIsAptos,
      amount: parsed.amount,
      mintRecipient: parsed.mintRecipient,
      nonce: parsed.nonce,
      messageBytes: message.message,
      attestation: hasAttestation ? message.attestation : null,
      status: hasAttestation ? "claimable" : "pending",
      explorerUrl: getSourceTxExplorerUrl(sourceChain, txHash),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to look up the CCTP transfer.",
      },
      { status: 500 }
    );
  }
}
