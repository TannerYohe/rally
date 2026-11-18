import { diffLineKind, splitDiffFiles, type DiffLine, type DiffLineKind } from '../lib/diff'

const LINE_STYLES: Record<DiffLineKind, string> = {
  hunk: 'text-secondary-300/80',
  add: 'bg-emerald-500/10 text-emerald-200',
  remove: 'bg-rose-500/10 text-rose-200',
  context: 'text-ink-400',
}

export function DiffView({ diff }: { diff: string }) {
  const files = splitDiffFiles(diff)
  if (files.length === 0) return <p className="py-4 text-center text-sm text-ink-500">No changes.</p>
  return (
    <div className="space-y-3">
      {files.map((file) => (
        <details key={file.path} open className="overflow-hidden rounded-lg border border-white/5 bg-ink-950">
          <summary className="cursor-pointer bg-ink-900 px-3 py-1.5 font-mono text-xs text-ink-200">{file.path}</summary>
          <DiffLines lines={file.lines.map((line) => ({ kind: diffLineKind(line), text: line || ' ' }))} />
        </details>
      ))}
    </div>
  )
}

/** Renders diff lines colored by kind; `className` styles the surrounding block. */
export function DiffLines({ lines, className = '' }: { lines: DiffLine[]; className?: string }) {
  return (
    <pre className={`overflow-x-auto text-xs leading-5 ${className}`}>
      {lines.map((line, index) => (
        <div key={index} className={`px-3 ${LINE_STYLES[line.kind]}`}>
          {line.text}
        </div>
      ))}
    </pre>
  )
}
