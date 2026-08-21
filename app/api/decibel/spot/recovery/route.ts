import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { getAptosFullnodeApiKey } from "@/lib/decibel";
import {
  classifyDecibelSpotAmbiguityRecovery,
  createDecibelSpotAmbiguityRecord,
  makeDecibelSpotExactOrderIdentity,
  normalizeDecibelSpotOwnerKey,
  validateDecibelSpotAccountObservation,
  validateDecibelSpotAmbiguityRecord,
  type DecibelSpotAmbiguityErrorResponse,
  type DecibelSpotAmbiguityPrepareResponse,
  type DecibelSpotAmbiguityResolveResponse,
  type DecibelSpotAccountObservation,
} from "@/lib/decibel-spot-ambiguity";
import type { DecibelSpotOrderIdentity } from "@/lib/decibel-spot-confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const APTOS_MAINNET_FULLNODE_BASE = "https://api.mainnet.aptoslabs.com/v1";
const UPSTREAM_TIMEOUT_MS = 4_500;
const MAX_REQUEST_BYTES = 12_000;
const MAX_ACCOUNT_BODY_BYTES = 20_000;
const MAX_TRANSACTIONS_BODY_BYTES = 250_000;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

type RecoveryRequest =
  | {
      action: "prepare";
      ownerAddress: unknown;
      identity: DecibelSpotOrderIdentity;
    }
  | {
      action: "resolve";
      ambiguity: unknown;
    };

type UpstreamJson = {
  body: unknown;
  headers: Headers;
};

function mainnetConfigIsExplicit() {
  return process.env.DECIBEL_NETWORK === "mainnet"
    && process.env.NEXT_PUBLIC_DECIBEL_NETWORK === "mainnet";
}

function unavailable(message: string, status: number) {
  return NextResponse.json(
    { ready: false, message } satisfies DecibelSpotAmbiguityErrorResponse,
    { status, headers: NO_STORE_HEADERS },
  );
}

async function readRequest(request: NextRequest): Promise<RecoveryRequest> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_REQUEST_BYTES) {
    throw new Error("request body exceeded the size bound");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) {
    throw new Error("request body exceeded the size bound");
  }
  const parsed = JSON.parse(text) as Partial<RecoveryRequest>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be an object");
  }
  if (parsed.action === "prepare") {
    return {
      action: "prepare",
      ownerAddress: parsed.ownerAddress,
      identity: parsed.identity as DecibelSpotOrderIdentity,
    };
  }
  if (parsed.action === "resolve") {
    return { action: "resolve", ambiguity: parsed.ambiguity };
  }
  throw new Error("action must be prepare or resolve");
}

