-- Strategy artifacts are the verifiability record for deployed vaults:
-- the exact PineScript, the Move it transpiled to, and where it was published.
-- /api/launchpad/verify recomputes the hash and re-emits from these rows.

CREATE TABLE "StrategyArtifact" (
    "id" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "pineScript" TEXT NOT NULL,
    "moveSource" TEXT NOT NULL,
    "transpilerVersion" TEXT NOT NULL,
    "marketAddr" TEXT NOT NULL,
    "packageAddress" TEXT,
    "publishTxHash" TEXT,
    "indicatorAddr" TEXT,
    "strategyVaultAddr" TEXT,
    "equivalenceReport" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StrategyArtifact_sourceHash_key" ON "StrategyArtifact"("sourceHash");
CREATE UNIQUE INDEX "StrategyArtifact_packageAddress_key" ON "StrategyArtifact"("packageAddress");
CREATE INDEX "StrategyArtifact_indicatorAddr_idx" ON "StrategyArtifact"("indicatorAddr");
