# Decibel TWAP Trading Bot

An automated TWAP (Time-Weighted Average Price) trading bot for Decibel DEX on Aptos blockchain.

## 🚀 Features

- 🎯 Automated TWAP order execution
- 💰 Real-time balance and portfolio tracking
- 📊 Historical trade analysis
- 🔐 Secure wallet integration (Petra, Martian, Pontem)
- 📱 Responsive web interface

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

## 📚 Documentation

- [SECURITY.md](./SECURITY.md) - Security best practices
- [DEVELOPMENT_NOTES.md](./DEVELOPMENT_NOTES.md) - Technical architecture
- [WALLET_INTEGRATION.md](./WALLET_INTEGRATION.md) - Wallet setup guide

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

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React 19, TailwindCSS
- **Blockchain**: Aptos TypeScript SDK
- **DEX Integration**: Decibel Protocol
- **Wallet**: Aptos Wallet Adapter

## 🗺️ Roadmap

- [x] Basic wallet integration
- [x] Balance fetching
- [x] TWAP order placement (testnet)
- [ ] Real-time order monitoring
- [ ] Advanced trading strategies
- [ ] Mobile optimization
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
