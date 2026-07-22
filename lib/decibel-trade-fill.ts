type EventRecord = {
  data?: Record<string, unknown>;
  type?: string;
};

function addressKey(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return "";
  return value.slice(2).toLowerCase().padStart(64, "0");
}

function variantName(value: unknown) {
  if (typeof value === "object" && value !== null && "__variant__" in value) {
    return String((value as { __variant__?: unknown }).__variant__ ?? "");
  }
  return String(value ?? "");
}

function eventMarket(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "inner" in value) {
    return String((value as { inner?: unknown }).inner ?? "");
  }
  return "";
}

function numericScale(rawValue: unknown, humanValue: unknown) {
  const raw = Number(rawValue);
  const human = Number(humanValue);
  if (!Number.isFinite(raw) || !Number.isFinite(human) || raw <= 0 || human <= 0) {
    return null;
  }
  const scale = raw / human;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

/** Extract the exact taker fill emitted by a confirmed Decibel market order. */
export function extractConfirmedDecibelFill(args: {
  transaction: unknown;
  subaccount: string;
  marketAddress?: string;
  requestedSize: unknown;
  requestedSizeRaw: unknown;
  requestedPrice: unknown;
  requestedPriceRaw: unknown;
}) {
  if (typeof args.transaction !== "object" || args.transaction === null) return null;
  const events = (args.transaction as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;

  const sizeScale = numericScale(args.requestedSizeRaw, args.requestedSize);
  const priceScale = numericScale(args.requestedPriceRaw, args.requestedPrice);
  if (!sizeScale || !priceScale) return null;

  const subaccountKey = addressKey(args.subaccount);
  const marketKey = addressKey(args.marketAddress);
  const candidates: Array<{ priceRaw: number; sizeRaw: number; score: number }> = [];

  for (const value of events) {
    if (typeof value !== "object" || value === null) continue;
    const event = value as EventRecord;
    if (!event.type?.includes("OrderEvent") || !event.data) continue;
    const data = event.data;
    if (variantName(data.status).toUpperCase() !== "FILLED") continue;
    const eventMarketKey = addressKey(eventMarket(data.market));
    if (marketKey && eventMarketKey && marketKey !== eventMarketKey) continue;

    const originalSize = Number(data.orig_size);
    const remainingSize = Number(data.remaining_size ?? 0);
    const sizeRaw = originalSize - remainingSize;
    const priceRaw = Number(data.price);
    if (!Number.isFinite(sizeRaw) || !Number.isFinite(priceRaw) || sizeRaw <= 0 || priceRaw <= 0) {
      continue;
    }

    const identityMatches = [data.parent, data.user, data.account]
      .some((address) => addressKey(address) === subaccountKey);
    const isTaker = data.is_taker === true || data.is_taker === "true";
    candidates.push({
      priceRaw,
      sizeRaw,
      score: (identityMatches ? 4 : 0) + (isTaker ? 2 : 0),
    });
  }

  const fill = candidates.sort((a, b) => b.score - a.score)[0];
  if (!fill || fill.score < 2) return null;
  return {
    price: fill.priceRaw / priceScale,
    size: fill.sizeRaw / sizeScale,
  };
}
