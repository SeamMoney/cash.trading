-- CreateTable
CREATE TABLE "BotInstance" (
    "id" TEXT NOT NULL,
    "userWalletAddress" TEXT NOT NULL,
    "userSubaccount" TEXT NOT NULL,
    "capitalUSDC" DOUBLE PRECISION NOT NULL,
    "volumeTargetUSDC" DOUBLE PRECISION NOT NULL,
    "bias" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'twap',
    "market" TEXT NOT NULL,
    "marketName" TEXT NOT NULL,
    "isRunning" BOOLEAN NOT NULL DEFAULT true,
    "cumulativeVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ordersPlaced" INTEGER NOT NULL DEFAULT 0,
    "currentCapitalUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastOrderTime" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderHistory" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'twap',
    "size" INTEGER NOT NULL,
    "volumeGenerated" DOUBLE PRECISION NOT NULL,
    "success" BOOLEAN NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "exitPrice" DOUBLE PRECISION,
    "pnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionHeldMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotInstance_userWalletAddress_key" ON "BotInstance"("userWalletAddress");

-- CreateIndex
CREATE INDEX "OrderHistory_botId_idx" ON "OrderHistory"("botId");

-- AddForeignKey
ALTER TABLE "OrderHistory" ADD CONSTRAINT "OrderHistory_botId_fkey" FOREIGN KEY ("botId") REFERENCES "BotInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
