import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { getAptosFullnodeApiKey } from "@/lib/decibel";
import { verifyDecibelSpotDeployment } from "@/lib/decibel-spot-deployment";
import {
  DECIBEL_MAINNET_APT_DECIMALS,
  DECIBEL_MAINNET_APT_METADATA,
  DECIBEL_MAINNET_SPOT_PACKAGE,
  DECIBEL_SPOT_DEFAULT_MAX_AGE_MS,
  DECIBEL_SPOT_MAX_BOOK_DEPTH,
  DECIBEL_SPOT_MAX_SETTLEMENT_FILLS,
  DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS,
  assembleDecibelSpotBalances,
  classifyDecibelSpotSettlement,
  normalizeDecibelSpotAddress,
  resolvePinnedDecibelSpotMarket,
  validateDecibelSpotLedgerInfo,
  validateDecibelSpotOrderStatusResponse,
  validateDecibelSpotSettlementLookup,
  validateDecibelSpotSourceDate,
  validateDecibelSpotTerminalTransaction,
  validateDecibelSpotTradeHistory,
  validateDecibelMainnetSpotMarkets,
  validateDecibelPrimaryStoreBalanceView,
  validateDecibelSpotOrderbook,
  validateDecibelSpotTakerFeeView,
  type DecibelSpotBalancesResponse,
  type DecibelSpotErrorResponse,
  type DecibelSpotMarketsResponse,
  type DecibelSpotOrderbookResponse,
  type DecibelSpotSettlementLookup,
  type DecibelSpotSettlementResponse,
} from "@/lib/decibel-spot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DECIBEL_MAINNET_REST_BASE = "https://api.mainnet.aptoslabs.com/decibel/api/v1";
const APTOS_MAINNET_FULLNODE_BASE = "https://api.mainnet.aptoslabs.com/v1";
const UPSTREAM_TIMEOUT_MS = 4_500;
const MAX_REGISTRY_BODY_BYTES = 1_000_000;
const MAX_ORDERBOOK_BODY_BYTES = 250_000;
const MAX_SETTLEMENT_BODY_BYTES = 250_000;
const MAX_TRANSACTION_BODY_BYTES = 1_000_000;
const REGISTRY_CACHE_MS = 8_000;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

type UpstreamJson = {
  body: unknown;
  headers: Headers;
  status: number;
};

type SpotRegistry = {
  markets: ReturnType<typeof validateDecibelMainnetSpotMarkets>;
  fee: ReturnType<typeof validateDecibelSpotTakerFeeView>;
};

type SpotRegistryCacheEntry = SpotRegistry & { cacheExpiresAtMs: number };

let spotRegistryCache: SpotRegistryCacheEntry | null = null;
let spotRegistryInFlight: Promise<SpotRegistryCacheEntry> | null = null;

function mainnetConfigIsExplicit() {
  return (
    process.env.DECIBEL_NETWORK === "mainnet" &&
    process.env.NEXT_PUBLIC_DECIBEL_NETWORK === "mainnet"
  );
}

function parseDepth(value: string | null) {
  if (value === null) return 25;
  if (!/^\d{1,2}$/.test(value)) throw new Error("invalid depth");
  const depth = Number(value);
  if (depth < 1 || depth > DECIBEL_SPOT_MAX_BOOK_DEPTH) throw new Error("invalid depth");
  return depth;
}

