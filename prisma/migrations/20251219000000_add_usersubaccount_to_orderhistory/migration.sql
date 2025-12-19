-- AlterTable
ALTER TABLE "OrderHistory" ADD COLUMN "userSubaccount" TEXT;

-- CreateIndex
CREATE INDEX "OrderHistory_userSubaccount_idx" ON "OrderHistory"("userSubaccount");

-- Backfill existing orders with subaccount from their bot instance
UPDATE "OrderHistory" oh
SET "userSubaccount" = bi."userSubaccount"
FROM "BotInstance" bi
WHERE oh."botId" = bi."id" AND oh."userSubaccount" IS NULL;
