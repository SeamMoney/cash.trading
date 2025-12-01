# Decibrrr - Decibel Volume Generation Bot

An automated volume generation bot for Decibel DEX on Aptos blockchain. Features a custom-built Decibel SDK for on-chain trading since Decibel's REST API is read-only.

**Status**: 90% Complete | Ready for Testing

---

## Table of Contents

1. [Features](#features)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [SDK Documentation](#sdk-documentation)
5. [Setup Guide](#setup-guide)
6. [API Reference](#api-reference)
7. [Security](#security)
8. [Database Setup](#database-setup)
9. [Testing](#testing)
10. [Roadmap](#roadmap)
11. [Contributing](#contributing)

---

## Features

- ✅ **Automated Volume Generation** - TWAP orders executing over 5-10 minutes
- ✅ **Multiple Trading Strategies** - TWAP, Market Maker, Delta Neutral, High Risk
- ✅ **Real-time Monitoring** - Live balance, order progress, and trade history
- ✅ **Secure Delegation Model** - Bot can trade but never withdraw your funds
- ✅ **Configurable Parameters** - Capital, volume target, bias, speed
- ✅ **Session Tracking** - Each bot run tracked separately with unique session ID
- ✅ **Multi-Wallet Support** - Petra, Martian, Pontem, and 15+ Aptos wallets
- ✅ **Mobile-Optimized UI** - Clean, responsive interface with bottom navigation

---

## Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- Aptos wallet (Petra, Martian, etc.)
- Testnet APT for gas fees
- Testnet USDC from [Decibel Faucet](https://app.decibel.trade)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/decibrrr.git
cd decibrrr

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
2. **Frontend** → Fetches balance from Decibel subaccount
3. **User** → Delegates trading permissions to bot operator
4. **Frontend** → Starts bot via `/api/bot/start`
5. **Bot Engine** → Places TWAP orders to Decibel smart contracts
6. **Database** → Tracks bot sessions and order history
7. **Frontend** → Polls `/api/bot/status` for real-time updates
8. **Vercel Cron** → Triggers `/api/cron/bot-tick` every minute for automated trading

---

## SDK Documentation

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

### Official SDK (Coming Soon)

The official `@decibel/sdk` package is fully documented but not yet available on npm. Key advantages:

- ✅ Type-safe API with full TypeScript definitions
- ✅ WebSocket subscriptions for real-time updates
- ✅ Gas price optimization and fee payer service
- ✅ TP/SL (take profit/stop loss) helpers
- ✅ Vault operations for copy trading
- ✅ Built-in tick size rounding and price formatting

**Migration Path**: When the official SDK becomes available, we can migrate in 3-5 days. See [SDK_COMPARISON_MATRIX.md](./docs/SDK_COMPARISON_MATRIX.md) for detailed comparison.

### Critical Missing Features

Our custom SDK is missing these essential features (available in official SDK):

1. ❌ **Withdraw USDC** - Users can deposit but can't withdraw
2. ❌ **Cancel orders** - Users can't cancel orders once placed
3. ❌ **Revoke delegation** - Users can't remove bot permissions
4. ❌ **TP/SL orders** - No automated risk management

**Recommendation**: Contact Decibel team for early SDK access or implement these features manually.

---

## Setup Guide

### Environment Variables

```bash
# Required
BOT_OPERATOR_PRIVATE_KEY=ed25519-priv-0x...  # Bot wallet private key
DATABASE_URL=postgresql://...                 # Neon PostgreSQL connection

# Optional
NEXT_PUBLIC_DECIBEL_PACKAGE=0x1f51...        # Decibel contract address
APTOS_NODE_API_KEY=...                       # For higher rate limits
```

### Security Model

The bot uses a **delegation model** for security:

- ✅ Bot **CAN**: Place orders, execute strategies, generate volume
- ❌ Bot **CANNOT**: Withdraw funds, transfer USDC, close subaccount
- 🔒 Funds **ALWAYS** stay in your Decibel subaccount

**How it works:**
1. User connects wallet and delegates trading permissions to bot operator
2. Bot operator can trade on behalf of user's subaccount
3. User retains full control and can revoke delegation anytime
4. Withdrawals require user's signature, not bot's

### Trading Strategies

#### 1. TWAP (Time-Weighted Average Price)
- Places orders that execute over 5-10 minutes
- Minimizes market impact
- Best for volume generation
- **Parameters**: `twapFrequencySeconds` (30s), `twapDurationSeconds` (5-10 min)

#### 2. Market Maker
- Fast TWAP orders (same as TWAP currently)
- **Planned**: bid/ask spread management

#### 3. Delta Neutral
- Places paired long/short limit orders
- Attempts to hedge positions
- **Use case**: Low-risk volume generation

#### 4. High Risk
- Uses larger position sizes (up to 10x multiplier)
- Maximum PNL volatility
- **Use case**: Aggressive volume generation

---

## API Reference

### REST Endpoints

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

## Security

### 🔐 Critical Security Practices

**NEVER commit to git:**
- ❌ Private keys in any format
- ❌ Wallet seed phrases/mnemonics
- ❌ API keys or authentication tokens
- ❌ Environment variable files (`.env`, `.env.local`)
- ❌ Wallet keystore files

**Always:**
- ✅ Use environment variables for sensitive data
- ✅ Keep `.env` in `.gitignore`
- ✅ Use different keys for testnet vs mainnet
- ✅ Validate all user input (addresses, amounts)
- ✅ Never log private keys or sensitive data

### Testnet vs Mainnet

This project uses **Aptos Testnet** for development:

- ✅ **Testnet**: Safe to experiment, funds have no real value
- ⚠️ **Mainnet**: Real funds at risk, requires production security practices

**Before mainnet deployment:**
1. Security audit of all smart contract interactions
2. Hardware wallet or secure key management service
3. Proper access controls and monitoring
4. Rate limiting and anti-abuse measures
5. Bug bounty program

### Safe Coding Practices

```typescript
// ✅ GOOD - Validate input
function isValidAptosAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(address);
}

// ✅ GOOD - Never log sensitive data
console.log('Wallet connected:', address);

// ❌ BAD - Logging private key
console.log('Private key:', privateKey);

// ✅ GOOD - Use read-only operations when possible
const balance = await aptos.view({
  function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
  functionArguments: [subaccountAddress],
});
```

### What to Do If Keys Are Compromised

1. **Immediately stop using that key**
2. **Transfer all funds** to a new wallet
3. **Rotate the key** - generate a new one
4. **Review git history** for the leaked key
5. **Consider rewriting git history** if mainnet keys were exposed

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
neonctl projects create --name decibrrr

# 4. Get connection string
neonctl connection-string

# 5. Add to environment
vercel env add DATABASE_URL production
# Paste the connection string

# 6. Deploy
vercel deploy
```

### Alternative: Vercel Postgres

1. Go to https://vercel.com/your-username/decibrrr
2. Click "Storage" tab
3. Click "Create Database" → "Postgres"
4. Check "Connect to project: decibrrr"
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

## Testing

### Manual Testing

Test scripts are located in the root directory:

```bash
# Fund wallet with testnet APT
node fund_wallet.mjs

# Delegate trading permissions
node delegate_trading.mjs

# Test TWAP order (requires testnet USDC)
node test_twap_order.mjs

# Check subaccount balance
node check_apt_balance.mjs

# Query subaccount object
node query_subaccount_object.mjs
```

**Note**: Test scripts are not committed to the repository for security. See `.gitignore` for excluded files.

### Verifying Delegation

Check if bot is delegated for a subaccount:

```bash
curl -s "https://aptos.testnet.porto.movementlabs.xyz/v1/accounts/{SUBACCOUNT_ADDRESS}/resources" | jq '.[] | select(.type | contains("Subaccount")) | .data.delegated_permissions'
```

Expected output:
```json
{
  "entries": [
    {
      "key": "0x501f5aab...",  // Bot operator address
      "value": {
        "perms": {
          "entries": [
            { "key": "TradePerpsAllMarkets", "value": "Unlimited" },
            { "key": "TradeVaultTokens", "value": "Unlimited" }
          ]
        }
      }
    }
  ]
}
```

### Market Addresses (NETNA Testnet)

| Market | Address | Max Leverage |
|--------|---------|--------------|
| BTC/USD | `0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e` | 40x |
| ETH/USD | `0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d` | 20x |
| SOL/USD | `0xef5eee5ae8ba5726efcd8af6ee89dffe2ca08d20631fff3bafe98d89137a58c4` | 20x |
| APT/USD | `0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2` | 10x |

**Updating Market Addresses:**

Market addresses can change when Decibel redeploys contracts. To fetch current addresses:

```bash
# 1. Query Decibel's perp_engine::Global resource
curl -s "https://aptos.testnet.aptoslabs.com/v1/accounts/0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75/resources" \
  | jq '.[] | select(.type | contains("perp_engine::Global")) | .data.market_refs'

# 2. For each market address, get the symbol:
curl -s "https://aptos.testnet.aptoslabs.com/v1/accounts/{MARKET_ADDRESS}/resources" \
  | jq '.[] | select(.type | contains("PerpMarketConfig")) | .data.name'
```

---

## Roadmap

### Completed ✅
- [x] Wallet integration & balance fetching
- [x] Multi-wallet support (15+ wallets)
- [x] Delegation system
- [x] TWAP order placement
- [x] Multiple trading strategies
- [x] Real-time order monitoring
- [x] Session-based trade tracking
- [x] Mobile-responsive UI
- [x] Database integration (Neon PostgreSQL)
- [x] Vercel Cron jobs for automation

### In Progress 🚧
- [ ] Position closing/management
- [ ] Order cancellation
- [ ] PnL tracking & reporting
- [ ] Portfolio chart visualization

### Planned 📋
- [ ] TP/SL (take profit/stop loss) automation
- [ ] Withdraw USDC functionality
- [ ] Revoke delegation UI
- [ ] WebSocket real-time updates
- [ ] Multi-market arbitrage
- [ ] Copy trading (vaults)
- [ ] Mainnet deployment (after security audit)

### Blocked ⚠️
- [ ] Official Decibel SDK migration (waiting for npm package)
- [ ] Advanced features (TP/SL, vaults) - requires SDK

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

## Contributing

Contributions welcome! Please:

1. Read [SECURITY.md](./SECURITY.md) first
2. Fork the repository
3. Create a feature branch
4. Submit a pull request

**Security reminder**: Never include private keys, wallet addresses, or sensitive data in PRs.

---

## Documentation

Comprehensive documentation in `/docs`:

- **[OFFICIAL_SDK_REFERENCE.md](./docs/OFFICIAL_SDK_REFERENCE.md)** - Official `@decibel/sdk` API reference (not yet public)
- **[DECIBEL_SDK.md](./docs/DECIBEL_SDK.md)** - Our custom SDK implementation details
- **[SDK_COMPARISON_MATRIX.md](./docs/SDK_COMPARISON_MATRIX.md)** - Feature comparison & migration guide
- **[ARCHITECTURE_DIAGRAMS.md](./docs/ARCHITECTURE_DIAGRAMS.md)** - 14 visual diagrams explaining the system
- **[SDK_ANALYSIS_SUMMARY.md](./docs/SDK_ANALYSIS_SUMMARY.md)** - Key findings from SDK review

---

## ⚠️ Disclaimer

This software is provided "as is" for educational and research purposes only. Use at your own risk. The authors are not responsible for any losses incurred through the use of this bot. Always test thoroughly on testnet before considering any mainnet deployment.

**Current Status**: Testnet only - DO NOT use with mainnet private keys.

---

## Links

- [Decibel DEX](https://app.decibel.trade)
- [Decibel Docs](https://docs.decibel.trade)
- [Aptos Docs](https://aptos.dev)
- [Aptos Testnet Faucet](https://aptos.dev/en/network/faucet)
- [Discord Support](https://discord.gg/decibel)

---

Built with ❤️ for the Aptos ecosystem
