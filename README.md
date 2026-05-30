# cash.trading - Decibel Trading Frontend

A Decibel trading frontend for Aptos with live market data, wallet-signed execution, portfolio management, indicator automation, vault workflows, and direct CASH rewards for product usage.

**Status**: Mainnet deployed | Trading, portfolio, automation, and launchpad flows in active development

---

## Table of Contents

1. [Features](#features)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Decibel SDK](#decibel-sdk)
5. [Trading Strategies](#trading-strategies)
6. [API Reference](#api-reference)
7. [Database Setup](#database-setup)
8. [Market Addresses](#market-addresses)
9. [Roadmap](#roadmap)

---

## Features

- **Automated Volume Generation** - TWAP orders executing over 5-10 minutes
- **Decibel Trading Frontend** - Mainnet market selector, live chart, order book, positions, close orders, and account state
- **Portfolio Management** - Portfolio chart, Decibel positions, open orders, balances, and USDC withdrawal flow
- **Multiple Trading Strategies** - TWAP, Market Maker, Delta Neutral, High Risk
- **Real-time Monitoring** - Live balance, order progress, and trade history
- **Secure Delegation Model** - Bot can trade but never withdraw your funds
- **Configurable Parameters** - Capital, volume target, bias, speed
- **Session Tracking** - Each bot run tracked separately with unique session ID
- **Multi-Wallet Support** - Petra, Martian, Pontem, and 15+ Aptos wallets
- **Mobile-Optimized UI** - Clean, responsive interface with bottom navigation
- **Direct CASH Rewards** - Successful bot trade records can trigger live mainnet `$CASH` transfers from a funded rewards treasury

---

## Direct CASH Rewards

The app rewards confirmed bot trading activity with direct `$CASH` transfers. This is not an internal points balance: each reward is stored as an idempotent transfer attempt with status, amount, recipient, and Aptos transaction hash.

Mainnet CASH is a legacy Aptos Coin:

```text
0x61ed8b048636516b4eaf4c74250fa4f9440d9c3e163d96aeb863fe658a4bdc67::CASH::CASH
decimals: 6
```

Required env:

```bash
CASH_REWARDS_ENABLED=true
CASH_REWARD_TREASURY_PRIVATE_KEY=ed25519-priv-0x...
CASH_REWARD_CASH_PER_USD_VOLUME=0.01
CASH_REWARD_NETWORK=mainnet
```

Safety env:

```bash
CASH_REWARD_MIN_VOLUME_USD=1
CASH_REWARD_MAX_CASH_PER_TRADE=100
CASH_REWARD_DAILY_WALLET_CAP=1000
CASH_REWARD_DAILY_GLOBAL_CAP=100000
```

Reward status API:

```text
GET /api/cash/rewards?userWalletAddress=0x...&userSubaccount=0x...
POST /api/cash/rewards
Authorization: Bearer <CASH_REWARD_ADMIN_SECRET or CRON_SECRET>
```

## Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- Aptos wallet (Petra, Martian, etc.)
- Testnet APT for gas fees
- Testnet USDC from [Decibel Faucet](https://app.decibel.trade)

### Installation

```bash
# Clone the repository
git clone https://github.com/SeamMoney/cash.trading.git
cd cash.trading

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env and add your bot operator private key

# Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### First Steps

1. **Connect Wallet** - Click the wallet button and connect your Aptos wallet
2. **Get USDC** - Visit [Decibel](https://app.decibel.trade) and mint testnet USDC (1000 USDC/day)
3. **Delegate Trading** - Click "Authorize Bot" to delegate trading permissions
4. **Configure Bot** - Set your capital allocation and trading parameters
5. **Start Trading** - Click "Start Bot" to begin automated volume generation

---

## Architecture

### System Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Next.js UI    │────▶│  API Routes      │────▶│  Bot Engine     │
│   (Frontend)    │     │  /api/bot/*      │     │  (lib/)         │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌──────────────────┐              │
                        │  Neon PostgreSQL │◀─────────────┤
                        │  (Bot State)     │              │
                        └──────────────────┘              │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  User Wallet    │────▶│  Decibel         │◀────│  Aptos Testnet  │
│  (Delegation)   │     │  Smart Contracts │     │  (On-chain TX)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Key Components

| Component | Purpose | Location |
|-----------|---------|----------|
| **Bot Engine** | Core trading logic, builds & submits transactions | `lib/bot-engine.ts` |
| **Decibel Client** | Constants, market addresses, fee structures | `lib/decibel-client.ts` |
| **Bot Manager** | In-memory bot instance management | `lib/bot-manager.ts` |
| **Wallet Integration** | Multi-wallet support, balance fetching | `components/wallet/` |
| **Trading UI** | Bot controls, configuration, status display | `components/trading/` |
| **API Routes** | Bot lifecycle, status, delegation | `app/api/bot/` |
| **Database** | Bot sessions, order history, state persistence | `prisma/` |

### Data Flow

1. **User** → Connects wallet via Aptos Wallet Adapter
2. **Frontend** → Fetches USDC balance from Decibel subaccount
3. **User** → Delegates trading permissions to bot operator
4. **Frontend** → Starts bot via `/api/bot/start`
5. **Bot Engine** → Places TWAP orders to Decibel smart contracts
6. **Database** → Tracks bot sessions and order history
7. **Frontend** → Polls `/api/bot/status` for real-time updates
8. **Vercel Cron** → Triggers `/api/cron/bot-tick` every minute for automated trading

---

## Decibel SDK

### Why We Built a Custom SDK

Decibel's REST API is **read-only** - it's used for fetching market data, prices, positions, and order history. All trading operations (placing orders, canceling orders, delegation) must go through **on-chain transactions** to Decibel's Move smart contracts.

### Custom SDK Components

| Component | Purpose |
|-----------|---------|
| `lib/bot-engine.ts` | Core trading engine - builds & submits transactions |
| `lib/decibel-client.ts` | Constants, market addresses, fee structures |
| `lib/bot-manager.ts` | In-memory bot instance management |
| `app/api/bot/delegate/` | Delegation transaction generator |

### Key Contract Functions

```move
// TWAP orders (time-weighted average price)
dex_accounts::place_twap_order_to_subaccount(
  subaccount: address,
  market: address,
  size: u64,
  is_long: bool,
  reduce_only: bool,
  min_duration_secs: u64,
  max_duration_secs: u64,
  builder_address: Option<address>,
  max_builder_fee: Option<u64>
)

// Market orders (immediate execution)
dex_accounts::place_market_order_to_subaccount(...)

// Limit orders
dex_accounts::place_order_to_subaccount(...)

// Delegation
dex_accounts::delegate_trading_to_for_subaccount(
  subaccount: address,
  delegate: address,
  expiration: u64  // 0 = unlimited
)

// Revoke delegation
dex_accounts::revoke_delegation_for_subaccount(...)
```

### Delegation Model

The bot uses a **delegation model** for security:

- [+] Bot **CAN**: Place orders, execute strategies, generate volume
- [-] Bot **CANNOT**: Withdraw funds, transfer USDC, close subaccount
- [!] Funds **ALWAYS** stay in your Decibel subaccount

**How it works:**
1. User connects wallet and delegates trading permissions to bot operator
2. Bot operator can trade on behalf of user's subaccount
3. User retains full control and can revoke delegation anytime
4. Withdrawals require user's signature, not bot's

### Decibel SDK

This app uses Decibel's TypeScript SDK where it is available and direct on-chain Aptos payloads for trading actions that must be signed by the connected wallet. The read paths use Decibel/Aptos market data plus Aptos fullnode views as a fallback, so trading actions do not need to depend on a browser-owned API key.

Key advantages:

- Type-safe API with full TypeScript definitions
- WebSocket subscriptions for real-time updates
- Gas price optimization and fee payer service
- TP/SL (take profit/stop loss) helpers where supported
- Vault operations for copy trading
- Built-in tick size rounding and price formatting

**Migration Path**: keep replacing local payload builders with official SDK helpers as Decibel exposes stable write helpers. See [SDK_COMPARISON_MATRIX.md](./docs/SDK_COMPARISON_MATRIX.md) for detailed comparison.

---

## Trading Strategies

### 1. TWAP (Time-Weighted Average Price)
- Places orders that execute over 5-10 minutes
- Minimizes market impact
- Best for volume generation
- **Parameters**: `twapFrequencySeconds` (30s), `twapDurationSeconds` (5-10 min)

### 2. Market Maker
- Fast TWAP orders (same as TWAP currently)
- **Planned**: bid/ask spread management

### 3. Delta Neutral
- Places paired long/short limit orders
- Attempts to hedge positions
- **Use case**: Low-risk volume generation

### 4. High Risk
- Uses larger position sizes (up to 10x multiplier)
- Maximum PNL volatility
- **Use case**: Aggressive volume generation

---

## API Reference

### Bot API Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/api/bot/start` | POST | Start a new bot instance |
| `/api/bot/stop` | POST | Stop a running bot |
| `/api/bot/status` | GET | Get bot status and order history |
| `/api/bot/tick` | POST | Execute one trade cycle (manual) |
| `/api/bot/delegate` | POST | Get delegation transaction payload |
| `/api/cron/bot-tick` | GET | Vercel Cron endpoint (automated trading) |

### Decibel REST API (Read-Only)

**Base URL**: `https://api.netna.aptoslabs.com/decibel/api/v1`

| Endpoint | Description |
|----------|-------------|
| `GET /active_twaps?user={address}` | Active TWAP orders |
| `GET /positions?user={address}` | User positions |
| `GET /trades?user={address}` | Trade history |
| `GET /open_orders?user={address}` | Open orders |
| `GET /markets` | All available markets |
| `GET /market_prices` | All market prices |
| `GET /orderbook?market={symbol}` | Order book depth |
| `GET /candles?market={symbol}&interval={1m\|5m\|15m\|1h\|1d}` | Candlestick data |

---

## Database Setup

### Quickest Option: Neon PostgreSQL (Recommended)

Neon offers a generous free tier with serverless PostgreSQL:

```bash
# 1. Install Neon CLI
npm install -g neonctl

# 2. Authenticate
neonctl auth

# 3. Create project
neonctl projects create --name cash-trading

# 4. Get connection string
neonctl connection-string

# 5. Add to environment
vercel env add DATABASE_URL production
# Paste the connection string

# 6. Deploy
vercel deploy
```

### Alternative: Vercel Postgres

1. Go to https://vercel.com/SeamMoney/cash.trading
2. Click "Storage" tab
3. Click "Create Database" → "Postgres"
4. Check "Connect to project: cash.trading"
5. Click "Create & Continue"

Vercel automatically:
- Creates the database
- Sets `DATABASE_URL` environment variable
- Runs migrations on next deployment

### Database Schema

```sql
-- Bot Sessions
CREATE TABLE BotSession (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  subaccount TEXT NOT NULL,
  strategy TEXT NOT NULL,
  capital REAL NOT NULL,
  targetVolume REAL NOT NULL,
  status TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- Order History
CREATE TABLE OrderHistory (
  id TEXT PRIMARY KEY,
  sessionId TEXT REFERENCES BotSession(id),
  orderId TEXT,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  size REAL NOT NULL,
  price REAL,
  status TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW()
);
```

### Migrations

```bash
# Generate migration
npx prisma migrate dev --name init

# Deploy to production
npx prisma migrate deploy

# Open Prisma Studio (DB GUI)
npx prisma studio
```

---

## Market Addresses

### NETNA Testnet Markets

| Market | Address | Max Leverage |
|--------|---------|--------------|
| BTC/USD | `0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e` | 40x |
| ETH/USD | `0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d` | 20x |
| SOL/USD | `0xef5eee5ae8ba5726efcd8af6ee89dffe2ca08d20631fff3bafe98d89137a58c4` | 20x |
| APT/USD | `0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2` | 10x |
| XRP/USD | `0x2b0858711c401b2ff1d22156241127c4500b9cc88aaab1e54aca88f29282a144` | 3x |
| LINK/USD | `0x7eda0461c46e464d7a155f77626be1d268b48f1c7b2e864c5dcf12aa5bf3159a` | 3x |
| AAVE/USD | `0x7c6d96f972a4986030ec3012217621f117f6be8a9380ffa29a7941cd62ccd34d` | 3x |
| ENA/USD | `0xbc6857d4255c58eb97643a6a3c9aed718322bf677b2556ce09097ab1bb3b47be` | 3x |
| HYPE/USD | `0x5f848e543d8a3021e74282fd258ab1919bcfd934d730368fb04398b64cbef9cf` | 3x |

### Decibel Contract Package

**Package Address**: `0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75`

### Updating Market Addresses

Market addresses can change when Decibel redeploys contracts. To fetch current addresses:

```bash
# 1. Query Decibel's perp_engine::Global resource
curl -s "https://aptos.testnet.aptoslabs.com/v1/accounts/0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75/resources" \
  | jq '.[] | select(.type | contains("perp_engine::Global")) | .data.market_refs'

# 2. For each market address, get the symbol:
curl -s "https://aptos.testnet.aptoslabs.com/v1/accounts/{MARKET_ADDRESS}/resources" \
  | jq '.[] | select(.type | contains("PerpMarketConfig")) | .data.name'
```

### Bot Operator Address

The bot operator address is the wallet that will execute trades on behalf of users who delegate permissions:

**Bot Operator**: `0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da`

This is a public address (NOT a private key). Users delegate trading permissions to this address so the bot can place orders on their behalf.

### Verifying Delegation

Check if the bot operator is delegated for your subaccount:

```bash
curl -s "https://aptos.testnet.porto.movementlabs.xyz/v1/accounts/{YOUR_SUBACCOUNT_ADDRESS}/resources" | jq '.[] | select(.type | contains("Subaccount")) | .data.delegated_permissions'
```

If delegated, you'll see the bot operator address in the output with "TradePerpsAllMarkets" permissions.

---

## Roadmap

### Completed
- [x] Wallet integration & balance fetching
- [x] Multi-wallet support (15+ wallets)
- [x] Delegation system
- [x] TWAP order placement
- [x] Market and reduce-only position close payloads
- [x] Order cancellation payloads
- [x] Multiple trading strategies
- [x] Real-time order monitoring
- [x] SSE stream proxy with polling fallback
- [x] Session-based trade tracking
- [x] Mobile-responsive UI
- [x] Database integration (Neon PostgreSQL)
- [x] Vercel Cron jobs for automation
- [x] PnL tracking and Decibel account overview
- [x] Portfolio chart visualization
- [x] USDC withdraw flow to owner wallet and optional recipient transfer
- [x] Mainnet deployment on `cash.trading`

### In Progress
- [ ] TP/SL (take profit/stop loss) automation
- [ ] Revoke delegation UI
- [ ] Dedicated real-time indexer service
- [ ] Copy trading and vault management polish
- [ ] Mobile trading UX polish

### Planned
- [ ] Multi-market arbitrage
- [ ] Advanced bot guardrails UI for indicator-bound strategies

### External Dependencies
- [ ] Some mainnet accounts cannot create Decibel subaccounts unless Decibel allowlists/referrers permit it (`EACCOUNT_WITHOUT_REFERRER_OR_IN_ALLOW_LIST`)
- [ ] Authenticated Decibel/Aptos market streams require server-side API keys in deployment env

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TailwindCSS, shadcn/ui |
| Backend | Next.js API Routes, Prisma ORM |
| Database | Neon PostgreSQL (serverless) |
| Blockchain | Aptos TypeScript SDK (`@aptos-labs/ts-sdk`) |
| DEX | Decibel Protocol (custom SDK) |
| Wallet | Aptos Wallet Adapter (15+ wallets) |
| Hosting | Vercel (with Cron jobs) |
| Package Manager | pnpm |

---

## Environment Variables

```bash
# Required
BOT_OPERATOR_PRIVATE_KEY=ed25519-priv-0x...  # Bot wallet private key
DATABASE_URL=postgresql://...                 # Neon PostgreSQL connection

# Optional
NEXT_PUBLIC_DECIBEL_PACKAGE=0x1f51...        # Decibel contract address
APTOS_NODE_API_KEY=...                       # For higher rate limits
```

---

## Documentation

All documentation is in the `/docs` folder:

### SDK Documentation
- **[OFFICIAL_SDK_REFERENCE.md](./docs/OFFICIAL_SDK_REFERENCE.md)** - Official `@decibel/sdk` API reference (not yet public)
- **[DECIBEL_SDK.md](./docs/DECIBEL_SDK.md)** - Our custom SDK implementation details
- **[SDK_COMPARISON_MATRIX.md](./docs/SDK_COMPARISON_MATRIX.md)** - Feature comparison & migration guide
- **[SDK_ANALYSIS_SUMMARY.md](./docs/SDK_ANALYSIS_SUMMARY.md)** - Key findings from SDK review

### Project Documentation
- **[ARCHITECTURE_DIAGRAMS.md](./docs/ARCHITECTURE_DIAGRAMS.md)** - 14 visual diagrams explaining the system
- **[COMPREHENSIVE_AUDIT.md](./docs/COMPREHENSIVE_AUDIT.md)** - Complete feature inventory & roadmap
- **[DEVELOPMENT_NOTES.md](./docs/DEVELOPMENT_NOTES.md)** - Technical deep dive & decisions
- **[DATABASE_SETUP.md](./docs/DATABASE_SETUP.md)** - PostgreSQL/Neon setup guide
- **[SECURITY.md](./docs/SECURITY.md)** - Security best practices

---

Built for the Aptos ecosystem
