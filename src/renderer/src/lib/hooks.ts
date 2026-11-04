import { useEffect, useRef, useState, type RefObject, type SyntheticEvent } from 'react'
import type { PrListState, ReviewSession, TimelineEntry } from '@shared/types'

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

interface FollowActivityInput {
  busy: boolean
  hasDrafts: boolean
  timeline: TimelineEntry[]
}

interface FollowActivity {
  ref: RefObject<HTMLDetailsElement | null>
  open: boolean
  onToggle(event: SyntheticEvent<HTMLDetailsElement>): void
  follow(): void
}

export function useFollowActivity({ busy, hasDrafts, timeline }: FollowActivityInput): FollowActivity {
  const ref = useRef<HTMLDetailsElement>(null)
  const [pinned, setPinned] = useState(false)
  const [following, setFollowing] = useState(false)
  const autoOpen = busy || !hasDrafts || pinned
  const [open, setOpen] = useState(autoOpen)

  useEffect(() => setOpen(autoOpen), [autoOpen])

  useEffect(() => {
    if (following) ref.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [following, open, timeline])

  useEffect(() => {
    if (!following) return
    const stopOnScrollUp = (event: WheelEvent) => {
      if (event.deltaY < 0) setFollowing(false)
    }
    window.addEventListener('wheel', stopOnScrollUp)
    return () => window.removeEventListener('wheel', stopOnScrollUp)
  }, [following])

  useEffect(() => {
    if (!busy) setFollowing(false)
  }, [busy])

  return {
    ref,
    open,
    onToggle: (event) => setOpen(event.currentTarget.open),
    follow: () => {
      setPinned(true)
      setOpen(true)
      setFollowing(true)
    },
  }
}
