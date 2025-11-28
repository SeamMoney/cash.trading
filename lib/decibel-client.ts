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

// Market addresses (from REST API /api/v1/markets)
export const MARKETS = {
  'BTC/USD': {
    address: '0x6a39745aaa7af8258060566f6501d84581de815128694f8ee013cae28e3357e7',
    maxLeverage: 40,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'ETH/USD': {
    address: '0xd9093834d0ee89ca16bb3aac64e321241fe091354fc526f0e03686e206e936f8',
    maxLeverage: 40,
    sizeDecimals: 7,
    priceDecimals: 6,
  },
  'SOL/USD': {
    address: '0x1fa58fb1d8d1fff57bea37fa1bb38c79acf8bbf489d99a74eed45e44b9fb19d0',
    maxLeverage: 20,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'APT/USD': {
    address: '0xe6de4f6ec47f1bc2ab73920e9f202953e60482e1c1a90e7eef3ee45c8aafee36',
    maxLeverage: 10,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'XRP/USD': {
    address: '0x14e529cc523562d84c169d3b7b238c0764d8574af4af71e9bbde58828ca20026',
    maxLeverage: 20,
    sizeDecimals: 4,
    priceDecimals: 6,
  },
  'LINK/USD': {
    address: '0xafa14b84214814cddfdab01170cd721ea687f402aecf595930160ea74f8d62c8',
    maxLeverage: 10,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'AAVE/USD': {
    address: '0x66b8e6c288ab02c14e082811cf37f6d0f019301fabee0cc916ed5dcb912edf92',
    maxLeverage: 10,
    sizeDecimals: 6,
    priceDecimals: 6,
  },
  'ENA/USD': {
    address: '0x4dc4aac045ab751f597acc46decb7ebec05ad45d2bb64130fabd120f40b80547',
    maxLeverage: 10,
    sizeDecimals: 3,
    priceDecimals: 6,
  },
  'HYPE/USD': {
    address: '0xb23912e94e6c804602387b965496165896a3d1b616ece0ee610f5b68afc6b0b5',
    maxLeverage: 10,
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
