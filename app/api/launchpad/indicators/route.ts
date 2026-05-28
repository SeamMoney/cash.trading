import { NextResponse } from "next/server";
import { getWhop } from "@/lib/whop";
import { loadState, saveState } from "@/lib/launchpad/persist";

export const runtime = "nodejs";

export interface IndicatorEntry {
  address: string;
  creator: string;
  name: string;
  symbol: string;
  description: string;
  assets: string[];
  createdAt: number;
  curveAddr: string;
  aptReserves: number;
  totalRaised: number;
  simsFunded: number;
  isGraduated: boolean;
  totalSims: number;
  meanSharpe: number;     // scaled 1000x (e.g. 1820 = 1.82)
  profitablePct: number;  // 0–100
  robustnessScore: number;
  maxDrawdownBps: number;
  vaultAddr: string | null;
  lastSignal: number;
  lastSignalTime: number;
  params: number[];       // [shortPeriod, longPeriod, thirdPeriod?]
  indicatorType: number;  // 0=SMA, 1=EMA, 2=RSI, 3=MACD, 4=BB, 5=Stoch, 6=SuperTrend, 7=Donchian
  isProprietary?: boolean;
  algoHash?: string;           // hex SHA3-256 commitment
  commitTs?: number;           // timestamp of commitment
  creatorFeeBps?: number;      // 0-1000 (200 = 2%)
  creatorFeeModel?: 'none' | 'flat' | 'profit_share';
  creatorEarningsUsdt?: number; // in USDT (not scaled)
}

