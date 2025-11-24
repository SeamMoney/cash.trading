import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

// Decibel constants
export const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75';
export const USDC_DECIMALS = 6;
export const PRICE_DECIMALS = 6;

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

export interface DecibelConfig {
  network: Network;
  privateKey?: string;
}

export class DecibelClient {
  private aptos: Aptos;
  private account?: Account;

  constructor(config: DecibelConfig) {
    const aptosConfig = new AptosConfig({ network: config.network });
    this.aptos = new Aptos(aptosConfig);

    if (config.privateKey) {
      const privateKey = new Ed25519PrivateKey(config.privateKey);
      this.account = Account.fromPrivateKey({ privateKey });
    }
  }

  /**
   * Get available order margin for a subaccount
   */
  async getAvailableMargin(subaccountAddress: string): Promise<number> {
    const result = await this.aptos.view({
      payload: {
        function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
        typeArguments: [],
        functionArguments: [subaccountAddress],
      },
    });

    const marginRaw = result[0] as string;
    return parseInt(marginRaw) / Math.pow(10, USDC_DECIMALS);
  }

  /**
   * Get primary subaccount for a wallet address
   */
  async getPrimarySubaccount(walletAddress: string): Promise<string> {
    const result = await this.aptos.view({
      payload: {
        function: `${DECIBEL_PACKAGE}::accounts_config::primary_subaccount`,
        typeArguments: [],
        functionArguments: [walletAddress],
      },
    });

    return result[0] as string;
  }

  /**
   * Get orderbook data from REST API
   */
  async getOrderbook(marketId: string): Promise<{
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  }> {
    const response = await fetch(
      `https://api.netna.aptoslabs.com/decibel/api/v1/orderbook?market_id=${marketId}`
    );
    const data = await response.json();

    return {
      bids: data.bids.map((b: any) => ({
        price: parseFloat(b.price) / Math.pow(10, PRICE_DECIMALS),
        size: parseFloat(b.size),
      })),
      asks: data.asks.map((a: any) => ({
        price: parseFloat(a.price) / Math.pow(10, PRICE_DECIMALS),
        size: parseFloat(a.size),
      })),
    };
  }

  /**
   * Get market info
   */
  async getMarket(marketId: string): Promise<any> {
    const response = await fetch(
      `https://api.netna.aptoslabs.com/decibel/api/v1/markets?market_id=${marketId}`
    );
    const data = await response.json();
    return data[0];
  }

