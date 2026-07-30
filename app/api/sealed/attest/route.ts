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
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { createStrategyRunner } from "@/lib/strategy-equivalence";
import { canonicalizePine } from "@/lib/sealed-presets";
import {
  buildTickAttestedPayload,
  computeProgramCommitment,
  fromHex,
  signAttestation,
  toHex,
  type Signal,
} from "@/lib/sealed-attestor";
import { getSealedVault, isHexAddress, sealedRegistryAvailable } from "@/lib/sealed-vaults";
import { prisma } from "@/lib/prisma";
import { fetchPythCandles } from "@/lib/launchpad/pyth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const toTrit = (s: "buy" | "sell" | "neutral"): Signal => (s === "buy" ? 1 : s === "sell" ? 2 : 0);

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

  const aptos = new Aptos(
    new AptosConfig({
      network: vault.network === "mainnet" ? Network.MAINNET : Network.TESTNET,
    }),
  );

  // Read the context FIRST: the attestation must be signed against the digest
  // the chain currently holds, not one we assume.
  let seq: bigint;
  let inputDigest: string;
  let onChainCommitment: string;
  try {
    const ctx = (await aptos.view({
      payload: {
        function: `${vault.packageAddress}::sealed_vault::get_attestation_context`,
        functionArguments: [addr],
      },
    })) as unknown[];
    onChainCommitment = String(ctx[0]);
    seq = BigInt(String(ctx[1]));
    inputDigest = String(ctx[2]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "chain read failed" },
      { status: 502, headers: NO_STORE },
    );
  }

  // Refuse to sign for a program the vault didn't commit to.
  const t = transpileV3(canonicalizePine(body.pineScript), undefined, {
    target: "vault",
    marketAddr: vault.marketAddr,
  });
  if (t.errors?.length) {
    return NextResponse.json(
      { error: "supplied pineScript does not transpile", errors: t.errors },
      { status: 422, headers: NO_STORE },
    );
  }
  const localCommitment = toHex(
    computeProgramCommitment({
      canonicalPine: canonicalizePine(body.pineScript),
      emittedMove: t.moveSource,
      manifestJson: row.manifestJson,
    }),
  );
  if (localCommitment.toLowerCase() !== onChainCommitment.toLowerCase()) {
    return NextResponse.json(
      {
        error: "commitment mismatch — refusing to sign",
        onChain: onChainCommitment,
        local: localCommitment,
      },
      { status: 409, headers: NO_STORE },
    );
  }

  // Warm the program up on history, then take the latest bar.
  const asset = typeof body.asset === "string" ? body.asset : "BTC/USD";
  const runner = createStrategyRunner(t.ir);
  const nowS = Math.floor(Date.now() / 1000);
  let closes: number[] = [];
  try {
    const candles = await fetchPythCandles(asset, "1", nowS - (runner.warmupBars + 80) * 120, nowS);
    closes = candles.map((c) => c.close);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "price fetch failed" },
      { status: 502, headers: NO_STORE },
    );
  }
  if (closes.length < runner.warmupBars + 2) {
    return NextResponse.json(
      { error: `insufficient price history (${closes.length} bars)` },
      { status: 503, headers: NO_STORE },
    );
  }
  let signal: Signal = 0;
  for (const c of closes) signal = toTrit(runner.pushBar(c));

  const attestorPriv = new Ed25519PrivateKey(attestorKeyRaw);
  const signature = signAttestation(attestorPriv, {
    chainId: await aptos.getChainId(),
    strategyVault: addr,
    programCommitment: fromHex(onChainCommitment),
    seq,
    inputDigest: fromHex(inputDigest),
    signal,
  });

  const cranker = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(crankKeyRaw),
  });
  try {
    const txn = await aptos.transaction.build.simple({
      sender: cranker.accountAddress,
      data: buildTickAttestedPayload({
        packageAddress: vault.packageAddress,
        strategyVault: addr,
        barTs: BigInt(nowS),
        signal,
        signature,
      }),
    });
    const res = await aptos.signAndSubmitTransaction({ signer: cranker, transaction: txn });
    await aptos.waitForTransaction({ transactionHash: res.hash });
    return NextResponse.json(
      { ok: true, seq: seq.toString(), signal, txHash: res.hash },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    // A Move abort here is meaningful (E_BAR_TOO_SOON, E_INVALID_SIGNATURE, …) —
    // pass it through verbatim rather than flattening it.
    return NextResponse.json(
      { ok: false, seq: seq.toString(), signal, error: err instanceof Error ? err.message : "submit failed" },
      { status: 502, headers: NO_STORE },
    );
  }
}
