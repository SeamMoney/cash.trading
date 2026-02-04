"use client"

import { createContext, useContext, useState, ReactNode } from 'react'

interface MockDataContextType {
  isMockMode: boolean
  toggleMockMode: () => void
}

const MockDataContext = createContext<MockDataContextType>({
  isMockMode: false,
  toggleMockMode: () => {},
})

export function MockDataProvider({ children }: { children: ReactNode }) {
  const [isMockMode, setIsMockMode] = useState(false)

  const toggleMockMode = () => {
    setIsMockMode(prev => !prev)
  }

  return (
    <MockDataContext.Provider value={{ isMockMode, toggleMockMode }}>
      {children}
    </MockDataContext.Provider>
  )
}

export function useMockData() {
  return useContext(MockDataContext)
}
