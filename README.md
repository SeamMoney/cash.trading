# Decibrrr - Decibel Volume Generation Bot

An automated volume generation bot for Decibel DEX on Aptos blockchain. Features a custom-built Decibel SDK for on-chain trading since Decibel's REST API is read-only.

## Features

- **Automated Volume Generation** - TWAP orders executing over 5-10 minutes
- **Multiple Trading Strategies** - TWAP, Market Maker, Delta Neutral, High Risk
- **Real-time Monitoring** - Live balance, order progress, and trade history
- **Secure Delegation Model** - Bot can trade but never withdraw your funds
- **Configurable Parameters** - Capital, volume target, bias, speed
- **Session Tracking** - Each bot run tracked separately with unique session ID

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

### Custom Decibel SDK

Since Decibel's REST API is **read-only**, we built a custom SDK for trading:

| Component | Purpose |
|-----------|---------|
| `lib/bot-engine.ts` | Core trading engine - builds & submits transactions |
| `lib/decibel-client.ts` | Constants, market addresses, fee structures |
| `lib/bot-manager.ts` | In-memory bot instance management |
| `app/api/bot/delegate/` | Delegation transaction generator |

**Key Contract Functions:**
```move
dex_accounts::place_twap_order_to_subaccount      // TWAP orders
dex_accounts::place_market_order_to_subaccount   // Market orders
dex_accounts::place_order_to_subaccount          // Limit orders
dex_accounts::delegate_trading_to_for_subaccount // Delegation
```

See [docs/DECIBEL_SDK.md](./docs/DECIBEL_SDK.md) for complete SDK documentation.

### Security Model

- Bot **CAN**: Place orders, execute strategies, generate volume
- Bot **CANNOT**: Withdraw funds, transfer USDC, close subaccount
- Funds **ALWAYS** stay in your Decibel subaccount

## ⚠️ Security Notice

This project is currently in **testnet development**.

- ✅ Safe for testnet experimentation
- ⚠️ **DO NOT use with mainnet private keys**
- 🔒 See [SECURITY.md](./SECURITY.md) for best practices

## 🏗️ Setup

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/decibrrr.git
cd decibrrr
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your testnet private key
```

**Important**: Never commit your `.env` file or private keys!

### 3. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Documentation

| Document | Description |
|----------|-------------|
| **[DECIBEL_SDK.md](./docs/DECIBEL_SDK.md)** | Custom Decibel SDK documentation - contract functions, market addresses, debugging |
| [ARCHITECTURE_DIAGRAMS.md](./docs/ARCHITECTURE_DIAGRAMS.md) | Visual diagrams explaining the system |
| [COMPREHENSIVE_AUDIT.md](./COMPREHENSIVE_AUDIT.md) | Complete feature inventory & roadmap |
| [DATABASE_SETUP.md](./DATABASE_SETUP.md) | PostgreSQL/Neon database setup guide |
| [SECURITY.md](./SECURITY.md) | Security best practices |
| [DEVELOPMENT_NOTES.md](./DEVELOPMENT_NOTES.md) | Technical deep dive |

## 🧪 Testing

Test scripts are located in the root directory:

```bash
# Fund wallet with testnet APT
node fund_wallet.mjs

# Delegate trading permissions
node delegate_trading.mjs

# Test TWAP order (requires testnet USDC)
node test_twap_order.mjs
```

**Note**: Test scripts are not committed to the repository for security. See `.gitignore` for excluded files.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TailwindCSS, shadcn/ui |
| Backend | Next.js API Routes, Prisma ORM |
| Database | Neon PostgreSQL (serverless) |
| Blockchain | Aptos TypeScript SDK (`@aptos-labs/ts-sdk`) |
| DEX | Decibel Protocol (custom SDK) |
| Wallet | Aptos Wallet Adapter |
| Hosting | Vercel (with Cron jobs) |

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/bot/start` | POST | Start a new bot instance |
| `/api/bot/stop` | POST | Stop a running bot |
| `/api/bot/status` | GET | Get bot status and order history |
| `/api/bot/tick` | POST | Execute one trade cycle |
| `/api/bot/delegate` | POST | Get delegation transaction payload |
| `/api/cron/bot-tick` | GET | Vercel Cron endpoint for automated trading |

## Environment Variables

```bash
# Required
BOT_OPERATOR_PRIVATE_KEY=ed25519-priv-0x...  # Bot wallet private key
DATABASE_URL=postgresql://...                 # Neon PostgreSQL connection

# Optional
NEXT_PUBLIC_DECIBEL_PACKAGE=0x1f51...        # Decibel contract address
```

## Roadmap

- [x] Wallet integration & balance fetching
- [x] TWAP order placement
- [x] Multiple trading strategies
- [x] Real-time order monitoring
- [x] Session-based trade tracking
- [x] Mobile-responsive UI
- [ ] Position closing/management
- [ ] PnL tracking & reporting
- [ ] Mainnet deployment (security audit required)

## 🤝 Contributing

Contributions welcome! Please:

1. Read [SECURITY.md](./SECURITY.md) first
2. Fork the repository
3. Create a feature branch
4. Submit a pull request

**Security reminder**: Never include private keys, wallet addresses, or sensitive data in PRs.

## 📄 License

MIT License - see LICENSE file for details

## ⚠️ Disclaimer

This software is provided "as is" for educational and research purposes only. Use at your own risk. The authors are not responsible for any losses incurred through the use of this bot. Always test thoroughly on testnet before considering any mainnet deployment.

## 🔗 Links

- [Decibel DEX](https://app.decibel.trade)
- [Aptos Docs](https://aptos.dev)
- [Aptos Testnet Faucet](https://aptos.dev/en/network/faucet)

---

Built with ❤️ for the Aptos ecosystem
