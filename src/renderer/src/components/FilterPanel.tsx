import type { ReactNode } from 'react'
import type { Pr } from '@shared/types'
import { filterOptions, repoName, type DraftFilter, type PrFilters } from '../lib/prFilters'
import { repoChipClass } from '../lib/theme'
import { Avatar } from './Avatar'

const DRAFT_OPTIONS: { value: DraftFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready for review' },
  { value: 'draft', label: 'Drafts' },
]

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

interface Props {
  prs: Pr[]
  filters: PrFilters
  onChange(filters: PrFilters): void
}

export function FilterPanel({ prs, filters, onChange }: Props) {
  const avatars = new Map(prs.map((pr) => [pr.author, pr.authorAvatarUrl]))
  const authors = filterOptions(prs, (pr) => pr.author, filters.authors)
  const repos = filterOptions(prs, repoName, filters.repos)

  return (
    <div className="space-y-4 rounded-xl border border-white/5 bg-ink-900/60 p-4">
      <FilterRow label="Author">
        {authors.map(({ value, count }) => {
          const selected = filters.authors.includes(value)
          return (
            <button
              key={value}
              onClick={() => onChange({ ...filters, authors: toggleValue(filters.authors, value) })}
              className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs ring-1 transition ${selected ? 'bg-primary-400/15 text-primary-100 ring-primary-400/50' : 'text-ink-400 ring-ink-800 hover:text-ink-200 hover:ring-ink-700'}`}
            >
              <Avatar login={value} url={avatars.get(value) ?? null} size="sm" ringClass={selected ? 'ring-primary-400/50' : 'ring-transparent'} />
              {value}
              <span className="opacity-60">{count}</span>
            </button>
          )
        })}
      </FilterRow>

      <FilterRow label="Repo">
        {repos.map(({ value, count }) => {
          const selected = filters.repos.includes(value)
          return (
            <button
              key={value}
              onClick={() => onChange({ ...filters, repos: toggleValue(filters.repos, value) })}
              className={`rounded-md px-2 py-0.5 font-mono text-[11px] ring-1 transition ${selected ? `${repoChipClass(value.split('/')[1])} ring-2` : 'text-ink-400 ring-ink-800 hover:text-ink-200 hover:ring-ink-700'}`}
            >
              {value.split('/')[1]}
              <span className="ml-1.5 opacity-60">{count}</span>
            </button>
          )
        })}
      </FilterRow>

      <FilterRow label="Status">
        <div className="inline-flex rounded-lg bg-ink-950 p-0.5 ring-1 ring-ink-800">
          {DRAFT_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => onChange({ ...filters, draft: option.value })}
              className={`rounded-md px-3 py-1 text-xs transition ${filters.draft === option.value ? 'bg-secondary-500/20 text-secondary-100' : 'text-ink-400 hover:text-ink-200'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </FilterRow>
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="w-14 shrink-0 pt-1 text-xs font-medium uppercase tracking-wide text-ink-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}
