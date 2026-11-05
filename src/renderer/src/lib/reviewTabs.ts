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

interface EmptyTabInput {
  hasDrafts: boolean
  threadCount: number
}

export function emptyReviewTabs({ hasDrafts, threadCount }: EmptyTabInput): Record<ReviewTab, boolean> {
  return { activity: false, report: !hasDrafts, threads: threadCount === 0, drafts: !hasDrafts }
}
