# Decibrrr Documentation

Welcome to the Decibrrr documentation! Here's everything you need to understand and work with the trading bot.

---

## 📖 Documentation Index

### **Getting Started**
- **[../README.md](../README.md)** - Project overview, setup instructions
- **[SIMPLE_FLOW.md](./SIMPLE_FLOW.md)** - Simple diagrams for quick understanding
- **[../CURRENT_STATUS.md](../CURRENT_STATUS.md)** - What's done, what's next

### **Architecture & Design**
- **[ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md)** ⭐ **START HERE**
  - 14 detailed Mermaid diagrams
  - System overview
  - Delegation flow
  - Bot execution
  - Security model
  - Component hierarchy
  - And more!

### **Development**
- **[../COMPREHENSIVE_AUDIT.md](../COMPREHENSIVE_AUDIT.md)** - Complete code inventory
  - What we have (90% complete)
  - What we need (missing features)
  - File-by-file breakdown
  - Priority roadmap
- **[../DEVELOPMENT_NOTES.md](../DEVELOPMENT_NOTES.md)** - Technical deep dive
- **[../SECURITY.md](../SECURITY.md)** - Security best practices

### **API Reference**
- **[DECIBEL_DOCS_SUMMARY.md](./DECIBEL_DOCS_SUMMARY.md)** - Quick API reference
  - REST endpoints we use
  - WebSocket topics
  - Key findings for our bot
  - Implementation examples
- **[decibel-complete/](./decibel-complete/)** - Full scraped docs (51 pages)
  - Complete Decibel API documentation
  - TypeScript SDK reference
  - Smart contract functions
  - Transaction formatting

---

## 🎯 Quick Navigation

**Want to understand the system?**
→ Start with [SIMPLE_FLOW.md](./SIMPLE_FLOW.md), then [ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md)

**Want to implement a feature?**
→ Check [DECIBEL_DOCS_SUMMARY.md](./DECIBEL_DOCS_SUMMARY.md) for API endpoints
→ See [COMPREHENSIVE_AUDIT.md](../COMPREHENSIVE_AUDIT.md) for what's missing

**Want to contribute?**
→ Read [../SECURITY.md](../SECURITY.md) first
→ Check [../CURRENT_STATUS.md](../CURRENT_STATUS.md) for priorities
→ Reference [ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md) for design

**Want to deploy?**
→ Follow [../README.md](../README.md) setup instructions
→ Review [../SECURITY.md](../SECURITY.md) before going live

---

## 📊 Diagram Preview

We have **14 comprehensive diagrams** covering:

1. **System Overview** - High-level architecture
2. **Delegation Flow** - How users authorize the bot
3. **Bot Execution** - Order placement process
4. **Status Monitoring** - Progress tracking
5. **Data Flow** - Information sources
6. **Smart Contract Map** - Which functions we call
7. **REST API Map** - Which endpoints we use
8. **Security Model** - Permission boundaries
9. **Component Hierarchy** - Code organization
10. **File Structure** - Repository layout
11. **Environment Config** - Variable flow
12. **User Journey** - End-to-end experience
13. **Error Handling** - Failure modes
14. **Tech Stack** - Technologies used

**All diagrams are in Mermaid format and render automatically on GitHub!**

---

## 🔑 Key Concepts

### **Delegation Model**
Users delegate **trading permission only** to the bot operator wallet. The bot can place/cancel orders but **cannot withdraw funds**. User's USDC stays in their Decibel subaccount at all times.

### **TWAP Execution**
Time-Weighted Average Price orders are split into smaller chunks and executed over time (5-40 minutes depending on mode). This reduces market impact and provides better average prices.

### **Bot Operator Wallet**
- Address: `0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da`
- Purpose: Signs transactions on behalf of delegated users
- Security: Private key stored in `.env` (server-side only)
- Limitations: Can only trade, cannot withdraw

### **API Architecture**
- **Aptos RPC**: Read blockchain state (balances, delegations)
- **Decibel REST API**: Get market data, monitor orders, fetch positions
- **Smart Contracts**: Write operations (place orders, delegate)
- **WebSockets**: Real-time updates (order fills, price changes)

---

## 🚀 Recent Updates

**November 27, 2025**:
- ✅ Scraped complete Decibel API documentation (51 pages)
- ✅ Created 14 architecture diagrams
- ✅ Completed comprehensive codebase audit
- ✅ Identified all REST endpoints needed for bot monitoring
- ✅ Updated README with architecture overview

**Next Priorities**:
1. Fund bot operator wallet with testnet APT
2. Implement bot status tracking API
3. Build monitoring dashboard UI
4. Test end-to-end delegation flow

---

## 📂 File Organization

```
docs/
├── README.md                          ← You are here
├── SIMPLE_FLOW.md                     ← Quick diagrams
├── ARCHITECTURE_DIAGRAMS.md           ← Detailed diagrams (14 total)
├── DECIBEL_DOCS_SUMMARY.md           ← API quick reference
└── decibel-complete/
    ├── 00_INDEX.md                    ← Index of all docs
    ├── quickstart_*.md                ← Getting started guides
    ├── api-reference_user_*.md        ← User API endpoints
    ├── api-reference_market-data_*.md ← Market data endpoints
    ├── api-reference_websockets_*.md  ← WebSocket topics
    └── typescript-sdk_*.md            ← SDK documentation
```

---

## 💡 Tips for Reading

1. **Start visual**: Look at diagrams before reading code
2. **Top-down**: System overview → Component details → Code
3. **Use search**: All docs are markdown, grep-friendly
4. **Follow links**: Docs reference each other extensively
5. **Check dates**: Recent updates are marked with timestamps

---

## 🤝 Contributing to Docs

When adding new features:
1. Update relevant diagrams in `ARCHITECTURE_DIAGRAMS.md`
2. Add API endpoints to `DECIBEL_DOCS_SUMMARY.md`
3. Update status in `COMPREHENSIVE_AUDIT.md`
4. Document security implications in `SECURITY.md`

---

## 📞 Questions?

- **Technical**: See [ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md)
- **API**: See [DECIBEL_DOCS_SUMMARY.md](./DECIBEL_DOCS_SUMMARY.md)
- **Status**: See [../CURRENT_STATUS.md](../CURRENT_STATUS.md)
- **Security**: See [../SECURITY.md](../SECURITY.md)

---

**Built with ❤️ for the Aptos ecosystem**
