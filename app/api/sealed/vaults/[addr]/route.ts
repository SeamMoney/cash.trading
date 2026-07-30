/**
 * GET /api/sealed/vaults/:addr
 *
 * Vault detail. Everything a depositor should judge the vault on is read from
 * CHAIN, not from the registry row — the row supplies display metadata only.
 * When they disagree we say so rather than papering over it.
 */
import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { getSealedVault, isHexAddress, sealedRegistryAvailable } from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

interface OnChainState {
  creator: string;
  decibelVault: string;
  programCommitment: string;
  attestorPubkey: string;
  enclaveMeasurement: string;
  pctBps: number;
  maxLeverageX100: number;
  minBarIntervalS: number;
  inPosition: boolean;
  isLong: boolean;
  paused: boolean;
  sealed: boolean;
  trades: number;
  seq: number;
  inputDigest: string;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ addr: string }> },
) {
  const rate = checkApiRateLimit(request, "sealed-vault-detail", 60, 60_000);
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
    return NextResponse.json(
      { error: "registry unavailable — DATABASE_URL is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  let vault: Awaited<ReturnType<typeof getSealedVault>> = null;
  try {
    vault = await getSealedVault(addr);
  } catch (err) {
    console.error("[sealed/vault] read failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "registry read failed" }, { status: 503, headers: NO_STORE });
  }
  if (!vault) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }

  const aptos = new Aptos(
    new AptosConfig({
      network: vault.network === "mainnet" ? Network.MAINNET : Network.TESTNET,
    }),
  );

  let onChain: OnChainState | null = null;
  let trace: { prices: string[]; timestamps: string[] } | null = null;
  let chainError: string | null = null;
  try {
    const [state, ctx, traceRes] = await Promise.all([
      aptos.view({
        payload: {
          function: `${vault.packageAddress}::sealed_vault::get_sealed_state`,
          functionArguments: [addr],
        },
      }),
      aptos.view({
        payload: {
          function: `${vault.packageAddress}::sealed_vault::get_attestation_context`,
          functionArguments: [addr],
        },
      }),
      aptos.view({
        payload: {
          function: `${vault.packageAddress}::sealed_vault::get_trace`,
          functionArguments: [addr],
        },
      }),
    ]);
    const s = state as unknown[];
    onChain = {
      creator: String(s[0]),
      decibelVault: String(s[1]),
      programCommitment: String(s[2]),
      attestorPubkey: String(s[3]),
      enclaveMeasurement: String(s[4]),
      pctBps: Number(s[5]),
      maxLeverageX100: Number(s[6]),
      minBarIntervalS: Number(s[7]),
      inPosition: Boolean(s[8]),
      isLong: Boolean(s[9]),
      paused: Boolean(s[10]),
      sealed: Boolean(s[11]),
      trades: Number(s[12]),
      seq: Number(s[13]),
      inputDigest: String((ctx as unknown[])[2]),
    };
    const t = traceRes as unknown[];
    trace = {
      prices: (t[0] as string[]) ?? [],
      timestamps: (t[1] as string[]) ?? [],
    };
  } catch (err) {
    chainError = err instanceof Error ? err.message : "chain read failed";
  }

  // Surface disagreement instead of hiding it — a registry row that doesn't
  // match chain is exactly what a depositor needs to know about.
  const mismatches: string[] = [];
  if (onChain) {
    if (onChain.programCommitment.toLowerCase() !== vault.programCommitment.toLowerCase()) {
      mismatches.push("programCommitment");
    }
    if (onChain.attestorPubkey.toLowerCase() !== vault.attestorPubkey.toLowerCase()) {
      mismatches.push("attestorPubkey");
    }
    if (onChain.decibelVault.toLowerCase() !== vault.decibelVaultAddr.toLowerCase()) {
      mismatches.push("decibelVaultAddr");
    }
    if (onChain.pctBps !== vault.pctBps) mismatches.push("pctBps");
    if (onChain.maxLeverageX100 !== vault.maxLeverageX100) mismatches.push("maxLeverageX100");
  }

  return NextResponse.json(
    {
      ok: true,
      vault,
      onChain,
      trace,
      chainError,
      registryMatchesChain: onChain ? mismatches.length === 0 : null,
      mismatches,
    },
    { status: 200, headers: NO_STORE },
  );
}
