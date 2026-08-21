/**
 * cash.trading's builder-code economics.
 *
 * Direct user orders and delegated vault orders have different Decibel
 * trading identities. A user can approve a builder fee for their own trading
 * subaccount. A delegated vault strategy cannot currently approve a fee for
 * the vault's trading subaccount through Decibel's public API.
 */
export const DEFAULT_DECIBEL_BUILDER_FEE_BPS = 10;
export const MAX_DECIBEL_BUILDER_FEE_BPS = 10;
export const DEFAULT_DECIBEL_BUILDER_FEE_RATE =
  DEFAULT_DECIBEL_BUILDER_FEE_BPS / 10_000;

/**
 * Automated vault orders must remain fee-free until Decibel exposes a
 * vault-admin/delegate-safe builder approval for the actual vault subaccount.
 * Keep these separate from the direct-order defaults above: changing one must
 * never silently change the other.
 */
export const DEFAULT_AUTOMATED_VAULT_BUILDER_FEE_BPS = 0;
export const MAX_AUTOMATED_VAULT_BUILDER_FEE_BPS = 0;
