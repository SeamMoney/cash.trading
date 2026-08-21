-- Personal Strategy Runner (BotInstance.strategy = "pine"). Additive only and
-- idempotent, in the same style as 20260811120000_add_bot_network_and_tick_health:
-- nothing here drops, rewrites, or backfills existing rows. Generated with
-- `prisma migrate diff --from-schema-datamodel --to-schema-datamodel --script`
-- and then hand-guarded with IF NOT EXISTS.

-- Which catalog Pine strategy (lib/sealed-catalog.ts id) this bot runs, and the
-- sha256 of its canonical text pinned at start so a later catalog edit cannot
-- silently change what a running bot trades.
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "strategyId" TEXT;
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "scriptHash" TEXT;

-- Candle interval the strategy is evaluated on ("1m" | "5m" | "15m").
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "barInterval" TEXT;

-- Last closed bar acted on. The tick advances it with a compare-and-set
-- (updateMany WHERE id = ? AND lastBarTs < ?) so two overlapping cron
-- invocations can never trade the same bar twice.
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "lastBarTs" BIGINT;

-- Last evaluated signal ("buy" | "sell" | "neutral") and when, for status.
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "lastSignal" TEXT;
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "lastSignalAt" TIMESTAMP(3);

-- Per-bot TP/SL overrides. NULL means the engine default for the strategy
-- (pine: SL = min(2%, 0.5/leverage), TP off).
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "stopLossPct" DOUBLE PRECISION;
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "takeProfitPct" DOUBLE PRECISION;
