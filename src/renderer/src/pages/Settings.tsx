import { useEffect, useState, type ReactNode } from 'react'
import { Link, useBlocker, useParams } from 'react-router-dom'
import {
  DEFAULT_CONFIG,
  type AppInfo,
  EFFORT_LABELS,
  MODEL_LABELS,
  type Config,
  type EffortChoice,
  type Health,
  type ModelChoice,
  type ReleaseInfo,
  type UpdateState,
} from '@shared/types'
import logo from '../../../../resources/icon.svg'
import { Avatar } from '../components/Avatar'
import { Switch } from '../components/Switch'
import { TagInput } from '../components/TagInput'
import { Markdown } from '../components/Markdown'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { clockTime, megabytes } from '../lib/format'
import { useUpdateState } from '../lib/hooks'
import { blocksLeavingSettings, sectionFromParam, SETTINGS_SECTIONS, settingsPath, type SettingsSection } from '../lib/settingsSections'
import { SKIN_IDS, SKINS, parseSkinId, useSkinPreview } from '../lib/skins'
import { PRIMARY_BUTTON_CLASS } from '../lib/theme'

const SECTION_NAV: Record<SettingsSection, { label: string; icon: ReactNode }> = {
  'pull-requests': { label: 'Pull requests', icon: <PullRequestIcon /> },
  reviews: { label: 'Reviews', icon: <SparkleIcon /> },
  appearance: { label: 'Appearance', icon: <PaletteIcon /> },
  accounts: { label: 'Accounts', icon: <PersonIcon /> },
  about: { label: 'About', icon: <InfoIcon /> },
}

const REPO_URL = 'https://github.com/TannerYohe/rally'

