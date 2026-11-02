import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { PrDetail } from './pages/PrDetail'
import { Settings } from './pages/Settings'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1 text-sm transition ${isActive ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'}`

export function App() {
  return (
    <HashRouter>
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-4 border-b border-white/5 bg-zinc-950/70 px-6 py-2.5 backdrop-blur">
          <span className="bg-gradient-to-r from-sky-400 via-violet-400 to-fuchsia-400 bg-clip-text text-lg font-bold tracking-tight text-transparent">
            Rally
          </span>
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
