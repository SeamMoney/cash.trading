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

// Market addresses (from SDK - TESTNET - updated Dec 16, 2025 after reset)
export const MARKETS = {
  'BTC/USD': {
    address: '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380',
    maxLeverage: 40,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'ETH/USD': {
    address: '0xd17355e1ac776bc91aa454c18c5dde81054a6ba6a4278d5296ec11f1cba4a274',
    maxLeverage: 20,
    sizeDecimals: 7,
    priceDecimals: 6,
  },
  'SOL/USD': {
    address: '0xc0a85e3b28244046399e74b934cc41f1eea8b315f412e985b1b26e3d6f617e97',
    maxLeverage: 20,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'APT/USD': {
    address: '0x51657ded71c9b4edc74b2877f0fc3aa0c99f28ed12f6a18ecf9e1aeadb0f0463',
    maxLeverage: 10,
    sizeDecimals: 4,
    priceDecimals: 6,
  },
  'XRP/USD': {
    address: '0xd9973a5e626f529a4dde41ba20e76843ac508446195603184278df69702dfa28',
    maxLeverage: 3,
    sizeDecimals: 4,
    priceDecimals: 6,
  },
  'LINK/USD': {
    address: '0xbe7bace32193a55b357ed6a778813cb97879443aab7eee74f7a8924e42c15f01',
    maxLeverage: 3,
    sizeDecimals: 5,
    priceDecimals: 6,
  },
  'AAVE/USD': {
    address: '0x499a1b99be437b42a3e65838075dc0c3319b4bf4146fd8bbc5f1b441623c1a8d',
    maxLeverage: 3,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'ENA/USD': {
    address: '0x65d5a08b4682197dd445681feb74b1c4b920d9623729089a7592ccc918b72c86',
    maxLeverage: 3,
    sizeDecimals: 3,
    priceDecimals: 6,
  },
  'HYPE/USD': {
    address: '0x7257fa2a4046358792b2cd07c386c62598806f2975ec4e02af9c0818fc66164c',
    maxLeverage: 3,
    sizeDecimals: 5,
    priceDecimals: 6,
  },
  'WLFI/USD': {
    address: '0xd7746e5f976b3e585ff382e42c9fa1dc1822b9c2b16e41e768fb30f3b1f542e4',
    maxLeverage: 3,
    sizeDecimals: 3,
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
