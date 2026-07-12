export interface MarketHistoryCandle {
  close: number;
  high: number;
  low: number;
  open: number;
  time: number;
  volume?: number;
}

const COINBASE_CANDLE_GRANULARITY_SECONDS = 60;
const COINBASE_MAX_CANDLES = 299;
const MARKET_DATA_TIMEOUT_MS = 7_000;

async function fetchBinanceSecondCandles(limit: number): Promise<MarketHistoryCandle[]> {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=${limit}`,
    { cache: "no-store", signal: AbortSignal.timeout(MARKET_DATA_TIMEOUT_MS) },
  );

  if (!res.ok) {
    throw new Error("Binance API error");
  }

  const raw = (await res.json()) as Array<Array<string | number>>;

  return raw.map((kline) => ({
    time: Number(kline[0]) / 1000,
    open: parseFloat(String(kline[1])),
    high: parseFloat(String(kline[2])),
    low: parseFloat(String(kline[3])),
    close: parseFloat(String(kline[4])),
    volume: parseFloat(String(kline[5])),
  }));
}

async function fetchCoinbaseMinuteCandles(limit: number): Promise<MarketHistoryCandle[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), COINBASE_MAX_CANDLES);
  const end = Math.floor(Date.now() / 1000);
  const start = end - (safeLimit - 1) * COINBASE_CANDLE_GRANULARITY_SECONDS;
  const url = new URL("https://api.exchange.coinbase.com/products/BTC-USD/candles");
  url.searchParams.set("granularity", String(COINBASE_CANDLE_GRANULARITY_SECONDS));
  url.searchParams.set("start", new Date(start * 1000).toISOString());
  url.searchParams.set("end", new Date(end * 1000).toISOString());

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(MARKET_DATA_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Coinbase candles API error (${res.status})`);
  }

  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Invalid Coinbase candles response");
  }

  return raw
    .map((candle) => ({
      time: Number(candle?.[0]),
      low: Number(candle?.[1]),
      high: Number(candle?.[2]),
      open: Number(candle?.[3]),
      close: Number(candle?.[4]),
      volume: Number(candle?.[5]),
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.close),
    )
    .sort((a, b) => a.time - b.time);
}

export async function fetchRecentBtcCandles(limit = 8): Promise<MarketHistoryCandle[]> {
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 8;
  const safeLimit = Math.min(Math.max(requestedLimit, 1), 1000);
  try {
    return await fetchBinanceSecondCandles(safeLimit);
  } catch {
    const minuteLimit = Math.min(Math.max(Math.ceil(safeLimit / 60), 30), 300);
    try {
      return await fetchCoinbaseMinuteCandles(minuteLimit);
    } catch {
      return [];
    }
  }
}

export async function fetchCurrentBtcPrice(): Promise<number> {
  const res = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", {
    cache: "no-store",
    signal: AbortSignal.timeout(MARKET_DATA_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error("Coinbase ticker API error");
  }

  const data = (await res.json()) as { price?: string };
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Invalid Coinbase ticker price");
  }

  return price;
}
