export const REVIEW_TABS = ['activity', 'report', 'threads', 'drafts'] as const

export type ReviewTab = (typeof REVIEW_TABS)[number]

export const REVIEW_TAB_LABELS: Record<ReviewTab, string> = {
  activity: 'Activity',
  report: 'Report',
  threads: 'Threads',
  drafts: 'Drafts',
}

interface TabInput {
  busy: boolean
  hasDrafts: boolean
}

export function automaticReviewTab({ busy, hasDrafts }: TabInput): ReviewTab {
  return busy || !hasDrafts ? 'activity' : 'drafts'
}

export function selectedReviewTab(chosen: ReviewTab | null, input: TabInput): ReviewTab {
  return chosen ?? automaticReviewTab(input)
}

export function reviewTabForKey(tab: ReviewTab, key: string): ReviewTab | null {
  const index = REVIEW_TABS.indexOf(tab)
  switch (key) {
    case 'ArrowRight':
      return REVIEW_TABS[(index + 1) % REVIEW_TABS.length]
    case 'ArrowLeft':
      return REVIEW_TABS[(index - 1 + REVIEW_TABS.length) % REVIEW_TABS.length]
    case 'Home':
      return REVIEW_TABS[0]
    case 'End':
      return REVIEW_TABS[REVIEW_TABS.length - 1]
    default:
      return null
  }
}

export interface ReviewTabState {
  chosen: ReviewTab | null
  following: boolean
}

export const INITIAL_REVIEW_TAB_STATE: ReviewTabState = { chosen: null, following: false }

export type ReviewTabAction =
  | { type: 'select'; tab: ReviewTab }
  | { type: 'follow' }
  | { type: 'sendFailed' }
  | { type: 'scrolledUp' }
  | { type: 'busyChanged'; busy: boolean }

export function reviewTabReducer(state: ReviewTabState, action: ReviewTabAction): ReviewTabState {
  switch (action.type) {
    case 'select':
      return { chosen: action.tab, following: state.following && action.tab === 'activity' }
    case 'follow':
      return { chosen: 'activity', following: true }
    case 'sendFailed':
      return INITIAL_REVIEW_TAB_STATE
    case 'scrolledUp':
      return { ...state, following: false }
    case 'busyChanged':
      return { chosen: null, following: action.busy && state.following }
  }
}

interface EmptyTabInput {
  hasDrafts: boolean
  commentCount: number
  threadCount: number
}

export function emptyReviewTabs({ hasDrafts, commentCount, threadCount }: EmptyTabInput): Record<ReviewTab, boolean> {
  return { activity: false, report: !hasDrafts, threads: threadCount === 0, drafts: commentCount === 0 }
}
