"use client"

import { useState, useEffect } from "react"

interface CloudStatus {
  cloudModeEnabled: boolean
  cronInterval: string
  checks: {
    cronSecret: boolean
    database: boolean
    botOperator: boolean
  }
  message: string
}

export function useCloudStatus() {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/cloud-status')
        if (!response.ok) {
          throw new Error('Failed to fetch cloud status')
        }
        const data = await response.json()
        setStatus(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()
  }, [])

  return { status, loading, error }
}
