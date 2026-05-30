# Decibel Indexer

Persistent Decibel market and account indexer for `cash.trading`.

This is intentionally a separate process, not a Next.js route. It keeps long-lived Decibel SDK/WebSocket connections, polls as a fallback, and writes normalized snapshots/events to Postgres so the frontend can read fast DB state.

## Environment

Required:

```bash
DATABASE_URL="postgresql://..."
DECIBEL_INDEXER_ENABLED=true
DECIBEL_INDEXER_NETWORK=mainnet
GEOMI_API_KEY_MAINNET="..."
```

Optional:

```bash
DECIBEL_INDEXER_MARKETS=ALL
DECIBEL_INDEXER_EXTRA_SUBACCOUNTS=0x...,0x...
DECIBEL_INDEXER_BACKFILL_INTERVAL_MS=30000
DECIBEL_INDEXER_ACCOUNT_REFRESH_MS=3000
DECIBEL_INDEXER_INSTANCE_ID=cash-trading-mainnet-1
```

## Run

```bash
cd decibel-indexer
npm install
npm run once
npm start
```

For a droplet:

```bash
pm2 start runner.js --name cash-trading-decibel-indexer
pm2 logs cash-trading-decibel-indexer
pm2 save
```

## What It Writes

- `DecibelMarket`: market metadata
- `DecibelMarketPrice`: latest mark/mid/oracle/funding/open interest
- `DecibelMarketTrade`: recent immutable market trades
- `DecibelWatchedSubaccount`: subaccounts to index
- `DecibelAccountOverview`: latest account overview
- `DecibelPosition`: latest positions
- `DecibelOpenOrder`: latest open orders
- `DecibelOrderEvent`: recent order history
- `DecibelIndexerCheckpoint`: liveness/checkpoint rows

The service discovers subaccounts from:

- `BotInstance.userSubaccount`
- `StrategyVault.decibelSubaccount`
- enabled `DecibelWatchedSubaccount` rows
- `DECIBEL_INDEXER_EXTRA_SUBACCOUNTS`
