-- Retire the outgoing strategy when a vault swaps algos.
--
-- The bug this closes: swapping a strategy revoked the old delegation and delegated the new
-- one on chain, but the registry was never told. The cron's working set is every managed,
-- unpaused, sealed row — so after a swap it kept ticking the OLD strategy vault, whose
-- delegation no longer exists, and never ticked the new one, which was never registered at
-- all. The visible symptom is a vault that quietly stops trading, which is the same failure
-- shape as the CRON_SECRET trap in docs/DEPLOY-SEALED.md §4.2.
--
-- Additive and NULL-defaulted: every existing row is live, which is what NULL means.
ALTER TABLE "SealedVault" ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3);
ALTER TABLE "SealedVault" ADD COLUMN IF NOT EXISTS "retiredBy" TEXT;

-- The cron reads (network, managedAttestation, paused, sealedAt, retiredAt) every minute.
CREATE INDEX IF NOT EXISTS "SealedVault_network_retiredAt_idx"
  ON "SealedVault" ("network", "retiredAt");

-- Which catalog strategy a pending swap is handing over to. `toLabel` is a display string;
-- the handover step needs the id to reproduce the commitment the new vault was sealed with.
ALTER TABLE "SealedPendingSwap" ADD COLUMN IF NOT EXISTS "toStrategyId" TEXT;
