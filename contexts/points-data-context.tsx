"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { useWallet } from '@aptos-labs/wallet-adapter-react'
import { useMockData } from './mock-data-context'
import { MOCK_LEADERBOARD, MOCK_POINTS_DATA } from '@/lib/mock-data'

export interface GlobalStats {
  total_points: number
  total_deposited: number
  total_dlp: number
  total_ua: number
  depositor_count: number
  dlp_cap?: number
  status: 'pre-launch' | 'live' | 'paused' | 'error'
  // Vault stats (mainnet DLP)
  vault_tvl?: number
  vault_depositors?: number
  vault_count?: number
}

export interface UserData {
  points: number
  dlp_balance: string
  ua_balance: string
  total_deposited: string
  rank?: number | null
  trading_points?: number
  vault_points?: number
  referral_points?: number
  streak_points?: number
  bonus_points?: number
}

export interface VaultUserData {
  totalDeposited: number
  currentValue: number
  totalPnl: number
  vaults: Array<{
    name: string
    address: string
    deposited: number
    currentValue: number
    pnl: number
    vaultType: string | null
  }>
}

export interface LeaderboardEntry {
  rank: number
  account: string
  points: number
  dlp_balance: string
  ua_balance: string
  total_deposited: string
  vault_points?: number
  trading_points?: number
  referral_points?: number
  streak_points?: number
  bonus_points?: number
}

interface PointsDataContextType {
  globalStats: GlobalStats | null
  userData: UserData | null
  vaultUserData: VaultUserData | null
  leaderboardEntries: LeaderboardEntry[]
  userRank: LeaderboardEntry | null
  loading: boolean
  leaderboardLoading: boolean
  refresh: () => void
}

const PointsDataContext = createContext<PointsDataContextType>({
  globalStats: null,
  userData: null,
  vaultUserData: null,
  leaderboardEntries: [],
  userRank: null,
  loading: false,
  leaderboardLoading: false,
  refresh: () => {},
})

// localStorage cache helpers
const CACHE_KEY = 'cash_trading_points_cache_v2'

interface CachedData {
  globalStats: GlobalStats | null
  userData: UserData | null
  vaultUserData: VaultUserData | null
  leaderboardEntries: LeaderboardEntry[]
  userRank: LeaderboardEntry | null
  userAddr: string | null
  timestamp: number
}

function readCache(addr: string | null): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached: CachedData = JSON.parse(raw)
    // Only use cache if same wallet (or both disconnected)
    if (cached.userAddr !== addr) return null
    // An all-zero globalStats is a poisoned entry (cached from a failed
    // fetch); using it suppresses the loading skeletons and renders
    // "$0.00 deposited" as if real. Treat it as no cached stats.
    const gs = cached.globalStats
    if (gs && !gs.total_deposited && !gs.total_dlp && !gs.total_points) {
      cached.globalStats = null as unknown as CachedData['globalStats']
    }
    return cached
  } catch {
    return null
  }
}

function writeCache(data: Omit<CachedData, 'timestamp'>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, timestamp: Date.now() }))
  } catch {
    // localStorage full or unavailable — ignore
  }
}

