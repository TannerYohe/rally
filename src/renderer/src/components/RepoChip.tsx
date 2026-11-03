import { repoChipClass } from '../lib/theme'

export function RepoChip({ repo, number }: { repo: string; number: number }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] ring-1 ${repoChipClass(repo)}`}>
      {repo}
      <span className="ml-1 opacity-60">#{number}</span>
    </span>
  )
}
