import { NextResponse } from "next/server";
import { getAptosFullnodeApiKey } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DECIBEL_BASE = "https://api.mainnet.aptoslabs.com/decibel/api/v1";
const NO_STORE_HEADERS = {
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

// Upstream /vaults regularly takes ~10s on a cold call (verified live: 10.1s,
// 10.0s, then 0.3s from its cache). Keep the last good payload so a slow or
// failed refresh serves stale-but-real data instead of an empty list.
let lastGood: { vaults: DecibelVault[]; fetchedAt: number } | null = null;

function unavailableVaults(reason: string) {
  if (lastGood) {
    return NextResponse.json(
      { ...lastGood, stale: true, reason },
      { headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { vaults: [], fetchedAt: Date.now(), unavailable: true, reason },
    { headers: NO_STORE_HEADERS },
  );
}

export async function GET() {
  const apiKey = getAptosFullnodeApiKey("mainnet");

  if (!apiKey) {
    return unavailableVaults("missing_api_key");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${DECIBEL_BASE}/vaults?limit=50`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Decibel vaults API returned ${res.status}`);
    }

    const data = await res.json();
    const items: DecibelVault[] = data.items ?? data;

    // Filter to active vaults with TVL, sorted by TVL desc
    const vaults = items
      .filter((v: DecibelVault) => v.status === "active" && (v.tvl ?? 0) > 0)
      .sort((a: DecibelVault, b: DecibelVault) => (b.tvl ?? 0) - (a.tvl ?? 0));

    if (vaults.length > 0) {
      lastGood = { vaults, fetchedAt: Date.now() };
    }

    return NextResponse.json({ vaults, fetchedAt: Date.now() }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? "timeout"
      : "upstream_unavailable";
    return unavailableVaults(reason);
  } finally {
    clearTimeout(timer);
  }
}
