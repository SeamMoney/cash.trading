/**
 * GET /api/sealed/vaults/:addr/performance
 *
 * A vault's actual track record, rebuilt from chain.
 *
 * Nobody deposits into a strategy with no history, and every fact needed for one is already
 * on-chain: `sealed_vault` emits an `AttestedTick` for EVERY bar (trade or not) and a
 * `VaultTraded` for each order. Nothing here is self-reported — the numbers derive from events
 * the contract wrote, so a vault cannot inflate its record by lying to this endpoint.
 *
 * A depositor can verify the same numbers independently: the committed price series is public,
 * and after a reveal the whole signal sequence replays against it (docs/SEALED-INDICATOR.md §6).
 * This route is a convenience, not a source of truth.
 */
import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { prisma } from "@/lib/prisma";
import { getSealedVault, isHexAddress, sealedRegistryAvailable } from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

interface TradeEvent {
  seq: number;
  isBuy: boolean;
  reduceOnly: boolean;
  size: number;
  price: number;
  timestamp: number;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ addr: string }> },
) {
  const rate = checkApiRateLimit(request, "sealed-performance", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }
  const { addr } = await context.params;
  if (!isHexAddress(addr)) {
    return NextResponse.json({ error: "invalid address" }, { status: 400, headers: NO_STORE });
  }
  if (!sealedRegistryAvailable()) {
    return NextResponse.json({ error: "registry unavailable" }, { status: 503, headers: NO_STORE });
  }
  const vault = await getSealedVault(addr).catch(() => null);
  if (!vault) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }

  const aptos = new Aptos(
    new AptosConfig({
      network: vault.network === "mainnet" ? Network.MAINNET : Network.TESTNET,
    }),
  );

  let prices: number[] = [];
  let timestamps: number[] = [];
  let trades = 0;
  let seq = 0;
  let inPosition = false;
  let isLong = false;
  try {
    const [p, t] = (await aptos.view({
      payload: {
        function: `${vault.packageAddress}::sealed_vault::get_trace`,
        functionArguments: [addr],
      },
    })) as [string[], string[]];
    prices = p.map(Number);
    timestamps = t.map(Number);

    const st = (await aptos.view({
      payload: {
        function: `${vault.packageAddress}::sealed_vault::get_sealed_state`,
        functionArguments: [addr],
      },
    })) as unknown[];
    inPosition = Boolean(st[8]);
    isLong = Boolean(st[9]);
    trades = Number(st[12] ?? 0);
    seq = Number(st[13] ?? 0);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "chain read failed" },
      { status: 502, headers: NO_STORE },
    );
  }

  // Realised P&L from the vault's own trade events. Prices are 1e8-scaled and sizes are in the
  // market's units, so absolute products would be meaningless — we report RATIOS, which are
  // unit-free and cannot be misread as dollars.
  // Trade history comes from our own tick receipts, not an indexer: Aptos's hosted indexer
  // removed its `events` table entirely, so Move 2 module events cannot be queried after the
  // fact. Every row here was read out of the transaction that produced it and is re-derivable
  // from its txHash — a cache of on-chain facts, not a claim.
  //
  // Consequence worth stating plainly: vaults whose creator runs their own attestor have no
  // rows here, because we never saw their transactions. That is reported as "unavailable",
  // never as "no trades".
  const rows = await prisma.sealedTrade
    .findMany({
      where: { strategyVaultAddr: addr },
      orderBy: [{ seq: "asc" }, { reduceOnly: "desc" }],
      take: 1000,
    })
    .catch(() => []);
  const tradeEvents: TradeEvent[] = rows.map((r) => ({
    seq: r.seq,
    isBuy: r.isBuy,
    reduceOnly: r.reduceOnly,
    size: Number(r.size),
    price: Number(r.price),
    timestamp: Math.floor(r.tradedAt.getTime() / 1000),
  }));
  const tradeSource: "recorded" | "unavailable" =
    rows.length > 0 ? "recorded" : trades > 0 ? "unavailable" : "recorded";

  const roundTrips: Array<{
    openPrice: number; closePrice: number; long: boolean; returnPct: number; closedAt: number;
  }> = [];
  let open: TradeEvent | null = null;
  for (const t of tradeEvents) {
    if (!t.reduceOnly) {
      open = t;
    } else if (open) {
      // A reduce-only SELL closes a long, so the opening side is this one inverted.
      const long = !t.isBuy;
      const ret = long
        ? (t.price - open.price) / open.price
        : (open.price - t.price) / open.price;
      roundTrips.push({
        openPrice: open.price,
        closePrice: t.price,
        long,
        returnPct: ret * 100,
        closedAt: t.timestamp,
      });
      open = null;
    }
  }

  const wins = roundTrips.filter((r) => r.returnPct > 0).length;
  // Compounded, not summed: a sequence of +10% then -10% is not flat.
  const cumulative = roundTrips.reduce((acc, r) => acc * (1 + r.returnPct / 100), 1) - 1;
  let peak = 1;
  let equity = 1;
  let maxDrawdown = 0;
  for (const r of roundTrips) {
    equity *= 1 + r.returnPct / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
  }

  return NextResponse.json(
    {
      ok: true,
      strategyVaultAddr: addr,
      network: vault.network,
      /** Bars processed. Gaps are visible on-chain — the attestor cannot hide one. */
      bars: seq,
      trades,
      inPosition,
      side: inPosition ? (isLong ? "long" : "short") : null,
      firstBarAt: timestamps[0] ?? null,
      lastBarAt: timestamps[timestamps.length - 1] ?? null,
      /** Null until at least one position has been opened AND closed. */
      closedTrades: roundTrips.length,
      winRatePct: roundTrips.length ? (wins / roundTrips.length) * 100 : null,
      cumulativeReturnPct: roundTrips.length ? cumulative * 100 : null,
      maxDrawdownPct: roundTrips.length ? maxDrawdown * 100 : null,
      recentTrades: roundTrips.slice(-20).reverse(),
      /** "unavailable" means P&L could not be computed, NOT that the vault has no trades. */
      tradeSource,
      /** Committed price series, 1e8-scaled, oldest first. */
      trace: prices.slice(-120),
      traceTimestamps: timestamps.slice(-120),
      note:
        tradeSource === "unavailable"
          ? `This vault has made ${trades} trade(s) on-chain, but its creator runs their own attestor so we did not record them. The on-chain trace remains fully verifiable.`
          : roundTrips.length === 0
            ? "No closed trades yet — there is no track record to judge this vault on."
            : `From ${roundTrips.length} closed round trip(s) recorded on-chain. Past performance says nothing about future results.`,
    },
    { status: 200, headers: NO_STORE },
  );
}
