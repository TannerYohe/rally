interface Props {
  value: string
  disabled: boolean
  placeholder?: string
  onChange(value: string): void
}

export function BodyTextarea({ value, disabled, placeholder, onChange }: Props) {
  return (
    <textarea
      className="w-full resize-y rounded border border-ink-800 bg-ink-950 p-2 font-mono text-sm text-ink-100 disabled:opacity-60"
      rows={Math.min(8, Math.max(2, Math.ceil(value.length / 90)))}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
