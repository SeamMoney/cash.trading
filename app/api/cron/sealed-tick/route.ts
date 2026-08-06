/**
 * GET /api/cron/sealed-tick — the thing that makes a sealed vault actually trade.
 *
 * Every launched vault sits inert until something computes its signal each bar and submits
 * `tick_attested`. Until this existed, nothing did: the only cron in production was
 * depth-compact, and `/api/sealed/attest` required a caller to supply the PineScript — which,
 * for a private strategy, only the creator had. A creator could complete the entire launch
 * flow and own a vault that never placed a single order.
 *
 * This ticks every vault whose creator opted into managed attestation. The rest are untouched
 * and remain the creator's own responsibility (scripts/sealed-attestor-runner.ts).
 *
 * Failure handling is deliberate:
 *   - E_BAR_TOO_SOON is the NORMAL state of a vault whose cadence is slower than the cron.
 *     It is not counted as a failure; counting it would back off every healthy vault.
 *   - A non-retryable failure (commitment mismatch, un-transpilable source) is recorded and
 *     the vault is skipped with exponential backoff, rather than burning gas every minute.
 *   - One vault's failure never aborts the run.
 */
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { attestorKeyMismatch, performTick, isTooSoon } from "@/lib/sealed-tick";
import {
  performPortfolioTick,
  isTooSoon as isPortfolioTooSoon,
} from "@/lib/portfolio-tick";
import {
  decryptSource,
  keyProblem,
  secretMatches,
  sourceVaultAvailable,
} from "@/lib/sealed-source-vault";
import { findSealedMarket, sealedNetwork, sealedRegistryAvailable } from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

/** Skip a vault for 2^failures minutes, capped at an hour. */
function backoffMs(failures: number): number {
  return Math.min(60, 2 ** Math.min(failures, 6)) * 60_000;
}

