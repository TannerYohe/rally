import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DEFAULT_CONFIG,
  EFFORT_LABELS,
  MODEL_LABELS,
  type Config,
  type EffortChoice,
  type Health,
  type ModelChoice,
} from '@shared/types'

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
      <div>
        <Link to="/" className="text-xs text-ink-500 hover:text-ink-300">
          ← All PRs
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Settings</h1>
      </div>
      <section className="rounded-md border border-ink-800 p-4 text-sm">
        <h2 className="mb-2 font-semibold">GitHub</h2>
        {health === null ? (
          <p className="text-ink-400">Checking…</p>
        ) : health.githubLogin ? (
          <p className="text-emerald-300">Signed in as {health.githubLogin} via the gh CLI.</p>
        ) : (
          <p className="text-rose-300">gh CLI not available: {health.githubError}. Run `gh auth login`.</p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Authors</span>
          <span className="block text-xs text-ink-500">GitHub logins, one per line. Empty means any author.</span>
          <textarea className="h-48 w-full rounded border border-ink-800 bg-ink-900 p-2 font-mono" value={authors} onChange={(e) => setAuthors(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Repos</span>
          <span className="block text-xs text-ink-500">owner/name or owner/* for a whole org, one per line. Empty means any repo.</span>
          <textarea className="h-48 w-full rounded border border-ink-800 bg-ink-900 p-2 font-mono" value={repos} onChange={(e) => setRepos(e.target.value)} />
        </label>
      </section>

      <section className="space-y-3 rounded-md border border-ink-800 p-4 text-sm">
        <div>
          <h2 className="font-semibold">Reviews</h2>
          <p className="text-xs text-ink-500">Changes apply to the next Claude turn, including turns in reviews already in progress.</p>
        </div>
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-ink-400">Review skill</span>
          <input
            className="w-full rounded border border-ink-800 bg-ink-900 px-2 py-1.5 font-mono"
            value={config.reviewSkill}
            placeholder={DEFAULT_CONFIG.reviewSkill}
            onChange={(e) => setConfig({ ...config, reviewSkill: e.target.value })}
          />
          <span className="block text-xs text-ink-500">
            The Claude Code skill a new review runs as <code>/&lt;skill&gt; &lt;PR URL&gt;</code>. Empty means <code>{DEFAULT_CONFIG.reviewSkill}</code>.
          </span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <ChoiceSelect
            label="Review model"
            labels={MODEL_LABELS}
            value={config.reviewModel}
            defaultLabel={systemDefault(health?.claudeDefaults.model)}
            onChange={(reviewModel) => setConfig({ ...config, reviewModel })}
          />
          <ChoiceSelect
            label="Review effort"
            labels={EFFORT_LABELS}
            value={config.reviewEffort}
            defaultLabel={systemDefault(health?.claudeDefaults.effort)}
            onChange={(reviewEffort) => setConfig({ ...config, reviewEffort })}
          />
          <ChoiceSelect
            label="Subagent model"
            labels={MODEL_LABELS}
            value={config.subagentModel}
            defaultLabel="System default (inherits)"
            onChange={(subagentModel) => setConfig({ ...config, subagentModel })}
          />
          <ChoiceSelect
            label="Subagent effort"
            labels={EFFORT_LABELS}
            value={config.subagentEffort}
            defaultLabel="System default"
            onChange={(subagentEffort) => setConfig({ ...config, subagentEffort })}
          />
        </div>
      </section>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.includeReviewRequests}
          onChange={(e) => setConfig({ ...config, includeReviewRequests: e.target.checked })}
        />
        Also include any PR where my review is requested directly (not via a team) or that I have reviewed
      </label>

      <label className="flex items-center gap-2 text-sm">
        Refresh every
        <input
          type="number"
          min={1}
          className="w-16 rounded border border-ink-800 bg-ink-900 px-2 py-1"
          value={config.pollIntervalMinutes}
          onChange={(e) => setConfig({ ...config, pollIntervalMinutes: Math.max(1, Number(e.target.value)) })}
        />
        minutes
      </label>

      <div className="flex items-center gap-3">
        <button className="rounded-md bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-500" onClick={save}>
          Save
        </button>
        {saved && <span className="text-sm text-emerald-300">Saved. Refreshing PRs…</span>}
      </div>
    </div>
  )
}

function systemDefault(value: string | null | undefined): string {
  return value ? `System default (${value})` : 'System default'
}

interface ChoiceSelectProps<T extends ModelChoice | EffortChoice> {
  label: string
  labels: Record<T, string>
  value: T | null
  defaultLabel: string
  onChange(value: T | null): void
}

function ChoiceSelect<T extends ModelChoice | EffortChoice>({ label, labels, value, defaultLabel, onChange }: ChoiceSelectProps<T>) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-ink-400">{label}</span>
      <select
        className="w-full rounded border border-ink-800 bg-ink-900 px-2 py-1.5"
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
      >
        <option value="">{defaultLabel}</option>
        {(Object.keys(labels) as T[]).map((choice) => (
          <option key={choice} value={choice}>
            {labels[choice]}
          </option>
        ))}
      </select>
    </label>
  )
}
