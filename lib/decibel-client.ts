/**
 * Decibel Protocol Constants & Configuration
 *
 * This file contains only constants that can be safely imported in browser environments.
 * The DecibelClient class (for server-side trading) is in a separate file.
 */

// Decibel constants
export const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75';
export const USDC_DECIMALS = 6;
export const PRICE_DECIMALS = 6;

// Bot operator address - users delegate trading permissions to this wallet
// This wallet is controlled by the backend and executes trades on behalf of users
export const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da';

// Fee structure
export const MAKER_REBATE = 0.00015; // -0.015%
export const TAKER_FEE = 0.00045; // 0.045%
export const BUILDER_FEE = 0.0002; // 0.02%

// Market addresses (from on-chain query - TESTNET - updated Nov 2025)
export const MARKETS = {
  'BTC/USD': {
    address: '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e',
    maxLeverage: 40,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'ETH/USD': {
    address: '0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d',
    maxLeverage: 20,
    sizeDecimals: 7,
    priceDecimals: 6,
  },
  'SOL/USD': {
    address: '0xef5eee5ae8ba5726efcd8af6ee89dffe2ca08d20631fff3bafe98d89137a58c4',
    maxLeverage: 20,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'APT/USD': {
    address: '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2',
    maxLeverage: 10,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'XRP/USD': {
    address: '0x2b0858711c401b2ff1d22156241127c4500b9cc88aaab1e54aca88f29282a144',
    maxLeverage: 3,
    sizeDecimals: 4,
    priceDecimals: 6,
  },
  'LINK/USD': {
    address: '0x7eda0461c46e464d7a155f77626be1d268b48f1c7b2e864c5dcf12aa5bf3159a',
    maxLeverage: 3,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'AAVE/USD': {
    address: '0x7c6d96f972a4986030ec3012217621f117f6be8a9380ffa29a7941cd62ccd34d',
    maxLeverage: 3,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'ENA/USD': {
    address: '0xbc6857d4255c58eb97643a6a3c9aed718322bf677b2556ce09097ab1bb3b47be',
    maxLeverage: 3,
    sizeDecimals: 3,
    priceDecimals: 6,
  },
  'HYPE/USD': {
    address: '0x5f848e543d8a3021e74282fd258ab1919bcfd934d730368fb04398b64cbef9cf',
    maxLeverage: 3,
    sizeDecimals: 6,
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