async function fetchMainnetJson(args: {
  apiKey: string;
  path: string;
  maxBytes: number;
  requestSignal: AbortSignal;
}): Promise<UpstreamJson> {
  const response = await fetch(`${APTOS_MAINNET_FULLNODE_BASE}${args.path}`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any([args.requestSignal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      "X-Aptos-Client": "cash-trading/decibel-spot-recovery",
    },
  });
  if (!response.ok) throw new Error(`Aptos mainnet recovery upstream returned ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Aptos mainnet recovery upstream did not return JSON");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > args.maxBytes) {
    throw new Error("Aptos mainnet recovery response exceeded the size bound");
  }
  return { body: JSON.parse(text) as unknown, headers: response.headers };
}

async function fetchAccountObservation(args: {
  apiKey: string;
  ownerAddress: string;
  requestSignal: AbortSignal;
}): Promise<DecibelSpotAccountObservation> {
  const account = await fetchMainnetJson({
    apiKey: args.apiKey,
    path: `/accounts/${encodeURIComponent(args.ownerAddress)}`,
    maxBytes: MAX_ACCOUNT_BODY_BYTES,
    requestSignal: args.requestSignal,
  });
  return validateDecibelSpotAccountObservation({
    account: account.body,
    chainId: account.headers.get("x-aptos-chain-id"),
    ledgerVersion: account.headers.get("x-aptos-ledger-version"),
    ledgerTimestampUsec: account.headers.get("x-aptos-ledger-timestampusec"),
    nowMs: Date.now(),
  });
}

async function fetchCandidateTransaction(args: {
  apiKey: string;
  ownerAddress: string;
  sequenceNumber: string;
  requestSignal: AbortSignal;
}) {
  const response = await fetchMainnetJson({
    apiKey: args.apiKey,
    path: `/accounts/${encodeURIComponent(args.ownerAddress)}/transactions?start=${encodeURIComponent(args.sequenceNumber)}&limit=1`,
    maxBytes: MAX_TRANSACTIONS_BODY_BYTES,
    requestSignal: args.requestSignal,
  });
  if (response.headers.get("x-aptos-chain-id") !== "1") {
    throw new Error("candidate transaction response was not from Aptos mainnet");
  }
  if (!Array.isArray(response.body) || response.body.length > 1) {
    throw new Error("candidate transaction response was malformed");
  }
  return response.body[0] ?? null;
}

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "decibel-mainnet-spot-recovery", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ready: false,
        message: "Too many wallet safety checks. Try again shortly.",
      } satisfies DecibelSpotAmbiguityErrorResponse,
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rate.retryAfterS ?? 60),
        },
      },
    );
  }
  if (!mainnetConfigIsExplicit()) {
    return unavailable("Wallet safety checks require explicit Aptos mainnet configuration.", 503);
  }
  const apiKey = getAptosFullnodeApiKey("mainnet");
  if (!apiKey) return unavailable("Wallet safety data credentials are unavailable.", 503);

  let body: RecoveryRequest;
  try {
    body = await readRequest(request);
  } catch {
    return unavailable("The wallet safety request was invalid.", 400);
  }

  try {
    if (body.action === "prepare") {
      const ownerAddress = normalizeDecibelSpotOwnerKey(String(body.ownerAddress ?? ""));
      const identity = makeDecibelSpotExactOrderIdentity(body.identity);
      if (identity.ownerAddress !== ownerAddress) {
        return unavailable("The wallet owner did not match the reviewed spot order.", 400);
      }
      const observation = await fetchAccountObservation({
        apiKey,
        ownerAddress,
        requestSignal: request.signal,
      });
      const ambiguity = createDecibelSpotAmbiguityRecord({ identity, observation });
      return NextResponse.json(
        {
          ready: true,
          action: "prepare",
          ambiguity,
        } satisfies DecibelSpotAmbiguityPrepareResponse,
        { headers: NO_STORE_HEADERS },
      );
    }

    const ambiguity = validateDecibelSpotAmbiguityRecord(body.ambiguity);
    // Read the candidate first, then take the account watermark. This ensures
    // a different transaction is never treated as sequence-consuming unless
    // the later account observation also contains its committed version.
    const candidateTransaction = await fetchCandidateTransaction({
      apiKey,
      ownerAddress: ambiguity.ownerAddress,
      sequenceNumber: ambiguity.preSignSequenceNumber,
      requestSignal: request.signal,
    });
    const observation = await fetchAccountObservation({
      apiKey,
      ownerAddress: ambiguity.ownerAddress,
      requestSignal: request.signal,
    });
    const recovery = classifyDecibelSpotAmbiguityRecovery({
      ambiguity,
      observation,
      candidateTransaction,
    });
    return NextResponse.json(
      {
        ready: true,
        action: "resolve",
        recovery,
        checkedAt: observation.ledgerTimestampMs,
      } satisfies DecibelSpotAmbiguityResolveResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown wallet safety error";
    const timedOut = /timeout|aborted/i.test(message) || error instanceof DOMException;
    console.error("[decibel-spot-recovery] fail-closed validation:", message);
    return unavailable(
      timedOut ? "The Aptos wallet safety check timed out." : "Aptos wallet safety data failed validation.",
      timedOut ? 504 : 502,
    );
  }
}
