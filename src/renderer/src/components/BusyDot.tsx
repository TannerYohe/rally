export function BusyDot({ className }: { className: string }) {
  return <span className={`inline-block animate-pulse rounded-full ${className}`} />
}
