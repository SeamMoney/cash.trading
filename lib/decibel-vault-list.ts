import { getAptosFullnodeApiKey, isValidAptosAddress } from "@/lib/decibel";
import { unstable_cache } from "next/cache";

const DECIBEL_BASE = "https://api.mainnet.aptoslabs.com/decibel/api/v1";
const VAULT_PAGE_SIZE = 1_000;
const MAX_VAULT_OFFSET = 10_000;

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
  past_month_return: number | null;
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

export interface DecibelVaultSnapshot {
  vaults: DecibelVault[];
  fetchedAt: number;
  totalCount: number;
  totalValueLocked: number;
  totalVolume: number;
}

type DecibelVaultPage = {
  items: DecibelVault[];
  total_count: number;
  total_value_locked: number;
  total_volume: number;
};

export type DecibelVaultFailureReason =
  | "missing_api_key"
  | "timeout"
  | "upstream_unavailable";

class DecibelVaultListError extends Error {
  constructor(
    readonly reason: DecibelVaultFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "DecibelVaultListError";
  }
}

// One server process may receive several cache misses together (for example,
// the Trade and Points data requests after a deploy). Collapse those misses
// into one upstream refresh. unstable_cache supplies the cross-instance cache
// used by both API routes; the module promise only handles same-process races.
let inFlight: Promise<DecibelVaultSnapshot> | null = null;
let lastGood: DecibelVaultSnapshot | null = null;

function validatePage(value: unknown): DecibelVaultPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DecibelVaultListError(
      "upstream_unavailable",
      "Decibel vaults returned invalid data",
    );
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
    throw new DecibelVaultListError(
      "upstream_unavailable",
      "Decibel vaults returned invalid pagination data",
    );
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
      throw new DecibelVaultListError(
        "upstream_unavailable",
        "Decibel vaults returned an invalid vault",
      );
    }
  }
  return page as DecibelVaultPage;
}

async function refreshActiveDecibelVaults(): Promise<DecibelVaultSnapshot> {
  const apiKey = getAptosFullnodeApiKey("mainnet");
  if (!apiKey) {
    throw new DecibelVaultListError(
      "missing_api_key",
      "Aptos fullnode API key is not configured",
    );
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
      const response = await fetch(`${DECIBEL_BASE}/vaults?${params.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new DecibelVaultListError(
          "upstream_unavailable",
          `Decibel vaults API returned ${response.status}`,
        );
      }
      return validatePage(await response.json() as unknown);
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
      throw new DecibelVaultListError(
        "upstream_unavailable",
        "Decibel vault pagination exceeded the safety limit",
      );
    }

    const remainingPages = await Promise.all(remainingOffsets.map(fetchPage));
    const vaults = [
      ...firstPage.items,
      ...remainingPages.flatMap((page) => page.items),
    ];
    const uniqueVaults = new Map(
      vaults.map((vault) => [vault.address.toLowerCase(), vault]),
    );
    if (uniqueVaults.size !== firstPage.total_count) {
      throw new DecibelVaultListError(
        "upstream_unavailable",
        "Decibel vault pagination was incomplete or duplicated",
      );
    }

    return {
      vaults: [...uniqueVaults.values()],
      fetchedAt: Date.now(),
      totalCount: firstPage.total_count,
      totalValueLocked: firstPage.total_value_locked,
      totalVolume: firstPage.total_volume,
    };
  } catch (error) {
    if (error instanceof DecibelVaultListError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DecibelVaultListError("timeout", "Decibel vaults request timed out");
    }
    throw new DecibelVaultListError(
      "upstream_unavailable",
      "Decibel vaults request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

const readCachedActiveDecibelVaults = unstable_cache(
  refreshActiveDecibelVaults,
  ["decibel-active-vaults-v1"],
  { revalidate: 30 },
);

export async function getActiveDecibelVaults(): Promise<DecibelVaultSnapshot> {
  if (!inFlight) {
    inFlight = readCachedActiveDecibelVaults();
  }
  try {
    const snapshot = await inFlight;
    if (snapshot.vaults.length > 0) lastGood = snapshot;
    return snapshot;
  } finally {
    inFlight = null;
  }
}

export function getLastGoodActiveDecibelVaults(): DecibelVaultSnapshot | null {
  return lastGood
    ? { ...lastGood, vaults: [...lastGood.vaults] }
    : null;
}

export function getDecibelVaultFailureReason(
  error: unknown,
): DecibelVaultFailureReason {
  return error instanceof DecibelVaultListError
    ? error.reason
    : "upstream_unavailable";
}
