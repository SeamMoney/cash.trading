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

export function PointsDataProvider({ children }: { children: ReactNode }) {
  const { account } = useWallet()
  const { isMockMode } = useMockData()
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null)
  const [userData, setUserData] = useState<UserData | null>(null)
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([])
  const [userRank, setUserRank] = useState<LeaderboardEntry | null>(null)
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

    setLoading(true)
    setLeaderboardLoading(true)

    const addr = account?.address?.toString()

    // Fire ALL requests in parallel — no waterfalls
    const totalPromise = fetch('/api/predeposit/total')
    const lbPromise = fetch('/api/predeposit/leaderboard?limit=100')
    const userPromise = addr ? fetch(`/api/predeposit/user?account=${addr}`) : null

    try {
      // Process total + user in parallel, update UI as each resolves
      const [totalRes, userRes] = await Promise.all([
        totalPromise,
        userPromise,
      ])

      if (!mountedRef.current) return

      // Global stats
      const totalData = await totalRes.json()
      setGlobalStats(totalData)

      // User data (local var so leaderboard injection can use it)
      let localUserData: UserData | null = null
      if (userRes) {
        const userJson = await userRes.json()
        localUserData = {
          points: userJson.points || 0,
          dlp_balance: userJson.dlp_balance || '0',
          ua_balance: userJson.ua_balance || '0',
          total_deposited: userJson.total_deposited || '0',
        }
        setUserData(localUserData)
      }

      // Stats + user are done, stop showing main loading
      setLoading(false)

      // Leaderboard — slowest, update independently
      const lbRes = await lbPromise
      if (!mountedRef.current) return
      const lbData = await lbRes.json()
      let entries: LeaderboardEntry[] = lbData.entries || []

      // Find or inject user into leaderboard using local var (not stale state)
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
        setUserRank(userEntry || null)
      }

      setLeaderboardEntries(entries)
    } catch (error) {
      console.error('Error fetching points data:', error)
    } finally {
      if (mountedRef.current) {
        setLoading(false)
        setLeaderboardLoading(false)
      }
    }
  }, [account?.address, isMockMode])

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
