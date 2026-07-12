import { NextResponse } from "next/server";
import { getAptosFullnodeApiKey, isValidAptosAddress } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DECIBEL_BASE = "https://api.mainnet.aptoslabs.com/decibel/api/v1";
const VAULT_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
};
const VAULT_ERROR_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
};
const VAULT_UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export interface DecibelVault {
  address: string;
  name: string;
  manager: string;
  status: string;
  created_at: number;
  tvl: number | null;
  volume: number | null;
  volume_30d: number | null;
  all_time_pnl: number | null;
  net_deposits: number | null;
  all_time_return: number | null;
  apr: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  weekly_win_rate_12w: number | null;
  profit_share: number | null;
  depositors: number | null;
  perp_equity: number | null;
  vault_type: "user" | "protocol" | null;
  description: string | null;
  average_leverage: number | null;
  manager_cash_pct: number | null;
}

type DecibelVaultPage = {
  items: DecibelVault[];
  total_count: number;
  total_value_locked: number;
  total_volume: number;
};

const VAULT_PAGE_SIZE = 1_000;
const MAX_VAULT_OFFSET = 10_000;

// Upstream /vaults regularly takes ~10s on a cold call (verified live: 10.1s,
// 10.0s, then 0.3s from its cache). Keep the last good payload so a slow or
// failed refresh serves stale-but-real data instead of an empty list.
let lastGood: {
  vaults: DecibelVault[];
  fetchedAt: number;
  totalCount: number;
  totalValueLocked: number;
  totalVolume: number;
} | null = null;

function unavailableVaults(reason: string) {
  if (lastGood) {
    return NextResponse.json(
      { ...lastGood, stale: true, reason },
      { headers: VAULT_ERROR_CACHE_HEADERS },
    );
  }
  return NextResponse.json(
    { vaults: [], fetchedAt: Date.now(), unavailable: true, reason },
    { status: 502, headers: VAULT_UNAVAILABLE_HEADERS },
  );
}

function validatePage(value: unknown): DecibelVaultPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Decibel vaults returned invalid data");
  }
  const page = value as Partial<DecibelVaultPage>;
  if (
    !Array.isArray(page.items) ||
    !Number.isSafeInteger(page.total_count) ||
    Number(page.total_count) < 0 ||
    !Number.isFinite(page.total_value_locked) ||
    Number(page.total_value_locked) < 0 ||
    !Number.isFinite(page.total_volume) ||
    Number(page.total_volume) < 0
  ) {
    throw new Error("Decibel vaults returned invalid pagination data");
  }
  for (const vault of page.items) {
    if (
      !vault ||
      typeof vault !== "object" ||
      !isValidAptosAddress(vault.address) ||
      typeof vault.name !== "string" ||
      !isValidAptosAddress(vault.manager) ||
      vault.status !== "active" ||
      (vault.tvl !== null && (!Number.isFinite(vault.tvl) || vault.tvl < 0))
    ) {
      throw new Error("Decibel vaults returned an invalid vault");
    }
  }
  return page as DecibelVaultPage;
}

export async function GET() {
  const apiKey = getAptosFullnodeApiKey("mainnet");

  if (!apiKey) {
    return unavailableVaults("missing_api_key");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const fetchPage = async (offset: number) => {
      const params = new URLSearchParams({
        status: "active",
        limit: String(VAULT_PAGE_SIZE),
        offset: String(offset),
        sort_key: "tvl",
        sort_dir: "DESC",
      });
      const res = await fetch(`${DECIBEL_BASE}/vaults?${params.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        next: { revalidate: 30 },
      });
      if (!res.ok) {
        throw new Error(`Decibel vaults API returned ${res.status}`);
      }
      return validatePage(await res.json() as unknown);
    };

    const firstPage = await fetchPage(0);
    const remainingOffsets: number[] = [];
    for (
      let offset = VAULT_PAGE_SIZE;
      offset < firstPage.total_count && offset <= MAX_VAULT_OFFSET;
      offset += VAULT_PAGE_SIZE
    ) {
      remainingOffsets.push(offset);
    }
    if (firstPage.total_count > MAX_VAULT_OFFSET + VAULT_PAGE_SIZE) {
      throw new Error("Decibel vault pagination exceeded the safety limit");
    }
    const remainingPages = await Promise.all(remainingOffsets.map(fetchPage));
    const vaults = [
      ...(firstPage.items ?? []),
      ...remainingPages.flatMap((page) => page.items ?? []),
    ];
    const uniqueVaults = new Map(vaults.map((vault) => [vault.address.toLowerCase(), vault]));
    if (uniqueVaults.size !== firstPage.total_count) {
      throw new Error("Decibel vault pagination was incomplete or duplicated");
    }
    const fetchedAt = Date.now();

    if (uniqueVaults.size > 0) {
      lastGood = {
        vaults: [...uniqueVaults.values()],
        fetchedAt,
        totalCount: firstPage.total_count,
        totalValueLocked: firstPage.total_value_locked,
        totalVolume: firstPage.total_volume,
      };
    }

    return NextResponse.json({
      vaults: [...uniqueVaults.values()],
      fetchedAt,
      totalCount: firstPage.total_count,
      totalValueLocked: firstPage.total_value_locked,
      totalVolume: firstPage.total_volume,
    }, { headers: VAULT_CACHE_HEADERS });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? "timeout"
      : "upstream_unavailable";
    return unavailableVaults(reason);
  } finally {
    clearTimeout(timer);
  }
}
