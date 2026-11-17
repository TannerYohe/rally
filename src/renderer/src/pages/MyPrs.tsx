import { AUTHOR_PHASE_ORDER } from '@shared/types'
import { PrDashboard, type DashboardConfig } from '../components/PrDashboard'
import { prDetailPath } from '../lib/routes'

const AUTHORED: DashboardConfig = {
  list: 'authored',
  title: 'My PRs',
  phaseOrder: AUTHOR_PHASE_ORDER,
  storageKey: 'rally.mine',
  detailPath: (pr) => prDetailPath('authored', pr),
  emptyState: 'You have no open PRs.',
}

export function MyPrs() {
  return <PrDashboard config={AUTHORED} />
}
