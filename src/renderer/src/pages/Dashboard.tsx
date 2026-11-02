import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PHASE_LABELS, PHASE_ORDER, type Phase, type Pr } from '@shared/types'
import { PhaseBadge } from '../components/PhaseBadge'
import { age } from '../lib/format'
import { usePrs } from '../lib/hooks'

function sortPrs(prs: Pr[]): Pr[] {
  return [...prs].sort(
    (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.createdAt.localeCompare(b.createdAt),
  )
}

export function Dashboard() {
  const { prs, refreshing, refreshedAt, error } = usePrs()
  const [hidden, setHidden] = useState<Set<Phase>>(new Set())
  const navigate = useNavigate()

  const counts = useMemo(() => {
    const result = Object.fromEntries(PHASE_ORDER.map((p) => [p, 0])) as Record<Phase, number>
    for (const pr of prs) result[pr.phase]++
    return result
  }, [prs])
  const visible = useMemo(() => sortPrs(prs.filter((pr) => !hidden.has(pr.phase))), [prs, hidden])

  const toggle = (phase: Phase) => {
    const next = new Set(hidden)
    if (next.has(phase)) next.delete(phase)
    else next.add(phase)
    setHidden(next)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-6 py-3">
        {PHASE_ORDER.map((phase) => (
          <button
            key={phase}
            onClick={() => toggle(phase)}
            className={`rounded-full px-3 py-1 text-xs ring-1 ring-zinc-700 ${hidden.has(phase) ? 'text-zinc-500 line-through' : 'bg-zinc-800 text-zinc-200'}`}
          >
            {PHASE_LABELS[phase]} · {counts[phase]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          {refreshedAt && <span>Updated {age(refreshedAt)} ago</span>}
          <button
            className="rounded-md bg-zinc-800 px-3 py-1 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            disabled={refreshing}
            onClick={() => window.rally.refreshPrs()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && <div className="bg-rose-950 px-6 py-2 text-sm text-rose-200">GitHub refresh failed: {error}</div>}
      <div className="flex-1 overflow-auto">
        {prs.length === 0 && !refreshing ? (
          <div className="p-10 text-center text-sm text-zinc-400">
            No open PRs match. Add authors and repos in <Link className="text-sky-400 underline" to="/settings">Settings</Link>.
          </div>
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-zinc-950 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="w-36 px-6 py-2">Author</th>
                <th className="w-[28%] px-2 py-2">Title</th>
                <th className="w-40 px-2 py-2">Repo</th>
                <th className="w-14 px-2 py-2">Age</th>
                <th className="w-40 px-2 py-2">Phase</th>
                <th className="px-2 py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((pr) => (
                <tr
                  key={pr.id}
                  className="cursor-pointer border-t border-zinc-900 hover:bg-zinc-900"
                  onClick={() => navigate(`/pr/${pr.owner}/${pr.repo}/${pr.number}`)}
                >
                  <td className="truncate px-6 py-2.5 text-zinc-300">{pr.author}</td>
                  <td className="truncate px-2 py-2.5" title={pr.title}>
                    {pr.isDraft && <span className="mr-1.5 text-xs text-zinc-500">[draft]</span>}
                    {pr.title}
                  </td>
                  <td className="truncate px-2 py-2.5 text-zinc-400">
                    {pr.repo}#{pr.number}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-400">{age(pr.createdAt)}</td>
                  <td className="px-2 py-2.5">
                    <PhaseBadge phase={pr.phase} />
                  </td>
                  <td className="truncate px-2 py-2.5 text-zinc-400" title={pr.summary ?? ''}>
                    {pr.summary ?? <span className="italic text-zinc-600">summarizing…</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
