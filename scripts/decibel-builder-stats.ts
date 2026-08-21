/**
 * Public Decibel builder-code adoption snapshot.
 *
 * Decibel does not currently expose a public builder-volume leaderboard. This
 * command ranks builders by the number of distinct subaccounts that approved
 * them on Aptos. It is an adoption proxy, not a revenue or filled-volume rank.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env pnpm builder:stats
 *   DOTENV_CONFIG_PATH=.env pnpm builder:stats -- --json
 */

import "dotenv/config";

const FULLNODE = "https://api.mainnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";
const REGISTRY_TYPE = `${DECIBEL_PACKAGE}::builder_code_registry::Registry`;
const CASH_TRADING_BUILDER =
  process.env.DECIBEL_BUILDER_ADDRESS?.trim().toLowerCase() ||
  "0xc755b3bb6477e11e1635de67cded8d0683e9d4e360b6c484a33eb2fd6cb9ca39";
const CHAIN_UNITS_PER_BASIS_POINT = 100;

type Approval = {
  account: string;
  builder: string;
  feeChainUnits: string;
};

type BuilderSummary = {
  builder: string;
  subaccounts: Set<string>;
  feeChainUnits: Map<string, number>;
};

function apiKey(): string {
  return (
    process.env.APTOS_API_KEY_MAINNET ||
    process.env.APTOS_NODE_API_KEY_MAINNET ||
    process.env.GEOMI_API_KEY_MAINNET ||
    process.env.APTOS_API_KEY ||
    process.env.APTOS_NODE_API_KEY ||
    process.env.GEOMI_API_KEY ||
    ""
  ).trim();
}

function authHeaders(includeJson = false): HeadersInit {
  const key = apiKey();
  return {
    ...(includeJson ? { "content-type": "application/json" } : {}),
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

function normalizedAddress(value: unknown): string | null {
  const raw =
    typeof value === "object" && value !== null && "inner" in value
      ? String((value as { inner?: unknown }).inner ?? "")
      : String(value ?? "");
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(raw)) return null;
  return `0x${raw.slice(2).toLowerCase().padStart(64, "0")}`;
}

async function jsonWithRetry<T>(url: string, init?: RequestInit): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
  }
  throw lastError ?? new Error("request failed");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function approvalsFromTreeNode(value: unknown): Approval[] {
  const node = record(value);
  if (!node || node.is_leaf !== true) return [];
  const entries = record(node.children)?.entries;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((rawEntry) => {
    const entry = record(rawEntry);
    const key = record(entry?.key);
    const leaf = record(entry?.value);
    if (leaf?.__variant__ !== "Leaf") return [];
    const account = normalizedAddress(key?.account);
    const builder = normalizedAddress(key?.builder);
    const feeChainUnits = String(leaf.value ?? "");
    if (!account || !builder || !/^\d+$/.test(feeChainUnits)) return [];
    return [{ account, builder, feeChainUnits }];
  });
}

async function registrySnapshot(): Promise<{
  approvals: Approval[];
  globalMaxFeeChainUnits: string;
}> {
  const resources = await jsonWithRetry<Array<{ type?: string; data?: unknown }>>(
    `${FULLNODE}/accounts/${DECIBEL_PACKAGE}/resources`,
    { headers: authHeaders() },
  );
  const registry = resources.find((resource) => resource.type === REGISTRY_TYPE);
  const registryData = record(registry?.data);
  const map = record(registryData?.approved_max_fees);
  const slots = record(record(record(map?.nodes)?.slots)?.vec);
  const slotValues = Array.isArray(slots)
    ? slots
    : (record(record(map?.nodes)?.slots)?.vec as unknown[] | undefined);
  const tableHandle = normalizedAddress(
    record(record(record(slotValues?.[0])?.inner)?.handle)?.inner ??
      record(record(slotValues?.[0])?.inner)?.handle,
  );
  if (!tableHandle) throw new Error("Decibel builder registry table handle is missing");

  const approvals = approvalsFromTreeNode(record(map?.root));
  let paginationComplete = false;
  for (let offset = 0; offset < 10_000; offset += 100) {
    const query = `query {
      current_table_items(
        where: {table_handle: {_eq: "${tableHandle}"}}
        limit: 100
        offset: ${offset}
      ) { decoded_value }
    }`;
    const result = await jsonWithRetry<{
      data?: { current_table_items?: Array<{ decoded_value?: unknown }> };
      errors?: Array<{ message?: string }>;
    }>(`${FULLNODE}/graphql`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ query }),
    });
    if (result.errors?.length) {
      throw new Error(result.errors.map((error) => error.message).join("; "));
    }
    const rows = result.data?.current_table_items ?? [];
    for (const row of rows) {
      const node = record(record(row.decoded_value)?.value);
      approvals.push(...approvalsFromTreeNode(node));
    }
    if (rows.length < 100) {
      paginationComplete = true;
      break;
    }
  }
  if (!paginationComplete) {
    throw new Error("Builder registry exceeded the reviewed pagination bound; the snapshot is incomplete");
  }
  return {
    approvals,
    globalMaxFeeChainUnits: String(registryData?.global_max_fee ?? ""),
  };
}

