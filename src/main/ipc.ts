import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Config, Health, PrRef, ReviewEvent } from '@shared/types'
import { readClaudeDefaults } from './claude/claudeDefaults'
import { reviewSessions } from './claude/reviewSessions'
import { github, resetGithubClient } from './github/client'
import { classifyGithubFailure } from './github/failure'
import { prList } from './prList'
import { configFile } from './store'

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
}

async function health(): Promise<Health> {
  try {
    resetGithubClient()
    const gh = await github()
    return { githubLogin: gh.login, githubFailure: null, githubError: null, claudeDefaults: readClaudeDefaults() }
  } catch (error) {
    const githubError = error instanceof Error ? error.message : String(error)
    return { githubLogin: null, githubFailure: classifyGithubFailure(error), githubError, claudeDefaults: readClaudeDefaults() }
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
  ipcMain.handle(IPC.submitReview, (_event, id: string, event: ReviewEvent, notes: string, resolveThreadIds: string[]) =>
    reviewSessions.submit(id, event, notes, resolveThreadIds),
  )
  ipcMain.handle(IPC.getReviewThreads, (_event, id: string) => reviewSessions.threads(id))
  ipcMain.handle(IPC.resolveThreads, (_event, id: string, threadIds: string[]) => reviewSessions.resolveThreads(id, threadIds))
  ipcMain.handle(IPC.cancelReview, (_event, id: string) => reviewSessions.cancel(id))
  ipcMain.handle(IPC.discardSession, (_event, id: string) => reviewSessions.discard(id))

  prList.on('changed', (state) => broadcast(IPC.prsChanged, state))
  prList.setReviewStatusLookup((key) => reviewSessions.statusOf(key))
  reviewSessions.on('changed', (session) => {
    broadcast(IPC.sessionChanged, session)
    prList.reapplyPhases()
  })
  reviewSessions.on('removed', () => prList.reapplyPhases())
}
