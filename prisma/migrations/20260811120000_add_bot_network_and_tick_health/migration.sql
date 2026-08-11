-- Additive only. Hand-authored rather than generated, because `prisma migrate
-- diff` against a local database also emitted DROP TABLE for tables that exist
-- only in production. Nothing here drops or rewrites existing data.

-- Which chain a bot trades. Existing rows are mainnet, which is what the
-- deployment has been running.
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "network" TEXT NOT NULL DEFAULT 'mainnet';

-- Requested leverage. NULL means the engine's conservative default rather than
-- the market maximum.
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "leverageX" INTEGER;

-- Tick health, so a bot that fails every minute drops out of cron selection
-- instead of retrying 6-12 times a minute forever.
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "lastTickAt" TIMESTAMP(3);
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "tickFailures" INTEGER NOT NULL DEFAULT 0;

-- The cron selects on (isRunning, network).
CREATE INDEX IF NOT EXISTS "BotInstance_isRunning_network_idx" ON "BotInstance"("isRunning", "network");
