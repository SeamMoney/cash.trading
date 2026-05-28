import { NextRequest, NextResponse } from "next/server";
import {
  getFastOverview,
  getFastPositions,
  getIndexedPositions,
  getMarketNamesForAddresses,
  getMarkPricesForAddresses,
  type ChainDecibelPosition,
} from "@/lib/decibel-chain";
import { getReadDex, MARKETS, PRICE_DECIMALS } from "@/lib/decibel";

const INDEXED_POSITIONS_TIMEOUT_MS = 600;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REST_OPEN_ORDER_TIMEOUT_MS = 250;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

interface OpenOrder {
  orderId: unknown;
  clientOrderId: unknown;
  market: unknown;
  isBuy: unknown;
  price: unknown;
  origSize: unknown;
  remainingSize: unknown;
  details: unknown;
  timestamp: unknown;
}

async function fetchOpenOrders(address: string): Promise<{
  orders: OpenOrder[];
  source: "rest" | "unavailable";
  error?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_OPEN_ORDER_TIMEOUT_MS);

  try {
    const dex = getReadDex();
    const openOrders = await dex.userOpenOrders.getByAddr({
      subAddr: address,
      limit: 50,
      fetchOptions: { signal: controller.signal },
    });

    return {
      source: "rest",
      orders: openOrders.items.map((order) => ({
        orderId: order.order_id,
        clientOrderId: order.client_order_id,
        market: order.market,
        isBuy: order.is_buy,
        price: order.price,
        origSize: order.orig_size,
        remainingSize: order.remaining_size,
        details: order.details,
        timestamp: order.unix_ms,
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Decibel open orders unavailable";
    return { source: "unavailable", orders: [], error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the indexed positions list from the Decibel SDK with a short timeout.
 * Returns `null` (not throws) on timeout/failure so the caller can fall back
 * to chain rows without dropping the response.
 */
async function tryIndexedPositions(address: string): Promise<{
  positions: ChainDecibelPosition[] | null;
  error?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    INDEXED_POSITIONS_TIMEOUT_MS
  );
  try {
    const positions = await getIndexedPositions(address, {
      signal: controller.signal,
    });
    return { positions };
  } catch (error) {
    return {
      positions: null,
      error:
        error instanceof Error
          ? error.message
          : "Indexed positions reader unavailable",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Merge indexed and chain position lists by lowercased marketAddress. Indexed
 * rows are authoritative for human-scaled size, liq, and funding; chain rows
 * fill in only for markets the indexer didn't return. If both have a row for
 * the same market, indexed wins.
 */
function mergeIndexedAndChain(
  indexed: ChainDecibelPosition[],
  chain: ChainDecibelPosition[]
): ChainDecibelPosition[] {
  const indexedAddrs = new Set(
    indexed
      .map((p) => p.marketAddress?.toLowerCase())
      .filter((a): a is string => typeof a === "string")
  );
  const chainExtras = chain.filter(
    (p) =>
      !p.marketAddress || !indexedAddrs.has(p.marketAddress.toLowerCase())
  );
  return [...indexed, ...chainExtras];
}

/**
 * Compute mark price, value, and est. PnL for a position when a mark price is
 * available. Pure derivation — no RPC.
 */
function enrichWithMark(
  position: ChainDecibelPosition,
  markByAddress: Record<string, number | null>
): ChainDecibelPosition {
  const addr = position.marketAddress?.toLowerCase();
  const mark = addr ? markByAddress[addr] ?? null : null;
  if (mark === null) return position;

  const absSize = Math.abs(position.size);
  const value = absSize * mark;
  const estimatedPnl = position.isLong
    ? (mark - position.entryPrice) * absSize
    : (position.entryPrice - mark) * absSize;

  return {
    ...position,
    markPrice: mark,
    value,
    estimatedPnl,
  };
}

/**
 * GET /api/decibel/positions?address=0x...
 *
 * Fullnode-first path for account state. Positions and account overview come
 * directly from Decibel Move view functions, so they are not blocked by the
 * Decibel REST indexer or API auth. Open-order enumeration still uses REST when
 * available because the package only exposes per-order chain lookup.
 *
 * `chainOnly=true` is the 1s hot poll: positions + overview only, no extra
 * RPC. Mark price enrichment runs on the slower default path so the 1s
 * cadence stays cheap.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const chainOnly = req.nextUrl.searchParams.get("chainOnly") === "true";
  const includeOpenOrders =
    req.nextUrl.searchParams.get("openOrders") !== "false" && !chainOnly;

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const startedAt = Date.now();

  try {
    const [chainPositions, overview, openOrders, indexedResult] =
      await Promise.all([
        getFastPositions(address),
        getFastOverview(address),
        includeOpenOrders
          ? fetchOpenOrders(address)
          : Promise.resolve({
              source: "skipped" as const,
              orders: [],
              error: undefined,
            }),
        chainOnly
          ? Promise.resolve({ positions: null as null, error: undefined })
          : tryIndexedPositions(address),
      ]);

    // Indexed rows are authoritative for size/liq/funding when available.
    // When indexed is unavailable (timeout, network, ...) we fall back to
    // chain rows so the user never loses positions visibility.
    const rawPositions =
      indexedResult.positions && indexedResult.positions.length > 0
        ? mergeIndexedAndChain(indexedResult.positions, chainPositions)
        : chainPositions;

    let positions = rawPositions;
    let markSource: "chain" | "skipped" = "skipped";
    let nameSource: "chain" | "skipped" = "skipped";
    const positionsSource: "chain" | "indexed" | "indexed+chain" =
      indexedResult.positions && indexedResult.positions.length > 0
        ? chainPositions.some(
            (p) =>
              !indexedResult.positions!.some(
                (i) =>
                  i.marketAddress?.toLowerCase() ===
                  p.marketAddress?.toLowerCase()
              )
          )
          ? "indexed+chain"
          : "indexed"
        : "chain";

    if (!chainOnly && rawPositions.length > 0) {
      const addresses = rawPositions
        .map((p) => p.marketAddress)
        .filter((a): a is string => typeof a === "string");

      if (addresses.length > 0) {
        const decimalsByAddress: Record<string, number> = {};
        for (const config of Object.values(MARKETS)) {
          decimalsByAddress[config.address.toLowerCase()] = config.priceDecimals;
        }
        for (const addr of addresses) {
          const lower = addr.toLowerCase();
          if (decimalsByAddress[lower] === undefined) {
            decimalsByAddress[lower] = PRICE_DECIMALS;
          }
        }

        const unknownAddresses = rawPositions
          .filter((p) => p.market === "Unknown" && p.marketAddress)
          .map((p) => p.marketAddress as string);

        const [marks, names] = await Promise.all([
          getMarkPricesForAddresses(addresses, decimalsByAddress),
          unknownAddresses.length > 0
            ? getMarketNamesForAddresses(unknownAddresses)
            : Promise.resolve({} as Record<string, string | null>),
        ]);

        positions = rawPositions.map((p) => {
          const renamed =
            p.market === "Unknown" && p.marketAddress
              ? {
                  ...p,
                  market:
                    names[p.marketAddress.toLowerCase()] ?? p.market,
                }
              : p;
          return enrichWithMark(renamed, marks);
        });
        markSource = "chain";
        if (unknownAddresses.length > 0) nameSource = "chain";
      }
    }

    return NextResponse.json({
      positions,
      openOrders: openOrders.orders,
      overview,
      latencyMs: Date.now() - startedAt,
      sources: {
        positions: positionsSource,
        overview: "chain",
        openOrders: openOrders.source,
        mark: markSource,
        marketName: nameSource,
        indexed: indexedResult.error
          ? `unavailable: ${indexedResult.error}`
          : indexedResult.positions
          ? "ok"
          : "skipped",
      },
      warnings: openOrders.error
        ? [
            "Open-order listing requires Decibel REST indexer access; positions and overview are chain reads.",
          ]
        : [],
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch Decibel positions";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