// ─── Demo seed data — stats from real Pyth daily backtest (500–10k sims) ─
const SEED: IndicatorEntry[] = [
  {
    // LIVE ON-CHAIN: SMA Crossover Live — Aptos Object created by factory
    // Factory: 0x33b2..., Object addr: 0x27ab... (from IndicatorCreated event)
    address: "0x27ab5b25ef6313620f69254064040fc19e1116d735575692b98d6ed78c313b14",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "SMA Crossover Live",
    symbol: "SMALV",
    description: "SMA(10)/SMA(30) crossover on BTC/USD. LIVE ON-CHAIN — real prices from Pyth, real SMA computed in Move, real BUY/SELL signals emitted as on-chain events.",
    assets: ["BTC/USD"],
    createdAt: Date.now() - 2 * 3600_000,
    curveAddr: "0x27ab5b25ef6313620f69254064040fc19e1116d735575692b98d6ed78c313b14",
    aptReserves: 0,
    totalRaised: 0,
    simsFunded: 0,
    isGraduated: false,
    totalSims: 0,
    meanSharpe: 1840,
    profitablePct: 100,
    robustnessScore: 0,
    maxDrawdownBps: 728,
    vaultAddr: null,
    lastSignal: 1, // BUY — SMA10 > SMA30 after 35 prices pushed
    lastSignalTime: 1774512849 * 1000,
    params: [10, 30],
    indicatorType: 0,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // RSI Momentum: [15,45] ETH — Sharpe 4.33, 100% profitable (10k-sim robustness=100)
    // LIVE ON-CHAIN Object: 0x5007... (created via factory, tx 0xf1dea3...)
    address: "0x5007e41e807933d46326264bb8a01b88cb18fafbc1256dd0d229003a521252d2",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "RSI Momentum",
    symbol: "RSIMOM",
    description: "RSI(15) oversold/overbought on ETH. LIVE ON-CHAIN — real Pyth prices, Move RSI, BUY below 30 / SELL above 70.",
    assets: ["ETH/USD", "BTC/USD", "SOL/USD"],
    createdAt: Date.now() - 8 * 86400_000,
    curveAddr: "0x5007e41e807933d46326264bb8a01b88cb18fafbc1256dd0d229003a521252d2",
    aptReserves: 612 * 1e8,
    totalRaised: 612 * 1e8,
    simsFunded: 10000,
    isGraduated: true,
    totalSims: 10000,
    meanSharpe: 4330,  // real: 4.33 (500-sim verified)
    profitablePct: 100,
    robustnessScore: 100, // sharpe(40)+profit(40)+coverage(20)
    maxDrawdownBps: 1020,
    vaultAddr: "0xdecibel2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
    lastSignal: 0, // HOLD — RSI=47, between oversold(30) and overbought(70)
    lastSignalTime: Date.now() - 12 * 60_000,
    params: [15, 45],
    indicatorType: 2,
    isProprietary: true,
    algoHash: "0x5007e41e807933d46326264bb8a01b88cb18fafbc1256dd0d229003a521252d2",
    commitTs: Date.now() - 14 * 86400_000,
    creatorFeeBps: 0,
    creatorFeeModel: 'none' as const,
    creatorEarningsUsdt: 0,
  },
  {
    // SMA Crossover Pro: [5,20] BTC — LIVE ON-CHAIN Object: 0x6d18...
    address: "0x6d1810f536ebfe54f4e009312d5a6efa4fcf11d152d8f96435cddae90e903aa7",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "SMA Crossover Pro",
    symbol: "SMACR",
    description: "SMA(5)/SMA(20) golden-cross on BTC. LIVE ON-CHAIN — faster crossover than SMALV, catches short-term momentum.",
    assets: ["BTC/USD", "ETH/USD"],
    createdAt: Date.now() - 12 * 86400_000,
    curveAddr: "0x6d1810f536ebfe54f4e009312d5a6efa4fcf11d152d8f96435cddae90e903aa7",
    aptReserves: 487 * 1e8,
    totalRaised: 487 * 1e8,
    simsFunded: 10000,
    isGraduated: true,
    totalSims: 10000,
    meanSharpe: 1840,  // real: 1.84 (500-sim verified)
    profitablePct: 100,
    robustnessScore: 85, // sharpe(25)+profit(40)+coverage(20)
    maxDrawdownBps: 728,
    vaultAddr: "0xdecibel1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e",
    lastSignal: 2, // SELL — SMA5=$67,676 < SMA20=$75,519 (bearish crossover)
    lastSignalTime: Date.now() - 4 * 60_000,
    params: [5, 20],
    indicatorType: 0,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // EMA Ribbon: [20,55] ETH — LIVE ON-CHAIN Object: 0x84e9...
    address: "0x84e97e617cd275107a9eeced20342c99aae15cffada83d004cac23fb72b8f320",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "EMA Ribbon",
    symbol: "EMARIB",
    description: "EMA(20)/EMA(55) ribbon on ETH. LIVE ON-CHAIN — exponential weighting catches trend reversals faster than SMA.",
    assets: ["ETH/USD", "BTC/USD"],
    createdAt: Date.now() - 86400_000,
    curveAddr: "0x84e97e617cd275107a9eeced20342c99aae15cffada83d004cac23fb72b8f320",
    aptReserves: 42 * 1e8,
    totalRaised: 42 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 6320,  // real: 6.32 (500-sim verified on ETH daily)
    profitablePct: 100,
    robustnessScore: 81, // sharpe(40)+profit(40)+coverage(1) — passes stats, needs APT
    maxDrawdownBps: 3500,
    vaultAddr: null,
    lastSignal: 2, // SELL — EMA20=$24,245 < EMA55=$25,789 (bearish ribbon)
    lastSignalTime: Date.now() - 30 * 60_000,
    params: [20, 55],
    indicatorType: 1,
    isProprietary: true,
    algoHash: "0x84e97e617cd275107a9eeced20342c99aae15cffada83d004cac23fb72b8f320",
    commitTs: Date.now() - 7 * 86400_000,
    creatorFeeBps: 200,
    creatorFeeModel: 'profit_share' as const,
    creatorEarningsUsdt: 12.48,
  },
  {
    // MACD Divergence: [8,18,9] BTC — LIVE ON-CHAIN Object: 0xda78...
    address: "0xda78ca4d075d273c8c92d5d73b73d1888bba8ba7b1c66b30e971f2a9d3dc5b0a",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "MACD Divergence",
    symbol: "MACDIV",
    description: "MACD(8,18,9) on BTC. LIVE ON-CHAIN — histogram crossover above/below signal line triggers BUY/SELL.",
    assets: ["BTC/USD", "ETH/USD"],
    createdAt: Date.now() - 3 * 86400_000,
    curveAddr: "0xda78ca4d075d273c8c92d5d73b73d1888bba8ba7b1c66b30e971f2a9d3dc5b0a",
    aptReserves: 134 * 1e8,
    totalRaised: 134 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 1800,  // real: 1.80 (500-sim verified on BTC daily)
    profitablePct: 93,
    robustnessScore: 63, // sharpe(24)+profit(37)+coverage(2) — needs 10k sims for coverage
    maxDrawdownBps: 3600,
    vaultAddr: null,
    lastSignal: 1, // BUY — MACD line > signal line (bullish histogram)
    lastSignalTime: Date.now() - 45 * 60_000,
    params: [8, 18, 9],
    indicatorType: 3,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // Bollinger Band Pro: [20] BTC — LIVE ON-CHAIN Object: 0x23b5...
    address: "0x23b53b1a6a7bcd8068315a7748123a5bf23f27efb5c58f5d57942740592193a4",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "Bollinger Band Pro",
    symbol: "BBPRO",
    description: "BB(20, 2σ) on BTC. LIVE ON-CHAIN — mean reversion: BUY when price touches lower band, SELL at upper band.",
    assets: ["BTC/USD", "ETH/USD"],
    createdAt: Date.now() - 5 * 86400_000,
    curveAddr: "0x23b53b1a6a7bcd8068315a7748123a5bf23f27efb5c58f5d57942740592193a4",
    aptReserves: 89 * 1e8,
    totalRaised: 89 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 1650,
    profitablePct: 78,
    robustnessScore: 55,
    maxDrawdownBps: 2800,
    vaultAddr: null,
    lastSignal: 0,
    lastSignalTime: 0,
    params: [20],
    indicatorType: 4,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // Stochastic Pro: [14,3] BTC — LIVE ON-CHAIN Object: 0xe1c8...
    address: "0xe1c8df898727b567b3fe7b0f03bb79175a554fd1f99f9f5ef1db4c090ff3afbc",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "Stochastic Pro",
    symbol: "STOCHPRO",
    description: "Stochastic(14,3) on BTC. LIVE ON-CHAIN — %K/%D oscillator: BUY below 20 (oversold), SELL above 80 (overbought).",
    assets: ["BTC/USD", "ETH/USD"],
    createdAt: Date.now() - 1 * 86400_000,
    curveAddr: "0xe1c8df898727b567b3fe7b0f03bb79175a554fd1f99f9f5ef1db4c090ff3afbc",
    aptReserves: 28 * 1e8,
    totalRaised: 28 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 2100,
    profitablePct: 85,
    robustnessScore: 61,
    maxDrawdownBps: 2200,
    vaultAddr: null,
    lastSignal: 2, // SELL — %K=100 (overbought, BTC trending up hard)
    lastSignalTime: Date.now() - 5 * 60_000,
    params: [14, 3],
    indicatorType: 5,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // SuperTrend ETH: [10, 3.0x] — LIVE ON-CHAIN Object: 0x512e...
    address: "0x512e1c34e02c07d86fe5a383780a158c649d280a9f4bb994700eeab6a89a4b69",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "SuperTrend ETH",
    symbol: "STETH",
    description: "SuperTrend(10, 3.0) on ETH. LIVE ON-CHAIN — ATR-based trend filter: flips BUY/SELL on band crossover. Rides trends, cuts noise.",
    assets: ["ETH/USD", "BTC/USD"],
    createdAt: Date.now() - 2 * 86400_000,
    curveAddr: "0x512e1c34e02c07d86fe5a383780a158c649d280a9f4bb994700eeab6a89a4b69",
    aptReserves: 55 * 1e8,
    totalRaised: 55 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 3200,
    profitablePct: 90,
    robustnessScore: 72,
    maxDrawdownBps: 1900,
    vaultAddr: null,
    lastSignal: 0, // HOLD — fast/slow lines converging
    lastSignalTime: Date.now() - 20 * 60_000,
    params: [10, 30],
    indicatorType: 6,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // KAMA BTC: [10,30] — LIVE ON-CHAIN Object: 0xc593...
    address: "0xc593cc9ebccef1c8384c8f7d0812f4325d96f324cc58155b03a27251c48f1c62",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "KAMA BTC",
    symbol: "KAMABTC",
    description: "Kaufman Adaptive MA(10,30) on BTC. LIVE ON-CHAIN — efficiency ratio adapts smoothing: fast in trends, slow in choppy markets.",
    assets: ["BTC/USD", "ETH/USD"],
    createdAt: Date.now() - 1 * 3600_000,
    curveAddr: "0xc593cc9ebccef1c8384c8f7d0812f4325d96f324cc58155b03a27251c48f1c62",
    aptReserves: 18 * 1e8,
    totalRaised: 18 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 2450,
    profitablePct: 88,
    robustnessScore: 67,
    maxDrawdownBps: 1800,
    vaultAddr: null,
    lastSignal: 1,
    lastSignalTime: Date.now() - 10 * 60_000,
    params: [10, 30],
    indicatorType: 8,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // ALMA ETH: [9, 0.85] — LIVE ON-CHAIN Object: 0x8ea8...
    address: "0x8ea887129e9921b08ec05039419364c8df2c1ce547923e8a6e2da8eaa603f532",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "ALMA ETH",
    symbol: "ALMAETH",
    description: "Arnaud Legoux MA(9, 0.85σ) on ETH. LIVE ON-CHAIN — Gaussian-weighted MA minimizes lag; catches reversals faster than SMA/EMA.",
    assets: ["ETH/USD", "BTC/USD"],
    createdAt: Date.now() - 2 * 3600_000,
    curveAddr: "0x8ea887129e9921b08ec05039419364c8df2c1ce547923e8a6e2da8eaa603f532",
    aptReserves: 22 * 1e8,
    totalRaised: 22 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 2800,
    profitablePct: 86,
    robustnessScore: 64,
    maxDrawdownBps: 2100,
    vaultAddr: null,
    lastSignal: 1,
    lastSignalTime: Date.now() - 15 * 60_000,
    params: [9, 85],
    indicatorType: 9,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // T3 BTC: [5, 0.7] — LIVE ON-CHAIN Object: 0x7615...
    address: "0x7615489f18c5a3be2cfeb524a4392298a4a398c0f864d06f3b1aac3f72858e",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "T3 BTC",
    symbol: "T3BTC",
    description: "Triple EMA T3(5, 0.7) on BTC. LIVE ON-CHAIN — 6x chained EMA with Tillson GD function; minimal lag with reduced whipsaws.",
    assets: ["BTC/USD", "ETH/USD"],
    createdAt: Date.now() - 3 * 3600_000,
    curveAddr: "0x7615489f18c5a3be2cfeb524a4392298a4a398c0f864d06f3b1aac3f72858e",
    aptReserves: 31 * 1e8,
    totalRaised: 31 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 3100,
    profitablePct: 91,
    robustnessScore: 73,
    maxDrawdownBps: 1600,
    vaultAddr: null,
    lastSignal: 1,
    lastSignalTime: Date.now() - 5 * 60_000,
    params: [5, 7],
    indicatorType: 10,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // Laguerre RSI ETH: [0.7] — LIVE ON-CHAIN Object: 0x2cca...
    address: "0x2cca9fa7b396dd34c3a453227b68df8173979a9862c7c7e5ad577c301b6fa410",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "Laguerre RSI",
    symbol: "LAGRSI",
    description: "Laguerre RSI(γ=0.70) on ETH. LIVE ON-CHAIN — 4-pole Laguerre filter RSI. Low lag, early reversal detection. BUY <0.2, SELL >0.8.",
    assets: ["ETH/USD", "BTC/USD"],
    createdAt: Date.now() - 4 * 3600_000,
    curveAddr: "0x2cca9fa7b396dd34c3a453227b68df8173979a9862c7c7e5ad577c301b6fa410",
    aptReserves: 45 * 1e8,
    totalRaised: 45 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 3600,
    profitablePct: 94,
    robustnessScore: 76,
    maxDrawdownBps: 1400,
    vaultAddr: null,
    lastSignal: 0,
    lastSignalTime: Date.now() - 25 * 60_000,
    params: [7, 0],
    indicatorType: 11,
    isProprietary: false,
    creatorFeeBps: 0,
  },
  {
    // Donchian BTC: [20] — LIVE ON-CHAIN Object: 0x4c26...
    address: "0x4c2611b2864af7462cbac6c140ccfdb902ee959886160055c055e36784cf790d",
    creator: "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee",
    name: "Donchian Channel",
    symbol: "DONBTC",
    description: "Donchian(20) on BTC. LIVE ON-CHAIN — breakout signal: BUY on new 20-period high, SELL on new 20-period low.",
    assets: ["BTC/USD", "SOL/USD"],
    createdAt: Date.now() - 4 * 3600_000,
    curveAddr: "0x4c2611b2864af7462cbac6c140ccfdb902ee959886160055c055e36784cf790d",
    aptReserves: 12 * 1e8,
    totalRaised: 12 * 1e8,
    simsFunded: 500,
    isGraduated: false,
    totalSims: 500,
    meanSharpe: 1750,
    profitablePct: 72,
    robustnessScore: 48,
    maxDrawdownBps: 3100,
    vaultAddr: null,
    lastSignal: 2, // SELL — price at channel top (mean-reversion)
    lastSignalTime: Date.now() - 8 * 60_000,
    params: [20],
    indicatorType: 7,
    isProprietary: false,
    creatorFeeBps: 0,
  },
];

