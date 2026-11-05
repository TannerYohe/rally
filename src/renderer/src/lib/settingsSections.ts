export const SETTINGS_ROOT = '/settings'

export const SETTINGS_SECTIONS = ['pull-requests', 'reviews', 'appearance', 'accounts', 'about'] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export function settingsPath(section: SettingsSection): string {
  return `${SETTINGS_ROOT}/${section}`
}

export function sectionFromParam(param: string | undefined): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s === param) ?? 'pull-requests'
}

export function blocksLeavingSettings(dirty: boolean, nextPathname: string): boolean {
  const staysInSettings = nextPathname === SETTINGS_ROOT || nextPathname.startsWith(`${SETTINGS_ROOT}/`)
  return dirty && !staysInSettings
}