async function fetchJson(args: {
  url: string;
  apiKey: string;
  maxBytes: number;
  method?: "GET" | "POST";
  body?: string;
  allowNotFound?: boolean;
  requestSignal: AbortSignal;
}): Promise<UpstreamJson> {
  const timeoutSignal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const signal = AbortSignal.any([args.requestSignal, timeoutSignal]);
  const response = await fetch(args.url, {
    method: args.method ?? "GET",
    cache: "no-store",
    redirect: "error",
    signal,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      "X-Aptos-Client": "cash-trading/decibel-spot",
      ...(args.body ? { "Content-Type": "application/json" } : {}),
    },
    body: args.body,
  });
  if (!response.ok && !(args.allowNotFound && response.status === 404)) {
    throw new Error(`Decibel spot upstream returned ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Decibel spot upstream did not return JSON");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > args.maxBytes) {
    throw new Error("Decibel spot upstream response exceeded the size bound");
  }
  try {
    return { body: JSON.parse(text) as unknown, headers: response.headers, status: response.status };
  } catch {
    throw new Error("Decibel spot upstream returned malformed JSON");
  }
}

async function fetchSpotRegistryUncached(apiKey: string): Promise<SpotRegistryCacheEntry> {
  // This read is shared across requests, so its lifetime is bounded internally
  // rather than by whichever browser request happened to start it.
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const [markets, contexts, feeView] = await Promise.all([
    fetchJson({
      url: `${DECIBEL_MAINNET_REST_BASE}/markets`,
      apiKey,
      maxBytes: MAX_REGISTRY_BODY_BYTES,
      requestSignal: signal,
    }),
    fetchJson({
      url: `${DECIBEL_MAINNET_REST_BASE}/spot/asset_contexts`,
      apiKey,
      maxBytes: MAX_REGISTRY_BODY_BYTES,
      requestSignal: signal,
    }),
    fetchJson({
      url: `${APTOS_MAINNET_FULLNODE_BASE}/view`,
      apiKey,
      maxBytes: 20_000,
      method: "POST",
      body: JSON.stringify({
        function: `${DECIBEL_MAINNET_SPOT_PACKAGE}::unified_fees_config::view_spot_tier_taker_fees`,
        type_arguments: [],
        arguments: [],
      }),
      requestSignal: signal,
    }),
  ]);
  const nowMs = Date.now();
  const validatedMarkets = validateDecibelMainnetSpotMarkets({
    markets: markets.body,
    contexts: contexts.body,
    nowMs,
    maxAgeMs: DECIBEL_SPOT_DEFAULT_MAX_AGE_MS,
  });
  const fee = validateDecibelSpotTakerFeeView({
    value: feeView.body,
    chainId: feeView.headers.get("x-aptos-chain-id"),
    ledgerVersion: feeView.headers.get("x-aptos-ledger-version"),
    ledgerTimestampUsec: feeView.headers.get("x-aptos-ledger-timestampusec"),
    nowMs,
    maxAgeMs: DECIBEL_SPOT_DEFAULT_MAX_AGE_MS,
  });
  const cacheExpiresAtMs = Math.min(
    nowMs + REGISTRY_CACHE_MS,
    fee.expiresAtMs,
    ...validatedMarkets.map(
      (market) => market.contextTimestampMs + DECIBEL_SPOT_DEFAULT_MAX_AGE_MS,
    ),
  );
  return { markets: validatedMarkets, fee, cacheExpiresAtMs };
}

async function fetchSpotRegistry(apiKey: string): Promise<SpotRegistry> {
  const nowMs = Date.now();
  if (spotRegistryCache && spotRegistryCache.cacheExpiresAtMs > nowMs) {
    return spotRegistryCache;
  }
  if (spotRegistryInFlight) return spotRegistryInFlight;
  spotRegistryInFlight = fetchSpotRegistryUncached(apiKey)
    .then((registry) => {
      if (registry.cacheExpiresAtMs > Date.now()) spotRegistryCache = registry;
      return registry;
    })
    .finally(() => {
      spotRegistryInFlight = null;
    });
  return spotRegistryInFlight;
}

async function fetchPrimaryStoreBalance(args: {
  apiKey: string;
  ownerAddress: string;
  metadataAddress: string;
  decimals: number;
  signal: AbortSignal;
}) {
  const response = await fetchJson({
    url: `${APTOS_MAINNET_FULLNODE_BASE}/view`,
    apiKey: args.apiKey,
    maxBytes: 20_000,
    method: "POST",
    body: JSON.stringify({
      function: "0x1::primary_fungible_store::balance",
      type_arguments: ["0x1::fungible_asset::Metadata"],
      arguments: [args.ownerAddress, args.metadataAddress],
    }),
    requestSignal: args.signal,
  });
  return validateDecibelPrimaryStoreBalanceView({
    value: response.body,
    metadataAddress: args.metadataAddress,
    decimals: args.decimals,
    chainId: response.headers.get("x-aptos-chain-id"),
    ledgerVersion: response.headers.get("x-aptos-ledger-version"),
    ledgerTimestampUsec: response.headers.get("x-aptos-ledger-timestampusec"),
    nowMs: Date.now(),
    maxAgeMs: DECIBEL_SPOT_DEFAULT_MAX_AGE_MS,
  });
}

async function fetchSpotBalances(args: {
  apiKey: string;
  ownerAddress: string;
  market: ReturnType<typeof resolvePinnedDecibelSpotMarket>;
  signal: AbortSignal;
}) {
  const requests = new Map<string, Promise<ReturnType<typeof validateDecibelPrimaryStoreBalanceView>>>();
  const read = (metadataAddress: string, decimals: number) => {
    const existing = requests.get(metadataAddress);
    if (existing) return existing;
    const request = fetchPrimaryStoreBalance({
      apiKey: args.apiKey,
      ownerAddress: args.ownerAddress,
      metadataAddress,
      decimals,
      signal: args.signal,
    });
    requests.set(metadataAddress, request);
    return request;
  };
  const [base, quote, gas] = await Promise.all([
    read(args.market.baseAssetAddress, args.market.baseDecimals),
    read(args.market.quoteAssetAddress, args.market.quoteDecimals),
    read(DECIBEL_MAINNET_APT_METADATA, DECIBEL_MAINNET_APT_DECIMALS),
  ]);
  return assembleDecibelSpotBalances({
    ownerAddress: args.ownerAddress,
    market: args.market,
    base,
    quote,
    gas,
  });
}

function exactOrderNotFound(value: unknown, orderId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return body.status === "notFound"
    && body.message === `Order with order_id: ${orderId} not found`;
}

async function fetchSpotSettlement(args: {
  apiKey: string;
  lookup: DecibelSpotSettlementLookup;
  signal: AbortSignal;
}): Promise<DecibelSpotSettlementResponse> {
  const orderParams = new URLSearchParams({
    market: args.lookup.marketAddress,
    account: args.lookup.ownerAddress,
    order_id: args.lookup.orderId,
    asset_type: "spot",
  });
  const [ledgerResponse, orderResponse] = await Promise.all([
    fetchJson({
      url: APTOS_MAINNET_FULLNODE_BASE,
      apiKey: args.apiKey,
      maxBytes: 20_000,
      requestSignal: args.signal,
    }),
    fetchJson({
      url: `${DECIBEL_MAINNET_REST_BASE}/orders?${orderParams.toString()}`,
      apiKey: args.apiKey,
      maxBytes: MAX_SETTLEMENT_BODY_BYTES,
      allowNotFound: true,
      requestSignal: args.signal,
    }),
  ]);
  const ledger = validateDecibelSpotLedgerInfo({
    value: ledgerResponse.body,
    chainId: ledgerResponse.headers.get("x-aptos-chain-id"),
    ledgerVersion: ledgerResponse.headers.get("x-aptos-ledger-version"),
    ledgerTimestampUsec: ledgerResponse.headers.get("x-aptos-ledger-timestampusec"),
  });
  const orderReadAtMs = validateDecibelSpotSourceDate(
    orderResponse.headers.get("date"),
  );
  let order = null;
  if (orderResponse.status === 404) {
    if (!exactOrderNotFound(orderResponse.body, args.lookup.orderId)) {
      throw new Error("Decibel spot order lookup returned an unexpected not-found response");
    }
  } else {
    order = validateDecibelSpotOrderStatusResponse({
      value: orderResponse.body,
      lookup: args.lookup,
      sourceReadAtMs: orderReadAtMs,
    });
  }

  let trades = null;
  let terminalProof = null;
  let tradeReadAtMs: number | null = null;
  if (
    order
    && (order.status === "Filled" || order.status === "Cancelled" || order.status === "Rejected")
  ) {
    const tradeParams = new URLSearchParams({
      account: args.lookup.ownerAddress,
      market: args.lookup.marketAddress,
      order_id: args.lookup.orderId,
      asset_type: "spot",
      limit: String(DECIBEL_SPOT_MAX_SETTLEMENT_FILLS),
      offset: "0",
      sort_key: "timestamp",
      sort_dir: "ASC",
    });
    const [tradeResponse, terminalTransactionResponse] = await Promise.all([
      fetchJson({
        url: `${DECIBEL_MAINNET_REST_BASE}/trade_history?${tradeParams.toString()}`,
        apiKey: args.apiKey,
        maxBytes: MAX_SETTLEMENT_BODY_BYTES,
        requestSignal: args.signal,
      }),
      fetchJson({
        url: `${APTOS_MAINNET_FULLNODE_BASE}/transactions/by_version/${encodeURIComponent(order.transactionVersion)}`,
        apiKey: args.apiKey,
        maxBytes: MAX_TRANSACTION_BODY_BYTES,
        requestSignal: args.signal,
      }),
    ]);
    tradeReadAtMs = validateDecibelSpotSourceDate(tradeResponse.headers.get("date"));
    trades = validateDecibelSpotTradeHistory({
      value: tradeResponse.body,
      order,
      sourceReadAtMs: tradeReadAtMs,
    });
    terminalProof = validateDecibelSpotTerminalTransaction({
      value: terminalTransactionResponse.body,
      order,
      chainId: terminalTransactionResponse.headers.get("x-aptos-chain-id"),
      ledgerVersion: terminalTransactionResponse.headers.get("x-aptos-ledger-version"),
      ledgerTimestampUsec: terminalTransactionResponse.headers.get("x-aptos-ledger-timestampusec"),
    });
  }

  const fetchedAt = Date.now();
  const settlement = classifyDecibelSpotSettlement({
    order,
    terminalProof,
    trades,
  });
  return {
    ready: true,
    resource: "settlement",
    network: "mainnet",
    owner: args.lookup.ownerAddress,
    marketAddress: args.lookup.marketAddress,
    orderId: args.lookup.orderId,
    settlement,
    ledgerVersion: ledger.ledgerVersion,
    ledgerTimestampMs: ledger.ledgerTimestampMs,
    fetchedAt,
    expiresAt: Math.min(
      ledger.expiresAtMs,
      orderReadAtMs + DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS,
      tradeReadAtMs === null
        ? Number.MAX_SAFE_INTEGER
        : tradeReadAtMs + DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS,
      fetchedAt + DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS,
    ),
  };
}

function rateLimited(rate: { retryAfterS?: number }) {
  return NextResponse.json(
    {
      ready: false,
      message: "Too many Decibel spot requests. Try again shortly.",
    } satisfies DecibelSpotErrorResponse,
    {
      status: 429,
      headers: {
        ...NO_STORE_HEADERS,
        "Retry-After": String(rate.retryAfterS ?? 60),
      },
    },
  );
}

function unavailable(message: string, status: number) {
  return NextResponse.json(
    { ready: false, message } satisfies DecibelSpotErrorResponse,
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "decibel-mainnet-spot", 120, 60_000);
  if (!rate.allowed) return rateLimited(rate);
  if (!mainnetConfigIsExplicit()) {
    return unavailable("Decibel spot is unavailable because mainnet is not explicitly configured.", 503);
  }
  const apiKey = getAptosFullnodeApiKey("mainnet");
  if (!apiKey) {
    return unavailable("Decibel spot data credentials are unavailable.", 503);
  }

  const resource = request.nextUrl.searchParams.get("resource") ?? "markets";
  const requestedNetwork = request.nextUrl.searchParams.get("network");
  if (requestedNetwork !== null && requestedNetwork !== "mainnet") {
    return unavailable("Decibel spot only supports mainnet.", 400);
  }
  if (
    resource !== "markets"
    && resource !== "orderbook"
    && resource !== "balances"
    && resource !== "settlement"
  ) {
    return unavailable("resource must be markets, orderbook, balances, or settlement.", 400);
  }
  const freshValues = request.nextUrl.searchParams.getAll("fresh");
  if (
    freshValues.length > 1
    || (freshValues.length === 1 && (resource !== "orderbook" || freshValues[0] !== "1"))
  ) {
    return unavailable("fresh=1 is only supported for an orderbook signing preflight.", 400);
  }
  const forceFreshRegistry = freshValues.length === 1;

  let depth = 25;
  let requestedMarket: ReturnType<typeof resolvePinnedDecibelSpotMarket> | null = null;
  let ownerAddress: string | null = null;
  let settlementLookup: DecibelSpotSettlementLookup | null = null;
  if (resource === "orderbook" || resource === "balances" || resource === "settlement") {
    try {
      if (resource === "orderbook") depth = parseDepth(request.nextUrl.searchParams.get("depth"));
      requestedMarket = resolvePinnedDecibelSpotMarket(
        request.nextUrl.searchParams.get("market"),
      );
      if (resource === "balances" || resource === "settlement") {
        ownerAddress = normalizeDecibelSpotAddress(
          request.nextUrl.searchParams.get("owner"),
          "owner",
        );
      }
      if (resource === "settlement") {
        const priceAtomic = request.nextUrl.searchParams.get("priceAtomic");
        const sizeAtomic = request.nextUrl.searchParams.get("sizeAtomic");
        const rawIsBid = request.nextUrl.searchParams.get("isBid");
        const expectedFieldCount = [priceAtomic, sizeAtomic, rawIsBid]
          .filter((value) => value !== null).length;
        if (expectedFieldCount !== 0 && expectedFieldCount !== 3) {
          throw new Error("expected spot order identity must be complete");
        }
        if (rawIsBid !== null && rawIsBid !== "true" && rawIsBid !== "false") {
          throw new Error("invalid expected spot side");
        }
        settlementLookup = validateDecibelSpotSettlementLookup({
          ownerAddress,
          market: requestedMarket.marketAddress,
          orderId: request.nextUrl.searchParams.get("orderId"),
          expectedOrder: expectedFieldCount === 3
            ? {
                priceAtomic,
                sizeAtomic,
                isBid: rawIsBid === "true",
              }
            : undefined,
        });
      }
    } catch {
      return unavailable(
        resource === "balances" || resource === "settlement"
          ? resource === "settlement"
            ? "owner, orderId, and a reviewed Decibel spot market are required."
            : "owner and a reviewed Decibel spot market are required."
          : `market must be a reviewed Decibel spot market and depth must be 1-${DECIBEL_SPOT_MAX_BOOK_DEPTH}.`,
        400,
      );
    }
  }

  try {
    if (resource === "settlement") {
      if (!settlementLookup) throw new Error("Decibel spot settlement lookup is missing");
      const response = await fetchSpotSettlement({
        apiKey,
        lookup: settlementLookup,
        signal: request.signal,
      });
      return NextResponse.json(response, { headers: NO_STORE_HEADERS });
    }

    await verifyDecibelSpotDeployment(apiKey);
    const [registry, orderbook, balances] = await Promise.all([
      forceFreshRegistry
        ? fetchSpotRegistryUncached(apiKey)
        : fetchSpotRegistry(apiKey),
      resource === "orderbook" && requestedMarket
        ? fetchJson({
            url: `${DECIBEL_MAINNET_REST_BASE}/orderbook?market=${encodeURIComponent(requestedMarket.marketAddress)}`,
            apiKey,
            maxBytes: MAX_ORDERBOOK_BODY_BYTES,
            requestSignal: request.signal,
          })
        : Promise.resolve(null),
      resource === "balances" && requestedMarket && ownerAddress
        ? fetchSpotBalances({
            apiKey,
            ownerAddress,
            market: requestedMarket,
            signal: request.signal,
          })
        : Promise.resolve(null),
    ]);

    const fetchedAt = Date.now();
    if (resource === "markets") {
      return NextResponse.json(
        {
          ready: true,
          resource: "markets",
          network: "mainnet",
          markets: registry.markets,
          fetchedAt,
        } satisfies DecibelSpotMarketsResponse,
        { headers: NO_STORE_HEADERS },
      );
    }

    if (!requestedMarket) throw new Error("Reviewed Decibel spot market was not resolved");
    const market = registry.markets.find(
      (candidate) => candidate.marketAddress === requestedMarket?.marketAddress,
    );
    if (!market) throw new Error("Reviewed Decibel spot market disappeared from the live registry");
    if (resource === "orderbook") {
      if (!orderbook) throw new Error("Decibel spot orderbook response is missing");
      const snapshot = validateDecibelSpotOrderbook({
        market,
        fee: registry.fee,
        orderbook: orderbook.body,
        depth,
        nowMs: fetchedAt,
        maxAgeMs: DECIBEL_SPOT_DEFAULT_MAX_AGE_MS,
      });
      return NextResponse.json(
        {
          ready: true,
          resource: "orderbook",
          snapshot,
          fetchedAt,
        } satisfies DecibelSpotOrderbookResponse,
        { headers: NO_STORE_HEADERS },
      );
    }

    if (!balances || !ownerAddress) throw new Error("Decibel spot balance response is missing");
    const [baseSymbol, quoteSymbol] = market.marketName.split("/");
    return NextResponse.json(
      {
        ready: true,
        resource: "balances",
        owner: ownerAddress,
        marketAddress: market.marketAddress,
        balances: {
          base: {
            atomic: balances.base.atomic,
            decimals: balances.base.decimals,
            symbol: baseSymbol,
          },
          quote: {
            atomic: balances.quote.atomic,
            decimals: balances.quote.decimals,
            symbol: quoteSymbol,
          },
          apt: {
            atomic: balances.gas.atomic,
            decimals: balances.gas.decimals,
            symbol: "APT",
          },
        },
        fetchedAt,
      } satisfies DecibelSpotBalancesResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown Decibel spot error";
    const timedOut = /timeout|aborted/i.test(message) || error instanceof DOMException;
    console.error("[decibel-spot] fail-closed upstream validation:", message);
    return unavailable(
      timedOut ? "Decibel spot data timed out." : "Decibel spot data failed validation.",
      timedOut ? 504 : 502,
    );
  }
}
