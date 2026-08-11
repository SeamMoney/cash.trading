/**
 * Strict decoders for portfolio-vault view responses.
 *
 * An attestor must fail closed on malformed or mismatched chain state. In particular,
 * `market_idx` is positional: checking only the allowlist length can send a validly signed
 * action to the wrong Decibel market when two equal-length lists have different orders.
 */
import { AccountAddress } from "@aptos-labs/ts-sdk";

import { parseMoveU64 } from "@/lib/committed-price-trace";

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export interface PortfolioBounds {
  marketCount: number;
  maxPctBps: number;
  maxLeverageX100: number;
  maxPositions: number;
}

export interface PortfolioPositionSnapshot {
  held: Map<number, boolean>;
  /** Canonical representation used to detect a permissionless close between view calls. */
  fingerprint: string;
}

function tuple(value: unknown, length: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < length) {
    throw new Error(`${label} returned an invalid tuple`);
  }
  return value;
}

function vector(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a vector`);
  return value;
}

function safeNumber(value: unknown, label: string): number {
  const parsed = parseMoveU64(value, label);
  if (parsed > MAX_SAFE_BIGINT) {
    throw new Error(`${label} cannot be represented exactly by JavaScript`);
  }
  return Number(parsed);
}

export function normalizePortfolioAddress(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be an Aptos address`);
  const match = /^0x([0-9a-fA-F]{1,64})$/.exec(value.trim());
  if (!match) throw new Error(`${label} must be an Aptos address`);
  try {
    return AccountAddress.fromString(`0x${match[1].padStart(64, "0")}`)
      .toStringLong()
      .toLowerCase();
  } catch {
    throw new Error(`${label} must be an Aptos address`);
  }
}

/** Decode `portfolio_vault::get_bounds`. */
export function parsePortfolioBounds(view: unknown): PortfolioBounds {
  const values = tuple(view, 7, "portfolio bounds view");
  const bounds = {
    maxPctBps: safeNumber(values[0], "maximum position percentage"),
    maxLeverageX100: safeNumber(values[1], "maximum leverage"),
    maxPositions: safeNumber(values[3], "maximum positions"),
    marketCount: safeNumber(values[6], "portfolio market count"),
  };
  if (bounds.marketCount <= 0) throw new Error("portfolio market count must be positive");
  if (bounds.marketCount > 256) throw new Error("portfolio market count exceeds the u8 index space");
  if (bounds.maxPctBps <= 0 || bounds.maxPctBps > 10_000) {
    throw new Error("maximum position percentage must be from 1 through 10000 bps");
  }
  if (bounds.maxLeverageX100 < 100 || bounds.maxLeverageX100 > 65_535) {
    throw new Error("maximum leverage must fit the on-chain u16 action field and be at least 1x");
  }
  if (bounds.maxPositions <= 0) throw new Error("maximum positions must be positive");
  if (bounds.maxPositions > bounds.marketCount) {
    throw new Error("maximum positions exceeds the frozen market count");
  }
  return bounds;
}

/** Decode the address vector returned by `portfolio_vault::get_markets`. */
export function parsePortfolioMarketAddresses(view: unknown): string[] {
  const values = tuple(view, 1, "portfolio markets view");
  return vector(values[0], "portfolio markets").map((address, index) =>
    normalizePortfolioAddress(address, `portfolio market ${index}`),
  );
}

/** Decode a Move `vector<u8>` exactly as the Aptos REST API returns it. */
export function decodeMoveU8Vector(value: unknown, label = "byte vector"): number[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) {
        throw new Error(`${label}[${index}] must be an integer from 0 through 255`);
      }
      return item;
    });
  }
  if (typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    const hex = value.slice(2);
    const out: number[] = [];
    for (let index = 0; index < hex.length; index += 2) {
      out.push(Number.parseInt(hex.slice(index, index + 2), 16));
    }
    return out;
  }
  throw new Error(`${label} must be an even-length 0x hex string or byte array`);
}

function parseBooleanVector(value: unknown, label: string): boolean[] {
  return vector(value, label).map((item, index) => {
    if (typeof item !== "boolean") throw new Error(`${label}[${index}] must be a boolean`);
    return item;
  });
}

function parseU64Vector(value: unknown, label: string): bigint[] {
  return vector(value, label).map((item, index) => parseMoveU64(item, `${label}[${index}]`));
}

/**
 * Decode `(market_idx, is_long, size, opened_seq, bars_held)` and bind it to the context
 * sequence. The full fingerprint changes when a permissionless stale-close removes a leg.
 */
export function parsePortfolioPositions(
  view: unknown,
  args: { marketCount: number; maxPositions: number; seq: bigint },
): PortfolioPositionSnapshot {
  const values = tuple(view, 5, "portfolio positions view");
  const idxs = decodeMoveU8Vector(values[0], "position market indices");
  const longs = parseBooleanVector(values[1], "position directions");
  const sizes = parseU64Vector(values[2], "position sizes");
  const opened = parseU64Vector(values[3], "position opening sequences");
  const barsHeld = parseU64Vector(values[4], "position bars held");
  const lengths = [longs.length, sizes.length, opened.length, barsHeld.length];
  if (lengths.some((length) => length !== idxs.length)) {
    throw new Error("portfolio position vectors have different lengths");
  }
  if (idxs.length > args.maxPositions) {
    throw new Error(
      `portfolio reports ${idxs.length} positions above its ${args.maxPositions}-position cap`,
    );
  }

  const held = new Map<number, boolean>();
  for (let index = 0; index < idxs.length; index++) {
    const marketIdx = idxs[index];
    if (marketIdx >= args.marketCount) {
      throw new Error(`position ${index} refers to out-of-range market index ${marketIdx}`);
    }
    if (held.has(marketIdx)) {
      throw new Error(`portfolio reports duplicate position market index ${marketIdx}`);
    }
    if (sizes[index] === 0n) throw new Error(`position ${index} has zero size`);
    if (opened[index] > args.seq) {
      throw new Error(`position ${index} opened after the current sequence`);
    }
    if (barsHeld[index] !== args.seq - opened[index]) {
      throw new Error(`position ${index} reports an inconsistent bars-held value`);
    }
    held.set(marketIdx, longs[index]);
  }

  return {
    held,
    fingerprint: JSON.stringify({
      idxs,
      longs,
      sizes: sizes.map(String),
      opened: opened.map(String),
      barsHeld: barsHeld.map(String),
    }),
  };
}
