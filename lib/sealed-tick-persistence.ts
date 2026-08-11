import { prisma } from "@/lib/prisma";
import type { TickTrade } from "@/lib/sealed-tick";

export type TickStatusData = {
  tickFailures: number;
  lastTickAt: Date;
  lastTickError: string | null;
  lastTickSeq?: number;
};

/**
 * A failed status write must be visible in both server logs and the authenticated API result.
 * Silently swallowing it makes a broken vault look healthy forever and defeats backoff.
 */
export async function persistTickStatus(args: {
  strategyVaultAddr: string;
  data: TickStatusData;
  context: string;
  transactionHash?: string;
}): Promise<string | undefined> {
  try {
    await prisma.sealedVault.update({
      where: { strategyVaultAddr: args.strategyVaultAddr },
      data: args.data,
    });
    return undefined;
  } catch (err) {
    console.error("[sealed-tick] vault status persistence failed", {
      context: args.context,
      transactionHash: args.transactionHash,
      strategyVaultAddr: args.strategyVaultAddr,
      error: err instanceof Error ? err.message : "unknown",
    });
    return "vault status persistence failed; inspect server logs and reconcile from chain";
  }
}

/**
 * The receipt cache and its health cursor describe the same confirmed transaction. Persist
 * them atomically so the UI cannot show a new cursor while silently missing that tick's fills.
 */
export async function persistSingleMarketTick(args: {
  strategyVaultAddr: string;
  network: string;
  seq: string;
  transactionHash: string;
  trades: TickTrade[];
}): Promise<string | undefined> {
  const writes = [];
  if (args.trades.length > 0) {
    writes.push(
      prisma.sealedTrade.createMany({
        data: args.trades.map((trade) => ({
          strategyVaultAddr: args.strategyVaultAddr,
          network: args.network,
          seq: trade.seq,
          isBuy: trade.isBuy,
          reduceOnly: trade.reduceOnly,
          size: BigInt(trade.size),
          price: BigInt(trade.price),
          orderPx: BigInt(trade.orderPx),
          txHash: args.transactionHash,
          tradedAt: new Date(trade.timestamp * 1000),
        })),
        // The transaction receipt is authoritative, and replaying it must be harmless.
        skipDuplicates: true,
      }),
    );
  }
  writes.push(
    prisma.sealedVault.update({
      where: { strategyVaultAddr: args.strategyVaultAddr },
      data: {
        lastTickAt: new Date(),
        lastTickSeq: Number(args.seq),
        tickFailures: 0,
        lastTickError: null,
      },
    }),
  );

  try {
    await prisma.$transaction(writes);
    return undefined;
  } catch (err) {
    console.error("[sealed-tick] confirmed tick persistence failed", {
      transactionHash: args.transactionHash,
      strategyVaultAddr: args.strategyVaultAddr,
      seq: args.seq,
      fills: args.trades.length,
      error: err instanceof Error ? err.message : "unknown",
    });
    return "confirmed tick persistence failed; inspect server logs and reconcile from transaction hash";
  }
}
