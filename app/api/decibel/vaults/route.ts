import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 30; // ISR: cache for 30s

const DECIBEL_BASE = "https://api.mainnet.aptoslabs.com/decibel/api/v1";
const API_KEY = process.env.GEOMI_API_KEY ?? "";

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

export async function GET() {
  if (!API_KEY) {
    return NextResponse.json({ error: "GEOMI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${DECIBEL_BASE}/vaults?limit=50`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Decibel vaults API returned ${res.status}`);
    }

    const data = await res.json();
    const items: DecibelVault[] = data.items ?? data;

    // Filter to active vaults with TVL, sorted by TVL desc
    const vaults = items
      .filter((v: DecibelVault) => v.status === "active" && (v.tvl ?? 0) > 0)
      .sort((a: DecibelVault, b: DecibelVault) => (b.tvl ?? 0) - (a.tvl ?? 0));

    return NextResponse.json({ vaults, fetchedAt: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch vaults";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
