import { createHashRouter, Link, NavLink, Outlet, RouterProvider } from 'react-router-dom'
import logo from '../../../resources/icon.svg'
import { SETTINGS_ROOT } from './lib/settingsSections'
import { useSkin } from './lib/skins'
import { Dashboard } from './pages/Dashboard'
import { PrDetail } from './pages/PrDetail'
import { Settings } from './pages/Settings'

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.3 4.3c.4-1.7 3-1.7 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.5 1.8 3 0 3.5a1.7 1.7 0 0 0-1 2.5c.9 1.6-.9 3.3-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.6-1c-1.5.9-3.3-.8-2.4-2.4a1.7 1.7 0 0 0-1-2.5c-1.8-.5-1.8-3 0-3.5a1.7 1.7 0 0 0 1-2.5c-.9-1.6.9-3.3 2.4-2.4a1.7 1.7 0 0 0 2.6-1.1Z"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function Layout() {
  const skin = useSkin()
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center border-b border-white/5 bg-ink-950/70 px-6 py-2.5 backdrop-blur">
        <Link to="/" className="flex items-center gap-2">
          <img src={logo} alt="" className="h-7 w-7" />
          <span className="wordmark bg-gradient-to-r from-primary-400 via-secondary-400 to-highlight-400 bg-clip-text text-lg font-bold tracking-tight text-transparent">
            Rally
          </span>
          {skin.mark && <span className="text-base">{skin.mark}</span>}
        </Link>
        <NavLink
          to={SETTINGS_ROOT}
          title="Settings"
          aria-label="Settings"
          className={({ isActive }) =>
            `ml-auto rounded-md p-1.5 transition ${isActive ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100'}`
          }
        >
          <GearIcon />
        </NavLink>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/pr/:owner/:repo/:number', element: <PrDetail /> },
      { path: `${SETTINGS_ROOT}/:section?`, element: <Settings /> },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
