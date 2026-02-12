/**
 * Decibel Protocol Constants & Configuration
 *
 * This file contains only constants that can be safely imported in browser environments.
 * The DecibelClient class (for server-side trading) is in a separate file.
 */

// Decibel constants (updated Feb 11, 2026 - testnet reset)
export const DECIBEL_PACKAGE = '0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f';
export const ORDERBOOK_ADDR = '0xb4e85b1328eeba5398a62585d9c15e55980f9c8acefbbe484b8232ddad0cc6c7';
export const USDC_DECIMALS = 6;

// Predeposit constants (Season 0) - TESTNET
// Note: predeposit object needs rediscovery after reset
export const PREDEPOSIT_OBJECT = '0x67d48b77f9110c959b9f7e3141480da14798f70cf3213c7200f3699fc68abaaa';
export const PREDEPOSIT_MIN_AMOUNT = 50; // $50 minimum deposit
export const PREDEPOSIT_MAX_AMOUNT = 1_000_000; // $1M maximum per wallet
export const PRICE_DECIMALS = 6;

// Mainnet predeposit constants
export const MAINNET_DECIBEL_PACKAGE = '0xc5939ec6e7e656cb6fed9afa155e390eb2aa63ba74e73157161829b2f80e1538';
export const MAINNET_PREDEPOSIT_OBJECT = '0xbd0c23dbc2e9ac041f5829f79b4c4c1361ddfa2125d5072a96b817984a013d69';
export const MAINNET_USDC_METADATA = '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b';

// Bot operator address - users delegate trading permissions to this wallet
// This wallet is controlled by the backend and executes trades on behalf of users
export const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da';

// Fee structure
export const MAKER_REBATE = 0.00015; // -0.015%
export const TAKER_FEE = 0.00045; // 0.045%
export const BUILDER_FEE = 0.0002; // 0.02%

// Market addresses (from perp_engine::Global on-chain - TESTNET - updated Feb 11, 2026)
// Per-market: lot_size=10, min_size=100000, but ticker_size & sz_precision vary
export const MARKETS = {
  'BTC/USD': {
    address: '0x6e9c93c836abebdcf998a7defdd56cd067b6db50127db5d51b000ccfc483b90a',
    maxLeverage: 40,
    sizeDecimals: 8,
    priceDecimals: 6,
    tickerSize: 100000, // $0.10
  },
  'ETH/USD': {
    address: '0x0dd1772998bb9bbb1189ef7d680353f1b97adb947b178167b03ace95dd2fcf8e',
    maxLeverage: 20,
    sizeDecimals: 7,
    priceDecimals: 6,
    tickerSize: 10000, // $0.01
  },
  'SOL/USD': {
    address: '0x2b67f9e6b9bb4b83e952058d3e6b17a8970f74175f3c00db4d0c787d86e69fe7',
    maxLeverage: 10,
    sizeDecimals: 6,
    priceDecimals: 6,
    tickerSize: 1000, // $0.001
  },
  'APT/USD': {
    address: '0x57ba43880ee443eebd5021af91d5a8156fb3e04247c97c30912e6501c187a428',
    maxLeverage: 10,
    sizeDecimals: 4,
    priceDecimals: 6,
    tickerSize: 10, // $0.00001
  },
  'XRP/USD': {
    address: '0x19ecde0fdf8308512d4b94400f65302b4c56606f6155a17dd15a612aa700e5ef',
    maxLeverage: 10,
    sizeDecimals: 4,
    priceDecimals: 6,
    tickerSize: 10, // $0.00001
  },
  'AAVE/USD': {
    address: '0xff9fad29f13afbd5f4598b56b097e7a140cbfe1f9dc88662674cfa3a2a712022',
    maxLeverage: 5,
    sizeDecimals: 6,
    priceDecimals: 6,
    tickerSize: 1000, // $0.001
  },
  'HYPE/USD': {
    address: '0x5a08d91d09ff042f6546b4bfcf25612fa708ad8787109892abac0b7e2ac2186a',
    maxLeverage: 3,
    sizeDecimals: 5,
    priceDecimals: 6,
    tickerSize: 100, // $0.0001
  },
  'WLFI/USD': {
    address: '0xca6ca1d77048f8bbd6f1ba21b417eaebf363952c789edb470fc9c9fca1379f48',
    maxLeverage: 3,
    sizeDecimals: 3,
    priceDecimals: 6,
    tickerSize: 1, // $0.000001
  },
  'SUI/USD': {
    address: '0x6201b0c52ccfa4db99832b5776805f0f78fe681707c305418379174e9eb27c03',
    maxLeverage: 3,
    sizeDecimals: 4,
    priceDecimals: 6,
    tickerSize: 10, // $0.00001
  },
  'BNB/USD': {
    address: '0xa9c06614506beeed5bf1b1834d045f2d1c68355657748bebd19417d0236cf897',
    maxLeverage: 3,
    sizeDecimals: 6,
    priceDecimals: 6,
    tickerSize: 1000, // $0.001
  },
  'DOGE/USD': {
    address: '0x2caf30beb1257543cab9182a325162e65a9e0e3e8ad970b6f2dea41ef3bc8d80',
    maxLeverage: 5,
    sizeDecimals: 3,
    priceDecimals: 6,
    tickerSize: 1, // $0.000001
  },
  'ZEC/USD': {
    address: '0x3d117276a2b009e710b761e1a554b5b66f01b1dac4e58972a2917945189a603c',
    maxLeverage: 5,
    sizeDecimals: 6,
    priceDecimals: 6,
    tickerSize: 1000, // $0.001
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
