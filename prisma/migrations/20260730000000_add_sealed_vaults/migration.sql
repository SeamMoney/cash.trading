-- CreateTable
CREATE TABLE "SealedVault" (
    "id" TEXT NOT NULL,
    "strategyVaultAddr" TEXT NOT NULL,
    "packageAddress" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'testnet',
    "creatorAddr" TEXT NOT NULL,
    "decibelVaultAddr" TEXT NOT NULL,
    "marketAddr" TEXT NOT NULL,
    "marketName" TEXT,
    "programCommitment" TEXT NOT NULL,
    "attestorPubkey" TEXT NOT NULL,
    "enclaveMeasurement" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pctBps" INTEGER NOT NULL,
    "maxLeverageX100" INTEGER NOT NULL,
    "minBarIntervalS" INTEGER NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "createTxHash" TEXT,
    "sealTxHash" TEXT,
    "sealedAt" TIMESTAMP(3),
    "revealedPine" TEXT,
    "revealedAt" TIMESTAMP(3),
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SealedVault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SealedVault_strategyVaultAddr_key" ON "SealedVault"("strategyVaultAddr");

-- CreateIndex
CREATE INDEX "SealedVault_network_sealedAt_idx" ON "SealedVault"("network", "sealedAt");

-- CreateIndex
CREATE INDEX "SealedVault_creatorAddr_idx" ON "SealedVault"("creatorAddr");

-- CreateIndex
CREATE INDEX "SealedVault_programCommitment_idx" ON "SealedVault"("programCommitment");
