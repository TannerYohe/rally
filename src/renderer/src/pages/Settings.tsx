import { useEffect, useState } from 'react'
import type { Config, Health } from '@shared/types'

const toLines = (values: string[]) => values.join('\n')
const fromLines = (text: string) =>
  text
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean)

export function Settings() {
  const [config, setConfig] = useState<Config | null>(null)
  const [authors, setAuthors] = useState('')
  const [repos, setRepos] = useState('')
  const [health, setHealth] = useState<Health | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.rally.getConfig().then((c) => {
      setConfig(c)
      setAuthors(toLines(c.authors))
      setRepos(toLines(c.repos))
    })
    window.rally.getHealth().then(setHealth)
  }, [])

  if (!config) return null

  const save = async () => {
    await window.rally.saveConfig({ ...config, authors: fromLines(authors), repos: fromLines(repos) })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <section className="rounded-md border border-zinc-800 p-4 text-sm">
        <h2 className="mb-2 font-semibold">GitHub</h2>
        {health === null ? (
          <p className="text-zinc-400">Checking…</p>
        ) : health.githubLogin ? (
          <p className="text-emerald-300">Signed in as {health.githubLogin} via the gh CLI.</p>
        ) : (
          <p className="text-rose-300">gh CLI not available: {health.githubError}. Run `gh auth login`.</p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Authors</span>
          <span className="block text-xs text-zinc-500">GitHub logins, one per line. Empty means any author.</span>
          <textarea className="h-48 w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono" value={authors} onChange={(e) => setAuthors(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Repos</span>
          <span className="block text-xs text-zinc-500">owner/name, one per line. Empty means any repo.</span>
          <textarea className="h-48 w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono" value={repos} onChange={(e) => setRepos(e.target.value)} />
        </label>
      </section>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.includeReviewRequests}
          onChange={(e) => setConfig({ ...config, includeReviewRequests: e.target.checked })}
        />
        Also include any PR where my review is requested
      </label>

      <label className="flex items-center gap-2 text-sm">
        Refresh every
        <input
          type="number"
          min={1}
          className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1"
          value={config.pollIntervalMinutes}
          onChange={(e) => setConfig({ ...config, pollIntervalMinutes: Math.max(1, Number(e.target.value)) })}
        />
        minutes
      </label>

      <div className="flex items-center gap-3">
        <button className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500" onClick={save}>
          Save
        </button>
        {saved && <span className="text-sm text-emerald-300">Saved. Refreshing PRs…</span>}
      </div>
    </div>
  )
}
