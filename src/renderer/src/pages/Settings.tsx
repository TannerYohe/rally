import { useEffect, useState, type ReactNode } from 'react'
import { Link, useBlocker, useParams, type Blocker } from 'react-router-dom'
import {
  DEFAULT_CONFIG,
  EFFORT_LABELS,
  MODEL_LABELS,
  type Config,
  type EffortChoice,
  type Health,
  type ModelChoice,
} from '@shared/types'
import logo from '../../../../resources/icon.svg'
import { Avatar } from '../components/Avatar'
import { TagInput } from '../components/TagInput'
import { SKINS, saveSkin, useSkin } from '../lib/skins'

type SectionId = 'pull-requests' | 'reviews' | 'appearance' | 'accounts'

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: 'pull-requests', label: 'Pull requests', icon: <PullRequestIcon /> },
  { id: 'reviews', label: 'Reviews', icon: <SparkleIcon /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteIcon /> },
  { id: 'accounts', label: 'Accounts', icon: <PersonIcon /> },
]

function sectionFromParam(param: string | undefined): SectionId {
  return SECTIONS.find((s) => s.id === param)?.id ?? 'pull-requests'
}

export function Settings() {
  const section = sectionFromParam(useParams().section)
  const [saved, setSaved] = useState<Config | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    window.rally.getConfig().then((c) => {
      setSaved(c)
      setConfig(c)
    })
    window.rally.getHealth().then(setHealth)
  }, [])

  const dirty = JSON.stringify(config) !== JSON.stringify(saved)
  const blocker = useBlocker(({ nextLocation }) => dirty && !nextLocation.pathname.startsWith('/settings'))

  if (!config || !saved) return null

  const save = async () => {
    await window.rally.saveConfig(config)
    setSaved(config)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 2000)
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-white/5 bg-ink-950/40 p-3">
        <Link to="/" className="mb-3 px-2.5 pt-1 text-xs text-ink-500 hover:text-ink-300">
          ← All PRs
        </Link>
        <h1 className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Settings</h1>
        {SECTIONS.map((s) => (
          <Link
            key={s.id}
            to={`/settings/${s.id}`}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition ${s.id === section ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100'}`}
          >
            {s.icon}
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="max-w-2xl space-y-5 px-10 py-8">
            <SectionBody section={section} config={config} health={health} onChange={setConfig} />
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-white/5 bg-ink-950/70 px-10 py-3 text-sm backdrop-blur">
          {dirty ? (
            <span className="flex items-center gap-2 text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Unsaved changes
            </span>
          ) : (
            justSaved && <span className="text-emerald-300">Saved. Refreshing PRs…</span>
          )}
          <button
            className="ml-auto rounded-md px-3 py-1.5 text-ink-400 hover:text-ink-100 disabled:invisible"
            disabled={!dirty}
            onClick={() => setConfig(saved)}
          >
            Discard
          </button>
          <button
            className={`rounded-md px-4 py-1.5 font-medium transition ${dirty ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-lg shadow-secondary-500/20 hover:from-primary-400 hover:to-secondary-400' : 'bg-ink-800 text-ink-400 hover:text-ink-200'}`}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
      {blocker.state === 'blocked' && <UnsavedChangesDialog blocker={blocker} onSave={save} />}
    </div>
  )
}

function UnsavedChangesDialog({ blocker, onSave }: { blocker: Blocker; onSave(): Promise<void> }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && blocker.reset?.()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blocker])

  const saveAndLeave = async () => {
    await onSave()
    blocker.proceed?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => blocker.reset?.()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        className="w-96 space-y-4 rounded-xl border border-white/10 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h2 id="unsaved-changes-title" className="font-semibold">
            Unsaved changes
          </h2>
          <p className="text-sm text-ink-400">Save your settings before leaving?</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button autoFocus className="rounded-md px-3 py-1.5 text-ink-400 hover:text-ink-100" onClick={() => blocker.reset?.()}>
            Keep editing
          </button>
          <button className="ml-auto rounded-md px-3 py-1.5 text-rose-300 hover:bg-rose-500/10" onClick={() => blocker.proceed?.()}>
            Discard
          </button>
          <button
            className="rounded-md bg-gradient-to-r from-primary-500 to-secondary-500 px-4 py-1.5 font-medium text-white hover:from-primary-400 hover:to-secondary-400"
            onClick={saveAndLeave}
          >
            Save and leave
          </button>
        </div>
      </div>
    </div>
  )
}

interface SectionProps {
  config: Config
  health: Health | null
  onChange(config: Config): void
}

function SectionBody({ section, ...props }: SectionProps & { section: SectionId }) {
  switch (section) {
    case 'pull-requests':
      return <PullRequestsSection {...props} />
    case 'reviews':
      return <ReviewsSection {...props} />
    case 'appearance':
      return <AppearanceSection />
    case 'accounts':
      return <AccountsSection {...props} />
  }
}

