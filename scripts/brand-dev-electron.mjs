// Renames the dev Electron.app bundle to Rally so the macOS dock and menu bar show the app name in `npm run dev`.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const APP_NAME = 'Rally'
const bundle = join(import.meta.dirname, '../node_modules/electron/dist/Electron.app')
const plist = join(bundle, 'Contents/Info.plist')

if (process.platform === 'darwin' && existsSync(plist)) {
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    execFileSync('plutil', ['-replace', key, '-string', APP_NAME, plist])
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'ignore' })
  execFileSync('touch', [bundle])
}
