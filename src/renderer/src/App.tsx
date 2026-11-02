import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { PrDetail } from './pages/PrDetail'
import { Settings } from './pages/Settings'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 text-sm ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`

export function App() {
  return (
    <HashRouter>
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-4 border-b border-zinc-800 px-6 py-2">
          <span className="font-semibold tracking-tight">Rally</span>
          <NavLink to="/" end className={navClass}>
            PRs
          </NavLink>
          <NavLink to="/settings" className={navClass}>
            Settings
          </NavLink>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pr/:owner/:repo/:number" element={<PrDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
