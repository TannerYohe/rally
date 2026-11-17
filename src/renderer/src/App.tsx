import { createHashRouter, Link, NavLink, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import logo from '../../../resources/icon.svg'
import { useSoundCues } from './lib/hooks'
import { SETTINGS_ROOT } from './lib/settingsSections'
import { useSkin } from './lib/skins'
import { LIST_ROOTS } from './lib/routes'
import { AuthorPrDetail } from './pages/AuthorPrDetail'
import { Dashboard } from './pages/Dashboard'
import { MyPrs } from './pages/MyPrs'
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

const NAV_TABS = [
  { to: LIST_ROOTS.reviewing, label: 'Reviewing', isActive: (path: string) => path === '/' || path.startsWith('/pr/') },
  { to: LIST_ROOTS.authored, label: 'My PRs', isActive: (path: string) => path.startsWith(LIST_ROOTS.authored) },
]

function NavTabs() {
  const { pathname } = useLocation()
  return (
    <nav className="ml-8 flex gap-1">
      {NAV_TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={`rounded-md px-3 py-1 text-sm transition ${tab.isActive(pathname) ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100'}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
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
        <NavTabs />
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
      { path: LIST_ROOTS.authored, element: <MyPrs /> },
      { path: `${LIST_ROOTS.authored}/:owner/:repo/:number`, element: <AuthorPrDetail /> },
      { path: `${SETTINGS_ROOT}/:section?`, element: <Settings /> },
    ],
  },
])

export function App() {
  useSoundCues()
  return <RouterProvider router={router} />
}