export function PointsDataProvider({ children }: { children: ReactNode }) {
  const { account } = useWallet()
  const { isMockMode } = useMockData()
  const addr = account?.address?.toString() || null

  // Cache hydration happens AFTER mount: reading localStorage in useState
  // initializers made the client's first render differ from the server's
  // (e.g. the LIVE badge) — a hydration mismatch on every clean /points load.
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null)
  const [userData, setUserData] = useState<UserData | null>(null)
  const [vaultUserData, setVaultUserData] = useState<VaultUserData | null>(null)
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([])
  const [userRank, setUserRank] = useState<LeaderboardEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)
  const activeAddrRef = useRef(addr)
  activeAddrRef.current = addr

  useEffect(() => {
    const cached = readCache(addr)
    if (!cached) return
    if (cached.globalStats) setGlobalStats((prev) => prev ?? cached.globalStats)
    if (cached.userData) setUserData((prev) => prev ?? cached.userData)
    if (cached.vaultUserData) setVaultUserData((prev) => prev ?? cached.vaultUserData)
    if (cached.leaderboardEntries?.length)
      setLeaderboardEntries((prev) => (prev.length ? prev : cached.leaderboardEntries))
    if (cached.userRank) setUserRank((prev) => prev ?? cached.userRank)
  }, [addr])

  const fetchAll = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const isCurrentRequest = () => (
      mountedRef.current
      && requestIdRef.current === requestId
      && activeAddrRef.current === addr
    )

    if (isMockMode) {
      setGlobalStats({
        total_points: 1049,
        total_deposited: 18960000,
        total_dlp: 18960000,
        total_ua: 0,
        depositor_count: 125,
        status: 'live',
      })
      setUserData(MOCK_POINTS_DATA)
      setLeaderboardEntries(MOCK_LEADERBOARD)
      setUserRank(MOCK_LEADERBOARD.find(e => e.rank === 12) || null)
      return
    }

    // Only show loading spinners if we have no cached data
    const cached = readCache(addr)
    if (!cached?.globalStats) setLoading(true)
    if (!cached?.leaderboardEntries?.length) setLeaderboardLoading(true)

    const fetchJson = async (url: string) => {
      const response = await fetch(url)
      const json = await response.json().catch(() => null)
      if (!response.ok || !json || json.unavailable) {
        throw new Error(`Points API unavailable (${response.status})`)
      }
      return json
    }

    // Parse each response into a JSON promise — each resolves independently
    const userJsonP = addr
      ? fetchJson(`/api/predeposit/user?account=${addr}`)
      : Promise.resolve(null)
    const totalJsonP = fetchJson('/api/predeposit/total')
    const lbJsonP = fetchJson('/api/predeposit/leaderboard?limit=100')

    // Vault data fetches (mainnet DLP)
    const vaultUserP = addr
      ? fetch(`/api/vault/user?account=${addr}`).then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null)
    const vaultTotalP = fetch('/api/vault/total').then(r => r.ok ? r.json() : null).catch(() => null)

    // Resolved data refs for cross-promise access
    let resolvedUser: UserData | null = null
    let resolvedTotal: GlobalStats | null = null
    let resolvedVaultUser: VaultUserData | null = null

    try {
      // 1) User points — FASTEST, single view function, render the instant it lands
      if (addr) {
        userJsonP.then((json) => {
          if (!isCurrentRequest() || !json) return
          const ud: UserData = {
            points: json.points || 0,
            dlp_balance: json.dlp_balance || '0',
            ua_balance: json.ua_balance || '0',
            total_deposited: json.total_deposited || '0',
            rank: json.rank ?? null,
            trading_points: json.trading_points || 0,
            vault_points: json.vault_points || 0,
            referral_points: json.referral_points || 0,
            streak_points: json.streak_points || 0,
            bonus_points: json.bonus_points || 0,
          }
          resolvedUser = ud
          setUserData(ud)
        }).catch(() => {})
      }

      // 1b) Vault user data — fast, render immediately
      if (addr) {
        vaultUserP.then((json) => {
          if (!isCurrentRequest() || !json) return
          const vd: VaultUserData = {
            totalDeposited: json.totalDeposited || 0,
            currentValue: json.currentValue || 0,
            totalPnl: json.totalPnl || 0,
            vaults: json.vaults || [],
          }
          resolvedVaultUser = vd
          setVaultUserData(vd)
        }).catch(() => {})
      }

      // 2) Global stats — medium speed, render when ready
      // Also merge vault TVL data
      Promise.all([totalJsonP, vaultTotalP]).then(([predeposit, vaultTotal]) => {
        if (!isCurrentRequest()) return
        const merged = { ...predeposit }
        if (vaultTotal) {
          merged.vault_tvl = vaultTotal.totalTvl || 0
          merged.vault_depositors = vaultTotal.totalDepositors || 0
          merged.vault_count = vaultTotal.vaultCount || 0
          // All active vaults contribute to TVL; only the protocol vault is DLP.
          merged.total_dlp = (merged.total_dlp || 0) +
            (vaultTotal.protocolTvl ?? vaultTotal.totalTvl ?? 0)
          merged.total_deposited = (merged.total_deposited || 0) + (vaultTotal.totalTvl || 0)
        }
        // If both upstreams failed we'd publish an all-zero stats object,
        // which renders as "$0.00 deposited" instead of the skeletons —
        // keep the previous value (or null) so the UI stays honest.
        const hasRealData =
          (merged.total_deposited || 0) > 0 ||
          (merged.total_dlp || 0) > 0 ||
          (merged.total_points || 0) > 0
        if (hasRealData) {
          resolvedTotal = merged
          setGlobalStats(merged)
        }
      }).catch(() => {}).finally(() => {
        if (isCurrentRequest()) setLoading(false)
      })

      // 3) Leaderboard — slowest, wait for all to finish for user injection
      const [userJson, , lbData, vaultUserJson] = await Promise.all([
        userJsonP.catch(() => null),
        totalJsonP.catch(() => null),
        lbJsonP.catch(() => ({ entries: [] })),
        vaultUserP.catch(() => null),
      ])

      if (!isCurrentRequest()) return

      // Use already-resolved user data, or parse now if the .then hasn't fired yet
      const predepositData = resolvedUser || (userJson ? {
        points: userJson.points || 0,
        dlp_balance: userJson.dlp_balance || '0',
        ua_balance: userJson.ua_balance || '0',
        total_deposited: userJson.total_deposited || '0',
        rank: userJson.rank ?? null,
        trading_points: userJson.trading_points || 0,
        vault_points: userJson.vault_points || 0,
        referral_points: userJson.referral_points || 0,
        streak_points: userJson.streak_points || 0,
        bonus_points: userJson.bonus_points || 0,
      } : null)

      // Merge vault DLP into user data so existing UI picks it up
      const localVaultData = resolvedVaultUser || (vaultUserJson ? {
        totalDeposited: vaultUserJson.totalDeposited || 0,
        currentValue: vaultUserJson.currentValue || 0,
        totalPnl: vaultUserJson.totalPnl || 0,
        vaults: vaultUserJson.vaults || [],
      } as VaultUserData : null)

      // Merge: add vault value to predeposit DLP balance
      let localUserData = predepositData
      if (localVaultData && localVaultData.currentValue > 0) {
        const predepDlp = parseFloat(predepositData?.dlp_balance || '0')
        const predepTotal = parseFloat(predepositData?.total_deposited || '0')
        localUserData = {
          points: predepositData?.points || 0,
          dlp_balance: (predepDlp + localVaultData.currentValue).toString(),
          ua_balance: predepositData?.ua_balance || '0',
          total_deposited: (predepTotal + localVaultData.totalDeposited).toString(),
          rank: predepositData?.rank ?? null,
          trading_points: predepositData?.trading_points || 0,
          vault_points: predepositData?.vault_points || 0,
          referral_points: predepositData?.referral_points || 0,
          streak_points: predepositData?.streak_points || 0,
          bonus_points: predepositData?.bonus_points || 0,
        }
        setUserData(localUserData)
      }

      if (localVaultData) {
        setVaultUserData(localVaultData)
      }

      let entries: LeaderboardEntry[] = lbData.entries || []
      let resolvedUserRank: LeaderboardEntry | null = null

      if (addr && localUserData) {
        const addrLower = addr.toLowerCase()
        let userEntry = entries.find(e => e.account?.toLowerCase() === addrLower)

        if (!userEntry) {
          const totalDep = parseFloat(localUserData.total_deposited || '0')
          if (localUserData.rank) {
            userEntry = {
              rank: localUserData.rank,
              account: addr,
              points: localUserData.points || 0,
              total_deposited: totalDep.toFixed(2),
              dlp_balance: localUserData.dlp_balance || '0',
              ua_balance: localUserData.ua_balance || '0',
              vault_points: localUserData.vault_points || 0,
              trading_points: localUserData.trading_points || 0,
              referral_points: localUserData.referral_points || 0,
              streak_points: localUserData.streak_points || 0,
              bonus_points: localUserData.bonus_points || 0,
            }
          } else if (totalDep > 0) {
            const userPts = localUserData.points || 0
            let insertIdx = entries.findIndex(e => (e.points ?? 0) < userPts)
            if (insertIdx === -1) insertIdx = entries.length
            userEntry = {
              rank: insertIdx + 1,
              account: addr,
              points: userPts,
              total_deposited: totalDep.toFixed(2),
              dlp_balance: localUserData.dlp_balance || '0',
              ua_balance: localUserData.ua_balance || '0',
            }
            entries = [...entries]
            entries.splice(insertIdx, 0, userEntry)
            entries = entries.map((e, i) => ({ ...e, rank: i + 1 }))
          }
        }
        resolvedUserRank = userEntry || null
        setUserRank(resolvedUserRank)
      }

      setLeaderboardEntries(entries)

      // Persist everything to localStorage
      writeCache({
        globalStats: resolvedTotal,
        userData: localUserData,
        vaultUserData: localVaultData,
        leaderboardEntries: entries,
        userRank: resolvedUserRank,
        userAddr: addr,
      })
    } catch (error) {
      console.error('Error fetching points data:', error)
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
        setLeaderboardLoading(false)
      }
    }
  }, [addr, isMockMode])

  // Clear user-specific cache when wallet changes
  useEffect(() => {
    const cached = readCache(addr)
    if (!cached) {
      // Different wallet or no cache — reset user-specific state
      setUserData(null)
      setVaultUserData(null)
      setUserRank(null)
    }
  }, [addr])

  useEffect(() => {
    mountedRef.current = true
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      clearInterval(interval)
    }
  }, [fetchAll])

  return (
    <PointsDataContext.Provider value={{
      globalStats,
      userData,
      vaultUserData,
      leaderboardEntries,
      userRank,
      loading,
      leaderboardLoading,
      refresh: fetchAll,
    }}>
      {children}
    </PointsDataContext.Provider>
  )
}

export function usePointsData() {
  return useContext(PointsDataContext)
}
