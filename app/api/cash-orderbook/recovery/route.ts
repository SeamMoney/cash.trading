import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { fetchMainnetAptos } from "@/lib/aptos-server-lite";
import {
  classifyCashAmbiguityRecovery,
  createCashAmbiguityRecord,
  normalizeCashAmbiguityIdentity,
  normalizeCashAmbiguityOwner,
  validateCashAccountObservation,
  validateCashAmbiguityRecord,
  type CashAccountObservation,
  type CashAmbiguityErrorResponse,
  type CashAmbiguityIdentity,
  type CashAmbiguityPrepareResponse,
  type CashAmbiguityResolveResponse,
} from "@/lib/cash-orderbook-ambiguity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UPSTREAM_TIMEOUT_MS = 4_500;
const REQUEST_BODY_TIMEOUT_MS = 4_000;
const MAX_REQUEST_BYTES = 12_000;
const MAX_ACCOUNT_BODY_BYTES = 20_000;
const MAX_TRANSACTIONS_BODY_BYTES = 250_000;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

type RecoveryRequest =
  | { action: "prepare"; ownerAddress: unknown; identity: CashAmbiguityIdentity }
  | { action: "resolve"; ambiguity: unknown };

type UpstreamJson = { body: unknown; headers: Headers };

async function readBoundedUtf8(args: {
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
  maxBytes: number;
  label: string;
  timeoutMs: number;
}) {
  const declaredLength = args.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) {
      await args.body?.cancel();
      throw new Error(`${args.label} length was malformed`);
    }
    if (BigInt(declaredLength) > BigInt(args.maxBytes)) {
      await args.body?.cancel();
      throw new Error(`${args.label} exceeded the size bound`);
    }
  }
  if (!args.body) return "";
  const reader = args.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let deadlineReached = false;
  const deadline = setTimeout(() => {
    deadlineReached = true;
    void reader.cancel().catch(() => undefined);
  }, args.timeoutMs);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > args.maxBytes) {
        await reader.cancel();
        throw new Error(`${args.label} exceeded the size bound`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (deadlineReached) throw new Error(`${args.label} timed out`);
    throw error;
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  if (deadlineReached) throw new Error(`${args.label} timed out`);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function mainnetConfigIsExplicit() {
  return process.env.DECIBEL_NETWORK === "mainnet"
    && process.env.NEXT_PUBLIC_DECIBEL_NETWORK === "mainnet";
}

function unavailable(message: string, status: number) {
  return NextResponse.json(
    { ready: false, message } satisfies CashAmbiguityErrorResponse,
    { status, headers: NO_STORE_HEADERS },
  );
}

async function readRequest(request: NextRequest): Promise<RecoveryRequest> {
  const text = await readBoundedUtf8({
    body: request.body,
    headers: request.headers,
    maxBytes: MAX_REQUEST_BYTES,
    label: "request body",
    timeoutMs: REQUEST_BODY_TIMEOUT_MS,
  });
  const parsed = JSON.parse(text) as Partial<RecoveryRequest>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be an object");
  }
  if (parsed.action === "prepare") {
    return {
      action: "prepare",
      ownerAddress: parsed.ownerAddress,
      identity: parsed.identity as CashAmbiguityIdentity,
    };
  }
  if (parsed.action === "resolve") return { action: "resolve", ambiguity: parsed.ambiguity };
  throw new Error("action must be prepare or resolve");
}

async function fetchMainnetJson(args: {
  path: string;
  maxBytes: number;
  requestSignal: AbortSignal;
}): Promise<UpstreamJson> {
  const response = await fetchMainnetAptos(args.path, {
    signal: args.requestSignal,
    headers: {
      Accept: "application/json",
    },
  }, {
    clientName: "cash-trading/cash-orderbook-recovery",
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Aptos mainnet recovery upstream returned ${response.status}`);
  }
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    await response.body?.cancel();
    throw new Error("Aptos mainnet recovery upstream did not return JSON");
  }
  const text = await readBoundedUtf8({
    body: response.body,
    headers: response.headers,
    maxBytes: args.maxBytes,
    label: "Aptos mainnet recovery response",
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
  return { body: JSON.parse(text) as unknown, headers: response.headers };
}

async function fetchAccountObservation(args: {
  ownerAddress: string;
  requestSignal: AbortSignal;
}): Promise<CashAccountObservation> {
  const account = await fetchMainnetJson({
    path: `/accounts/${encodeURIComponent(args.ownerAddress)}`,
    maxBytes: MAX_ACCOUNT_BODY_BYTES,
    requestSignal: args.requestSignal,
  });
  return validateCashAccountObservation({
    account: account.body,
    chainId: account.headers.get("x-aptos-chain-id"),
    ledgerVersion: account.headers.get("x-aptos-ledger-version"),
    ledgerTimestampUsec: account.headers.get("x-aptos-ledger-timestampusec"),
    nowMs: Date.now(),
  });
}

async function fetchCandidateTransaction(args: {
  ownerAddress: string;
  sequenceNumber: string;
  requestSignal: AbortSignal;
}) {
  const response = await fetchMainnetJson({
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
  const rate = checkApiRateLimit(request, "cash-orderbook-mainnet-recovery", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { ready: false, message: "Too many wallet safety checks. Try again shortly." } satisfies CashAmbiguityErrorResponse,
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }
  if (!mainnetConfigIsExplicit()) {
    return unavailable("CASH wallet safety checks require explicit Aptos mainnet configuration.", 503);
  }
  let body: RecoveryRequest;
  try {
    body = await readRequest(request);
  } catch {
    return unavailable("The CASH wallet safety request was invalid.", 400);
  }

  try {
    if (body.action === "prepare") {
      const ownerAddress = normalizeCashAmbiguityOwner(String(body.ownerAddress ?? ""));
      const identity = normalizeCashAmbiguityIdentity(body.identity);
      if (identity.ownerAddress !== ownerAddress) {
        return unavailable("The wallet owner did not match the reviewed CASH transaction.", 400);
      }
      const observation = await fetchAccountObservation({
        ownerAddress,
        requestSignal: request.signal,
      });
      const ambiguity = createCashAmbiguityRecord({ identity, observation });
      return NextResponse.json(
        { ready: true, action: "prepare", ambiguity } satisfies CashAmbiguityPrepareResponse,
        { headers: NO_STORE_HEADERS },
      );
    }

    const ambiguity = validateCashAmbiguityRecord(body.ambiguity);
    // Read the candidate first. The later account watermark must contain the
    // candidate's version before it can prove that this sequence was consumed.
    const candidateTransaction = await fetchCandidateTransaction({
      ownerAddress: ambiguity.ownerAddress,
      sequenceNumber: ambiguity.preSignSequenceNumber,
      requestSignal: request.signal,
    });
    const observation = await fetchAccountObservation({
      ownerAddress: ambiguity.ownerAddress,
      requestSignal: request.signal,
    });
    const recovery = classifyCashAmbiguityRecovery({
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
      } satisfies CashAmbiguityResolveResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown CASH wallet safety error";
    const timedOut = /timeout|aborted/i.test(message) || error instanceof DOMException;
    console.error("[cash-orderbook-recovery] fail-closed validation:", message);
    return unavailable(
      timedOut ? "The Aptos wallet safety check timed out." : "Aptos wallet safety data failed validation.",
      timedOut ? 504 : 502,
    );
  }
}
