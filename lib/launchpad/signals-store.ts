import { Prisma, type LaunchpadSignal } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const MAX_RETAINED_SIGNALS_PER_INDICATOR = 1_000;

export interface LaunchpadSignalEntry {
  timestamp: number;
  signal: 0 | 1 | 2;
  price: number;
  confidence: number;
  asset: string;
}

export interface StoredLaunchpadSignal extends LaunchpadSignalEntry {
  id: bigint;
  indicatorAddr: string;
}

function toStoredSignal(row: LaunchpadSignal): StoredLaunchpadSignal {
  return {
    id: row.id,
    indicatorAddr: row.indicatorAddr,
    timestamp: row.observedAt.getTime(),
    signal: row.signal as 0 | 1 | 2,
    price: row.price,
    confidence: row.confidence,
    asset: row.asset,
  };
}

export async function getRecentLaunchpadSignals(
  indicatorAddr: string,
  limit: number,
): Promise<{ signals: StoredLaunchpadSignal[]; total: number }> {
  const [rows, total] = await prisma.$transaction([
    prisma.launchpadSignal.findMany({
      where: { indicatorAddr },
      orderBy: { id: "desc" },
      take: limit,
    }),
    prisma.launchpadSignal.count({ where: { indicatorAddr } }),
  ]);

  return { signals: rows.map(toStoredSignal), total };
}

export async function getLaunchpadSignalHistory(
  indicatorAddrs: string[],
  perIndicator: number,
): Promise<StoredLaunchpadSignal[]> {
  if (indicatorAddrs.length === 0) return [];

  // Preserve the old feed contract: a reconnect receives recent history for
  // every watched indicator, not just whichever indicator published last.
  // A window query does this in one database round trip rather than up to 32.
  const rows = await prisma.$queryRaw<LaunchpadSignal[]>(Prisma.sql`
    SELECT
      "id", "indicatorAddr", "signal", "price", "confidence", "asset", "source", "observedAt"
    FROM (
      SELECT
        "id", "indicatorAddr", "signal", "price", "confidence", "asset", "source", "observedAt",
        ROW_NUMBER() OVER (PARTITION BY "indicatorAddr" ORDER BY "id" DESC) AS "signalRank"
      FROM "LaunchpadSignal"
      WHERE "indicatorAddr" IN (${Prisma.join(indicatorAddrs)})
    ) AS ranked
    WHERE "signalRank" <= ${perIndicator}
    ORDER BY "id" ASC
  `);

  return rows.map(toStoredSignal);
}

export async function getLaunchpadSignalsAfter(
  indicatorAddrs: string[],
  afterId: bigint,
  limit: number,
): Promise<StoredLaunchpadSignal[]> {
  const rows = await prisma.launchpadSignal.findMany({
    where: {
      indicatorAddr: { in: indicatorAddrs },
      id: { gt: afterId },
    },
    orderBy: { id: "asc" },
    take: limit,
  });

  return rows.map(toStoredSignal);
}

export async function appendLaunchpadSignal(input: {
  indicatorAddr: string;
  signal: 0 | 1 | 2;
  price: number;
  confidence: number;
  asset: string;
}): Promise<{ entry: StoredLaunchpadSignal; total: number }> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.launchpadSignal.create({
      data: {
        indicatorAddr: input.indicatorAddr,
        signal: input.signal,
        price: input.price,
        confidence: input.confidence,
        asset: input.asset,
      },
    });

    const retentionBoundary = await tx.launchpadSignal.findFirst({
      where: { indicatorAddr: input.indicatorAddr },
      orderBy: { id: "desc" },
      skip: MAX_RETAINED_SIGNALS_PER_INDICATOR - 1,
      select: { id: true },
    });

    if (retentionBoundary) {
      await tx.launchpadSignal.deleteMany({
        where: {
          indicatorAddr: input.indicatorAddr,
          id: { lt: retentionBoundary.id },
        },
      });
    }

    const total = await tx.launchpadSignal.count({
      where: { indicatorAddr: input.indicatorAddr },
    });

    return { entry: toStoredSignal(created), total };
  });
}
