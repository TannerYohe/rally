import { Link } from 'react-router-dom'
import { REVIEW_PHASE_ORDER } from '@shared/types'
import { PrDashboard, type DashboardConfig } from '../components/PrDashboard'
import { prDetailPath } from '../lib/routes'
import { SESSION_STATUS_LABELS } from '../lib/sessionStatus'
import { settingsPath } from '../lib/settingsSections'

const REVIEWING: DashboardConfig = {
  list: 'reviewing',
  title: 'Open PRs',
  phaseOrder: REVIEW_PHASE_ORDER,
  storageKey: 'rally.dashboard',
  detailPath: (pr) => prDetailPath('reviewing', pr),
  statusLabels: SESSION_STATUS_LABELS,
  emptyState: (
    <>
      No open PRs match. Add authors and repos in{' '}
      <Link className="text-primary-400 underline" to={settingsPath('pull-requests')}>
        Settings
      </Link>
      .
    </>
  ),
}

export function Dashboard() {
  return <PrDashboard config={REVIEWING} />
}
