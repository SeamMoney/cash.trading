/**
 * Creator earnings withdrawal endpoint.
 *
 * POST /api/launchpad/withdraw
 * Body: { indicatorAddr: string, creatorAddr: string }
 *
 * Verifiable path: when LAUNCHPAD_PAYOUT_TREASURY_KEY is configured, send
 * USDT from the launchpad treasury to the creator and only clear pending
 * earnings after Aptos confirms the transfer. Without treasury config, return
 * a pending status and preserve earnings.
 */
import { NextResponse } from "next/server";
import {
  Account,
  AccountAddress,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { indicatorRegistry } from "@/app/api/launchpad/indicators/route";
import { saveState } from "@/lib/launchpad/persist";
import { aptos } from "@/lib/aptos";
import { explorerTxUrl } from "@/lib/constants";
import { TOKENS } from "@/lib/tokens";

export const runtime = "nodejs";

type WithdrawRequest = {
  indicatorAddr: string;
  creatorAddr: string;
};

function normalizeAddress(addr: string) {
  return AccountAddress.from(addr).toStringLong();
}

function amountUsdtToBaseUnits(amount: number) {
  return String(Math.round(amount * 1_000_000));
}

function getTreasuryAccount(): Account | null {
  const keyHex = process.env.LAUNCHPAD_PAYOUT_TREASURY_KEY;
  if (!keyHex) return null;
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(keyHex) });
}

async function submitUsdtPayout(
  treasury: Account,
  creatorAddr: string,
  amountUsdt: number,
) {
  const amount = amountUsdtToBaseUnits(amountUsdt);
  const txn = await aptos.transaction.build.simple({
    sender: treasury.accountAddress,
    data: {
      function: "0x1::primary_fungible_store::transfer",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [
        TOKENS.USDT.faAddress,
        AccountAddress.from(creatorAddr),
        amount,
      ],
    },
  });
  const committed = await aptos.signAndSubmitTransaction({
    signer: treasury,
    transaction: txn,
  });
  const executed = await aptos.waitForTransaction({
    transactionHash: committed.hash,
  });
  if ("success" in executed && executed.success === false) {
    throw new Error(executed.vm_status || "USDT payout transaction failed");
  }
  return committed.hash;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as WithdrawRequest;
    const { indicatorAddr, creatorAddr } = body;

    if (!indicatorAddr || !creatorAddr) {
      return NextResponse.json(
        { error: "indicatorAddr and creatorAddr are required" },
        { status: 400 },
      );
    }

    const ind = indicatorRegistry.find(i => i.address === indicatorAddr);
    if (!ind) {
      return NextResponse.json({ error: "Indicator not found" }, { status: 404 });
    }

    const requestedCreator = normalizeAddress(creatorAddr);
    const owner = normalizeAddress(ind.creator);
    if (requestedCreator !== owner) {
      return NextResponse.json(
        {
          success: false,
          status: "failed",
          code: "CREATOR_MISMATCH",
          error: "Connected wallet is not the indicator creator.",
          pendingEarningsUsdt: ind.creatorEarningsUsdt ?? 0,
        },
        { status: 403 },
      );
    }

    const earnings = ind.creatorEarningsUsdt ?? 0;
    if (earnings <= 0) {
      return NextResponse.json({ error: "No earnings to withdraw" }, { status: 400 });
    }

    const treasury = getTreasuryAccount();
    if (!treasury) {
      return NextResponse.json(
        {
          success: false,
          status: "pending_configuration",
          code: "PAYOUT_TREASURY_NOT_CONFIGURED",
          error:
            "Creator withdrawal is pending until LAUNCHPAD_PAYOUT_TREASURY_KEY is configured for verifiable USDT payouts.",
          pendingEarningsUsdt: earnings,
          indicatorAddr,
          creatorAddr: requestedCreator,
          payoutPath: "treasury_usdt_transfer",
        },
        { status: 202 },
      );
    }

    const txHash = await submitUsdtPayout(treasury, requestedCreator, earnings);
    const payoutId = `launchpad_usdt_${txHash.slice(0, 14)}`;

    ind.creatorEarningsUsdt = 0;
    saveState("indicators", indicatorRegistry);

    return NextResponse.json({
      success: true,
      status: "paid",
      payoutPath: "treasury_usdt_transfer",
      payoutId,
      txHash,
      explorerUrl: explorerTxUrl(txHash),
      paidEarningsUsdt: earnings,
      pendingEarningsUsdt: 0,
      indicatorAddr,
      creatorAddr: requestedCreator,
    });
  } catch (err) {
    console.error("[withdraw] POST error:", err);
    return NextResponse.json(
      {
        success: false,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
