-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "botId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'twap',
    "size" INTEGER NOT NULL,
    "volumeGenerated" REAL NOT NULL,
    "success" BOOLEAN NOT NULL,
    "entryPrice" REAL,
    "exitPrice" REAL,
    "pnl" REAL NOT NULL DEFAULT 0,
    "positionHeldMs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrderHistory_botId_fkey" FOREIGN KEY ("botId") REFERENCES "BotInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrderHistory" ("botId", "direction", "id", "size", "strategy", "success", "timestamp", "txHash", "volumeGenerated") SELECT "botId", "direction", "id", "size", "strategy", "success", "timestamp", "txHash", "volumeGenerated" FROM "OrderHistory";
DROP TABLE "OrderHistory";
ALTER TABLE "new_OrderHistory" RENAME TO "OrderHistory";
CREATE INDEX "OrderHistory_botId_idx" ON "OrderHistory"("botId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
