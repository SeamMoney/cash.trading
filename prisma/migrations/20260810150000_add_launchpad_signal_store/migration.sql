-- Durable launchpad signal delivery.
--
-- Serverless requests do not share memory. Keeping the public signal feed in
-- Postgres lets the keeper, history endpoint, and SSE stream run on different
-- Vercel instances without losing events. The application retains at most
-- 1,000 rows per indicator after each insert.
CREATE TABLE "LaunchpadSignal" (
  "id" BIGSERIAL NOT NULL,
  "indicatorAddr" TEXT NOT NULL,
  "signal" INTEGER NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "confidence" INTEGER NOT NULL,
  "asset" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'keeper',
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LaunchpadSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LaunchpadSignal_indicatorAddr_id_idx"
  ON "LaunchpadSignal"("indicatorAddr", "id");