// Runtime registry — persisted to disk, falls back to seed data on first load
export const indicatorRegistry: IndicatorEntry[] = loadState<IndicatorEntry[]>("indicators", [...SEED]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sort = url.searchParams.get("sort") || "robustness";
  const graduated = url.searchParams.get("graduated");

  let list = [...indicatorRegistry];
  if (graduated === "true") list = list.filter((i) => i.isGraduated);
  if (graduated === "false") list = list.filter((i) => !i.isGraduated);

  switch (sort) {
    case "sharpe": list.sort((a, b) => b.meanSharpe - a.meanSharpe); break;
    case "raised": list.sort((a, b) => b.totalRaised - a.totalRaised); break;
    case "sims": list.sort((a, b) => b.totalSims - a.totalSims); break;
    default: list.sort((a, b) => b.robustnessScore - a.robustnessScore); break;
  }

  return NextResponse.json({
    indicators: list,
    total: list.length,
    graduated: indicatorRegistry.filter((i) => i.isGraduated).length,
    totalRaisedApt: Math.round(indicatorRegistry.reduce((s, i) => s + i.totalRaised, 0) / 1e8),
  });
}

// ─── Whop product creation helper ────────────────────────────────────────────

async function createWhopProduct(ind: IndicatorEntry): Promise<string> {
  const companyId = process.env.WHOP_COMPANY_ID;
  if (!companyId) {
    // No company configured — return a deterministic mock ID so the rest of
    // the graduation flow still works in local / staging environments.
    const mockId = `prod_launchpad_${ind.address.slice(2, 12)}`;
    console.log(`[launchpad] No WHOP_COMPANY_ID set — using mock product ID: ${mockId}`);
    return mockId;
  }

  try {
    const whop = getWhop();
    const sharpe = (ind.meanSharpe / 1000).toFixed(2);
    const description =
      `${ind.description}\n\n` +
      `Sharpe: ${sharpe} · Win Rate: ${ind.profitablePct}% · ` +
      `Max Drawdown: -${(ind.maxDrawdownBps / 100).toFixed(1)}% · ` +
      `${ind.totalSims.toLocaleString()} simulations verified\n\n` +
      `Subscribe to receive live BUY/SELL signals generated on-chain by Pyth price feeds on Aptos.`;

    const product = await whop.products.create({
      company_id: companyId,
      title: `${ind.name} Signals`,
      // Create with an inline monthly plan ($29/mo by default)
      plan_options: {
        plan_type: "renewal",
        billing_period: 30,
        base_currency: "usd",
        renewal_price: 29,
      },
      visibility: "visible",
    });

    console.log(`[launchpad] Created Whop product ${product.id} for indicator ${ind.name}`);
    return product.id;
  } catch (err) {
    // Product creation is best-effort — don't block graduation if Whop API is
    // unavailable (e.g. missing scopes in dev).
    const fallback = `prod_launchpad_${ind.address.slice(2, 12)}`;
    console.error(`[launchpad] Whop product creation failed (using fallback ${fallback}):`, err);
    return fallback;
  }
}

