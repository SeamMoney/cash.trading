/**
 * Strict decoders for the price traces returned by the sealed-vault Move views.
 *
 * These traces are the only price history an attestation may evaluate. Re-fetching an
 * off-chain feed can produce different bars, timestamps, or retention windows and would make
 * a valid signature claim that the committed program saw data it never actually committed.
 */

const MAX_U64 = (1n << 64n) - 1n;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const PRICE_SCALE = 100_000_000;

export function parseMoveU64(value: unknown, label: string): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a safe unsigned integer`);
    }
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    parsed = BigInt(value);
  } else {
    throw new Error(`${label} must be a decimal unsigned integer`);
  }

  if (parsed < 0n || parsed > MAX_U64) {
    throw new Error(`${label} is outside the Move u64 range`);
  }
  return parsed;
}

export interface SingleCommittedTrace {
  closes: number[];
  timestamps: bigint[];
}

export interface PortfolioCommittedTrace {
  closesByMarket: number[][];
  timestamps: bigint[];
  marketWidth: number;
}

function parseVector(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a vector`);
  return value;
}

function parsePrice(value: unknown, label: string): number {
  const price = parseMoveU64(value, label);
  if (price === 0n) throw new Error(`${label} must be greater than zero`);
  if (price > MAX_SAFE_BIGINT) {
    throw new Error(`${label} cannot be represented exactly by the JavaScript evaluator`);
  }
  return Number(price) / PRICE_SCALE;
}

function parseTimestamps(raw: unknown[]): bigint[] {
  const timestamps = raw.map((value, i) => parseMoveU64(value, `trace timestamp ${i}`));
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] <= timestamps[i - 1]) {
      throw new Error(`trace timestamps must increase strictly (row ${i})`);
    }
  }
  return timestamps;
}

function validateRetainedRows(seq: bigint, rows: number): void {
  if (seq === 0n) {
    if (rows !== 0) throw new Error("a sequence-zero vault must have an empty trace");
    return;
  }
  if (rows === 0) throw new Error("a non-empty vault sequence must retain at least one trace row");
  if (BigInt(rows) > seq) {
    throw new Error(`trace retains ${rows} rows but the vault sequence is only ${seq}`);
  }
}

/** Decode `(vector<u64> prices, vector<u64> timestamps)` from `sealed_vault::get_trace`. */
export function parseSingleCommittedTrace(
  view: unknown,
  seq: bigint,
  lastBarTs: bigint,
): SingleCommittedTrace {
  if (!Array.isArray(view) || view.length < 2) {
    throw new Error("sealed trace view must return prices and timestamps");
  }
  const prices = parseVector(view[0], "trace prices");
  const rawTimestamps = parseVector(view[1], "trace timestamps");
  if (prices.length !== rawTimestamps.length) {
    throw new Error(
      `sealed trace has ${prices.length} prices but ${rawTimestamps.length} timestamps`,
    );
  }

  validateRetainedRows(seq, prices.length);
  if (seq === 0n && lastBarTs !== 0n) {
    throw new Error("a sequence-zero vault must have a zero last-bar timestamp");
  }

  const timestamps = parseTimestamps(rawTimestamps);
  if (timestamps.length > 0 && timestamps[timestamps.length - 1] !== lastBarTs) {
    throw new Error(
      `trace ends at ${timestamps[timestamps.length - 1]} but context says ${lastBarTs}`,
    );
  }

  return {
    closes: prices.map((value, i) => parsePrice(value, `trace price ${i}`)),
    timestamps,
  };
}

/**
 * Decode `(vector<u64> flat_prices, vector<u64> timestamps, u64 markets_len)` from
 * `portfolio_vault::get_trace` and restore one close series per frozen market index.
 */
export function parsePortfolioCommittedTrace(
  view: unknown,
  seq: bigint,
  expectedWidth: number,
): PortfolioCommittedTrace {
  if (!Number.isSafeInteger(expectedWidth) || expectedWidth <= 0) {
    throw new Error("expected portfolio market width must be a positive safe integer");
  }
  if (!Array.isArray(view) || view.length < 3) {
    throw new Error("portfolio trace view must return prices, timestamps, and market width");
  }

  const flatPrices = parseVector(view[0], "portfolio trace prices");
  const rawTimestamps = parseVector(view[1], "portfolio trace timestamps");
  const widthRaw = parseMoveU64(view[2], "portfolio trace market width");
  if (widthRaw > MAX_SAFE_BIGINT) {
    throw new Error("portfolio trace market width is too large");
  }
  const marketWidth = Number(widthRaw);
  if (marketWidth !== expectedWidth) {
    throw new Error(
      `portfolio trace width is ${marketWidth}, expected ${expectedWidth} frozen markets`,
    );
  }
  if (flatPrices.length !== rawTimestamps.length * marketWidth) {
    throw new Error(
      `portfolio trace has ${flatPrices.length} prices for ${rawTimestamps.length} rows × ${marketWidth} markets`,
    );
  }

  validateRetainedRows(seq, rawTimestamps.length);
  const timestamps = parseTimestamps(rawTimestamps);
  const closesByMarket = Array.from({ length: marketWidth }, () => [] as number[]);
  for (let row = 0; row < timestamps.length; row++) {
    for (let market = 0; market < marketWidth; market++) {
      const at = row * marketWidth + market;
      closesByMarket[market].push(
        parsePrice(flatPrices[at], `portfolio trace price row ${row}, market ${market}`),
      );
    }
  }

  return { closesByMarket, timestamps, marketWidth };
}
