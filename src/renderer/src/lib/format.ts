const UNITS: [number, string][] = [
  [365 * 24 * 60, 'y'],
  [30 * 24 * 60, 'mo'],
  [7 * 24 * 60, 'w'],
  [24 * 60, 'd'],
  [60, 'h'],
  [1, 'm'],
]

export function age(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  const [size, unit] = UNITS.find(([size]) => minutes >= size) ?? [1, 'm']
  return `${Math.floor(minutes / size)}${unit}`
}

export function usd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function clockTime(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return time
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString()
}
