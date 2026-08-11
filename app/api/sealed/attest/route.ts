/**
 * POST /api/sealed/attest — server-side attestor tick for one sealed vault.
 *
 * This is the piece that makes a sealed vault trade without anyone watching it.
 * It is deliberately narrow: it computes a signal from the committed program,
 * signs it, and submits tick_attested. It cannot choose the market, the size,
 * the price or the direction of any resulting order — all of that is enforced
 * on-chain (docs/SEALED-INDICATOR.md §4).
 *
 * Requires the vault's Pine, which the server does NOT store. Callers supply it
 * (the creator's own keeper), or run scripts/sealed-attestor-runner.ts, which is
 * the recommended production path. Guarded by CRANK_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { persistDecibelBuilderFills } from "@/lib/decibel-builder-revenue";
import { attestorKeyMismatch, performTick } from "@/lib/sealed-tick";
import { persistSingleMarketTick } from "@/lib/sealed-tick-persistence";
import {
  derivePrimarySubaccount,
  getSealedVault,
  isHexAddress,
  sealedRegistryAvailable,
} from "@/lib/sealed-vaults";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-attest", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  const secret = process.env.CRANK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "attestation endpoint is disabled — CRANK_SECRET is not set" },
      { status: 501, headers: NO_STORE },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const attestorKeyRaw = process.env.SEALED_ATTESTOR_PRIVATE_KEY;
  const crankKeyRaw = process.env.SEALED_CRANK_PRIVATE_KEY;
  if (!attestorKeyRaw || !crankKeyRaw) {
    return NextResponse.json(
      { error: "SEALED_ATTESTOR_PRIVATE_KEY and SEALED_CRANK_PRIVATE_KEY must both be set" },
      { status: 501, headers: NO_STORE },
    );
  }
  const mismatch = attestorKeyMismatch(
    attestorKeyRaw,
    process.env.SEALED_ATTESTOR_PUBLIC_KEY ??
      process.env.NEXT_PUBLIC_SEALED_ATTESTOR_PUBLIC_KEY,
  );
  if (mismatch) {
    return NextResponse.json({ error: mismatch }, { status: 500, headers: NO_STORE });
  }
  if (!sealedRegistryAvailable()) {
    return NextResponse.json({ error: "registry unavailable" }, { status: 503, headers: NO_STORE });
  }

  let body: { strategyVaultAddr?: unknown; pineScript?: unknown; asset?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  if (!isHexAddress(body.strategyVaultAddr) || typeof body.pineScript !== "string") {
    return NextResponse.json(
      { error: "strategyVaultAddr and pineScript required" },
      { status: 400, headers: NO_STORE },
    );
  }
  const addr = body.strategyVaultAddr as string;

  const vault = await getSealedVault(addr).catch(() => null);
  if (!vault) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }
  if (!vault.sealedAt) {
    return NextResponse.json(
      { error: "vault is not sealed yet — tick_attested would abort with E_NOT_SEALED" },
      { status: 409, headers: NO_STORE },
    );
  }

  // The manifest is needed to reproduce the commitment; it is registry-only
  // (the chain stores just the resulting hash).
  const row = await prisma.sealedVault
    .findUnique({ where: { strategyVaultAddr: addr } })
    .catch(() => null);
  if (!row) {
    return NextResponse.json(
      { error: "registry row missing — cannot reproduce the commitment" },
      { status: 503, headers: NO_STORE },
    );
  }

  // One signing path, shared with the cron. Two implementations is how a scheduled job
  // quietly starts signing something this endpoint would have refused.
  const result = await performTick({
    strategyVaultAddr: addr,
    packageAddress: vault.packageAddress,
    network: vault.network,
    marketAddr: vault.marketAddr,
    manifestJson: row.manifestJson,
    pineScript: body.pineScript,
    asset: typeof body.asset === "string" ? body.asset : (vault.marketName ?? "BTC/USD"),
    expectedDecibelSubaccount: derivePrimarySubaccount(
      row.decibelVaultAddr,
      vault.network === "mainnet" ? "mainnet" : "testnet",
    ),
    attestorPrivateKey: attestorKeyRaw,
    crankPrivateKey: crankKeyRaw,
  });

  if (result.ok) {
    let accountingWarning: string | undefined;
    try {
      await persistDecibelBuilderFills({
        fills: result.builderFills,
        strategyVaultAddr: row.strategyVaultAddr,
        decibelVaultAddr: row.decibelVaultAddr,
      });
    } catch (err) {
      accountingWarning = "builder fee persistence failed; reconcile from transaction hash";
      console.error("[sealed-attest] builder revenue persistence failed", {
        transactionHash: result.txHash,
        strategyVaultAddr: row.strategyVaultAddr,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
    const persistenceWarning = await persistSingleMarketTick({
      strategyVaultAddr: row.strategyVaultAddr,
      network: row.network,
      seq: result.seq,
      transactionHash: result.txHash,
      trades: result.trades,
    });
    return NextResponse.json(
      {
        ok: true,
        seq: result.seq,
        signal: result.signal,
        txHash: result.txHash,
        fills: result.trades.length,
        builderFills: result.builderFills.length,
        ...(accountingWarning ? { accountingWarning } : {}),
        ...(persistenceWarning ? { persistenceWarning } : {}),
      },
      { status: 200, headers: NO_STORE },
    );
  }
  // Pass the Move abort through verbatim — E_BAR_TOO_SOON and E_INVALID_SIGNATURE mean very
  // different things to whoever is debugging.
  const status =
    result.stage === "commitment" ? 409 : result.stage === "transpile" ? 422 : 502;
  return NextResponse.json(
    { ok: false, stage: result.stage, error: result.error, seq: result.seq, signal: result.signal },
    { status, headers: NO_STORE },
  );
}