function summarize(approvals: Approval[]): BuilderSummary[] {
  const builders = new Map<string, BuilderSummary>();

  for (const approval of approvals) {
    const summary = builders.get(approval.builder) ?? {
      builder: approval.builder,
      subaccounts: new Set<string>(),
      feeChainUnits: new Map<string, number>(),
    };
    summary.subaccounts.add(approval.account);
    summary.feeChainUnits.set(
      approval.feeChainUnits,
      (summary.feeChainUnits.get(approval.feeChainUnits) ?? 0) + 1,
    );
    builders.set(approval.builder, summary);
  }

  return [...builders.values()].sort(
    (left, right) => right.subaccounts.size - left.subaccounts.size,
  );
}

function feeLabel(chainUnits: string): string {
  const basisPoints = Number(chainUnits) / CHAIN_UNITS_PER_BASIS_POINT;
  return `${basisPoints.toLocaleString()} bp`;
}

async function main() {
  const snapshot = await registrySnapshot();
  const builders = summarize(snapshot.approvals);
  const ourIndex = builders.findIndex(
    (summary) => summary.builder === CASH_TRADING_BUILDER,
  );

  const rows = builders.map((summary, index) => ({
    rank: index + 1,
    builder: summary.builder,
    cashTrading: summary.builder === CASH_TRADING_BUILDER,
    subaccounts: summary.subaccounts.size,
    fees: [...summary.feeChainUnits.entries()].map(([fee, count]) => ({
      basisPoints: Number(fee) / CHAIN_UNITS_PER_BASIS_POINT,
      approvals: count,
    })),
  }));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      activeApprovals: snapshot.approvals.length,
      builderAddresses: builders.length,
      protocolMaximumBasisPoints:
        Number(snapshot.globalMaxFeeChainUnits) / CHAIN_UNITS_PER_BASIS_POINT,
      rankingBasis: "distinct approving subaccounts",
      builders: rows,
      cashTrading: ourIndex === -1
        ? { builder: CASH_TRADING_BUILDER, rank: null, subaccounts: 0 }
        : {
            builder: CASH_TRADING_BUILDER,
            rank: ourIndex + 1,
            subaccounts: builders[ourIndex].subaccounts.size,
          },
    }, null, 2));
    return;
  }

  console.log("Decibel builder approval snapshot");
  console.log(
    `${snapshot.approvals.length} active approvals · ${builders.length} builder addresses`,
  );
  console.log(
    `Protocol maximum: ${feeLabel(snapshot.globalMaxFeeChainUnits)}`,
  );
  console.log(
    "Rank is by distinct approving subaccounts. It is not a volume or revenue leaderboard.\n",
  );

  console.table(
    rows.map((row) => ({
      rank: row.rank,
      builder: row.cashTrading ? `${row.builder} (cash.trading)` : row.builder,
      subaccounts: row.subaccounts,
      fees: row.fees
        .map(({ basisPoints, approvals }) => `${basisPoints.toLocaleString()} bp × ${approvals}`)
        .join(", "),
    })),
  );

  if (ourIndex === -1) {
    console.log(
      `\ncash.trading: no active on-chain user approvals found (${CASH_TRADING_BUILDER}).`,
    );
  } else {
    const ours = builders[ourIndex];
    console.log(
      `\ncash.trading rank: #${ourIndex + 1}; ${ours.subaccounts.size} distinct approved subaccount(s).`,
    );
  }
}

void main().catch((error) => {
  console.error(
    "Builder stats failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