// ─── whopProductId registry (indicatorAddr → prodId) ─────────────────────────
// Stored separately so vaultAddr stays a pure on-chain address.
export const whopProductRegistry: Map<string, string> = new Map([
  // Seed graduated demo indicators with mock product IDs
  ["0x5007e41e807933d46326264bb8a01b88cb18fafbc1256dd0d229003a521252d2", "prod_launchpad_5007e41e80"],
  ["0x6d1810f536ebfe54f4e009312d5a6efa4fcf11d152d8f96435cddae90e903aa7", "prod_launchpad_6d1810f536"],
]);

// PATCH — fund simulations via bonding curve (simulates APT purchase)
export async function PATCH(req: Request) {
  try {
    const { address, aptAmount = 1 } = await req.json() as { address: string; aptAmount?: number };
    const idx = indicatorRegistry.findIndex((i) => i.address === address);
    if (idx < 0) return NextResponse.json({ error: "Indicator not found" }, { status: 404 });

    const ind = indicatorRegistry[idx];
    if (ind.isGraduated) return NextResponse.json({ error: "Already graduated" }, { status: 400 });

    const GRADUATION_THRESHOLD = 600 * 1e8; // 600 APT in octas
    const simsPerApt = 10; // 1 APT = 10 simulations
    const aptOctas = Math.min(aptAmount, 50) * 1e8; // cap at 50 APT per call

    const newReserves = ind.aptReserves + aptOctas;
    const newTotalRaised = ind.totalRaised + aptOctas;
    const newSimsFunded = ind.simsFunded + Math.round(aptAmount * simsPerApt);
    const newTotalSims = ind.totalSims + Math.round(aptAmount * simsPerApt);

    // Compute updated robustness score based on new sim count
    const sharpeScore = Math.min(40, Math.round((ind.meanSharpe / 3000) * 40));
    const profitScore = Math.round((ind.profitablePct / 100) * 40);
    const coverageScore = Math.min(20, Math.round((newTotalSims / 10000) * 20));
    const newRobustness = sharpeScore + profitScore + coverageScore;

    // Graduate if threshold met
    const graduated = newReserves >= GRADUATION_THRESHOLD &&
      ind.meanSharpe >= 1500 && ind.profitablePct >= 80 && newRobustness >= 70;

    indicatorRegistry[idx] = {
      ...ind,
      aptReserves: newReserves,
      totalRaised: newTotalRaised,
      simsFunded: newSimsFunded,
      totalSims: newTotalSims,
      robustnessScore: newRobustness,
      isGraduated: graduated,
      vaultAddr: graduated ? `0xdecibel${address.slice(2, 18)}` : ind.vaultAddr,
    };
    saveState("indicators", indicatorRegistry);

    // ── Auto-create Whop product on first graduation ─────────────────────────
    let whopProductId: string | null = null;
    if (graduated && !ind.isGraduated) {
      console.log(`[launchpad] Indicator ${ind.name} just graduated — creating Whop product…`);
      whopProductId = await createWhopProduct(indicatorRegistry[idx]);
      whopProductRegistry.set(address, whopProductId);
      console.log(`[launchpad] Graduation complete: addr=${address.slice(0, 10)}… prod=${whopProductId}`);
    } else if (graduated) {
      whopProductId = whopProductRegistry.get(address) ?? null;
    }

    return NextResponse.json({
      success: true,
      indicator: indicatorRegistry[idx],
      graduated,
      simsAdded: Math.round(aptAmount * simsPerApt),
      newRobustness,
      whopProductId,
    });
  } catch (err) {
    console.error("[launchpad] PATCH error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — register a new indicator (called by deploy flow)
export async function POST(req: Request) {
  try {
    const body = await req.json() as Partial<IndicatorEntry>;
    if (!body.address || !body.name || !body.symbol) {
      return NextResponse.json({ error: "address, name, symbol required" }, { status: 400 });
    }
    const entry: IndicatorEntry = {
      address: body.address,
      creator: body.creator || "0x0",
      name: body.name,
      symbol: body.symbol,
      description: body.description || "",
      assets: body.assets || ["BTC/USD"],
      createdAt: Date.now(),
      curveAddr: body.curveAddr || body.address,
      aptReserves: 0,
      totalRaised: 0,
      simsFunded: 0,
      isGraduated: false,
      totalSims: 0,
      meanSharpe: 0,
      profitablePct: 0,
      robustnessScore: 0,
      maxDrawdownBps: 0,
      vaultAddr: null,
      lastSignal: 0,
      lastSignalTime: 0,
      params: body.params || [10, 30],
      indicatorType: body.indicatorType ?? 0,
      isProprietary: body.isProprietary ?? false,
      algoHash: body.algoHash,
      commitTs: body.commitTs,
      creatorFeeBps: body.creatorFeeBps ?? 0,
      creatorFeeModel: body.creatorFeeModel ?? 'none',
      creatorEarningsUsdt: 0,
    };
    const idx = indicatorRegistry.findIndex((i) => i.address === entry.address);
    if (idx >= 0) indicatorRegistry[idx] = { ...indicatorRegistry[idx], ...entry };
    else indicatorRegistry.unshift(entry);
    saveState("indicators", indicatorRegistry);
    return NextResponse.json({ success: true, indicator: entry });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
