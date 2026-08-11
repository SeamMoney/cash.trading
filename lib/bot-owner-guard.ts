import { NextResponse } from "next/server";

import { verifyDecibelSubaccountOwnership } from "@/lib/decibel-account-verification";
import { getActiveNetwork } from "@/lib/decibel-sdk";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * Authorization for the non-vault bot API.
 *
 * These routes hand the shared operator key a subaccount address and tell it to
 * trade. They take `userWalletAddress` / `userSubaccount` as plain JSON with no
 * signature, so before this existed the only thing standing between a stranger
 * and someone else's delegated subaccount was a blanket production 501.
 *
 * Two independent checks, both fail-closed:
 *
 *   1. The caller's wallet must be on an explicit allowlist (`BOT_OWNER_ADDRESSES`).
 *      This is deliberately an allowlist and not a signature scheme — it is far
 *      smaller, and it cannot be replayed or spoofed into accepting a wallet
 *      that isn't listed. It does mean the API is single-tenant until real
 *      wallet-signed auth lands, which is the correct trade while it is one
 *      operator running their own capital.
 *
 *   2. The subaccount must actually belong to that wallet on chain, verified via
 *      `verifyDecibelSubaccountOwnership`. Without this an allowlisted wallet
 *      could still name a stranger's subaccount.
 *
 * An unset allowlist disables the API entirely rather than opening it.
 */

function allowlist(): string[] {
  return (process.env.BOT_OWNER_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
}

/** True when at least one owner is configured. */
export function botOwnerAllowlistConfigured(): boolean {
  return allowlist().length > 0;
}

/** True when this wallet may drive the bot API. */
export function isBotOwner(walletAddress: string | null | undefined): boolean {
  const wallet = (walletAddress ?? "").trim().toLowerCase();
  if (!wallet) return false;
  return allowlist().includes(wallet);
}

/**
 * Returns a NextResponse to short-circuit with, or null to proceed.
 *
 * Mirrors `legacyBotAutomationUnavailable()` so call sites keep the shape
 * `const denied = await denyUnlessBotOwner(...); if (denied) return denied;`
 */
export async function denyUnlessBotOwner(args: {
  walletAddress: string | null | undefined;
  /** When given, also proves this subaccount belongs to the wallet on chain. */
  subaccount?: string | null;
}): Promise<NextResponse | null> {
  if (!botOwnerAllowlistConfigured()) {
    return NextResponse.json(
      {
        unavailable: true,
        reason: "bot_owner_allowlist_not_configured",
        error:
          "Automated bot execution is disabled: no BOT_OWNER_ADDRESSES allowlist is configured.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (!isBotOwner(args.walletAddress)) {
    return NextResponse.json(
      { error: "This wallet is not authorized to control bot automation." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (args.subaccount) {
    let owned = false;
    let lookupIncomplete = false;
    try {
      const result = await verifyDecibelSubaccountOwnership({
        owner: String(args.walletAddress),
        subaccount: args.subaccount,
        network: getActiveNetwork(),
      });
      owned = result.owned;
      lookupIncomplete = result.lookupIncomplete;
    } catch {
      lookupIncomplete = true;
    }

    // A failed lookup is not permission. Same posture as app/api/cash/rewards.
    if (lookupIncomplete) {
      return NextResponse.json(
        { error: "Could not verify subaccount ownership right now. Try again." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    if (!owned) {
      return NextResponse.json(
        { error: "That subaccount does not belong to this wallet." },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
  }

  return null;
}
