import type { RallyApi } from '@shared/ipc'

declare global {
  interface Window {
    rally: RallyApi
  }
}