  /**
   * Place a limit order (post-only for maker rebate)
   * Function signature from module ABI:
   * place_order_to_subaccount(
   *   &signer,
   *   Object<Subaccount>,
   *   Object<PerpMarket>,
   *   u64 price,
   *   u64 size,
   *   bool is_long,
   *   u8 order_type,
   *   bool post_only,
   *   Option<String> client_order_id,
   *   Option<u64> time_in_force,
   *   Option<u64> trigger_price,
   *   Option<u64> tp_price,
   *   Option<u64> sl_price,
   *   Option<u64> expiration,
   *   Option<address> referrer,
   *   Option<u64> reduce_only
   * )
   */
  async placeLimitOrder(params: {
    marketAddress: string;
    subaccountAddress: string;
    isLong: boolean;
    price: number;
    size: number;
    postOnly: boolean;
    clientOrderId?: string;
  }): Promise<string> {
    if (!this.account) {
      throw new Error('Account not initialized - privateKey required');
    }

    const priceRaw = Math.floor(params.price * Math.pow(10, PRICE_DECIMALS));
    const sizeRaw = Math.floor(params.size * Math.pow(10, USDC_DECIMALS));

    const transaction = await this.aptos.transaction.build.simple({
      sender: this.account.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::place_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          params.subaccountAddress, // Object<Subaccount>
          params.marketAddress, // Object<PerpMarket>
          priceRaw.toString(), // u64 price
          sizeRaw.toString(), // u64 size
          params.isLong, // bool is_long
          0, // u8 order_type (0 = limit)
          params.postOnly, // bool post_only
          params.clientOrderId ? [params.clientOrderId] : [], // Option<String>
          [], // Option<u64> time_in_force
          [], // Option<u64> trigger_price
          [], // Option<u64> tp_price
          [], // Option<u64> sl_price
          [], // Option<u64> expiration
          [], // Option<address> referrer
          [], // Option<u64> reduce_only
        ],
      },
    });

    const committedTxn = await this.aptos.signAndSubmitTransaction({
      signer: this.account,
      transaction,
    });

    const executedTxn = await this.aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    return executedTxn.hash;
  }

  /**
   * Place a native TWAP order (Decibel has built-in TWAP support!)
   * Function signature from module ABI:
   * place_twap_order_to_subaccount(
   *   &signer,
   *   Object<Subaccount>,
   *   Object<PerpMarket>,
   *   u64 size,
   *   bool is_long,
   *   bool reduce_only,
   *   u64 min_duration_seconds,
   *   u64 max_duration_seconds,
   *   Option<address> referrer,
   *   Option<u64> client_order_id
   * )
   */
  async placeTWAPOrder(params: {
    marketAddress: string;
    subaccountAddress: string;
    isLong: boolean;
    size: number;
    minDurationSeconds: number;
    maxDurationSeconds: number;
    reduceOnly?: boolean;
    clientOrderId?: number;
  }): Promise<string> {
    if (!this.account) {
      throw new Error('Account not initialized - privateKey required');
    }

    const sizeRaw = Math.floor(params.size * Math.pow(10, USDC_DECIMALS));

    const transaction = await this.aptos.transaction.build.simple({
      sender: this.account.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          params.subaccountAddress, // Object<Subaccount>
          params.marketAddress, // Object<PerpMarket>
          sizeRaw.toString(), // u64 size
          params.isLong, // bool is_long
          params.reduceOnly || false, // bool reduce_only
          params.minDurationSeconds.toString(), // u64 min_duration_seconds
          params.maxDurationSeconds.toString(), // u64 max_duration_seconds
          [], // Option<address> referrer
          params.clientOrderId ? [params.clientOrderId.toString()] : [], // Option<u64>
        ],
      },
    });

    const committedTxn = await this.aptos.signAndSubmitTransaction({
      signer: this.account,
      transaction,
    });

    const executedTxn = await this.aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    return executedTxn.hash;
  }

  /**
   * Cancel an order
   * Function signature from module ABI:
   * cancel_order_to_subaccount(
   *   &signer,
   *   Object<Subaccount>,
   *   u128 order_id,
   *   Object<PerpMarket>
   * )
   */
  async cancelOrder(params: {
    subaccountAddress: string;
    marketAddress: string;
    orderId: string;
  }): Promise<string> {
    if (!this.account) {
      throw new Error('Account not initialized - privateKey required');
    }

    const transaction = await this.aptos.transaction.build.simple({
      sender: this.account.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::cancel_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          params.subaccountAddress, // Object<Subaccount>
          params.orderId, // u128 order_id
          params.marketAddress, // Object<PerpMarket>
        ],
      },
    });

    const committedTxn = await this.aptos.signAndSubmitTransaction({
      signer: this.account,
      transaction,
    });

    const executedTxn = await this.aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    return executedTxn.hash;
  }

  /**
   * Get account overview from REST API (includes equity, PnL, margin)
   * Note: This data may have indexer lag. For real-time margin, use getAvailableMargin()
   */
  async getAccountOverview(walletAddress: string): Promise<{
    perpEquityBalance: number;
    usdcCrossWithdrawableBalance: number;
    unrealizedPnl: number;
    totalMargin: number;
    maintenanceMargin: number;
    crossMarginRatio: number;
    crossAccountLeverageRatio: number;
  }> {
    const response = await fetch(
      `https://api.netna.aptoslabs.com/decibel/api/v1/account_overviews?user=${walletAddress}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch account overview: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      perpEquityBalance: data.perp_equity_balance,
      usdcCrossWithdrawableBalance: data.usdc_cross_withdrawable_balance,
      unrealizedPnl: data.unrealized_pnl,
      totalMargin: data.total_margin,
      maintenanceMargin: data.maintenance_margin,
      crossMarginRatio: data.cross_margin_ratio,
      crossAccountLeverageRatio: data.cross_account_leverage_ratio,
    };
  }
}
