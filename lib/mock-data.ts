// Mock data for previewing UI with populated data

// Type for chart data points
interface MockDataPoint {
  date: Date
  value: number
}

export const MOCK_POINTS_DATA = {
  points: 847293,
  dlp_balance: '125847.50',
  ua_balance: '50000.00',
  total_deposited: '175847.50',
  rank: 12,
}

export const MOCK_GLOBAL_STATS = {
  total_points: 15847293,
  total_deposited: 8547291,
  total_dlp: 6847291,
  total_ua: 1700000,
  depositor_count: 1847,
  status: 'pre-launch' as const,
}

export const MOCK_LEADERBOARD = [
  { rank: 1, account: '0x1a2b3c4d5e6f7890abcdef1234567890abcdef12', points: 2847293, dlp_balance: '500000.00', ua_balance: '200000.00', total_deposited: '700000.00' },
  { rank: 2, account: '0x2b3c4d5e6f7890abcdef1234567890abcdef1234', points: 2156782, dlp_balance: '425000.00', ua_balance: '175000.00', total_deposited: '600000.00' },
  { rank: 3, account: '0x3c4d5e6f7890abcdef1234567890abcdef123456', points: 1987654, dlp_balance: '380000.00', ua_balance: '150000.00', total_deposited: '530000.00' },
  { rank: 4, account: '0x4d5e6f7890abcdef1234567890abcdef12345678', points: 1654321, dlp_balance: '320000.00', ua_balance: '125000.00', total_deposited: '445000.00' },
  { rank: 5, account: '0x5e6f7890abcdef1234567890abcdef1234567890', points: 1432109, dlp_balance: '275000.00', ua_balance: '100000.00', total_deposited: '375000.00' },
  { rank: 6, account: '0x6f7890abcdef1234567890abcdef123456789012', points: 1298765, dlp_balance: '250000.00', ua_balance: '90000.00', total_deposited: '340000.00' },
  { rank: 7, account: '0x7890abcdef1234567890abcdef12345678901234', points: 1154321, dlp_balance: '220000.00', ua_balance: '80000.00', total_deposited: '300000.00' },
  { rank: 8, account: '0x890abcdef1234567890abcdef1234567890123456', points: 1032109, dlp_balance: '195000.00', ua_balance: '70000.00', total_deposited: '265000.00' },
  { rank: 9, account: '0x90abcdef1234567890abcdef123456789012345678', points: 987654, dlp_balance: '180000.00', ua_balance: '65000.00', total_deposited: '245000.00' },
  { rank: 10, account: '0xabcdef1234567890abcdef12345678901234567890', points: 876543, dlp_balance: '165000.00', ua_balance: '55000.00', total_deposited: '220000.00' },
  { rank: 11, account: '0xbcdef1234567890abcdef123456789012345678901', points: 854321, dlp_balance: '155000.00', ua_balance: '52000.00', total_deposited: '207000.00' },
  { rank: 12, account: '0xcdef1234567890abcdef1234567890123456789012', points: 847293, dlp_balance: '125847.50', ua_balance: '50000.00', total_deposited: '175847.50' },
  { rank: 13, account: '0xdef1234567890abcdef12345678901234567890123', points: 765432, dlp_balance: '140000.00', ua_balance: '45000.00', total_deposited: '185000.00' },
  { rank: 14, account: '0xef1234567890abcdef123456789012345678901234', points: 698765, dlp_balance: '125000.00', ua_balance: '40000.00', total_deposited: '165000.00' },
  { rank: 15, account: '0xf1234567890abcdef1234567890123456789012345', points: 654321, dlp_balance: '115000.00', ua_balance: '35000.00', total_deposited: '150000.00' },
]

// Generate balance history for chart (last 30 days)
// Tells a dramatic story: trader loses big, struggles, then recovers
const generateBalanceHistory = (): MockDataPoint[] => {
  const now = new Date()

  // Hardcoded volatile journey: start high, crash, recover
  const balanceStory = [
    175000, 172000, 168000,           // Days 1-3: Starting confident
    145000, 120000, 95000, 78000,     // Days 4-7: The crash begins
    65000, 58000, 62000,              // Days 8-10: Bottom
    55000, 68000, 72000, 65000, 78000, // Days 11-15: Struggle at the bottom
    85000, 92000, 88000, 105000, 98000, 115000, 108000, // Days 16-22: Recovery
    125000, 138000, 145000, 155000, 162000, // Days 23-27: Strong recovery
    170000, 175847.50                  // Days 28-30: Made it all back
  ]

  return balanceStory.map((value, i) => ({
    date: new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000),
    value,
  }))
}

