CREATE TABLE "DecibelIndexerCheckpoint" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "lastTransactionVersion" BIGINT,
  "lastEventIndex" INTEGER,
  "lastUnixMs" BIGINT,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecibelIndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecibelWatchedSubaccount" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "subaccount" TEXT NOT NULL,
  "ownerWallet" TEXT,
  "source" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecibelWatchedSubaccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecibelMarket" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "marketAddress" TEXT NOT NULL,
  "marketName" TEXT NOT NULL,
  "tickSize" DOUBLE PRECISION,
  "lotSize" DOUBLE PRECISION,
  "maxLeverage" DOUBLE PRECISION,
  "sizeDecimals" INTEGER,
  "priceDecimals" INTEGER,
  "mode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecibelMarket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecibelMarketPrice" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "marketAddress" TEXT NOT NULL,
  "marketName" TEXT,
  "markPrice" DOUBLE PRECISION,
  "midPrice" DOUBLE PRECISION,
  "oraclePrice" DOUBLE PRECISION,
  "fundingRateBps" DOUBLE PRECISION,
  "isFundingPositive" BOOLEAN,
  "openInterest" DOUBLE PRECISION,
  "transactionUnixMs" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecibelMarketPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecibelMarketTrade" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "marketAddress" TEXT NOT NULL,
  "marketName" TEXT,
  "account" TEXT,
  "side" TEXT,
  "size" DOUBLE PRECISION,
  "price" DOUBLE PRECISION,
  "pnl" DOUBLE PRECISION,
  "funding" DOUBLE PRECISION,
  "fee" DOUBLE PRECISION,
  "orderId" TEXT,
  "tradeId" TEXT,
  "transactionVersion" BIGINT,
  "transactionUnixMs" BIGINT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecibelMarketTrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecibelAccountOverview" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "subaccount" TEXT NOT NULL,
  "equity" DOUBLE PRECISION,
  "unrealizedPnl" DOUBLE PRECISION,
  "realizedPnl" DOUBLE PRECISION,
  "marginRatio" DOUBLE PRECISION,
  "maintenanceMargin" DOUBLE PRECISION,
  "leverage" DOUBLE PRECISION,
  "totalMargin" DOUBLE PRECISION,
  "totalNotional" DOUBLE PRECISION,
  "collateral" DOUBLE PRECISION,
  "crossWithdrawable" DOUBLE PRECISION,
  "volume30d" DOUBLE PRECISION,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecibelAccountOverview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecibelPosition" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "subaccount" TEXT NOT NULL,
  "marketKey" TEXT NOT NULL,
  "marketAddress" TEXT,
  "marketName" TEXT,
  "isLong" BOOLEAN,
  "size" DOUBLE PRECISION,
  "leverage" DOUBLE PRECISION,
  "entryPrice" DOUBLE PRECISION,
  "markPrice" DOUBLE PRECISION,
  "value" DOUBLE PRECISION,
  "estimatedPnl" DOUBLE PRECISION,
  "marginUsed" DOUBLE PRECISION,
  "unrealizedFunding" DOUBLE PRECISION,
  "estimatedLiquidationPrice" DOUBLE PRECISION,
  "tpTriggerPrice" DOUBLE PRECISION,
  "slTriggerPrice" DOUBLE PRECISION,
  "transactionVersion" BIGINT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecibelPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecibelOpenOrder" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "subaccount" TEXT NOT NULL,
  "marketAddress" TEXT,
  "marketName" TEXT,
  "orderId" TEXT NOT NULL,
  "clientOrderId" TEXT,
  "side" TEXT,
  "price" DOUBLE PRECISION,
  "originalSize" DOUBLE PRECISION,
  "remainingSize" DOUBLE PRECISION,
  "orderType" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Open',
  "transactionVersion" BIGINT,
  "timestampUnixMs" BIGINT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecibelOpenOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecibelOrderEvent" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "subaccount" TEXT NOT NULL,
  "marketAddress" TEXT,
  "marketName" TEXT,
  "orderId" TEXT,
  "clientOrderId" TEXT,
  "side" TEXT,
  "price" DOUBLE PRECISION,
  "originalSize" DOUBLE PRECISION,
  "remainingSize" DOUBLE PRECISION,
  "orderType" TEXT,
  "status" TEXT,
  "transactionVersion" BIGINT,
  "timestampUnixMs" BIGINT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecibelOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DecibelIndexerCheckpoint_network_source_key" ON "DecibelIndexerCheckpoint"("network", "source");
CREATE INDEX "DecibelIndexerCheckpoint_updatedAt_idx" ON "DecibelIndexerCheckpoint"("updatedAt");

CREATE UNIQUE INDEX "DecibelWatchedSubaccount_network_subaccount_source_key" ON "DecibelWatchedSubaccount"("network", "subaccount", "source");
CREATE INDEX "DecibelWatchedSubaccount_network_enabled_idx" ON "DecibelWatchedSubaccount"("network", "enabled");
CREATE INDEX "DecibelWatchedSubaccount_ownerWallet_idx" ON "DecibelWatchedSubaccount"("ownerWallet");

CREATE UNIQUE INDEX "DecibelMarket_network_marketAddress_key" ON "DecibelMarket"("network", "marketAddress");
CREATE INDEX "DecibelMarket_network_marketName_idx" ON "DecibelMarket"("network", "marketName");

CREATE UNIQUE INDEX "DecibelMarketPrice_network_marketAddress_key" ON "DecibelMarketPrice"("network", "marketAddress");
CREATE INDEX "DecibelMarketPrice_network_updatedAt_idx" ON "DecibelMarketPrice"("network", "updatedAt");

CREATE UNIQUE INDEX "DecibelMarketTrade_network_eventKey_key" ON "DecibelMarketTrade"("network", "eventKey");
CREATE INDEX "DecibelMarketTrade_network_marketAddress_transactionUnixMs_idx" ON "DecibelMarketTrade"("network", "marketAddress", "transactionUnixMs");
CREATE INDEX "DecibelMarketTrade_account_idx" ON "DecibelMarketTrade"("account");

CREATE UNIQUE INDEX "DecibelAccountOverview_network_subaccount_key" ON "DecibelAccountOverview"("network", "subaccount");
CREATE INDEX "DecibelAccountOverview_network_updatedAt_idx" ON "DecibelAccountOverview"("network", "updatedAt");

CREATE UNIQUE INDEX "DecibelPosition_network_subaccount_marketKey_key" ON "DecibelPosition"("network", "subaccount", "marketKey");
CREATE INDEX "DecibelPosition_network_subaccount_idx" ON "DecibelPosition"("network", "subaccount");
CREATE INDEX "DecibelPosition_marketAddress_idx" ON "DecibelPosition"("marketAddress");

CREATE UNIQUE INDEX "DecibelOpenOrder_network_subaccount_orderId_key" ON "DecibelOpenOrder"("network", "subaccount", "orderId");
CREATE INDEX "DecibelOpenOrder_network_subaccount_idx" ON "DecibelOpenOrder"("network", "subaccount");
CREATE INDEX "DecibelOpenOrder_marketAddress_idx" ON "DecibelOpenOrder"("marketAddress");

CREATE UNIQUE INDEX "DecibelOrderEvent_network_eventKey_key" ON "DecibelOrderEvent"("network", "eventKey");
CREATE INDEX "DecibelOrderEvent_network_subaccount_timestampUnixMs_idx" ON "DecibelOrderEvent"("network", "subaccount", "timestampUnixMs");
CREATE INDEX "DecibelOrderEvent_orderId_idx" ON "DecibelOrderEvent"("orderId");
