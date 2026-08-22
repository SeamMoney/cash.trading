import { NextRequest, NextResponse } from "next/server";

import {
  normalizeAptosAddressText,
  readFreshMainnetAptosLedger,
} from "@/lib/aptos-server-lite";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { CASH_ORDERBOOK_PAIR_ID } from "@/lib/cash-orderbook";
import {
  CASH_INDEXER_MAX_LAG_VERSIONS,
  isCashIndexerVersionFresh,
  normalizeStableCashOrderbookTrade,
} from "@/lib/cash-orderbook-launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const MAX_TRADES = 80;
const MAX_HEALTH_BODY_BYTES = 32_000;
const MAX_TRADES_BODY_BYTES = 512_000;

interface IndexerHealth {
  status?: unknown;
  network?: unknown;
  contractAddress?: unknown;
  lastSuccessfulPollLedgerVersion?: unknown;
  authoritativeReplayComplete?: unknown;
}

function configuredValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function verifiedIndexerBase(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("CASH_ORDERBOOK_API_URL is not a valid URL");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("CASH_ORDERBOOK_API_URL must be a credential-free HTTPS base URL");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

async function readBoundedJson<T = unknown>(response: Response, maxBytes: number, label: string): Promise<T> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength) || BigInt(declaredLength) > BigInt(maxBytes)) {
      await response.body?.cancel();
      throw new Error(`${label} exceeded its response bound`);
    }
  }
  if (!response.body) throw new Error(`${label} returned an empty response`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeded its response bound`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
}

async function fetchIndexerJson<T = unknown>(url: string, maxBytes: number, label: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return readBoundedJson<T>(response, maxBytes, label);
}

async function readMainnetLedgerVersion() {
  const ledger = await readFreshMainnetAptosLedger({
    clientName: "cash-trading/cash-orderbook-trades",
    timeoutMs: 4_000,
  });
  return BigInt(ledger.version);
}

function normalizeTrade(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const trade = value as Record<string, unknown>;
  if (String(trade.pairId) !== String(CASH_ORDERBOOK_PAIR_ID)) return null;
  return normalizeStableCashOrderbookTrade({
    id: trade.id,
    price: trade.price,
    size: trade.quantity,
    side: trade.side,
    timestamp: trade.timestamp,
    txRef: trade.txRef,
  });
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "cash-orderbook-trades", 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { ready: false, trades: [], message: "Too many trade requests. Try again shortly." },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rate.retryAfterS ?? 60),
        },
      },
    );
  }

  const configuredIndexerUrl = configuredValue(process.env.CASH_ORDERBOOK_API_URL);
  const contractAddress = configuredValue(
    process.env.CASH_ORDERBOOK_CONTRACT_ADDRESS,
    process.env.NEXT_PUBLIC_CASH_ORDERBOOK_CONTRACT_ADDRESS,
  );
  if (!configuredIndexerUrl || !/^0x[0-9a-fA-F]{1,64}$/.test(contractAddress)) {
    return NextResponse.json({
      ready: false,
      trades: [],
      message: "CASH/USDC trade history is not configured yet.",
    }, { headers: NO_STORE_HEADERS });
  }

  try {
    const indexerUrl = verifiedIndexerBase(configuredIndexerUrl);
    const normalizedContract = normalizeAptosAddressText(contractAddress);
    const [ledgerVersion, health, rawTrades] = await Promise.all([
      readMainnetLedgerVersion(),
      fetchIndexerJson<IndexerHealth>(
        `${indexerUrl}/health`,
        MAX_HEALTH_BODY_BYTES,
        "CASH indexer health",
      ),
      fetchIndexerJson(
        `${indexerUrl}/trades?limit=${MAX_TRADES}&pairId=${CASH_ORDERBOOK_PAIR_ID}`,
        MAX_TRADES_BODY_BYTES,
        "CASH trade history",
      ),
    ]);
    const indexedVersionText = String(health.lastSuccessfulPollLedgerVersion ?? "");
    if (
      health.status !== "ok"
      || health.network !== "mainnet"
      || health.authoritativeReplayComplete !== true
      || normalizeAptosAddressText(health.contractAddress, "indexer contract address") !== normalizedContract
      || !/^\d+$/.test(indexedVersionText)
    ) {
      throw new Error("The CASH trade indexer identity is invalid");
    }
    const indexedVersion = BigInt(indexedVersionText);
    if (!isCashIndexerVersionFresh(
      indexedVersion,
      ledgerVersion,
      CASH_INDEXER_MAX_LAG_VERSIONS,
    )) {
      throw new Error("The CASH trade indexer is stale");
    }

    if (!Array.isArray(rawTrades) || rawTrades.length > MAX_TRADES) {
      throw new Error("The CASH trade indexer returned malformed data");
    }
    const trades = rawTrades.map(normalizeTrade);
    if (trades.some((trade) => trade === null)) {
      throw new Error("The CASH trade indexer returned an invalid trade");
    }

    return NextResponse.json({
      ready: true,
      network: "mainnet",
      contractAddress: normalizedContract,
      trades,
      indexedLedgerVersion: indexedVersionText,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[cash-orderbook-trades] verified trade history failed:", error);
    return NextResponse.json({
      ready: false,
      trades: [],
      message: "CASH/USDC trade history is temporarily unavailable.",
    }, { headers: NO_STORE_HEADERS });
  }
}
