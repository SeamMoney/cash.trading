import { NextRequest, NextResponse } from "next/server";
import {
  Account,
  AccountAuthenticator,
  Deserializer,
  Ed25519PrivateKey,
  Hex,
  SimpleTransaction,
  TransactionPayloadEntryFunction,
  TransactionPayloadScript,
} from "@aptos-labs/ts-sdk";
import { aptos } from "@/lib/aptos";
import { MAINNET_DECIBEL_PACKAGE } from "@/lib/decibel";
import { APTOS_CCTP_HANDLE_RECEIVE_MESSAGE_BYTECODE } from "@/lib/decibel-cctp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

// Hard ceiling on what a single sponsored transaction may cost us:
// max_gas_amount * gas_unit_price <= 0.05 APT.
const MAX_SPONSORED_GAS_OCTAS = 5_000_000n;

const ALLOWED_CLAIM_BYTECODES = new Set(
  Object.values(APTOS_CCTP_HANDLE_RECEIVE_MESSAGE_BYTECODE).map((b) => b.toLowerCase()),
);

function getSponsorAccount(): Account | null {
  const raw =
    process.env.SPONSOR_PRIVATE_KEY || process.env.BOT_OPERATOR_PRIVATE_KEY || "";
  if (!raw.trim()) return null;
  try {
    return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(raw.trim()) });
  } catch {
    return null;
  }
}

/**
 * Only sponsor the two transactions in the CCTP deposit flow:
 *   1. the Circle CCTP claim (handle_receive_message script — exact bytecode match)
 *   2. the Decibel collateral deposit (deposit_to_subaccount_at on a known package)
 * Anything else gets refused so the sponsor key can't be drained as a public
 * gas faucet.
 */
function isSponsorablePayload(transaction: SimpleTransaction): {
  ok: boolean;
  kind?: "cctp_claim" | "decibel_deposit";
  reason?: string;
} {
  const payload = transaction.rawTransaction.payload;

  if (payload instanceof TransactionPayloadScript) {
    const bytecode = Hex.fromHexInput(payload.script.bytecode).toString().toLowerCase();
    if (ALLOWED_CLAIM_BYTECODES.has(bytecode)) {
      return { ok: true, kind: "cctp_claim" };
    }
    return { ok: false, reason: "script_not_allowlisted" };
  }

  if (payload instanceof TransactionPayloadEntryFunction) {
    const fn = payload.entryFunction;
    const moduleAddress = fn.module_name.address.toStringLong();
    const functionName = fn.function_name.identifier;
    const allowedPackages = new Set(
      [MAINNET_DECIBEL_PACKAGE, process.env.DECIBEL_PACKAGE]
        .filter((p): p is string => !!p)
        .map((p) => p.toLowerCase()),
    );
    if (
      functionName === "deposit_to_subaccount_at" &&
      allowedPackages.has(moduleAddress.toLowerCase())
    ) {
      return { ok: true, kind: "decibel_deposit" };
    }
    return { ok: false, reason: "entry_function_not_allowlisted" };
  }

  return { ok: false, reason: "unsupported_payload_type" };
}

export async function POST(req: NextRequest) {
  const sponsor = getSponsorAccount();
  if (!sponsor) {
    return NextResponse.json(
      { unavailable: true, reason: "sponsor_not_configured" },
      { status: 501, headers: NO_STORE_HEADERS },
    );
  }

  let transactionHex: unknown;
  let senderAuthenticatorHex: unknown;
  try {
    const body = await req.json();
    transactionHex = body?.transactionHex;
    senderAuthenticatorHex = body?.senderAuthenticatorHex;
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (typeof transactionHex !== "string" || typeof senderAuthenticatorHex !== "string") {
    return NextResponse.json(
      { error: "transactionHex and senderAuthenticatorHex are required hex strings" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let transaction: SimpleTransaction;
  let senderAuthenticator: AccountAuthenticator;
  try {
    transaction = SimpleTransaction.deserialize(
      new Deserializer(Hex.fromHexInput(transactionHex).toUint8Array()),
    );
    senderAuthenticator = AccountAuthenticator.deserialize(
      new Deserializer(Hex.fromHexInput(senderAuthenticatorHex).toUint8Array()),
    );
  } catch {
    return NextResponse.json(
      { error: "could not deserialize transaction or authenticator" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!transaction.feePayerAddress) {
    return NextResponse.json(
      { error: "transaction was not built with a fee payer slot" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const allow = isSponsorablePayload(transaction);
  if (!allow.ok) {
    return NextResponse.json(
      { error: "transaction is not sponsorable", reason: allow.reason },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const gasBudget =
    BigInt(transaction.rawTransaction.max_gas_amount) *
    BigInt(transaction.rawTransaction.gas_unit_price);
  if (gasBudget > MAX_SPONSORED_GAS_OCTAS) {
    return NextResponse.json(
      { error: "gas budget exceeds sponsorship cap", capOctas: String(MAX_SPONSORED_GAS_OCTAS) },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const feePayerAuthenticator = aptos.transaction.signAsFeePayer({
      signer: sponsor,
      transaction,
    });
    const pending = await aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator,
      feePayerAuthenticator,
    });
    return NextResponse.json(
      { hash: pending.hash, sponsored: true, kind: allow.kind },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "submission failed";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
