import { AUTHOR_PHASE_ORDER } from '@shared/types'
import { PrDashboard, type DashboardConfig } from '../components/PrDashboard'
import { AUTHOR_STATUS_LABELS } from '../lib/authorView'
import { prDetailPath } from '../lib/routes'

const AUTHORED: DashboardConfig = {
  list: 'authored',
  title: 'My PRs',
  phaseOrder: AUTHOR_PHASE_ORDER,
  storageKey: 'rally.mine',
  detailPath: (pr) => prDetailPath('authored', pr),
  statusLabels: AUTHOR_STATUS_LABELS,
  emptyState: 'You have no open PRs.',
}

export function MyPrs() {
  return <PrDashboard config={AUTHORED} />
}
