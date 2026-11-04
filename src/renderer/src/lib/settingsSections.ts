export const SETTINGS_SECTIONS = ['pull-requests', 'reviews', 'accounts'] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export function settingsPath(section: SettingsSection): string {
  return `/settings/${section}`
}

export function sectionFromParam(param: string | undefined): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s === param) ?? 'pull-requests'
}

export function blocksLeavingSettings(dirty: boolean, nextPathname: string): boolean {
  const staysInSettings = nextPathname === '/settings' || nextPathname.startsWith('/settings/')
  return dirty && !staysInSettings
}
