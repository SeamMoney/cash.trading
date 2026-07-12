export interface OnChainTradeRecord {
  tradeId: number;
  signal: 1 | 2;
  price: number;
  gainBps: number;
  lossBps: number;
  timestamp: number;
  type: "BUY" | "SELL";
  pnlBps: number;
}

export interface OnChainTradePair {
  entryTrade: OnChainTradeRecord;
  exitTrade: OnChainTradeRecord | null;
  pnlBps: number;
  pnlPct: number;
}

export function parseSafeUnsigned(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} is not a safe unsigned integer`);
  }
  return parsed;
}

export function decodeMoveU8Vector(value: unknown, field = "vector<u8>"): number[] {
  let bytes: number[];
  if (Array.isArray(value)) {
    bytes = value.map((entry, index) => {
      const parsed = parseSafeUnsigned(entry, `${field}[${index}]`);
      if (parsed > 255) throw new Error(`${field}[${index}] is outside the u8 range`);
      return parsed;
    });
  } else if (typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    const hex = value.slice(2);
    bytes = [];
    for (let index = 0; index < hex.length; index += 2) {
      bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
    }
  } else {
    throw new Error(`${field} is not a Move byte vector`);
  }
  return bytes;
}

export function unwrapMoveVectorView(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length !== 1 || !Array.isArray(value[0])) {
    throw new Error(`${field} did not return a single Move vector`);
  }
  return value[0];
}

function requireVector(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} is not a vector`);
  return value;
}

export function parseOnChainTradeVectors(value: unknown): OnChainTradeRecord[] {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new Error("get_trades returned an unexpected tuple");
  }

  const ids = requireVector(value[0], "trade ids");
  const signals = decodeMoveU8Vector(value[1], "trade signals");
  const prices = requireVector(value[2], "trade prices");
  const gains = requireVector(value[3], "trade gains");
  const losses = requireVector(value[4], "trade losses");
  const timestamps = requireVector(value[5], "trade timestamps");
  const length = ids.length;

  if (length > 200 || [signals, prices, gains, losses, timestamps].some((part) => part.length !== length)) {
    throw new Error("get_trades returned misaligned vectors");
  }

  return ids.map((id, index) => {
    const signal = signals[index];
    if (signal !== 1 && signal !== 2) {
      throw new Error(`trade signals[${index}] is not BUY or SELL`);
    }
    const gainBps = parseSafeUnsigned(gains[index], `trade gains[${index}]`);
    const lossBps = parseSafeUnsigned(losses[index], `trade losses[${index}]`);
    const timestamp = parseSafeUnsigned(timestamps[index], `trade timestamps[${index}]`);
    if (timestamp === 0) throw new Error(`trade timestamps[${index}] is zero`);

    return {
      tradeId: parseSafeUnsigned(id, `trade ids[${index}]`),
      signal,
      price: parseSafeUnsigned(prices[index], `trade prices[${index}]`) / 1e8,
      gainBps,
      lossBps,
      timestamp,
      type: signal === 1 ? "BUY" : "SELL",
      pnlBps: signal === 2 ? (gainBps > 0 ? gainBps : -lossBps) : 0,
    };
  });
}

/**
 * The Move contract replaces its entry price on every BUY crossover. Pair a
 * SELL with the most recent unmatched BUY so the UI mirrors that state machine.
 */
export function pairOnChainTrades(trades: OnChainTradeRecord[]): OnChainTradePair[] {
  const pairs: OnChainTradePair[] = [];
  let openEntry: OnChainTradeRecord | null = null;

  for (const trade of trades) {
    if (trade.signal === 1) {
      openEntry = trade;
      continue;
    }
    if (!openEntry) continue;
    pairs.push({
      entryTrade: openEntry,
      exitTrade: trade,
      pnlBps: trade.pnlBps,
      pnlPct: trade.pnlBps / 100,
    });
    openEntry = null;
  }

  if (openEntry) {
    pairs.push({ entryTrade: openEntry, exitTrade: null, pnlBps: 0, pnlPct: 0 });
  }
  return pairs;
}