export async function GET(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` — CRON_SECRET, not CRANK_SECRET.
  // Reading only CRANK_SECRET meant the scheduled run 401'd forever while the deploy looked
  // healthy: config reported ready, creators launched vaults, and not one of them ever traded.
  // Both are accepted so the same endpoint works for Vercel and for a manual/keeper call.
  const cronSecret = process.env.CRON_SECRET?.trim();
  const crankSecret = process.env.CRANK_SECRET?.trim();
  if (!cronSecret && !crankSecret) {
    return NextResponse.json(
      { error: "neither CRON_SECRET nor CRANK_SECRET is set — the tick cron is disabled" },
      { status: 501, headers: NO_STORE },
    );
  }
  const provided = (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret") ??
    ""
  ).trim();
  const authorized =
    (cronSecret ? secretMatches(provided, cronSecret) : false) ||
    (crankSecret ? secretMatches(provided, crankSecret) : false);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const attestorKey = process.env.SEALED_ATTESTOR_PRIVATE_KEY;
  const crankKey = process.env.SEALED_CRANK_PRIVATE_KEY;
  if (!attestorKey || !crankKey) {
    return NextResponse.json(
      { error: "SEALED_ATTESTOR_PRIVATE_KEY and SEALED_CRANK_PRIVATE_KEY must both be set" },
      { status: 501, headers: NO_STORE },
    );
  }
  // Fail the whole run loudly rather than letting every vault abort on-chain one at a time.
  const mismatch = attestorKeyMismatch(
    attestorKey,
    process.env.SEALED_ATTESTOR_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_SEALED_ATTESTOR_PUBLIC_KEY,
  );
  if (mismatch) {
    return NextResponse.json({ error: mismatch }, { status: 500, headers: NO_STORE });
  }
  if (!sealedRegistryAvailable()) {
    return NextResponse.json({ error: "registry unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!sourceVaultAvailable()) {
    return NextResponse.json(
      {
        error: `${keyProblem() ?? "SEALED_SOURCE_KEY unusable"} — managed strategies cannot be decrypted`,
      },
      { status: 501, headers: NO_STORE },
    );
  }

  const network = sealedNetwork();
  const rows = await prisma.sealedVault.findMany({
    where: {
      network,
      managedAttestation: true,
      paused: false,
      sealedAt: { not: null },
      encryptedPine: { not: null },
      // A retired strategy lost its delegation in a swap. Ticking it is not merely wasted gas:
      // any tick that produced an order would abort on Decibel forever, and the failure counter
      // would keep the row churning. `retiredAt` is set in the same transaction that registers
      // the replacement, so exactly one strategy per Decibel vault is ever in this set.
      retiredAt: null,
    },
    take: 200,
  });

  const now = Date.now();
  const results: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    // Back off a vault that keeps failing rather than paying gas to watch it abort.
    if (
      row.tickFailures > 0 &&
      row.lastTickAt &&
      now - row.lastTickAt.getTime() < backoffMs(row.tickFailures)
    ) {
      results.push({ vault: row.strategyVaultAddr, skipped: "backoff", failures: row.tickFailures });
      continue;
    }

    let pine: string;
    try {
      pine = decryptSource(
        {
          ciphertext: row.encryptedPine!,
          iv: row.encryptedPineIv!,
          tag: row.encryptedPineTag!,
        },
        row.strategyVaultAddr,
      );
    } catch (err) {
      // A decrypt failure means the key rotated or the row was tampered with. Never retry in a
      // loop — record it and move on.
      await prisma.sealedVault.update({
        where: { strategyVaultAddr: row.strategyVaultAddr },
        data: {
          tickFailures: row.tickFailures + 1,
          lastTickAt: new Date(),
          lastTickError: `decrypt failed: ${err instanceof Error ? err.message : "unknown"}`,
        },
      }).catch(() => undefined);
      results.push({ vault: row.strategyVaultAddr, error: "decrypt failed" });
      continue;
    }

    // Two modules, two tick paths. Routed on the stored kind rather than on the market count,
    // because the kind is what says which Move module the vault's address actually holds — a
    // portfolio vault ticked as a single one calls a function its module does not have, and
    // the abort would read as a transient failure and be retried every minute forever.
    const isPortfolio = row.vaultKind === "portfolio";

    if (isPortfolio) {
      // The allowlist, in stored order. Index i here MUST be market_idx i on-chain; the tick
      // path re-reads the on-chain market count and refuses to sign on a mismatch, so a
      // corrupted list fails closed rather than trading the wrong book.
      const names = (row.marketNames ?? row.marketName ?? "").split(",").map((n) => n.trim()).filter(Boolean);
      const resolved = names.map((n, idx) => {
        const m = findSealedMarket(n);
        return m ? { idx, name: m.name, asset: m.pythAsset } : null;
      });
      if (resolved.some((m) => m === null)) {
        await prisma.sealedVault.update({
          where: { strategyVaultAddr: row.strategyVaultAddr },
          data: {
            tickFailures: row.tickFailures + 1,
            lastTickAt: new Date(),
            lastTickError: `unknown market in allowlist: ${names.join(",")}`,
          },
        }).catch(() => undefined);
        results.push({ vault: row.strategyVaultAddr, ok: false, stage: "markets", error: "unknown market in allowlist" });
        continue;
      }

      const pr = await performPortfolioTick({
        strategyVaultAddr: row.strategyVaultAddr,
        packageAddress: row.packageAddress,
        network: row.network,
        markets: resolved as Array<{ idx: number; name: string; asset: string }>,
        manifestJson: row.manifestJson,
        pineScript: pine,
        defaultPctBps: row.pctBps,
        leverageX100: row.maxLeverageX100,
        attestorPrivateKey: attestorKey,
        crankPrivateKey: crankKey,
      }).catch((err) => ({
        ok: false as const,
        stage: "unexpected",
        error: err instanceof Error ? err.message : "unknown",
        retryable: true,
      }));

      if (pr.ok) {
        await prisma.sealedVault.update({
          where: { strategyVaultAddr: row.strategyVaultAddr },
          data: {
            lastTickAt: new Date(),
            lastTickSeq: Number(pr.seq),
            tickFailures: 0,
            // A partial tick is not a clean one. Markets that were skipped are recorded so a
            // vault quietly trading three of its four markets is visible rather than green.
            lastTickError: pr.skipped.length > 0 ? `skipped: ${pr.skipped.join("; ")}`.slice(0, 500) : null,
          },
        }).catch(() => undefined);
        results.push({
          vault: row.strategyVaultAddr,
          ok: true,
          seq: pr.seq,
          actions: pr.actions.length,
          skipped: pr.skipped.length,
          tx: pr.txHash,
        });
      } else if (isPortfolioTooSoon(pr)) {
        results.push({ vault: row.strategyVaultAddr, skipped: "too soon" });
      } else {
        await prisma.sealedVault.update({
          where: { strategyVaultAddr: row.strategyVaultAddr },
          data: {
            tickFailures: row.tickFailures + 1,
            lastTickAt: new Date(),
            lastTickError: `${pr.stage}: ${pr.error}`.slice(0, 500),
          },
        }).catch(() => undefined);
        results.push({ vault: row.strategyVaultAddr, ok: false, stage: pr.stage, error: pr.error });
      }
      continue;
    }

    const r = await performTick({
      strategyVaultAddr: row.strategyVaultAddr,
      packageAddress: row.packageAddress,
      network: row.network,
      marketAddr: row.marketAddr,
      manifestJson: row.manifestJson,
      pineScript: pine,
      asset: row.marketName ?? "BTC/USD",
      attestorPrivateKey: attestorKey,
      crankPrivateKey: crankKey,
    }).catch((err): ReturnType<typeof performTick> extends Promise<infer T> ? T : never => ({
      ok: false as const,
      stage: "unexpected",
      error: err instanceof Error ? err.message : "unknown",
      retryable: true,
    }));

    if (r.ok) {
      // Persist the fills from our own receipt. createMany + skipDuplicates so a re-run of the
      // same seq is idempotent rather than doubling a vault's trade count.
      if (r.trades.length > 0) {
        await prisma.sealedTrade.createMany({
          data: r.trades.map((t) => ({
            strategyVaultAddr: row.strategyVaultAddr,
            network: row.network,
            seq: t.seq,
            isBuy: t.isBuy,
            reduceOnly: t.reduceOnly,
            size: BigInt(t.size),
            price: BigInt(t.price),
            orderPx: BigInt(t.orderPx),
            txHash: r.txHash,
            tradedAt: new Date(t.timestamp * 1000),
          })),
          skipDuplicates: true,
        }).catch(() => undefined);
      }
      await prisma.sealedVault.update({
        where: { strategyVaultAddr: row.strategyVaultAddr },
        data: {
          lastTickAt: new Date(),
          lastTickSeq: Number(r.seq),
          tickFailures: 0,
          lastTickError: null,
        },
      }).catch(() => undefined);
      results.push({
        vault: row.strategyVaultAddr,
        ok: true,
        seq: r.seq,
        signal: r.signal,
        fills: r.trades.length,
        tx: r.txHash,
      });
    } else if (isTooSoon(r)) {
      // Healthy — the vault's cadence is simply slower than the cron. Not a failure.
      results.push({ vault: row.strategyVaultAddr, skipped: "too soon" });
    } else {
      await prisma.sealedVault.update({
        where: { strategyVaultAddr: row.strategyVaultAddr },
        data: {
          tickFailures: row.tickFailures + 1,
          lastTickAt: new Date(),
          lastTickError: `${r.stage}: ${r.error}`.slice(0, 500),
        },
      }).catch(() => undefined);
      results.push({ vault: row.strategyVaultAddr, ok: false, stage: r.stage, error: r.error });
    }
  }

  const ticked = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  return NextResponse.json(
    { ok: true, network, considered: rows.length, ticked, failed, results },
    { status: 200, headers: NO_STORE },
  );
}
