-- Strategy vaults bind launchpad indicators to Decibel execution accounts.
-- Decisions and audits make the bot path replayable and enforceable.

CREATE TABLE "StrategyVault" (
    "id" TEXT NOT NULL,
    "indicatorAddr" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "decibelSubaccount" TEXT,
    "vaultAddr" TEXT,
    "marketName" TEXT NOT NULL,
    "allocationPct" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "latestDecisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyVault_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IndicatorSignalDecision" (
    "id" TEXT NOT NULL,
    "strategyVaultId" TEXT NOT NULL,
    "indicatorAddr" TEXT NOT NULL,
    "signal" INTEGER NOT NULL,
    "prevSignal" INTEGER,
    "price" DOUBLE PRECISION NOT NULL,
    "priceTimestamp" TIMESTAMP(3),
    "onChainTxHash" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'keeper',

    CONSTRAINT "IndicatorSignalDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutionAudit" (
    "id" TEXT NOT NULL,
    "strategyVaultId" TEXT NOT NULL,
    "decisionId" TEXT,
    "indicatorAddr" TEXT NOT NULL,
    "requestedSignal" INTEGER NOT NULL,
    "onChainSignal" INTEGER,
    "allowed" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "marketName" TEXT NOT NULL,
    "side" TEXT,
    "size" DOUBLE PRECISION,
    "sizeUsdt" DOUBLE PRECISION,
    "orderPrice" DOUBLE PRECISION,
    "decibelTxHash" TEXT,
    "subaccount" TEXT,
    "rawRequest" JSONB,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StrategyVault_indicatorAddr_ownerWallet_key" ON "StrategyVault"("indicatorAddr", "ownerWallet");
CREATE INDEX "StrategyVault_indicatorAddr_idx" ON "StrategyVault"("indicatorAddr");
CREATE INDEX "StrategyVault_ownerWallet_idx" ON "StrategyVault"("ownerWallet");
CREATE INDEX "StrategyVault_status_idx" ON "StrategyVault"("status");
CREATE INDEX "IndicatorSignalDecision_indicatorAddr_observedAt_idx" ON "IndicatorSignalDecision"("indicatorAddr", "observedAt");
CREATE INDEX "IndicatorSignalDecision_strategyVaultId_observedAt_idx" ON "IndicatorSignalDecision"("strategyVaultId", "observedAt");
CREATE INDEX "IndicatorSignalDecision_expiresAt_idx" ON "IndicatorSignalDecision"("expiresAt");
CREATE INDEX "ExecutionAudit_strategyVaultId_createdAt_idx" ON "ExecutionAudit"("strategyVaultId", "createdAt");
CREATE INDEX "ExecutionAudit_indicatorAddr_createdAt_idx" ON "ExecutionAudit"("indicatorAddr", "createdAt");
CREATE INDEX "ExecutionAudit_decisionId_idx" ON "ExecutionAudit"("decisionId");
CREATE INDEX "ExecutionAudit_decibelTxHash_idx" ON "ExecutionAudit"("decibelTxHash");

ALTER TABLE "IndicatorSignalDecision" ADD CONSTRAINT "IndicatorSignalDecision_strategyVaultId_fkey" FOREIGN KEY ("strategyVaultId") REFERENCES "StrategyVault"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecutionAudit" ADD CONSTRAINT "ExecutionAudit_strategyVaultId_fkey" FOREIGN KEY ("strategyVaultId") REFERENCES "StrategyVault"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecutionAudit" ADD CONSTRAINT "ExecutionAudit_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "IndicatorSignalDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
