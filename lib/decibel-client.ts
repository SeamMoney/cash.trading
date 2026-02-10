/**
 * Decibel Protocol Constants & Configuration
 *
 * This file contains only constants that can be safely imported in browser environments.
 * The DecibelClient class (for server-side trading) is in a separate file.
 */

// Decibel constants (updated Feb 3, 2026 - testnet contract reset Jan 21, 2026)
export const DECIBEL_PACKAGE = '0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88';
export const ORDERBOOK_ADDR = '0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7';
export const USDC_DECIMALS = 6;

// Predeposit constants (Season 0)
// Object address derived from createObjectAddress(DECIBEL_PACKAGE, "predeposit")
export const PREDEPOSIT_OBJECT = '0x67d48b77f9110c959b9f7e3141480da14798f70cf3213c7200f3699fc68abaaa';
export const PREDEPOSIT_MIN_AMOUNT = 50; // $50 minimum deposit
export const PREDEPOSIT_MAX_AMOUNT = 1_000_000; // $1M maximum per wallet
export const PRICE_DECIMALS = 6;

// Bot operator address - users delegate trading permissions to this wallet
// This wallet is controlled by the backend and executes trades on behalf of users
export const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da';

// Fee structure
export const MAKER_REBATE = 0.00015; // -0.015%
export const TAKER_FEE = 0.00045; // 0.045%
export const BUILDER_FEE = 0.0002; // 0.02%

// Market addresses (from perp_engine::Global on-chain - TESTNET - updated Feb 5, 2026)
// All markets: lot_size=10, min_size=100000, ticker_size=100000, sz_precision=8 decimals
export const MARKETS = {
  'BTC/USD': {
    address: '0x274b5e1aa56156f087d2a39fc6bded92f27e2bf6bbfff97ea4b4669b8a6d6557',
    maxLeverage: 40,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'ETH/USD': {
    address: '0x3f20be2579c669064acc135e15cda176a6418a6e26f074bfb9ba81d8a681d0bd',
    maxLeverage: 20,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'SOL/USD': {
    address: '0x563b315ea3453cf79727de5160b32dfb960e3abbe21d9022d49b428d3c3e9981',
    maxLeverage: 10,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'APT/USD': {
    address: '0x4fd3b7994c48c5c7a48ebd284ce11ecaa9ea9c2cf032f8aebff45735e59e79ac',
    maxLeverage: 10,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'XRP/USD': {
    address: '0xf67a0879b80b2ece2d6d498f3cebc6c206b8de434473a79fbb840d4de3ad7eec',
    maxLeverage: 10,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'AAVE/USD': {
    address: '0x4d2d4b80b943d1fd139bf2cc4a2e46f5b4b69cde8efd1af420d7000a1b351695',
    maxLeverage: 5,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'HYPE/USD': {
    address: '0x33414fbda4a7247a49b26f05d6c297692de079b904fbe0a50c99985df22942db',
    maxLeverage: 3,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'WLFI/USD': {
    address: '0x1c7b5de5ed55e89244797f1888dde0f99d086afd0c739a2897589f98f262a714',
    maxLeverage: 3,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'SUI/USD': {
    address: '0x2c0a985573e3ef66b99735858a2bb798e80580d639db3500ff0836786c8fb70b',
    maxLeverage: 3,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'BNB/USD': {
    address: '0x5136d1a68791f7a9caa6f6574f2c5b7bd7cf204262b770149bb7c61561e0c95b',
    maxLeverage: 3,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'DOGE/USD': {
    address: '0x8deecfcaccfea7f4f1a2f203372aeee16d41068bb4ce955dcc4f15c3934c1ae7',
    maxLeverage: 5,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'ZEC/USD': {
    address: '0x9a18f3b7400157c46f713d85f3d82d6c52d95b1cb45430506cf593eb39165ebf',
    maxLeverage: 5,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
} as const;

export type MarketName = keyof typeof MARKETS;

/**
 * NOTE: DecibelClient class has been moved to lib/decibel-server.ts
 * to avoid bundling Node.js libraries (got, keyv, etc.) in browser builds.
 *
 * Use DecibelClient only in:
 * - API routes (app/api/*)
 * - Server actions
 * - Backend scripts
 *
 * For frontend wallet operations, use browser-native fetch with Aptos RPC endpoints.
 */
