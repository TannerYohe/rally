import { useEffect, useState } from 'react'
import type { PrListState, ReviewSession } from '@shared/types'

const EMPTY_PRS: PrListState = { prs: [], viewer: null, refreshedAt: null, refreshing: false, error: null }

export function usePrs(): PrListState {
  const [state, setState] = useState<PrListState>(EMPTY_PRS)
  useEffect(() => {
    window.rally.getPrs().then(setState)
    return window.rally.onPrsChanged(setState)
  }, [])
  return state
}

export function useSession(prKey: string): [ReviewSession | null, (session: ReviewSession | null) => void] {
  const [session, setSession] = useState<ReviewSession | null>(null)
  useEffect(() => {
    window.rally.getSession(prKey).then(setSession)
    return window.rally.onSessionChanged((s) => {
      if (s.prKey === prKey) setSession(s)
    })
  }, [prKey])
  return [session, setSession]
}

export function usePersistentState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key)
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback
  })
  const update = (next: T) => {
    localStorage.setItem(key, JSON.stringify(next))
    setValue(next)
  }
  return [value, update]
}
