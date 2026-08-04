-- Managed attestation: optional encrypted custody of a creator's PineScript so the platform
-- can run it for them every bar. Opt-in; when false nothing is stored and the creator runs
-- their own attestor. The encryption key lives in SEALED_SOURCE_KEY, never in this database.
ALTER TABLE "SealedVault" ADD COLUMN "managedAttestation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SealedVault" ADD COLUMN "encryptedPine" TEXT;
ALTER TABLE "SealedVault" ADD COLUMN "encryptedPineIv" TEXT;
ALTER TABLE "SealedVault" ADD COLUMN "encryptedPineTag" TEXT;

-- Tick health, so the cron can report and back off rather than burning gas on a vault that
-- aborts every minute.
ALTER TABLE "SealedVault" ADD COLUMN "lastTickAt" TIMESTAMP(3);
ALTER TABLE "SealedVault" ADD COLUMN "lastTickSeq" INTEGER;
ALTER TABLE "SealedVault" ADD COLUMN "tickFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SealedVault" ADD COLUMN "lastTickError" TEXT;

-- The cron's working set: managed, unpaused vaults on one network.
CREATE INDEX "SealedVault_managedAttestation_network_idx"
  ON "SealedVault"("managedAttestation", "network");
