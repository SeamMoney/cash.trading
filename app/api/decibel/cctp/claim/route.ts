import { NextRequest, NextResponse } from "next/server";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import {
  buildAptosCctpClaimPayload,
  getCctpDomain,
  isValidCctpAttestation,
  parseCctpMessage,
} from "@/lib/decibel-cctp";
import { checkApiRateLimit, checkRateLimitForKey } from "@/lib/api-rate-limit";
import type { DecibelNetwork } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const MAX_BODY_BYTES = 96_000;
const MAX_CCTP_HEX_CHARS = 32_000;
const MAX_RELAY_GAS_OCTAS = 5_000_000n;
const ZERO_CCTP_ADDRESS = `0x${"0".repeat(64)}`;

function getSponsorAccount(): Account | null {
  const raw = process.env.SPONSOR_PRIVATE_KEY || "";
  if (!raw.trim()) return null;
  try {
    return Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(raw.trim()),
    });
  } catch {
    return null;
  }
}

function aptosFor(network: DecibelNetwork) {
  return new Aptos(
    new AptosConfig({
      network: network === "mainnet" ? Network.MAINNET : Network.TESTNET,
    }),
  );
}

function isAlreadyClaimedVmStatus(vmStatus: string) {
  const normalized = vmStatus.toLowerCase();
  // message_transmitter::ENONCE_ALREADY_USED is error::already_exists(10),
  // encoded as 0x8000a (524298) by Move.
  return (
    normalized.includes("nonce already used") ||
    normalized.includes("nonce_already_used") ||
    normalized.includes("0x8000a") ||
    normalized.includes("524298")
  );
}

export async function POST(req: NextRequest) {
  const ipRate = checkApiRateLimit(req, "cctp-claim", 10, 60_000);
  if (!ipRate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: ipRate.retryAfterS },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(ipRate.retryAfterS ?? 60),
        },
      },
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "request body is too large" },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }

  let body: unknown;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "request body is too large" },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const network = (body as { network?: unknown })?.network;
  const messageBytes = (body as { messageBytes?: unknown })?.messageBytes;
  const attestation = (body as { attestation?: unknown })?.attestation;
  if (network !== "mainnet" && network !== "testnet") {
    return NextResponse.json(
      { error: "network must be mainnet or testnet" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (
    typeof messageBytes !== "string" ||
    typeof attestation !== "string" ||
    messageBytes.length > MAX_CCTP_HEX_CHARS ||
    attestation.length > MAX_CCTP_HEX_CHARS
  ) {
    return NextResponse.json(
      { error: "messageBytes and attestation must be bounded hex strings" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!isValidCctpAttestation(attestation)) {
    return NextResponse.json(
      { error: "Circle attestation is not ready" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = parseCctpMessage(messageBytes);
  if (!parsed) {
    return NextResponse.json(
      { error: "invalid CCTP message" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (parsed.destinationDomain !== getCctpDomain("Aptos")) {
    return NextResponse.json(
      { error: "CCTP message is not addressed to Aptos" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (parsed.destinationCaller !== ZERO_CCTP_ADDRESS) {
    return NextResponse.json(
      { error: "CCTP message requires a different destination caller" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const transferRate = checkRateLimitForKey(
    "cctp-claim-transfer",
    `${network}:${parsed.sourceDomain}:${parsed.nonce}`,
    6,
    10 * 60_000,
  );
  if (!transferRate.allowed) {
    return NextResponse.json(
      {
        error: "claim retry limit reached",
        retryAfterS: transferRate.retryAfterS,
      },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(transferRate.retryAfterS ?? 600),
        },
      },
    );
  }

  const sponsor = getSponsorAccount();
  if (!sponsor) {
    return NextResponse.json(
      { error: "claim relayer is unavailable" },
      { status: 501, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const client = aptosFor(network);
    const transaction = await client.transaction.build.simple({
      sender: sponsor.accountAddress,
      data: buildAptosCctpClaimPayload({
        attestation,
        messageBytes,
        network,
      }),
      options: { maxGasAmount: 20_000 },
    });
    const gasBudget =
      BigInt(transaction.rawTransaction.max_gas_amount) *
      BigInt(transaction.rawTransaction.gas_unit_price);
    if (gasBudget > MAX_RELAY_GAS_OCTAS) {
      return NextResponse.json(
        { error: "claim gas budget exceeds relayer cap" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    const [simulation] = await client.transaction.simulate.simple({
      signerPublicKey: sponsor.publicKey,
      transaction,
    });
    if (!simulation?.success) {
      const vmStatus = simulation?.vm_status ?? "unknown";
      if (isAlreadyClaimedVmStatus(vmStatus)) {
        return NextResponse.json(
          { alreadyClaimed: true },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      return NextResponse.json(
        { error: "claim fails simulation", vmStatus },
        { status: 422, headers: NO_STORE_HEADERS },
      );
    }

    const senderAuthenticator = client.transaction.sign({
      signer: sponsor,
      transaction,
    });
    const pending = await client.transaction.submit.simple({
      transaction,
      senderAuthenticator,
    });
    return NextResponse.json(
      {
        hash: pending.hash,
        mintRecipient: parsed.mintRecipient,
        relayed: true,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "claim relay failed";
    if (isAlreadyClaimedVmStatus(message)) {
      return NextResponse.json(
        { alreadyClaimed: true },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
