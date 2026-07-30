/**
 * POST /api/sealed/verify — delayed-reveal verification (SEALED-INDICATOR §6).
 *
 * Two things get checked, and they are different claims:
 *
 *  1. commitment — does the revealed Pine, re-transpiled with the pinned
 *     manifest, hash to the commitment the vault is sealed to? This proves the
 *     creator revealed the program they committed to and not a flattering
 *     substitute.
 *  2. replay — does re-running that program over the on-chain price trace
 *     reproduce the signal sequence the attestor actually signed? This proves
 *     the vault traded the strategy.
 *
 * Passing (1) and failing (2) is the interesting case: it means the committed
 * program is genuine but the attestor deviated from it, which is provable
 * misconduct rather than a disagreement.
 */
import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { prisma } from "@/lib/prisma";
import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { createStrategyRunner } from "@/lib/strategy-equivalence";
import { canonicalizePine } from "@/lib/sealed-presets";
import {
  getSealedVault,
  isHexAddress,
  sealedRegistryAvailable,
  verifyRevealedProgram,
} from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const SIGNAL_NAME = ["neutral", "buy", "sell"] as const;

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-verify", 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }
  if (!sealedRegistryAvailable()) {
    return NextResponse.json(
      { error: "registry unavailable — DATABASE_URL is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: { strategyVaultAddr?: unknown; pineScript?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  if (!isHexAddress(body.strategyVaultAddr)) {
    return NextResponse.json(
      { error: "strategyVaultAddr required" },
      { status: 400, headers: NO_STORE },
    );
  }
  const addr = body.strategyVaultAddr as string;

  const vault = await getSealedVault(addr).catch(() => null);
  if (!vault) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }

  // Prefer a stored reveal; otherwise accept one supplied in the request so a
  // creator can prove adherence without publishing the source permanently.
  const supplied = typeof body.pineScript === "string" ? body.pineScript : null;
  const row = await prisma.sealedVault
    .findUnique({ where: { strategyVaultAddr: addr } })
    .catch(() => null);
  const pine = supplied ?? row?.revealedPine ?? null;
  if (!pine) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This vault has not revealed its strategy. Supply pineScript to verify a reveal privately.",
        checks: { commitment: "unrevealed", replay: "unrevealed" },
      },
      { status: 409, headers: NO_STORE },
    );
  }

  // ── Check 1: commitment ────────────────────────────────────────────────────
  const commitmentCheck = verifyRevealedProgram({
    pine,
    manifestJson: row?.manifestJson ?? "",
    marketAddr: vault.marketAddr,
    expectedCommitment: vault.programCommitment,
  });
  if (!commitmentCheck.matches) {
    return NextResponse.json(
      {
        ok: false,
        checks: { commitment: "fail", replay: "skipped" },
        expected: vault.programCommitment,
        recomputed: commitmentCheck.recomputed,
        errors: commitmentCheck.errors,
        note: "The revealed source does not hash to the sealed commitment.",
      },
      { status: 200, headers: NO_STORE },
    );
  }

  // ── Check 2: replay over the on-chain trace ────────────────────────────────
  const aptos = new Aptos(
    new AptosConfig({
      network: vault.network === "mainnet" ? Network.MAINNET : Network.TESTNET,
    }),
  );
  let prices: string[] = [];
  try {
    const t = (await aptos.view({
      payload: {
        function: `${vault.packageAddress}::sealed_vault::get_trace`,
        functionArguments: [addr],
      },
    })) as unknown[];
    prices = (t[0] as string[]) ?? [];
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        checks: { commitment: "ok", replay: "unavailable" },
        error: err instanceof Error ? err.message : "could not read the on-chain trace",
      },
      { status: 200, headers: NO_STORE },
    );
  }

  const t = transpileV3(canonicalizePine(pine), undefined, {
    target: "vault",
    marketAddr: vault.marketAddr,
  });
  const runner = createStrategyRunner(t.ir);
  const expected: Array<{ seq: number; signal: string }> = [];
  prices.forEach((p, i) => {
    // The on-chain trace is 1e8-scaled; the evaluator works in float USD.
    const signal = runner.pushBar(Number(p) / 1e8);
    expected.push({ seq: i, signal });
  });

  return NextResponse.json(
    {
      ok: true,
      checks: { commitment: "ok", replay: "computed" },
      commitment: vault.programCommitment,
      barsReplayed: prices.length,
      // Consumers compare this against the AttestedTick event log. The chain
      // holds the signatures; this is the sequence they must match.
      expectedSignals: expected,
      note:
        "Compare expectedSignals against the vault's AttestedTick events. Any bar where the " +
        "signed signal differs from the expected one is a provable deviation from the committed program.",
      signalLegend: SIGNAL_NAME,
    },
    { status: 200, headers: NO_STORE },
  );
}
