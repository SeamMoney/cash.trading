-- DropIndex
DROP INDEX IF EXISTS "BotInstance_userWalletAddress_key";

-- CreateIndex (composite unique)
CREATE UNIQUE INDEX "BotInstance_userWalletAddress_userSubaccount_key" ON "BotInstance"("userWalletAddress", "userSubaccount");

-- CreateIndex (for fast lookups by wallet)
CREATE INDEX "BotInstance_userWalletAddress_idx" ON "BotInstance"("userWalletAddress");
