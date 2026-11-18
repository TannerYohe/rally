import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { unitHide, unitPhase } from '@shared/prUnit'
import { REVIEW_PHASE_ORDER, type Pr, type PrListKind } from '@shared/types'
import { age } from '../lib/format'
import { LIST_ROOTS } from '../lib/routes'
import { PHASE_THEME } from '../lib/theme'
import { Avatar } from './Avatar'
import { DiffStat } from './DiffStat'
import { HideControls } from './HideControls'
import { Markdown } from './Markdown'
import { PhaseBadge } from './PhaseBadge'
import { RepoChip } from './RepoChip'

const BACK_LABELS: Record<PrListKind, string> = {
  reviewing: '← All PRs',
  authored: '← My PRs',
}

interface Props {
  list: PrListKind
  pr: Pr | undefined
  title: string
  repo: string
  number: number
  url: string
}

export function PrHeader({ list, pr, title, repo, number, url }: Props) {
  return (
    <>
      <div>
        <Link to={LIST_ROOTS[list]} className="text-xs text-ink-500 hover:text-ink-300">
          {BACK_LABELS[list]}
        </Link>
        <div className="mt-3 flex items-start gap-4">
          {pr && <Avatar login={pr.author} url={pr.authorAvatarUrl} ringClass={PHASE_THEME[pr.phase].ring} />}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start gap-3">
              <h1 className="min-w-0 flex-1 text-xl font-semibold">{pr?.title ?? title}</h1>
              {pr && <PhaseBadge phase={pr.phase} />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-400">
              <RepoChip repo={repo} number={number} />
              {pr && (
                <>
                  <span>
                    by <span className="text-ink-200">{pr.author}</span>
                  </span>
                  <span>opened {age(pr.createdAt)} ago</span>
                  <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFiles} />
                </>
              )}
              <a className="text-primary-400 hover:text-primary-300" href={url} target="_blank" rel="noreferrer">
                Open on GitHub ↗
              </a>
              {pr && <HideControls list={list} ids={[pr.id]} hidden={pr.hidden} phase={pr.phase} className="ml-auto" />}
            </div>
          </div>
        </div>
        {pr?.summary && (
          <p className="mt-4 rounded-lg bg-secondary-500/5 px-4 py-3 text-sm text-ink-300 ring-1 ring-secondary-500/20">
            <span className="mr-2 text-secondary-400">✦</span>
            {pr.summary}
          </p>
        )}
      </div>

      {pr && <DescriptionAndFiles pr={pr} />}
    </>
  )
}

function DescriptionAndFiles({ pr, className = 'rounded-xl border border-white/5 bg-ink-900/40 p-4' }: { pr: Pr; className?: string }) {
  return (
    <details className={className}>
      <summary className="cursor-pointer text-sm font-semibold">Description and files</summary>
      <div className="mt-3 space-y-4">
        <Markdown>{pr.body || '_No description._'}</Markdown>
        <ul className="space-y-0.5 font-mono text-xs text-ink-400">
          {pr.files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      </div>
    </details>
  )
}

function MemberHeader({ pr, actions }: { pr: Pr; actions?: ReactNode }) {
  return (
    <li className="space-y-2 rounded-xl border border-white/5 bg-ink-900/40 p-3">
      <div className="flex items-center gap-3">
        <Avatar login={pr.author} url={pr.authorAvatarUrl} size="sm" ringClass={PHASE_THEME[pr.phase].ring} />
        <RepoChip repo={pr.repo} number={pr.number} />
        <span className="min-w-0 flex-1 truncate font-medium">{pr.title}</span>
        <PhaseBadge phase={pr.phase} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-400">
        <span>
          by <span className="text-ink-200">{pr.author}</span>
        </span>
        <span>opened {age(pr.createdAt)} ago</span>
        <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFiles} />
        {pr.companion && <span title="Listed because a PR in your queue is linked with it">not in your queue</span>}
        <a className="text-primary-400 hover:text-primary-300" href={pr.url} target="_blank" rel="noreferrer">
          Open on GitHub ↗
        </a>
        {actions && <span className="ml-auto">{actions}</span>}
      </div>
      {pr.summary && (
        <p className="text-sm text-ink-300">
          <span className="mr-2 text-secondary-400">✦</span>
          {pr.summary}
        </p>
      )}
      <DescriptionAndFiles pr={pr} className="text-ink-300" />
    </li>
  )
}

interface UnitHeaderProps {
  members: Pr[]
  /** Controls shown on each member's row, such as Unlink. */
  memberActions?(pr: Pr): ReactNode
}

/** Heads the page of a PR reviewed together with its linked PRs, with a compact header per PR and Snooze and Hide for all of them. */
export function UnitHeader({ members, memberActions }: UnitHeaderProps) {
  const phase = unitPhase(members, REVIEW_PHASE_ORDER)
  return (
    <div>
      <Link to={LIST_ROOTS.reviewing} className="text-xs text-ink-500 hover:text-ink-300">
        {BACK_LABELS.reviewing}
      </Link>
      <div className="mt-3 flex items-center gap-3">
        <h1 className="min-w-0 flex-1 text-xl font-semibold">{members.length} linked PRs</h1>
        <HideControls list="reviewing" ids={members.map((pr) => pr.id)} hidden={unitHide(members)} phase={phase} />
        <PhaseBadge phase={phase} />
      </div>
      <ul className="mt-3 space-y-2">
        {members.map((pr) => (
          <MemberHeader key={pr.id} pr={pr} actions={memberActions?.(pr)} />
        ))}
      </ul>
    </div>
  )
}
