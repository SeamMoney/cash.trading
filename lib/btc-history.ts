export interface MarketHistoryCandle {
  close: number;
  high: number;
  low: number;
  open: number;
  time: number;
  volume?: number;
}

async function fetchBinanceSecondCandles(limit: number): Promise<MarketHistoryCandle[]> {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=${limit}`,
    { cache: "no-store" },
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
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.max(limit, 1) * 60;
  const res = await fetch(
    `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`,
    { cache: "no-store" },
  );

  if (!res.ok) {
    throw new Error("Coinbase candles API error");
  }

  const raw = (await res.json()) as Array<[number, number, number, number, number, number]>;

  return raw
    .map((candle) => ({
      time: candle[0],
      low: candle[1],
      high: candle[2],
      open: candle[3],
      close: candle[4],
      volume: candle[5],
    }))
    .sort((a, b) => a.time - b.time);
}

export async function fetchRecentBtcCandles(limit = 8): Promise<MarketHistoryCandle[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 1000);
  try {
    return await fetchBinanceSecondCandles(safeLimit);
  } catch {
    const minuteLimit = Math.min(Math.max(Math.ceil(safeLimit / 60), 30), 300);
    return fetchCoinbaseMinuteCandles(minuteLimit);
  }
}

export async function fetchCurrentBtcPrice(): Promise<number> {
  const res = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", {
    cache: "no-store",
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
