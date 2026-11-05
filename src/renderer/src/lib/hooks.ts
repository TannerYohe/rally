import { useEffect, useReducer, useRef, useState, type RefObject } from 'react'
import { priorConcernThreadIds, type PrListState, type ReviewSession, type ReviewThread, type TimelineEntry, type UpdateState } from '@shared/types'
import { INITIAL_REVIEW_TAB_STATE, reviewTabReducer, selectedReviewTab, type ReviewTab } from './reviewTabs'
import { concernRows, selectedThreadIds, type ConcernRow } from './threads'

const EMPTY_PRS: PrListState = { prs: [], viewer: null, refreshedAt: null, refreshing: false, error: null }

export function usePrs(): PrListState {
  const [state, setState] = useState<PrListState>(EMPTY_PRS)
  useEffect(() => {
    window.rally.getPrs().then(setState)
    return window.rally.onPrsChanged(setState)
  }, [])
  return state
}

export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    window.rally.getUpdateState().then(setState)
    return window.rally.onUpdateChanged(setState)
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

interface ReviewTabInput {
  busy: boolean
  hasDrafts: boolean
  timeline: TimelineEntry[]
}

interface ReviewTabHook {
  tab: ReviewTab
  activityRef: RefObject<HTMLDivElement | null>
  select(tab: ReviewTab): void
  follow(): void
  sendFailed(): void
}

export function useReviewTab({ busy, hasDrafts, timeline }: ReviewTabInput): ReviewTabHook {
  const activityRef = useRef<HTMLDivElement>(null)
  const [{ chosen, following }, dispatch] = useReducer(reviewTabReducer, INITIAL_REVIEW_TAB_STATE)
  const tab = selectedReviewTab(chosen, { busy, hasDrafts })

  useEffect(() => dispatch({ type: 'busyChanged', busy }), [busy])

  useEffect(() => {
    if (following && tab === 'activity') activityRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [following, tab, timeline])

  useEffect(() => {
    if (!following) return
    const stopOnScrollUp = (event: WheelEvent) => {
      if (event.deltaY < 0) dispatch({ type: 'scrolledUp' })
    }
    window.addEventListener('wheel', stopOnScrollUp)
    return () => window.removeEventListener('wheel', stopOnScrollUp)
  }, [following])

  return {
    tab,
    activityRef,
    select: (next) => dispatch({ type: 'select', tab: next }),
    follow: () => dispatch({ type: 'follow' }),
    sendFailed: () => dispatch({ type: 'sendFailed' }),
  }
}

interface ReviewThreadsState {
  key: string | null
  threads: ReviewThread[]
  error: string | null
}

function useReviewThreads(session: ReviewSession): { threads: ReviewThread[]; loaded: boolean; error: string | null } {
  const threadKey = priorConcernThreadIds(session.drafts).join(',')
  const [state, setState] = useState<ReviewThreadsState>({ key: null, threads: [], error: null })
  useEffect(() => {
    if (!threadKey) return
    let current = true
    window.rally.getReviewThreads(session.id).then(
      (threads) => current && setState({ key: threadKey, threads, error: null }),
      (error) => current && setState({ key: threadKey, threads: [], error: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      current = false
    }
  }, [session.id, threadKey, session.threadResolution?.at])
  if (!threadKey) return { threads: [], loaded: true, error: null }
  const loaded = state.key === threadKey
  return { threads: loaded ? state.threads : [], loaded: loaded && !state.error, error: loaded ? state.error : null }
}

export interface ThreadResolutionState {
  rows: ConcernRow[]
  overrides: Record<string, boolean>
  selectedIds: string[]
  threadsLoaded: boolean
  threadsError: string | null
  resolveError: string | null
  resolving: boolean
  select(threadId: string, selected: boolean): void
  resolveSelected(): Promise<void>
}

export function useThreadResolution(session: ReviewSession): ThreadResolutionState {
  const { threads, loaded, error } = useReviewThreads(session)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [resolveError, setResolveError] = useState<string | null>(null)
  const rows = concernRows(session.drafts?.priorConcerns ?? [], threads)
  const selectedIds = selectedThreadIds(rows, overrides)
  return {
    rows,
    overrides,
    selectedIds,
    threadsLoaded: loaded,
    threadsError: error,
    resolveError,
    resolving: session.resolvingThreads ?? false,
    select: (threadId, selected) => setOverrides((current) => ({ ...current, [threadId]: selected })),
    resolveSelected: async () => {
      if (!window.confirm(`Resolve ${selectedIds.length} review thread(s) on GitHub?`)) return
      setResolveError(null)
      try {
        await window.rally.resolveThreads(session.id, selectedIds)
      } catch (failure) {
        setResolveError(failure instanceof Error ? failure.message : String(failure))
      }
    },
  }
}