function PullRequestsSection({ config, onChange }: SectionProps) {
  return (
    <>
      <SectionHeader title="Pull requests">
        The dashboard lists open PRs whose author and repo both match these lists, plus your review requests if enabled.
      </SectionHeader>
      <Card>
        <StackedRow label="Authors" description="GitHub logins. Leave empty to include any author.">
          <TagInput
            values={config.authors}
            placeholder="Add a GitHub login"
            renderIcon={(login) => <Avatar login={login} url={`https://github.com/${login}.png?size=40`} size="xs" ringClass="ring-transparent" />}
            onChange={(authors) => onChange({ ...config, authors })}
          />
        </StackedRow>
        <StackedRow label="Repos" description="owner/name, or owner/* for every repo in an org. Leave empty to include any repo.">
          <TagInput values={config.repos} placeholder="Add owner/name or owner/*" onChange={(repos) => onChange({ ...config, repos })} />
        </StackedRow>
      </Card>
      <Card>
        <Row label="Include my review requests" description="Also list any PR where my review is requested directly (not via a team) or that I have reviewed.">
          <Switch
            label="Include my review requests"
            checked={config.includeReviewRequests}
            onChange={(includeReviewRequests) => onChange({ ...config, includeReviewRequests })}
          />
        </Row>
        <Row label="Refresh interval" description="How often Rally checks GitHub for changes.">
          <span className="flex items-center gap-2 text-ink-400">
            <input
              type="number"
              min={1}
              className={`${FIELD_CLASS} w-16 text-right`}
              value={config.pollIntervalMinutes}
              onChange={(e) => onChange({ ...config, pollIntervalMinutes: Math.max(1, Number(e.target.value)) })}
            />
            min
          </span>
        </Row>
      </Card>
    </>
  )
}

function ReviewsSection({ config, health, onChange }: SectionProps) {
  return (
    <>
      <SectionHeader title="Reviews">
        How Rally runs Claude. Changes apply to the next Claude turn, including turns in reviews already in progress.
      </SectionHeader>
      <Card>
        <StackedRow
          label="Review skill"
          description={
            <>
              The Claude Code skill a new review runs as <code className="text-ink-300">/&lt;skill&gt; &lt;PR URL&gt;</code>. Empty means{' '}
              <code className="text-ink-300">{DEFAULT_CONFIG.reviewSkill}</code>.
            </>
          }
        >
          <div className={`${FIELD_CLASS} flex items-center font-mono focus-within:ring-secondary-400/50`}>
            <span className="text-ink-500">/</span>
            <input
              className="flex-1 bg-transparent pl-0.5 outline-none placeholder:text-ink-600"
              value={config.reviewSkill}
              placeholder={DEFAULT_CONFIG.reviewSkill}
              onChange={(e) => onChange({ ...config, reviewSkill: e.target.value })}
            />
          </div>
        </StackedRow>
      </Card>
      <Card title="Review session" description="The main Claude session that runs the skill and drafts the review.">
        <Row label="Model">
          <ChoiceSelect
            labels={MODEL_LABELS}
            value={config.reviewModel}
            defaultLabel={systemDefault(health?.claudeDefaults.model)}
            onChange={(reviewModel) => onChange({ ...config, reviewModel })}
          />
        </Row>
        <Row label="Effort">
          <ChoiceSelect
            labels={EFFORT_LABELS}
            value={config.reviewEffort}
            defaultLabel={systemDefault(health?.claudeDefaults.effort)}
            onChange={(reviewEffort) => onChange({ ...config, reviewEffort })}
          />
        </Row>
      </Card>
      <Card title="Subagents" description="Reviewer subagents the skill fans out to.">
        <Row label="Model">
          <ChoiceSelect
            labels={MODEL_LABELS}
            value={config.subagentModel}
            defaultLabel="System default (inherits)"
            onChange={(subagentModel) => onChange({ ...config, subagentModel })}
          />
        </Row>
        <Row label="Effort">
          <ChoiceSelect
            labels={EFFORT_LABELS}
            value={config.subagentEffort}
            defaultLabel="System default"
            onChange={(subagentEffort) => onChange({ ...config, subagentEffort })}
          />
        </Row>
      </Card>
    </>
  )
}

