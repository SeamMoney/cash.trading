import {
  validateDecibelSpotSettlementLookup,
  validateDecibelSpotSettlementResponse,
  type DecibelSpotSettlementLookup,
  type DecibelSpotSettlementResponse,
} from "./decibel-spot";

const MAX_RESPONSE_BYTES = 64_000;

export type DecibelSpotSettlementPollResult = DecibelSpotSettlementResponse;

export function isDecibelSpotSettlementTerminal(
  result: DecibelSpotSettlementPollResult,
) {
  return result.settlement.status === "filled" || result.settlement.status === "no-fill";
}

/**
 * One bounded, no-store poll of a previously confirmed Decibel CBS spot order.
 * Callers must keep the wallet flow locked for both `pending` and `unverified`.
 */
export async function fetchDecibelSpotSettlementStatus(args: {
  lookup: DecibelSpotSettlementLookup;
  signal?: AbortSignal;
}): Promise<DecibelSpotSettlementPollResult> {
  const lookup = validateDecibelSpotSettlementLookup({
    ownerAddress: args.lookup.ownerAddress,
    market: args.lookup.marketAddress,
    orderId: args.lookup.orderId,
    expectedOrder: args.lookup.expectedOrder,
  });
  const params = new URLSearchParams({
    resource: "settlement",
    network: "mainnet",
    owner: lookup.ownerAddress,
    market: lookup.marketAddress,
    orderId: lookup.orderId,
  });
  if (lookup.expectedOrder) {
    params.set("priceAtomic", lookup.expectedOrder.priceAtomic);
    params.set("sizeAtomic", lookup.expectedOrder.sizeAtomic);
    params.set("isBid", String(lookup.expectedOrder.isBid));
  }
  const response = await fetch(`/api/decibel/spot?${params.toString()}`, {
    cache: "no-store",
    signal: args.signal,
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Decibel spot settlement response exceeded the size bound");
  }
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Decibel spot settlement returned malformed JSON");
  }
  if (!response.ok) {
    throw new Error("Decibel spot settlement is temporarily unavailable");
  }
  return validateDecibelSpotSettlementResponse({ value: body, lookup });
}
