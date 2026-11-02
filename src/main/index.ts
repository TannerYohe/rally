import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { prList } from './prList'
import { loadLoginShellPath } from './shellPath'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Rally',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return window
}

if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.whenReady().then(() => {
  loadLoginShellPath()
  registerIpc()
  createWindow()
  prList.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
