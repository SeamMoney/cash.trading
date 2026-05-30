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

function unavailableVaults(reason: string) {
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
  const timer = setTimeout(() => controller.abort(), 8000);

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
