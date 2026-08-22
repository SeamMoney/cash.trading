"use client";

import type { Market } from "@/components/trade/BTCChart";

export const SPOT_MARKETS: Market[] = [
  // Major crypto — spot only
  { id: "BTC/USD",  label: "Bitcoin",       pair: "BTC/USDT",   leverage: 0, color: "#f7931a", category: "crypto" },
  { id: "ETH/USD",  label: "Ethereum",      pair: "ETH/USDT",   leverage: 0, color: "#627eea", category: "crypto" },
  { id: "APT/USD",  label: "Aptos",         pair: "APT/USDT",   leverage: 0, color: "#00d4aa", category: "crypto" },
  { id: "SOL/USD",  label: "Solana",        pair: "SOL/USDT",   leverage: 0, color: "#9945ff", category: "crypto" },
  { id: "SUI/USD",  label: "Sui",           pair: "SUI/USDT",   leverage: 0, color: "#6dd6ff", category: "crypto" },
  // Aptos ecosystem
  { id: "HYPE/USD", label: "Hyperliquid",   pair: "HYPE/USDT",  leverage: 0, color: "#50e3c2", category: "crypto" },
  { id: "DOGE/USD", label: "Dogecoin",      pair: "DOGE/USDT",  leverage: 0, color: "#c2a633", category: "crypto" },
  { id: "XRP/USD",  label: "XRP",           pair: "XRP/USDT",   leverage: 0, color: "#d9d9d9", category: "crypto" },
  { id: "BNB/USD",  label: "BNB",           pair: "BNB/USDT",   leverage: 0, color: "#f3ba2f", category: "crypto" },
  { id: "ZEC/USD",  label: "Zcash",         pair: "ZEC/USDT",   leverage: 0, color: "#f4b728", category: "crypto" },
  // Stablecoins
  { id: "USDC/USD", label: "USDC",          pair: "USDC/USDT",  leverage: 0, color: "#2775ca", category: "crypto" },
  { id: "USDT/USD", label: "Tether",        pair: "USDT/USD",   leverage: 0, color: "#26a17b", category: "crypto" },
  // Emojicoins
  { id: "GLOBE/USD",   label: "Globe",      pair: "\u{1F310}/USDT", leverage: 0, color: "#4A90D9", category: "crypto" },
  { id: "MONEY/USD",   label: "Dollar",     pair: "\u{1F4B5}/USDT", leverage: 0, color: "#85BB65", category: "crypto" },
  { id: "HONGBAO/USD", label: "Hongbao",    pair: "\u{1F9E7}/USDT", leverage: 0, color: "#DE2910", category: "crypto" },
  { id: "BEE/USD",     label: "Bee",        pair: "\u{1F41D}/USDT", leverage: 0, color: "#FFD700", category: "crypto" },
];

export const SPOT_CATEGORIES = [
  { key: "crypto", label: "Crypto" },
] as const;