function AppearanceSection() {
  const current = useSkin()
  return (
    <>
      <SectionHeader title="Appearance">A skin changes Rally's colors and backdrop. It applies right away and doesn't need saving.</SectionHeader>
      <Card title="Skin">
        <div role="radiogroup" aria-label="Skin" className="divide-y divide-white/5">
          {SKINS.map((skin) => (
            <button
              key={skin.id}
              type="button"
              role="radio"
              aria-checked={skin.id === current.id}
              onClick={() => saveSkin(skin.id)}
              className={`flex w-full items-center gap-4 px-4 py-3 text-left transition first:rounded-t-xl last:rounded-b-xl ${skin.id === current.id ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
            >
              {skin.mark ? <span className="w-7 text-center text-2xl">{skin.mark}</span> : <img src={logo} alt="" className="h-7 w-7" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink-100">{skin.name}</span>
                <span className="block text-xs text-ink-500">{skin.tagline}</span>
              </span>
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full ring-1 ${skin.id === current.id ? 'bg-secondary-500 ring-secondary-500' : 'ring-ink-600'}`}
              >
                {skin.id === current.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </button>
          ))}
        </div>
      </Card>
    </>
  )
}

function AccountsSection({ health }: SectionProps) {
  return (
    <>
      <SectionHeader title="Accounts">Rally signs in with your existing CLI logins.</SectionHeader>
      <Card>
        <Row label="GitHub" description="Read from the gh CLI.">
          {health === null ? (
            <StatusText tone="pending">Checking…</StatusText>
          ) : health.githubLogin ? (
            <StatusText tone="ok">Signed in as {health.githubLogin}</StatusText>
          ) : (
            <StatusText tone="error">
              Not signed in. Run <code>gh auth login</code>.
            </StatusText>
          )}
        </Row>
        {health?.githubError && (
          <div className="px-4 pb-3 font-mono text-xs text-rose-300/80">{health.githubError}</div>
        )}
        <Row label="Claude Code" description="Uses your Claude Code login. System defaults come from ~/.claude/settings.json.">
          <span className="text-right text-xs text-ink-400">
            Model <span className="text-ink-200">{health?.claudeDefaults.model ?? 'not set'}</span>
            <br />
            Effort <span className="text-ink-200">{health?.claudeDefaults.effort ?? 'not set'}</span>
          </span>
        </Row>
      </Card>
    </>
  )
}

const FIELD_CLASS = 'rounded-md bg-ink-950/60 px-2.5 py-1.5 text-sm text-ink-100 outline-none ring-1 ring-ink-800 focus:ring-secondary-400/50'

function SectionHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1 pb-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-ink-400">{children}</p>
    </div>
  )
}

function Card({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && (
        <div className="px-1">
          <h3 className="text-sm font-medium text-ink-200">{title}</h3>
          {description && <p className="text-xs text-ink-500">{description}</p>}
        </div>
      )}
      <div className="divide-y divide-white/5 rounded-xl border border-white/5 bg-ink-900/60">{children}</div>
    </section>
  )
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink-100">{label}</div>
        {description && <div className="text-xs text-ink-500">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function StackedRow({ label, description, children }: { label: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2 px-4 py-3">
      <div>
        <div className="text-sm text-ink-100">{label}</div>
        <div className="text-xs text-ink-500">{description}</div>
      </div>
      {children}
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(checked: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-secondary-500' : 'bg-ink-700'}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}

const STATUS_TONES = {
  pending: { text: 'text-ink-400', dot: 'bg-ink-500' },
  ok: { text: 'text-emerald-300', dot: 'bg-emerald-400' },
  error: { text: 'text-rose-300', dot: 'bg-rose-400' },
}

function StatusText({ tone, children }: { tone: keyof typeof STATUS_TONES; children: ReactNode }) {
  return (
    <span className={`flex items-center gap-2 text-sm ${STATUS_TONES[tone].text}`}>
      <span className={`h-2 w-2 rounded-full ${STATUS_TONES[tone].dot}`} />
      {children}
    </span>
  )
}

function systemDefault(value: string | null | undefined): string {
  return value ? `System default (${value})` : 'System default'
}

interface ChoiceSelectProps<T extends ModelChoice | EffortChoice> {
  labels: Record<T, string>
  value: T | null
  defaultLabel: string
  onChange(value: T | null): void
}

function ChoiceSelect<T extends ModelChoice | EffortChoice>({ labels, value, defaultLabel, onChange }: ChoiceSelectProps<T>) {
  return (
    <select className={`${FIELD_CLASS} w-56`} value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as T | null)}>
      <option value="">{defaultLabel}</option>
      {(Object.keys(labels) as T[]).map((choice) => (
        <option key={choice} value={choice}>
          {labels[choice]}
        </option>
      ))}
    </select>
  )
}

function PullRequestIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4m0 0 2.5-2.5M11 6l2.5 2.5" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinejoin="round" d="M12 3c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7Z" />
      <path strokeLinecap="round" d="M19 16v4M17 18h4" />
    </svg>
  )
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path
        strokeLinejoin="round"
        d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z"
      />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7" r="1" fill="currentColor" />
      <circle cx="15" cy="7.5" r="1" fill="currentColor" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />
    </svg>
  )
}
