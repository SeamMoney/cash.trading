/**
 * GET /api/sealed/decibel-vault?tx=0x…   — read the vault address out of a create tx
 * GET /api/sealed/decibel-vault?owner=0x… — preflight: can this wallet launch right now?
 *
 * Decibel's `create_and_fund_vault` emits no event carrying the new vault's address, so the
 * only source of truth is the transaction writeset: exactly one change writes a
 * `<decibel>::vault::Vault` resource, and that change's address is the vault.
 *
 * The preflight mode exists so the launch button can be honest before it costs anything. It
 * derives the caller's primary subaccount (a named object — pure function of package+owner,
 * no view call needed) and reads its USDC balance, which is the one prerequisite the flow
 * cannot create for the user: `create_and_fund_vault` spends 100 USDC of protocol fee plus the
 * initial funding, and both come from the subaccount, not the wallet.
 */
import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  DECIBEL_PACKAGE_BY_NETWORK,
  USDC_METADATA_BY_NETWORK,
  derivePrimarySubaccount,
  isHexAddress,
  sealedNetwork,
} from "@/lib/sealed-vaults";
import { DECIBEL_VAULT_LIMITS, launchCostUsdc } from "@/lib/vault-economics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type Change = { address?: string; data?: { type?: string } };

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-decibel-vault", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  const network =
    request.nextUrl.searchParams.get("network") === "mainnet"
      ? "mainnet"
      : request.nextUrl.searchParams.get("network") === "testnet"
        ? "testnet"
        : sealedNetwork();
  const aptos = new Aptos(
    new AptosConfig({ network: network === "mainnet" ? Network.MAINNET : Network.TESTNET }),
  );
  const decibel = DECIBEL_PACKAGE_BY_NETWORK[network];

  const owner = request.nextUrl.searchParams.get("owner");
  if (owner) {
    if (!isHexAddress(owner)) {
      return NextResponse.json({ error: "invalid owner" }, { status: 400, headers: NO_STORE });
    }
    const subaccountAddr = derivePrimarySubaccount(owner, network);
    let usdc = 0;
    let subaccountExists = false;
    try {
      // Deployable balance, not raw collateral: this is what `create_and_fund_vault` can
      // actually spend on the 100 USDC protocol fee plus the initial funding. A subaccount
      // with open positions can hold USDC it cannot move.
      const [raw] = (await aptos.view({
        payload: {
          function: `${decibel}::perp_engine::max_allowed_withdraw_from_cross`,
          functionArguments: [subaccountAddr, USDC_METADATA_BY_NETWORK[network]],
        },
      })) as [string];
      usdc = Number(raw) / 1e6;
      subaccountExists = true;
    } catch {
      // No subaccount yet — the view aborts rather than returning zero. Treat as "not funded",
      // which is exactly what the UI needs to say.
    }
    const requiredUsdc = launchCostUsdc(DECIBEL_VAULT_LIMITS.minFundsForActivationUsdc);
    return NextResponse.json(
      {
        ok: true,
        network,
        subaccountAddr,
        subaccountExists,
        usdc,
        requiredUsdc,
        /** True when a launch would go through end-to-end without a funding step. */
        canLaunch: usdc >= requiredUsdc,
        shortfallUsdc: Math.max(0, requiredUsdc - usdc),
      },
      { status: 200, headers: NO_STORE },
    );
  }

  const tx = request.nextUrl.searchParams.get("tx");
  if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    return NextResponse.json(
      { error: "tx hash or owner required" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const txn = (await aptos.getTransactionByHash({ transactionHash: tx })) as {
      success?: boolean;
      vm_status?: string;
      changes?: Change[];
    };
    if (txn.success === false) {
      return NextResponse.json(
        { error: `transaction failed: ${txn.vm_status ?? "unknown"}` },
        { status: 400, headers: NO_STORE },
      );
    }
    const want = `${decibel}::vault::Vault`;
    const hit = (txn.changes ?? []).find((c) => c.data?.type === want);
    if (!hit?.address) {
      return NextResponse.json(
        { error: "no Decibel vault was created in that transaction" },
        { status: 404, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { ok: true, decibelVaultAddr: hit.address, network },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "transaction lookup failed" },
      { status: 502, headers: NO_STORE },
    );
  }
}
