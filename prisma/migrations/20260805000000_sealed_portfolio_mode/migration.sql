-- Portfolio-mode sealed vaults.
--
-- Additive only. Every existing row is a single-market vault, which is exactly what the
-- `vaultKind` default says, so no backfill is needed and no existing tick path changes
-- behaviour.
--
-- `marketNames` holds the allowlist IN ORDER. That order is load-bearing: an action's
-- `market_idx` addresses the on-chain list positionally, so storing an unordered set here
-- would eventually place a real order on the wrong market. It stays NULL for single-market
-- vaults, where `marketName` already says everything.
ALTER TABLE "SealedVault" ADD COLUMN IF NOT EXISTS "vaultKind" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "SealedVault" ADD COLUMN IF NOT EXISTS "marketNames" TEXT;
