-- Direct CASH reward transfer ledger.
-- This stores actual transfer attempts and idempotency keys, not an internal points balance.

CREATE TYPE "CashRewardStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "CashRewardTransfer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "orderHistoryId" TEXT,
    "userWalletAddress" TEXT NOT NULL,
    "userSubaccount" TEXT,
    "recipientAddress" TEXT NOT NULL,
    "amountCash" DOUBLE PRECISION NOT NULL,
    "amountAtomic" BIGINT NOT NULL,
    "volumeGenerated" DOUBLE PRECISION,
    "rewardRateCashPerUsd" DOUBLE PRECISION,
    "status" "CashRewardStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "error" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "CashRewardTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashRewardTransfer_orderHistoryId_key" ON "CashRewardTransfer"("orderHistoryId");
CREATE UNIQUE INDEX "CashRewardTransfer_sourceType_sourceId_key" ON "CashRewardTransfer"("sourceType", "sourceId");
CREATE INDEX "CashRewardTransfer_recipientAddress_idx" ON "CashRewardTransfer"("recipientAddress");
CREATE INDEX "CashRewardTransfer_userWalletAddress_idx" ON "CashRewardTransfer"("userWalletAddress");
CREATE INDEX "CashRewardTransfer_status_idx" ON "CashRewardTransfer"("status");
CREATE INDEX "CashRewardTransfer_createdAt_idx" ON "CashRewardTransfer"("createdAt");

ALTER TABLE "CashRewardTransfer" ADD CONSTRAINT "CashRewardTransfer_orderHistoryId_fkey" FOREIGN KEY ("orderHistoryId") REFERENCES "OrderHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
