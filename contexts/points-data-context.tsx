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
}

export interface UserData {
  points: number
  dlp_balance: string
  ua_balance: string
  total_deposited: string
}

export interface LeaderboardEntry {
  rank: number
  account: string
  points: number
  dlp_balance: string
  ua_balance: string
  total_deposited: string
}

interface PointsDataContextType {
  globalStats: GlobalStats | null
  userData: UserData | null
  leaderboardEntries: LeaderboardEntry[]
  userRank: LeaderboardEntry | null
  loading: boolean
  leaderboardLoading: boolean
  refresh: () => void
}

const PointsDataContext = createContext<PointsDataContextType>({
  globalStats: null,
  userData: null,
  leaderboardEntries: [],
  userRank: null,
  loading: false,
  leaderboardLoading: false,
  refresh: () => {},
})

// localStorage cache helpers
const CACHE_KEY = 'decibrrr_points_cache'

interface CachedData {
  globalStats: GlobalStats | null
  userData: UserData | null
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

  // Initialize state from localStorage cache for instant render
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(() => {
    if (typeof window === 'undefined') return null
    return readCache(addr)?.globalStats || null
  })
  const [userData, setUserData] = useState<UserData | null>(() => {
    if (typeof window === 'undefined') return null
    return readCache(addr)?.userData || null
  })
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>(() => {
    if (typeof window === 'undefined') return []
    return readCache(addr)?.leaderboardEntries || []
  })
  const [userRank, setUserRank] = useState<LeaderboardEntry | null>(() => {
    if (typeof window === 'undefined') return null
    return readCache(addr)?.userRank || null
  })
  const [loading, setLoading] = useState(false)
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const mountedRef = useRef(true)

  const fetchAll = useCallback(async () => {
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

    // Parse each response into a JSON promise — each resolves independently
    const userJsonP = addr
      ? fetch(`/api/predeposit/user?account=${addr}`).then(r => r.json())
      : Promise.resolve(null)
    const totalJsonP = fetch('/api/predeposit/total').then(r => r.json())
    const lbJsonP = fetch('/api/predeposit/leaderboard?limit=100').then(r => r.json())

    // Resolved data refs for cross-promise access
    let resolvedUser: UserData | null = null
    let resolvedTotal: GlobalStats | null = null

    try {
      // 1) User points — FASTEST, single view function, render the instant it lands
      if (addr) {
        userJsonP.then((json) => {
          if (!mountedRef.current || !json) return
          const ud: UserData = {
            points: json.points || 0,
            dlp_balance: json.dlp_balance || '0',
            ua_balance: json.ua_balance || '0',
            total_deposited: json.total_deposited || '0',
          }
          resolvedUser = ud
          setUserData(ud)
        }).catch(() => {})
      }

      // 2) Global stats — medium speed, render when ready
      totalJsonP.then((data) => {
        if (!mountedRef.current) return
        resolvedTotal = data
        setGlobalStats(data)
        setLoading(false)
      }).catch(() => {})

      // 3) Leaderboard — slowest, wait for all 3 to finish for user injection
      const [userJson, , lbData] = await Promise.all([
        userJsonP.catch(() => null),
        totalJsonP.catch(() => null),
        lbJsonP.catch(() => ({ entries: [] })),
      ])

      if (!mountedRef.current) return

      // Use already-resolved user data, or parse now if the .then hasn't fired yet
      const localUserData = resolvedUser || (userJson ? {
        points: userJson.points || 0,
        dlp_balance: userJson.dlp_balance || '0',
        ua_balance: userJson.ua_balance || '0',
        total_deposited: userJson.total_deposited || '0',
      } : null)

      let entries: LeaderboardEntry[] = lbData.entries || []
      let resolvedUserRank: LeaderboardEntry | null = null

      if (addr && localUserData) {
        const addrLower = addr.toLowerCase()
        let userEntry = entries.find(e => e.account?.toLowerCase() === addrLower)

        if (!userEntry) {
          const totalDep = parseFloat(localUserData.total_deposited || '0')
          if (totalDep > 0) {
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
        leaderboardEntries: entries,
        userRank: resolvedUserRank,
        userAddr: addr,
      })
    } catch (error) {
      console.error('Error fetching points data:', error)
    } finally {
      if (mountedRef.current) {
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
      setUserRank(null)
    }
  }, [addr])

  useEffect(() => {
    mountedRef.current = true
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [fetchAll])

  return (
    <PointsDataContext.Provider value={{
      globalStats,
      userData,
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
