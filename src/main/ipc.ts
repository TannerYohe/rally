import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Config, Health, PrRef, ReviewEvent } from '@shared/types'
import { reviewSessions } from './claude/reviewSessions'
import { github, resetGithubClient } from './github/client'
import { prList } from './prList'
import { configFile } from './store'

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
}

async function health(): Promise<Health> {
  try {
    resetGithubClient()
    const gh = await github()
    return { githubLogin: gh.login, githubError: null }
  } catch (error) {
    return { githubLogin: null, githubError: error instanceof Error ? error.message : String(error) }
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC.getConfig, () => configFile.get())
  ipcMain.handle(IPC.saveConfig, (_event, config: Config) => {
    configFile.set(config)
    prList.schedule()
    void prList.refresh()
  })
  ipcMain.handle(IPC.getHealth, () => health())
  ipcMain.handle(IPC.getPrs, () => prList.get())
  ipcMain.handle(IPC.refreshPrs, () => prList.refresh())
  ipcMain.handle(IPC.getSession, (_event, key: string) => reviewSessions.getByPr(key))
  ipcMain.handle(IPC.startReview, (_event, pr: PrRef) => reviewSessions.start(pr))
  ipcMain.handle(IPC.sendFeedback, (_event, id: string, message: string) => reviewSessions.feedback(id, message))
  ipcMain.handle(IPC.submitReview, (_event, id: string, event: ReviewEvent, notes: string) =>
    reviewSessions.submit(id, event, notes),
  )
  ipcMain.handle(IPC.cancelReview, (_event, id: string) => reviewSessions.cancel(id))
  ipcMain.handle(IPC.discardSession, (_event, id: string) => reviewSessions.discard(id))

  prList.on('changed', (state) => broadcast(IPC.prsChanged, state))
  reviewSessions.on('changed', (session) => broadcast(IPC.sessionChanged, session))
}