export function Settings() {
  const section = sectionFromParam(useParams().section)
  const [savedConfig, setSavedConfig] = useState<Config | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    window.rally.getConfig().then((c) => {
      const loaded = { ...c, skin: parseSkinId(c.skin) }
      setSavedConfig(loaded)
      setConfig(loaded)
    })
    window.rally.getHealth().then(setHealth)
  }, [])

  const markSkinSaved = useSkinPreview(config?.skin, savedConfig?.skin)

  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig)
  const blocker = useBlocker(({ nextLocation }) => blocksLeavingSettings(dirty, nextLocation.pathname))

  if (!config || !savedConfig) return null

  const edit = (next: Config) => {
    setConfig(next)
    setSaveError(null)
  }
  const save = async (): Promise<string | null> => {
    try {
      await window.rally.saveConfig(config)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(message)
      return message
    }
    setSaveError(null)
    setSavedConfig(config)
    markSkinSaved(config.skin)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 2000)
    return null
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-white/5 bg-ink-950/40 p-3">
        <Link to="/" className="mb-3 px-2.5 pt-1 text-xs text-ink-500 hover:text-ink-300">
          ← All PRs
        </Link>
        <h1 className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Settings</h1>
        {SETTINGS_SECTIONS.map((id) => (
          <Link
            key={id}
            to={settingsPath(id)}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition ${id === section ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100'}`}
          >
            {SECTION_NAV[id].icon}
            {SECTION_NAV[id].label}
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="max-w-2xl space-y-5 px-10 py-8">
            <SectionBody section={section} config={config} health={health} onChange={edit} />
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-white/5 bg-ink-950/70 px-10 py-3 text-sm backdrop-blur">
          <SaveStatus error={saveError} dirty={dirty} justSaved={justSaved} />
          <button
            className="ml-auto rounded-md px-3 py-1.5 text-ink-400 hover:text-ink-100 disabled:invisible"
            disabled={!dirty}
            onClick={() => edit(savedConfig)}
          >
            Discard
          </button>
          <button
            className={`px-4 py-1.5 transition ${dirty ? PRIMARY_BUTTON_CLASS : 'rounded-md bg-ink-800 font-medium text-ink-400 hover:text-ink-200'}`}
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

function SaveStatus({ error, dirty, justSaved }: { error: string | null; dirty: boolean; justSaved: boolean }) {
  if (error) return <span className="min-w-0 truncate text-rose-300" title={error}>Couldn't save: {error}</span>
  if (dirty) {
    return (
      <span className="flex items-center gap-2 text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Unsaved changes
      </span>
    )
  }
  if (justSaved) return <span className="text-emerald-300">Saved. Refreshing PRs…</span>
  return null
}

interface SectionProps {
  config: Config
  health: Health | null
  onChange(config: Config): void
}

function SectionBody({ section, ...props }: SectionProps & { section: SettingsSection }) {
  switch (section) {
    case 'pull-requests':
      return <PullRequestsSection {...props} />
    case 'reviews':
      return <ReviewsSection {...props} />
    case 'appearance':
      return <AppearanceSection {...props} />
    case 'accounts':
      return <AccountsSection {...props} />
    case 'about':
      return <AboutSection />
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
      <ModelEffortCard
        title="Review session"
        description="The main Claude session that runs the skill and drafts the review."
        model={config.reviewModel}
        effort={config.reviewEffort}
        modelDefault={systemDefault(health?.claudeDefaults.model)}
        effortDefault={systemDefault(health?.claudeDefaults.effort)}
        onModelChange={(reviewModel) => onChange({ ...config, reviewModel })}
        onEffortChange={(reviewEffort) => onChange({ ...config, reviewEffort })}
      />
      <ModelEffortCard
        title="Subagents"
        description="Reviewer subagents the skill fans out to."
        model={config.subagentModel}
        effort={config.subagentEffort}
        modelDefault={systemDefault('inherits')}
        effortDefault={systemDefault(null)}
        onModelChange={(subagentModel) => onChange({ ...config, subagentModel })}
        onEffortChange={(subagentEffort) => onChange({ ...config, subagentEffort })}
      />
    </>
  )
}

function AppearanceSection({ config, onChange }: SectionProps) {
  return (
    <>
      <SectionHeader title="Appearance">A skin changes Rally's colors and backdrop. Picking one previews it until you save or discard.</SectionHeader>
      <Card title="Skin">
        <div role="radiogroup" aria-label="Skin" className="divide-y divide-white/5">
          {SKIN_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === config.skin}
              onClick={() => onChange({ ...config, skin: id })}
              className={`flex w-full items-center gap-4 px-4 py-3 text-left transition first:rounded-t-xl last:rounded-b-xl ${id === config.skin ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
            >
              {SKINS[id].mark ? <span className="w-7 text-center text-2xl">{SKINS[id].mark}</span> : <img src={logo} alt="" className="h-7 w-7" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink-100">{SKINS[id].name}</span>
                <span className="block text-xs text-ink-500">{SKINS[id].tagline}</span>
              </span>
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full ring-1 ${id === config.skin ? 'bg-secondary-500 ring-secondary-500' : 'ring-ink-600'}`}
              >
                {id === config.skin && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
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
          <GithubStatus health={health} />
        </Row>
        {health?.githubError && (
          <div className="px-4 pb-3 font-mono text-xs text-rose-300/80">{health.githubError}</div>
        )}
        <Row label="Claude Code" description="Uses your Claude Code login. System defaults come from ~/.claude/settings.json.">
          {health === null ? (
            <StatusText tone="pending">Checking…</StatusText>
          ) : (
            <span className="text-right text-xs text-ink-400">
              Model <span className="text-ink-200">{health.claudeDefaults.model ?? 'not set'}</span>
              <br />
              Effort <span className="text-ink-200">{health.claudeDefaults.effort ?? 'not set'}</span>
            </span>
          )}
        </Row>
      </Card>
    </>
  )
}

function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const update = useUpdateState()

  useEffect(() => {
    window.rally.getAppInfo().then(setInfo)
  }, [])

  if (!info) return null

  return (
    <>
      <div className="flex items-center gap-4 pb-1">
        <img src={logo} alt="" className="h-14 w-14" />
        <div>
          <h2 className="text-lg font-semibold">Rally</h2>
          <p className="text-sm text-ink-400">Version {info.version}</p>
        </div>
      </div>
      <Card title="Updates" description="Rally checks GitHub releases when you ask.">
        <UpdateRow state={update} currentVersion={info.version} />
        {update.status === 'available' && <ReleaseNotes release={update.release} />}
      </Card>
      <Card title="Details">
        <InfoRow label="Electron" value={info.electron} />
        <InfoRow label="Chromium" value={info.chrome} />
        <InfoRow label="Node.js" value={info.node} />
        <InfoRow label="Platform" value={info.platform} />
        <InfoRow label="Data folder" value={info.userDataDir} />
      </Card>
      <p className="flex gap-4 px-1 text-xs">
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-secondary-300 hover:underline">
          GitHub
        </a>
        <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer" className="text-secondary-300 hover:underline">
          Releases
        </a>
        <a href={`${REPO_URL}/blob/main/LICENSE.md`} target="_blank" rel="noreferrer" className="text-secondary-300 hover:underline">
          License
        </a>
      </p>
    </>
  )
}

const SECONDARY_BUTTON_CLASS = 'rounded-md bg-ink-800 px-3 py-1.5 text-sm hover:bg-ink-700 disabled:opacity-40'

function UpdateRow({ state, currentVersion }: { state: UpdateState; currentVersion: string }) {
  const check = () => window.rally.checkForUpdates()
  const install = () => window.rally.installUpdate()
  switch (state.status) {
    case 'idle':
      return (
        <Row label="Check for updates" description={`You have Rally ${currentVersion}.`}>
          <button className={SECONDARY_BUTTON_CLASS} onClick={check}>
            Check for updates
          </button>
        </Row>
      )
    case 'checking':
      return (
        <Row label="Check for updates" description={`You have Rally ${currentVersion}.`}>
          <StatusText tone="pending">Checking…</StatusText>
        </Row>
      )
    case 'up_to_date':
      return (
        <Row label="Rally is up to date" description={`Checked ${clockTime(state.checkedAt)}.`}>
          <button className={SECONDARY_BUTTON_CLASS} onClick={check}>
            Check again
          </button>
        </Row>
      )
    case 'available':
      return (
        <Row
          label={`Rally ${state.release.version} is available`}
          description={
            state.installBlocker ??
            `You have ${currentVersion}. Rally quits and reopens to install it. A running Claude turn stops; send feedback to resume it.`
          }
        >
          <button className={`px-3 py-1.5 text-sm ${PRIMARY_BUTTON_CLASS}`} disabled={state.installBlocker !== null} onClick={install}>
            Download and install
          </button>
        </Row>
      )
    case 'downloading':
      return (
        <Row label={`Downloading Rally ${state.release.version}`} description={`${megabytes(state.received)} of ${megabytes(state.total)}`}>
          <ProgressBar fraction={state.received / state.total} />
        </Row>
      )
    case 'installing':
      return (
        <Row label={`Installing Rally ${state.release.version}`} description="Rally quits and reopens on the new version.">
          <StatusText tone="pending">Installing…</StatusText>
        </Row>
      )
    case 'error':
      return (
        <Row label={state.release ? `Couldn't install Rally ${state.release.version}` : "Couldn't check for updates"} description={state.error}>
          <button className={SECONDARY_BUTTON_CLASS} onClick={state.release ? install : check}>
            Try again
          </button>
        </Row>
      )
  }
}

function ProgressBar({ fraction }: { fraction: number }) {
  const percent = Math.min(100, Math.round(fraction * 100))
  return (
    <div className="flex w-48 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-ink-400">{percent}%</span>
    </div>
  )
}

function ReleaseNotes({ release }: { release: ReleaseInfo }) {
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-500">What's new</span>
        <a href={release.url} target="_blank" rel="noreferrer" className="text-xs text-secondary-300 hover:underline">
          View release on GitHub
        </a>
      </div>
      {release.notes ? (
        <div className="max-h-64 overflow-auto [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-ink-400">
          <Markdown>{release.notes}</Markdown>
        </div>
      ) : (
        <p className="text-xs text-ink-500">This release has no notes.</p>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-6 px-4 py-2.5">
      <div className="w-28 shrink-0 text-sm text-ink-400">{label}</div>
      <div className="min-w-0 flex-1 select-text break-all font-mono text-xs text-ink-200">{value}</div>
    </div>
  )
}

function GithubStatus({ health }: { health: Health | null }) {
  if (health === null) return <StatusText tone="pending">Checking…</StatusText>
  if (health.githubLogin) return <StatusText tone="ok">Signed in as {health.githubLogin}</StatusText>
  switch (health.githubFailure) {
    case 'gh_missing':
      return (
        <StatusText tone="error">
          gh CLI not found. Install it and run <code>gh auth login</code>.
        </StatusText>
      )
    case 'signed_out':
      return (
        <StatusText tone="error">
          Not signed in. Run <code>gh auth login</code>.
        </StatusText>
      )
    default:
      return <StatusText tone="error">Couldn't reach GitHub</StatusText>
  }
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

interface ModelEffortCardProps {
  title: string
  description: string
  model: ModelChoice | null
  effort: EffortChoice | null
  modelDefault: string
  effortDefault: string
  onModelChange(model: ModelChoice | null): void
  onEffortChange(effort: EffortChoice | null): void
}

function ModelEffortCard({ title, description, model, effort, modelDefault, effortDefault, onModelChange, onEffortChange }: ModelEffortCardProps) {
  return (
    <Card title={title} description={description}>
      <Row label="Model">
        <ChoiceSelect labels={MODEL_LABELS} value={model} defaultLabel={modelDefault} onChange={onModelChange} />
      </Row>
      <Row label="Effort">
        <ChoiceSelect labels={EFFORT_LABELS} value={effort} defaultLabel={effortDefault} onChange={onEffortChange} />
      </Row>
    </Card>
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

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 11v5" />
      <circle cx="12" cy="7.75" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
