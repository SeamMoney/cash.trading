import { NextRequest, NextResponse } from "next/server";
import { getAptosFullnodeApiKey, MAINNET_DECIBEL_PACKAGE } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DECIBEL_BASE = "https://api.mainnet.aptoslabs.com/decibel/api/v1";
const FULLNODE_VIEW = "https://api.mainnet.aptoslabs.com/v1/view";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const RANGES = ["7d", "30d", "all"] as const;
const DATA_TYPES = ["pnl", "account_value"] as const;
type Range = (typeof RANGES)[number];
type DataType = (typeof DATA_TYPES)[number];

export interface VaultHistoryPoint {
  /** Unix ms */
  t: number;
  v: number;
}

interface UpstreamPoint {
  timestamp: number;
  data_points: number;
}

// Vault → portfolio subaccounts barely ever changes; cache resolutions briefly
// so polling the chart doesn't re-run the on-chain view every request.
const SUBACCOUNT_CACHE_TTL_MS = 10 * 60 * 1000;
const subaccountCache = new Map<string, { subaccounts: string[]; expires: number }>();

function unavailable(reason: string, status = 200) {
  return NextResponse.json(
    { points: [], unavailable: true, reason, fetchedAt: Date.now() },
    { status, headers: NO_STORE_HEADERS },
  );
}

async function getVaultSubaccounts(
  vault: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<string[]> {
  const cached = subaccountCache.get(vault);
  if (cached && cached.expires > Date.now()) return cached.subaccounts;

  const res = await fetch(FULLNODE_VIEW, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      function: `${MAINNET_DECIBEL_PACKAGE}::vault::get_vault_portfolio_subaccounts`,
      type_arguments: [],
      arguments: [vault],
    }),
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`vault subaccount view returned ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  const subaccounts = (Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [])
    .filter((s): s is string => typeof s === "string" && s.startsWith("0x"));
  subaccountCache.set(vault, { subaccounts, expires: Date.now() + SUBACCOUNT_CACHE_TTL_MS });
  return subaccounts;
}

async function getChartSeries(
  account: string,
  range: Range,
  dataType: DataType,
  apiKey: string,
  signal: AbortSignal,
): Promise<UpstreamPoint[]> {
  const params = new URLSearchParams({ account, range, data_type: dataType });
  const res = await fetch(`${DECIBEL_BASE}/portfolio_chart?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`portfolio_chart returned ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (p): p is UpstreamPoint =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as UpstreamPoint).timestamp === "number" &&
      typeof (p as UpstreamPoint).data_points === "number",
  );
}

/**
 * Sum several subaccount series into one vault series. Timestamps across
 * subaccounts don't necessarily align, so take the union of timestamps and
 * forward-fill each series before summing.
 */
function mergeSeries(seriesList: UpstreamPoint[][]): VaultHistoryPoint[] {
  const nonEmpty = seriesList.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) {
    return nonEmpty[0].map((p) => ({ t: p.timestamp, v: p.data_points }));
  }

  const timestamps = [...new Set(nonEmpty.flatMap((s) => s.map((p) => p.timestamp)))].sort(
    (a, b) => a - b,
  );
  const cursors = nonEmpty.map(() => 0);
  const lastValues = nonEmpty.map(() => 0);

  return timestamps.map((t) => {
    let sum = 0;
    for (let i = 0; i < nonEmpty.length; i++) {
      const series = nonEmpty[i];
      while (cursors[i] < series.length && series[cursors[i]].timestamp <= t) {
        lastValues[i] = series[cursors[i]].data_points;
        cursors[i]++;
      }
      sum += lastValues[i];
    }
    return { t, v: sum };
  });
}

export async function GET(req: NextRequest) {
  const vault = req.nextUrl.searchParams.get("vault")?.toLowerCase() ?? "";
  if (!/^0x[0-9a-f]{1,64}$/.test(vault)) {
    return NextResponse.json(
      { error: "vault must be a 0x-prefixed hex address" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const rangeParam = req.nextUrl.searchParams.get("range") ?? "all";
  const typeParam = req.nextUrl.searchParams.get("type") ?? "pnl";
  if (!RANGES.includes(rangeParam as Range)) {
    return NextResponse.json(
      { error: `range must be one of: ${RANGES.join(", ")}` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!DATA_TYPES.includes(typeParam as DataType)) {
    return NextResponse.json(
      { error: `type must be one of: ${DATA_TYPES.join(", ")}` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const range = rangeParam as Range;
  const dataType = typeParam as DataType;

  const apiKey = getAptosFullnodeApiKey("mainnet");
  if (!apiKey) {
    return unavailable("missing_api_key");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const subaccounts = await getVaultSubaccounts(vault, apiKey, controller.signal);
    if (subaccounts.length === 0) {
      return unavailable("no_portfolio_subaccounts");
    }

    const seriesList = await Promise.all(
      subaccounts.map((s) => getChartSeries(s, range, dataType, apiKey, controller.signal)),
    );
    const points = mergeSeries(seriesList);
    if (points.length === 0) {
      return unavailable("empty_series");
    }

    return NextResponse.json(
      {
        vault,
        range,
        type: dataType,
        subaccounts: subaccounts.length,
        points,
        fetchedAt: Date.now(),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError" ? "timeout" : "upstream_unavailable";
    return unavailable(reason);
  } finally {
    clearTimeout(timer);
  }
}
