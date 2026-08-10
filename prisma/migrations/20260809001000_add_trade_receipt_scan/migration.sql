ALTER TABLE "DecibelMarketTrade"
  ADD COLUMN "receiptScannedAt" TIMESTAMP(3);

CREATE INDEX "DecibelMarketTrade_network_receiptScannedAt_transactionVersion_idx"
  ON "DecibelMarketTrade"("network", "receiptScannedAt", "transactionVersion");
