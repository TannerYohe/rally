const BLOCKS = 5

export function DiffStat({ additions, deletions, files }: { additions: number; deletions: number; files: number }) {
  const total = additions + deletions
  const green = total ? Math.round((additions / total) * BLOCKS) : 0
  const red = total ? BLOCKS - green : 0
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
      <span className="text-emerald-400">+{additions}</span>
      <span className="text-rose-400">−{deletions}</span>
      <span className="flex gap-px">
        {Array.from({ length: BLOCKS }, (_, i) => (
          <span
            key={i}
            className={`h-2 w-2 rounded-[2px] ${i < green ? 'bg-emerald-500' : i < green + red ? 'bg-rose-500' : 'bg-zinc-700'}`}
          />
        ))}
      </span>
      <span className="text-zinc-500">
        {files} file{files === 1 ? '' : 's'}
      </span>
    </span>
  )
}
