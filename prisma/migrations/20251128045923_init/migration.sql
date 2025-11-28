-- CreateTable
CREATE TABLE "BotInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userWalletAddress" TEXT NOT NULL,
    "userSubaccount" TEXT NOT NULL,
    "capitalUSDC" REAL NOT NULL,
    "volumeTargetUSDC" REAL NOT NULL,
    "bias" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "marketName" TEXT NOT NULL,
    "isRunning" BOOLEAN NOT NULL DEFAULT true,
    "cumulativeVolume" REAL NOT NULL DEFAULT 0,
    "ordersPlaced" INTEGER NOT NULL DEFAULT 0,
    "currentCapitalUsed" REAL NOT NULL DEFAULT 0,
    "lastOrderTime" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "botId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "volumeGenerated" REAL NOT NULL,
    "success" BOOLEAN NOT NULL,
    CONSTRAINT "OrderHistory_botId_fkey" FOREIGN KEY ("botId") REFERENCES "BotInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BotInstance_userWalletAddress_key" ON "BotInstance"("userWalletAddress");

-- CreateIndex
CREATE INDEX "OrderHistory_botId_idx" ON "OrderHistory"("botId");
