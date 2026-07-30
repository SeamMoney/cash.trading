/**
 * GET /api/sealed/created?tx=0x…
 *
 * Reads the SealedVault object address out of a create transaction's
 * SealedVaultCreated event. Derivation isn't an option here — the object address
 * comes from object::create_object, which is not deterministic from the caller —
 * so the event is the source of truth.
 */
import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-created", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  const tx = request.nextUrl.searchParams.get("tx");
  if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    return NextResponse.json({ error: "tx hash required" }, { status: 400, headers: NO_STORE });
  }
  const network =
    request.nextUrl.searchParams.get("network") === "mainnet" ? Network.MAINNET : Network.TESTNET;
  const aptos = new Aptos(new AptosConfig({ network }));

  try {
    const txn = (await aptos.getTransactionByHash({ transactionHash: tx })) as {
      events?: Array<{ type: string; data: Record<string, unknown> }>;
    };
    const ev = (txn.events ?? []).find((e) => e.type.endsWith("::sealed_vault::SealedVaultCreated"));
    if (!ev) {
      return NextResponse.json(
        { error: "no SealedVaultCreated event in that transaction" },
        { status: 404, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        strategyVaultAddr: String(ev.data.strategy_vault),
        creator: String(ev.data.creator),
        decibelVault: String(ev.data.decibel_vault),
        programCommitment: String(ev.data.program_commitment),
        attestorPubkey: String(ev.data.attestor_pubkey),
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "transaction lookup failed" },
      { status: 502, headers: NO_STORE },
    );
  }
}
