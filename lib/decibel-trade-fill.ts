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
  const candidates: Array<{
    priceRaw: number;
    sizeRaw: number;
    score: number;
    source: "trade" | "order" | "bulk";
    identityMatches: boolean;
    isTaker: boolean;
  }> = [];

  for (const value of events) {
    if (typeof value !== "object" || value === null) continue;
    const event = value as EventRecord;
    if (!event.type || !event.data) continue;
    const data = event.data;
    const eventMarketKey = addressKey(eventMarket(data.market));
    if (marketKey && eventMarketKey && marketKey !== eventMarketKey) continue;

    const identityMatches = [data.parent, data.user, data.account]
      .some((address) => addressKey(address) === subaccountKey);
    const isTaker = data.is_taker === true || data.is_taker === "true";

    // TradeEvent is the authoritative executed fill. A market order can cross
    // several makers, so retain every taker-side event and aggregate them
    // below instead of reporting the final OrderEvent price for the full size.
    if (event.type.includes("TradeEvent")) {
      const sizeRaw = Number(data.size);
      const priceRaw = Number(data.price);
      if (Number.isFinite(sizeRaw) && Number.isFinite(priceRaw) && sizeRaw > 0 && priceRaw > 0) {
        candidates.push({
          priceRaw,
          sizeRaw,
          score: (identityMatches ? 4 : 0) + (isTaker ? 2 : 0) + 4,
          source: "trade",
          identityMatches,
          isTaker,
        });
      }
      continue;
    }

    if (event.type.includes("BulkOrderFilledEvent")) {
      const sizeRaw = Number(data.filled_size ?? data.size);
      const priceRaw = Number(data.price ?? data.avg_price);
      if (Number.isFinite(sizeRaw) && Number.isFinite(priceRaw) && sizeRaw > 0 && priceRaw > 0) {
        candidates.push({
          priceRaw,
          sizeRaw,
          score: (identityMatches ? 4 : 0) + 1,
          source: "bulk",
          identityMatches,
          isTaker: false,
        });
      }
      continue;
    }

    if (!event.type.includes("OrderEvent")) continue;
    if (variantName(data.status).toUpperCase() !== "FILLED") continue;

    const originalSize = Number(data.orig_size);
    const remainingSize = Number(data.remaining_size ?? 0);
    const sizeRaw = originalSize - remainingSize;
    const priceRaw = Number(data.price);
    if (!Number.isFinite(sizeRaw) || !Number.isFinite(priceRaw) || sizeRaw <= 0 || priceRaw <= 0) {
      continue;
    }

    candidates.push({
      priceRaw,
      sizeRaw,
      score: (identityMatches ? 4 : 0) + (isTaker ? 2 : 0),
      source: "order",
      identityMatches,
      isTaker,
    });
  }

  const takerTradeFills = candidates.filter(
    (candidate) => candidate.source === "trade" && candidate.identityMatches && candidate.isTaker,
  );
  if (takerTradeFills.length > 0) {
    const fills = takerTradeFills.map((fill) => ({
      price: fill.priceRaw / priceScale,
      size: fill.sizeRaw / sizeScale,
    }));
    const size = fills.reduce((total, fill) => total + fill.size, 0);
    if (size > 0) {
      return {
        price: fills.reduce((total, fill) => total + fill.price * fill.size, 0) / size,
        size,
      };
    }
  }

  const fill = candidates.sort((a, b) => b.score - a.score)[0];
  if (!fill || fill.score < 2) return null;
  return {
    price: fill.priceRaw / priceScale,
    size: fill.sizeRaw / sizeScale,
  };
}
