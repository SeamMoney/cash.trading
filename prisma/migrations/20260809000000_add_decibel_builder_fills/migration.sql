CREATE TABLE "DecibelBuilderFill" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "transactionHash" TEXT NOT NULL,
  "transactionVersion" BIGINT NOT NULL,
  "eventIndex" INTEGER NOT NULL,
  "transactionUnixMs" BIGINT,
  "account" TEXT NOT NULL,
  "marketAddress" TEXT NOT NULL,
  "fillId" TEXT NOT NULL,
  "orderId" TEXT,
  "clientOrderId" TEXT,
  "isTaker" BOOLEAN NOT NULL,
  "side" TEXT,
  "source" TEXT,
  "priceRaw" BIGINT NOT NULL,
  "sizeRaw" BIGINT NOT NULL,
  "feeRaw" BIGINT,
  "builderAddress" TEXT NOT NULL,
  "builderFeeRaw" BIGINT NOT NULL,
  "builderFeeChainUnits" BIGINT NOT NULL,
  "strategyVaultAddr" TEXT,
  "decibelVaultAddr" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecibelBuilderFill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DecibelBuilderFill_network_eventKey_key"
  ON "DecibelBuilderFill"("network", "eventKey");
CREATE INDEX "DecibelBuilderFill_network_builderAddress_transactionUnixMs_idx"
  ON "DecibelBuilderFill"("network", "builderAddress", "transactionUnixMs");
CREATE INDEX "DecibelBuilderFill_network_account_transactionUnixMs_idx"
  ON "DecibelBuilderFill"("network", "account", "transactionUnixMs");
CREATE INDEX "DecibelBuilderFill_network_transactionHash_idx"
  ON "DecibelBuilderFill"("network", "transactionHash");
CREATE INDEX "DecibelBuilderFill_strategyVaultAddr_transactionUnixMs_idx"
  ON "DecibelBuilderFill"("strategyVaultAddr", "transactionUnixMs");
