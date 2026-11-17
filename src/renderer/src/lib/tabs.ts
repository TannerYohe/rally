/** Returns the tab a roving-focus key moves to, or null for keys that don't move focus. */
export function tabForKey<T>(tabs: readonly T[], tab: T, key: string): T | null {
  const index = tabs.indexOf(tab)
  switch (key) {
    case 'ArrowRight':
      return tabs[(index + 1) % tabs.length]
    case 'ArrowLeft':
      return tabs[(index - 1 + tabs.length) % tabs.length]
    case 'Home':
      return tabs[0]
    case 'End':
      return tabs[tabs.length - 1]
    default:
      return null
  }
}
