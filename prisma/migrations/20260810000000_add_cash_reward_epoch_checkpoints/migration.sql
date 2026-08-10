-- Monotonic CASH reward accounting.
--
-- A compact checkpoint replaces the moving trade-history window that could
-- lower a wallet's displayed entitlement after its oldest fills fell out of
-- the API page cap. The JSON state contains only cumulative totals, a cursor,
-- and open positions; it is not a duplicate trade ledger.
CREATE TABLE "CashRewardEpochCheckpoint" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "ownerAddress" TEXT NOT NULL,
  "subaccountAddress" TEXT NOT NULL,
  "epoch" INTEGER NOT NULL,
  "formulaVersion" INTEGER NOT NULL,
  "state" JSONB NOT NULL,
  "earnedAtomic" BIGINT NOT NULL,
  "sourceTruncated" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashRewardEpochCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashRewardEpochCheckpoint_network_ownerAddress_subaccountAddress_epoch_key"
  ON "CashRewardEpochCheckpoint"("network", "ownerAddress", "subaccountAddress", "epoch");

CREATE INDEX "CashRewardEpochCheckpoint_updatedAt_idx"
  ON "CashRewardEpochCheckpoint"("updatedAt");