export const MOCK_PORTFOLIO_DATA = {
  balance: {
    usdc: 175847.50,
    accountAddress: '0xcdef1234567890abcdef1234567890123456789012',
  },
  stats: {
    totalVolume: 2847293,
    totalPnl: 15847.50,
    totalTrades: 847,
    winRate: 62.5,
    avgTradeSize: 3362.50,
    bestTrade: 4521.00,
    worstTrade: -1287.00,
  },
  dailyStats: [
    { date: '2026-01-28', volume: 125000, pnl: 2500, trades: 45 },
    { date: '2026-01-29', volume: 98000, pnl: -1200, trades: 38 },
    { date: '2026-01-30', volume: 145000, pnl: 3800, trades: 52 },
    { date: '2026-01-31', volume: 112000, pnl: 1500, trades: 41 },
    { date: '2026-02-01', volume: 167000, pnl: 4200, trades: 58 },
    { date: '2026-02-02', volume: 134000, pnl: 2100, trades: 47 },
    { date: '2026-02-03', volume: 89000, pnl: 850, trades: 32 },
  ],
  botStatus: {
    isRunning: true,
    currentSession: 'session_abc123',
    market: 'BTC-PERP',
    strategy: 'Grid Trading',
    bias: 'long',
  },
  balanceHistory: generateBalanceHistory(),
}

// Generate mock trades
const generateMockTrades = () => {
  const trades = []
  const now = Date.now()
  const markets = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP', 'APT-PERP']
  const strategies = ['Grid', 'DCA', 'Scalp', 'Swing']

  for (let i = 0; i < 50; i++) {
    const isLong = Math.random() > 0.5
    const success = Math.random() > 0.15
    const size = Math.round((Math.random() * 5000 + 500) * 100) / 100
    const pnl = success
      ? Math.round((Math.random() * 500 + 50) * 100) / 100
      : -Math.round((Math.random() * 300 + 20) * 100) / 100

    trades.push({
      id: `trade_${i}`,
      timestamp: new Date(now - i * 3600000 * (Math.random() * 2 + 0.5)).toISOString(),
      txHash: `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`,
      direction: isLong ? 'long' : 'short',
      strategy: strategies[Math.floor(Math.random() * strategies.length)],
      size: size,
      volumeGenerated: size * 2,
      success: success,
      entryPrice: Math.round((40000 + Math.random() * 5000) * 100) / 100,
      exitPrice: Math.round((40000 + Math.random() * 5000) * 100) / 100,
      pnl: pnl,
      positionHeldMs: Math.round(Math.random() * 300000 + 5000),
      market: markets[Math.floor(Math.random() * markets.length)],
      leverage: Math.floor(Math.random() * 10 + 1),
      source: Math.random() > 0.3 ? 'bot' : 'manual' as const,
    })
  }

  return trades
}

export const MOCK_TRADES = generateMockTrades()

export const MOCK_DEPOSIT_EVENTS = [
  { timestamp: '2026-02-02T14:30:00Z', event_kind: 'deposit' as const, fund_type: 'ua' as const, amount: '25000.00', tx_hash: '0xabc123...' },
  { timestamp: '2026-02-01T10:15:00Z', event_kind: 'promote' as const, fund_type: 'dlp' as const, amount: '50000.00', tx_hash: '0xdef456...' },
  { timestamp: '2026-01-30T16:45:00Z', event_kind: 'deposit' as const, fund_type: 'ua' as const, amount: '75000.00', tx_hash: '0xghi789...' },
  { timestamp: '2026-01-28T09:00:00Z', event_kind: 'deposit' as const, fund_type: 'ua' as const, amount: '50000.00', tx_hash: '0xjkl012...' },
  { timestamp: '2026-01-25T11:30:00Z', event_kind: 'promote' as const, fund_type: 'dlp' as const, amount: '25847.50', tx_hash: '0xmno345...' },
  { timestamp: '2026-01-22T08:20:00Z', event_kind: 'withdraw' as const, fund_type: 'ua' as const, amount: '10000.00', tx_hash: '0xpqr678...' },
  { timestamp: '2026-01-20T15:00:00Z', event_kind: 'deposit' as const, fund_type: 'ua' as const, amount: '35000.00', tx_hash: '0xstu901...' },
]

// PnL chart data (cumulative)
export const MOCK_PNL_DATA = MOCK_TRADES.slice(0, 20).map((trade, i) => ({
  timestamp: new Date(trade.timestamp).getTime(),
  pnl: trade.pnl,
  direction: trade.direction as 'long' | 'short',
  txHash: trade.txHash,
}))
