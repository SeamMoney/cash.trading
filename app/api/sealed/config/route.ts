/**
 * GET /api/sealed/config
 *
 * Everything the launch UI needs so the user doesn't have to type it. The
 * attestor public key in particular is PLATFORM-managed: asking a creator to
 * paste a 32-byte ed25519 key was the single worst piece of UX in the flow, and
 * it isn't even theirs to choose — the attestor is the service that runs their
 * committed program.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  PORTFOLIO_DEFAULTS,
  SEALED_MARKETS,
  readPlatformTerms,
} from "@/lib/sealed-vaults";
import { SEALED_PRESETS } from "@/lib/sealed-presets";
import {
  evaluateSealedReadiness,
  withSealedPlatformReadiness,
} from "@/lib/sealed-readiness";
import {
  DECIBEL_VAULT_LIMITS,
  computeFeeBreakdown,
  launchFunding,
} from "@/lib/vault-economics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Defaults a creator never has to think about. Bounds are enforced on-chain. */
export const SEALED_DEFAULTS = {
  pctBps: 1000, // 10% of NAV per order
  maxLeverageX100: 200, // 2x
  minBarIntervalS: 60,
  slippageBps: 30, // 0.30%
  performanceFeeBps: 1000, // 10% profit share, Hyperliquid-customary
  traceCapacity: 500,
} as const;

/**
 * The one operational fact the readiness probe could not prove: whether the crank wallet
 * actually holds APT. A dry crank fails SILENTLY — the cron logs a submit error, vaults simply
 * stop trading, and `ready:true` keeps smiling. That is the same failure shape as the
 * CRON_SECRET trap (DEPLOY-SEALED §4.2), and it is the last one still only documented rather
 * than detected. So derive the crank's address from the key the server already holds and read
 * its live balance. Only the address and balance are exposed; both become public on the
 * crank's first transaction anyway.
 */
async function readCrankFunding(network: "testnet" | "mainnet") {
  const key = process.env.SEALED_CRANK_PRIVATE_KEY?.trim();
  if (!key) return null;
  try {
    const { Ed25519PrivateKey } = await import("@aptos-labs/ts-sdk");
    const address = new Ed25519PrivateKey(key).publicKey().authKey().derivedAddress().toString();
    const host = network === "mainnet" ? "api.mainnet.aptoslabs.com" : "api.testnet.aptoslabs.com";
    const res = await fetch(`https://${host}/v1/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        function: "0x1::coin::balance",
        type_arguments: ["0x1::aptos_coin::AptosCoin"],
        arguments: [address],
      }),
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    // An unfunded account has no CoinStore, which reads as an error rather than zero. Report
    // that as an explicit zero: "never funded" is exactly the state worth catching here.
    if (!res.ok) return { address, balanceApt: 0, funded: false };
    const [octas] = (await res.json()) as [string];
    const balanceApt = Number(BigInt(octas)) / 1e8;
    // §5's floor: one vault ticking every minute burns ~0.27 APT/day, so ~8 APT is a month of
    // runway. 1 APT is the "this will die within days" line, not a comfortable balance.
    return { address, balanceApt, funded: balanceApt >= 1 };
  } catch {
    // Never let a chain hiccup break the config route — the launch UI depends on it, and a
    // null here reads as "unknown", which is honest.
    return null;
  }
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-config", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  const network =
    (process.env.NEXT_PUBLIC_DECIBEL_NETWORK ?? process.env.DECIBEL_NETWORK) === "mainnet"
      ? ("mainnet" as const)
      : ("testnet" as const);

  // Quoted from the contract, not from a constant: the launch and builder fees are
  // admin-settable on chain, and a stale constant would show a price that is no longer real.
  const [terms, crank] = await Promise.all([readPlatformTerms(), readCrankFunding(network)]);

  const readiness = withSealedPlatformReadiness(
    evaluateSealedReadiness(),
    terms.onChain,
  );

  return NextResponse.json(
    {
      ok: true,
      ...readiness,
      network,
      /** null when the key is unset or the chain read failed; never blocks the route. */
      crank,
      markets: SEALED_MARKETS.map((m) => ({ name: m.name, addr: m.addr })),
      defaults: SEALED_DEFAULTS,
      /** Frozen bounds a portfolio vault is created with. Shown, not asked for. */
      portfolioDefaults: PORTFOLIO_DEFAULTS,
      presets: Object.keys(SEALED_PRESETS),
      // Everything the cost panel shows, straight from the on-chain limits — so the UI never
      // hardcodes a number that a Decibel config change could silently falsify.
      economics: {
        creationFeeUsdc: DECIBEL_VAULT_LIMITS.creationFeeUsdc,
        minFundingUsdc: DECIBEL_VAULT_LIMITS.minFundsForActivationUsdc,
        feeIntervalDays: DECIBEL_VAULT_LIMITS.minFeeIntervalS / 86_400,
        /** Our one-time fee, per Decibel vault. Unlimited strategy swaps after this. */
        launchFeeUsdc: terms.launchFeeUsdc,
        /** Our per-fill fee on notional, in bps. */
        builderFeeBps: terms.builderFeeBps,
        /** False when the module is unpublished — the numbers are then defaults, not quotes. */
        termsOnChain: terms.onChain,
        ...launchFunding(DECIBEL_VAULT_LIMITS.minFundsForActivationUsdc, terms.launchFeeUsdc),
        ...computeFeeBreakdown(),
      },
    },
    { status: 200, headers: NO_STORE },
  );
}
