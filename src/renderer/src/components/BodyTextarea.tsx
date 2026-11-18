interface Props {
  value: string
  disabled: boolean
  placeholder?: string
  maxRows?: number
  onChange(value: string): void
}

/** Returns enough rows for the text's lines and its wrapped length, between 2 and maxRows. */
function rowsFor(value: string, maxRows: number): number {
  return Math.min(maxRows, Math.max(2, value.split('\n').length, Math.ceil(value.length / 90)))
}

export function BodyTextarea({ value, disabled, placeholder, maxRows = 8, onChange }: Props) {
  return (
    <textarea
      className="w-full resize-y rounded border border-ink-800 bg-ink-950 p-2 font-mono text-sm text-ink-100 disabled:opacity-60"
      rows={rowsFor(value, maxRows)}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
