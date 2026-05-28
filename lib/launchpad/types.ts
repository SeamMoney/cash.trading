// Launchpad — shared types (inlined from packages/indicator-launchpad)

export type Signal = 0 | 1 | 2; // NEUTRAL | BUY | SELL
export const SIGNAL_NEUTRAL: Signal = 0;
export const SIGNAL_BUY: Signal = 1;
export const SIGNAL_SELL: Signal = 2;

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestResult {
  sharpe: number;       // scaled 1000x (e.g. 1820 = 1.82)
  returnBps: number;    // basis points
  maxDrawdownBps: number;
  profitable: boolean;
  trades: number;
  winRate: number;      // 0-1
  equityCurve: { t: number; v: number }[]; // time → equity value
}

export interface BacktestConfig {
  candles: Candle[];
  params: number[];
  initialCapital: number;
  positionSizePct: number;
  indicatorType?: number;  // 0=SMA, 1=EMA, 2=RSI, 3=MACD, 4=BB
}

export type TAFunction =
  | "sma" | "ema" | "wma" | "hma" | "dema" | "tema"
  | "rsi" | "macd" | "stoch" | "stochrsi" | "cci" | "williams_r" | "mfi"
  | "crossover" | "crossunder"
  | "highest" | "lowest" | "atr"
  | "bb" | "bbands" | "keltner" | "donchian"
  | "supertrend" | "vwap" | "obv";

export interface TANode {
  func: TAFunction;
  params: number[];
  source: "close" | "open" | "high" | "low" | "volume";
}

export interface PineAST {
  indicators: TANode[];
  buyCondition: string;
  sellCondition: string;
  params: Record<string, number>;
}

export type CandleResolution = "1" | "5" | "15" | "30" | "60" | "240" | "D";

export interface ScheduledJob {
  jobId: number;
  owner: string;
  triggerType: 'time' | 'signal' | 'price';
  indicatorAddr: string;     // for signal trigger
  expectedSignal?: 0 | 1 | 2; // 0=any, 1=BUY, 2=SELL
  scheduledTimeMs?: number;  // for time trigger
  priceThreshold?: number;   // for price trigger
  isPriceAbove?: boolean;
  actionType: 'apt_transfer' | 'record_signal';
  actionData?: string;       // hex-encoded BCS
  gasDeposit: number;        // APT
  actionAmount: number;      // APT or USDT
  status: 'pending' | 'executed' | 'cancelled';
  createdAt: number;
  executedAt?: number;
  recurring?: boolean;  // if true, job resets to 'pending' after execution
}
