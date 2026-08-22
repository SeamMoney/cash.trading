import { DEFAULT_AUTOMATED_VAULT_BUILDER_FEE_BPS } from "@/lib/decibel-builder-config";

/**
 * Decibel vault economics — what it costs to run a vault, and what we charge.
 *
 * Every number here was read from the live `vault_global_config::GlobalVaultConfig`
 * resource on 2026-08-03 (identical on testnet and mainnet). Do NOT guess these:
 * they are consensus-enforced and a violation aborts vault creation.
 *
 *   testnet  0xe7da2794…b7f
 *   mainnet  0x50ead22a…db06
 *
 * `pnpm test:economics` re-reads both chains and fails on drift.
 */

/** Decibel's protocol-level limits. Immutable from our side. */
export const DECIBEL_VAULT_LIMITS = {
  /** Charged in USDC to the vault creator, once, at creation. 100 USDC. */
  creationFeeUsdc: 100,
  creationFeeRaw: 100_000_000n, // 1e6 scale

  /** HARD CEILING on a vault's profit share. 1000 bps = 10%. */
  maxFeeBps: 1000,
  /** Fee interval must sit in [30 days, 365 days]. */
  minFeeIntervalS: 2_592_000,
  maxFeeIntervalS: 31_536_000,

  /** A vault needs this much before it can activate. 100 USDC. */
  minFundsForActivationUsdc: 100,
  minFundsForActivationRaw: 100_000_000n,

  /** Smallest depositor contribution. 10 USDC. */
  minContributionUsdc: 10,
  /** Smallest redemption. 5 USDC. */
  minRedemptionUsdc: 5,

  /**
   * Manager skin-in-the-game: the greater of 100,000 USDC or 5% of the vault.
   * A manager who can't meet it must be opted out via
   * `vault_admin_api::set_not_respecting_manager_minimum_shares_requirement`,
   * which is PUBLIC on both networks. Disclose that opt-out to depositors —
   * it removes the alignment guarantee they'd otherwise get.
   */
  minManagerFundsUsdc: 100_000,
  minManagerFundsFractionBps: 500,

  /** Deposit lockup is capped at 7 days. */
  maxContributionLockupS: 604_800,

  /** Vault creation is permissionless — GlobalVaultMode is `Open` on both
   *  networks. No allowlist, no application, no referrer requirement. */
  permissionless: true,
} as const;

/**
 * Our fee, charged on top of Decibel's.
 *
 * ONE fee, taken as a slice of the vault's profit share — not a separate
 * charge to depositors. The vault's on-chain `fee_bps` is what depositors
 * actually pay (capped at 10% by Decibel); we split that between the strategy
 * creator and the platform when fees are distributed.
 *
 * Why a split rather than an additional fee: Decibel enforces `fee_bps <= 1000`
 * at the contract level, so "10% creator + 2% platform" is not expressible —
 * it would simply abort. Splitting a single 10% is the only structure the
 * protocol permits, and it keeps the depositor's headline number honest.
 */
/**
 * Our own economics — the part Decibel does not set.
 *
 * Two revenue lines, and only one of them is a wall in front of the user:
 *
 *  - `launchFeeUsdc` — one-time, charged per DECIBEL VAULT, not per strategy. Once a vault is
 *    licensed the creator can re-point it at as many sealed strategies as they like for gas
 *    alone. That is what the fee actually buys: not one bot, but a vault that can run any
 *    indicator, swapped whenever they want.
 *  - `builderFeeBps` — currently zero for automated vault fills. Decibel validates a builder
 *    approval against the vault's trading subaccount, but its public API only lets the owner of
 *    a user trading account grant that approval. The delegated strategy object cannot grant it
 *    for a Decibel vault. Direct cash.trading orders still use the separate 1 bp builder route.
 *
 * Both are read from the CHAIN at runtime (`sealed_vault::platform_terms`) — these constants
 * are the deployment default and the UI's fallback, not the source of truth.
 */
export const PLATFORM_LAUNCH = {
  /** One-time, per Decibel vault, in whole USDC. Bounded at $500 by the contract. */
  launchFeeUsdc: 50,
  /** Builder fee on automated vault notional. Must remain zero until Decibel adds approval. */
  builderFeeBps: DEFAULT_AUTOMATED_VAULT_BUILDER_FEE_BPS,
} as const;

