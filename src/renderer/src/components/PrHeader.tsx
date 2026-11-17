import { Link } from 'react-router-dom'
import type { Pr, PrListKind } from '@shared/types'
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
              {pr && <HideControls list={list} pr={pr} className="ml-auto" />}
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

      {pr && (
        <details className="rounded-xl border border-white/5 bg-ink-900/40 p-4">
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
      )}
    </>
  )
}
