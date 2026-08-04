-- Trade history for sealed vaults.
--
-- Aptos's hosted indexer removed its `events` table, so Move 2 module events like VaultTraded
-- cannot be queried after the fact. We are the party submitting every tick, though, so the
-- fills are in the transaction receipt we already hold — recorded here at submit time.
--
-- This is a cache of on-chain facts, never a source of truth: every row corresponds to a
-- VaultTraded event in the referenced transaction and can be re-derived from it.
CREATE TABLE "SealedTrade" (
    "id" TEXT NOT NULL,
    "strategyVaultAddr" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "isBuy" BOOLEAN NOT NULL,
    "reduceOnly" BOOLEAN NOT NULL,
    "size" BIGINT NOT NULL,
    -- 1e8-scaled trace price, matching the committed series.
    "price" BIGINT NOT NULL,
    -- Engine px units (1e6) actually submitted as the IOC limit.
    "orderPx" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "tradedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SealedTrade_pkey" PRIMARY KEY ("id")
);

-- One row per (vault, seq, side): a flip emits a close and an open at the same seq.
CREATE UNIQUE INDEX "SealedTrade_strategyVaultAddr_seq_reduceOnly_key"
  ON "SealedTrade"("strategyVaultAddr", "seq", "reduceOnly");
CREATE INDEX "SealedTrade_strategyVaultAddr_seq_idx"
  ON "SealedTrade"("strategyVaultAddr", "seq");