export const PLATFORM_FEE = {
  /** Total profit share charged to depositors, in bps. Decibel's max. */
  totalFeeBps: 1000,
  /** Platform's cut OF THAT fee, in bps of the fee (2000 = 20% of the 10%). */
  platformShareOfFeeBps: 2000,
} as const;

export interface FeeBreakdown {
  /** What a depositor pays on profits, as a percentage. */
  depositorPaysPct: number;
  /** Of the profits, what the creator keeps, as a percentage. */
  creatorKeepsPct: number;
  /** Of the profits, what the platform takes, as a percentage. */
  platformTakesPct: number;
  /** Human summary for the UI. */
  summary: string;
}

export function computeFeeBreakdown(
  totalFeeBps: number = PLATFORM_FEE.totalFeeBps,
  platformShareOfFeeBps: number = PLATFORM_FEE.platformShareOfFeeBps,
): FeeBreakdown {
  const depositorPaysPct = totalFeeBps / 100;
  const platformTakesPct = (depositorPaysPct * platformShareOfFeeBps) / 10_000;
  const creatorKeepsPct = depositorPaysPct - platformTakesPct;
  return {
    depositorPaysPct,
    creatorKeepsPct,
    platformTakesPct,
    summary:
      `${depositorPaysPct}% of profits — you keep ${creatorKeepsPct}%, ` +
      `platform takes ${platformTakesPct}%`,
  };
}

/** Validate a proposed vault config against Decibel's consensus limits.
 *  Returns human-readable violations; empty means the create will be accepted. */
export function validateVaultConfig(cfg: {
  feeBps: number;
  feeIntervalS: number;
  initialFundingUsdc: number;
  lockupS: number;
}): string[] {
  const errs: string[] = [];
  const L = DECIBEL_VAULT_LIMITS;
  if (cfg.feeBps < 0 || cfg.feeBps > L.maxFeeBps) {
    errs.push(`Profit share must be 0–${L.maxFeeBps / 100}% (Decibel caps it at ${L.maxFeeBps} bps).`);
  }
  if (cfg.feeIntervalS < L.minFeeIntervalS || cfg.feeIntervalS > L.maxFeeIntervalS) {
    errs.push(
      `Fee interval must be ${L.minFeeIntervalS / 86400}–${L.maxFeeIntervalS / 86400} days ` +
        `(got ${Math.round(cfg.feeIntervalS / 86400)} days).`,
    );
  }
  if (cfg.initialFundingUsdc < L.minFundsForActivationUsdc) {
    errs.push(`A vault needs at least ${L.minFundsForActivationUsdc} USDC to activate.`);
  }
  if (cfg.lockupS < 0 || cfg.lockupS > L.maxContributionLockupS) {
    errs.push(`Deposit lockup can't exceed ${L.maxContributionLockupS / 86400} days.`);
  }
  return errs;
}

/**
 * Total USDC a creator needs on hand to launch — and WHERE each part must sit.
 *
 * These are two different pots and conflating them is the fastest way to a failed launch:
 * Decibel's creation fee and the vault's seed are spent from the creator's Decibel
 * SUBACCOUNT, while our launch fee is a primary-fungible-store transfer from their WALLET.
 * A creator with 300 USDC all in the subaccount still cannot launch.
 */
export function launchFunding(
  initialFundingUsdc: number,
  launchFeeUsdc: number = PLATFORM_LAUNCH.launchFeeUsdc,
): { subaccountUsdc: number; walletUsdc: number; totalUsdc: number } {
  const subaccountUsdc = DECIBEL_VAULT_LIMITS.creationFeeUsdc + initialFundingUsdc;
  return { subaccountUsdc, walletUsdc: launchFeeUsdc, totalUsdc: subaccountUsdc + launchFeeUsdc };
}

/** Total USDC a creator needs on hand to launch. */
export function launchCostUsdc(
  initialFundingUsdc: number,
  launchFeeUsdc: number = PLATFORM_LAUNCH.launchFeeUsdc,
): number {
  return launchFunding(initialFundingUsdc, launchFeeUsdc).totalUsdc;
}
