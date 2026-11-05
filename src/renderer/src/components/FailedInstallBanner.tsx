import { Link } from 'react-router-dom'
import { useFailedInstall } from '../lib/hooks'
import { settingsPath } from '../lib/settingsSections'

export function FailedInstallBanner() {
  const [attempt, dismiss] = useFailedInstall()
  if (!attempt) return null
  return (
    <div className="flex items-center gap-3 rounded-lg bg-amber-950/80 px-4 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
      <span className="min-w-0 flex-1">
        Rally {attempt.version} didn't install.{' '}
        <Link to={settingsPath('about')} className="underline hover:text-amber-100">
          See details in Settings → About
        </Link>
      </span>
      <button className="text-xs text-amber-300/80 hover:text-amber-100" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  )
}
