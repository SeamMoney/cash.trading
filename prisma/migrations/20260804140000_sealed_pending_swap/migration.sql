-- A strategy swap in flight.
--
-- The chain records the notice schedule (announced_at on the new strategy) but NOT which
-- strategy is replacing which — that pairing exists only in the creator's intent. It lived in
-- localStorage, so clearing browser storage mid-swap stranded the countdown and left the
-- creator without an obvious way to finish. It belongs server-side.
CREATE TABLE "SealedPendingSwap" (
    "id" TEXT NOT NULL,
    "decibelVaultAddr" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "creatorAddr" TEXT NOT NULL,
    "fromStrategyAddr" TEXT NOT NULL,
    "toStrategyAddr" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "vaultName" TEXT NOT NULL,
    "announced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SealedPendingSwap_pkey" PRIMARY KEY ("id")
);

-- One in-flight swap per Decibel vault. Starting a second replaces the first.
CREATE UNIQUE INDEX "SealedPendingSwap_decibelVaultAddr_key"
  ON "SealedPendingSwap"("decibelVaultAddr");
CREATE INDEX "SealedPendingSwap_creatorAddr_network_idx"
  ON "SealedPendingSwap"("creatorAddr", "network");
