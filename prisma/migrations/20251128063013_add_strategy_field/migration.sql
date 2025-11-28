-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BotInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userWalletAddress" TEXT NOT NULL,
    "userSubaccount" TEXT NOT NULL,
    "capitalUSDC" REAL NOT NULL,
    "volumeTargetUSDC" REAL NOT NULL,
    "bias" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'twap',
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
INSERT INTO "new_BotInstance" ("bias", "capitalUSDC", "createdAt", "cumulativeVolume", "currentCapitalUsed", "error", "id", "isRunning", "lastOrderTime", "market", "marketName", "ordersPlaced", "updatedAt", "userSubaccount", "userWalletAddress", "volumeTargetUSDC") SELECT "bias", "capitalUSDC", "createdAt", "cumulativeVolume", "currentCapitalUsed", "error", "id", "isRunning", "lastOrderTime", "market", "marketName", "ordersPlaced", "updatedAt", "userSubaccount", "userWalletAddress", "volumeTargetUSDC" FROM "BotInstance";
DROP TABLE "BotInstance";
ALTER TABLE "new_BotInstance" RENAME TO "BotInstance";
CREATE UNIQUE INDEX "BotInstance_userWalletAddress_key" ON "BotInstance"("userWalletAddress");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
