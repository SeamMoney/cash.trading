/**
 * POST /api/sealed/payload
 *
 * Builds the wallet-signed entry-function payloads for the sealed-vault launch
 * rail. The server holds no user key and never submits these — the UI signs.
 *
 * kinds: create | seal | pause | delegate
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  DECIBEL_VAULT_PACKAGE,
  SEALED_PACKAGE,
  buildCreateSealedVaultPayload,
  buildDelegateInstruction,
  buildSealPayload,
  buildSetPausedPayload,
  findSealedMarket,
  isHex32,
  isHexAddress,
} from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-payload", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const pkg = typeof body.packageAddress === "string" ? body.packageAddress : SEALED_PACKAGE;
  if (!pkg) {
    return NextResponse.json(
      { error: "sealed vault module is not configured — set SEALED_VAULT_PACKAGE" },
      { status: 501, headers: NO_STORE },
    );
  }
  if (!isHexAddress(pkg)) {
    return NextResponse.json({ error: "invalid packageAddress" }, { status: 400, headers: NO_STORE });
  }

  const kind = body.kind;

  if (kind === "create") {
    const { programCommitment, attestorPubkey, decibelVaultAddr } = body as {
      programCommitment?: unknown;
      attestorPubkey?: unknown;
      decibelVaultAddr?: unknown;
    };
    if (!isHex32(programCommitment)) {
      return NextResponse.json(
        { error: "programCommitment must be 32 bytes of hex" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!isHex32(attestorPubkey)) {
      return NextResponse.json(
        { error: "attestorPubkey must be a 32-byte ed25519 key" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!isHexAddress(decibelVaultAddr)) {
      return NextResponse.json(
        { error: "decibelVaultAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }
    const market = findSealedMarket(typeof body.market === "string" ? body.market : "BTC/USD");
    if (!market) {
      return NextResponse.json({ error: "unknown market" }, { status: 400, headers: NO_STORE });
    }

    // Rule bounds are enforced on-chain too; validating here gives a readable
    // error instead of a Move abort code.
    const pctBps = Number(body.pctBps ?? 1000);
    const maxLeverageX100 = Number(body.maxLeverageX100 ?? 200);
    const minBarIntervalS = Number(body.minBarIntervalS ?? 60);
    const traceCapacity = Number(body.traceCapacity ?? 500);
    if (!Number.isInteger(pctBps) || pctBps < 1 || pctBps > 10000) {
      return NextResponse.json(
        { error: "pctBps must be 1..10000 (bps of NAV per order)" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!Number.isInteger(maxLeverageX100) || maxLeverageX100 < 1 || maxLeverageX100 > 2000) {
      return NextResponse.json(
        { error: "maxLeverageX100 must be 1..2000 (200 = 2x)" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!Number.isInteger(minBarIntervalS) || minBarIntervalS < 1) {
      return NextResponse.json(
        { error: "minBarIntervalS must be >= 1" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!Number.isInteger(traceCapacity) || traceCapacity < 30 || traceCapacity > 2000) {
      return NextResponse.json(
        { error: "traceCapacity must be 30..2000" },
        { status: 400, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        payload: buildCreateSealedVaultPayload({
          packageAddress: pkg,
          programCommitment,
          attestorPubkey,
          decibelVaultAddr,
          market,
          pctBps,
          maxLeverageX100,
          minBarIntervalS,
          traceCapacity,
        }),
      },
      { status: 200, headers: NO_STORE },
    );
  }

  if (kind === "seal" || kind === "pause") {
    if (!isHexAddress(body.strategyVaultAddr)) {
      return NextResponse.json(
        { error: "strategyVaultAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }
    const addr = body.strategyVaultAddr as string;
    const payload =
      kind === "seal"
        ? buildSealPayload({
            packageAddress: pkg,
            strategyVaultAddr: addr,
            enclaveMeasurement:
              typeof body.enclaveMeasurement === "string" ? body.enclaveMeasurement : "0x",
          })
        : buildSetPausedPayload({
            packageAddress: pkg,
            strategyVaultAddr: addr,
            paused: body.paused === true,
          });
    return NextResponse.json({ ok: true, payload }, { status: 200, headers: NO_STORE });
  }

  if (kind === "delegate") {
    if (!isHexAddress(body.strategyVaultAddr) || !isHexAddress(body.decibelVaultAddr)) {
      return NextResponse.json(
        { error: "strategyVaultAddr and decibelVaultAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }
    // Always bound the delegation. An unbounded grant on the old Decibel package
    // could never be revoked (docs/CURATOR-RULES.md §2).
    const days = Number(body.expiryDays ?? 365);
    const expirySecs = Math.floor(Date.now() / 1000) + Math.max(1, days) * 86_400;
    return NextResponse.json(
      {
        ok: true,
        signer: "decibel-vault-admin",
        note: "This must be signed by the Decibel vault ADMIN, not the strategy creator.",
        payload: buildDelegateInstruction({
          decibelPackage:
            typeof body.decibelPackage === "string" ? body.decibelPackage : DECIBEL_VAULT_PACKAGE,
          decibelVaultAddr: body.decibelVaultAddr as string,
          strategyVaultAddr: body.strategyVaultAddr as string,
          expirySecs,
        }),
      },
      { status: 200, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    { error: 'kind must be one of "create" | "seal" | "pause" | "delegate"' },
    { status: 400, headers: NO_STORE },
  );
}
