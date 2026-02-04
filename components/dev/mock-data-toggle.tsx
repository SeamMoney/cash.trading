"use client"

import { useMockData } from '@/contexts/mock-data-context'

export function MockDataToggle() {
  const { isMockMode, toggleMockMode } = useMockData()

  return (
    <button
      onClick={toggleMockMode}
      className={`fixed bottom-4 right-4 z-[9999] w-4 h-4 transition-all duration-300 ${
        isMockMode
          ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]'
          : 'bg-zinc-600 hover:bg-zinc-500'
      }`}
      title={isMockMode ? 'Mock data ON - Click to use real data' : 'Click to preview with mock data'}
      aria-label={isMockMode ? 'Disable mock data' : 'Enable mock data'}
    />
  )
}
