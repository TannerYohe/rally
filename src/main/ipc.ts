import { BrowserWindow, ipcMain } from 'electron'
import type { DraftChanges } from '@shared/feedback'
import { IPC } from '@shared/ipc'
import type { ActionRequest, Config, Health, HideMode, PrListKind, PrRef, ReplyPost, ReviewEvent } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { readClaudeDefaults } from './claude/claudeDefaults'
import { authorSessions } from './claude/authorSessions'
import { reviewSessions } from './claude/reviewSessions'
import { fetchFeedbackItems } from './github/authorFeedback'
import { github, resetGithubClient } from './github/client'
import { classifyGithubFailure } from './github/failure'
import { authoredPrList, prList, prLists } from './prList'
import { connectSoundCues } from './soundCues'
import { configFile } from './store'
import { appInfo, updater } from './update/updater'

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
}

async function health(): Promise<Health> {
  try {
    resetGithubClient()
    const gh = await github()
    return { githubLogin: gh.login, githubFailure: null, githubError: null, claudeDefaults: readClaudeDefaults() }
  } catch (error) {
    const githubError = errorMessage(error)
    return { githubLogin: null, githubFailure: classifyGithubFailure(error), githubError, claudeDefaults: readClaudeDefaults() }
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC.getConfig, () => configFile.get())
  ipcMain.handle(IPC.saveConfig, (_event, config: Config) => {
    configFile.set(config)
    for (const list of Object.values(prLists)) list.schedule()
    void prList.refresh()
  })
  ipcMain.handle(IPC.getHealth, () => health())
  ipcMain.handle(IPC.getPrs, (_event, list: PrListKind) => prLists[list].get())
  ipcMain.handle(IPC.refreshPrs, (_event, list: PrListKind) => prLists[list].refresh())
  ipcMain.handle(IPC.hidePr, (_event, list: PrListKind, id: string, mode: HideMode) => prLists[list].hide(id, mode))
  ipcMain.handle(IPC.unhidePr, (_event, list: PrListKind, id: string) => prLists[list].unhide(id))
  ipcMain.handle(IPC.getSession, (_event, key: string) => reviewSessions.open(key))
  ipcMain.handle(IPC.startReview, (_event, pr: PrRef) => reviewSessions.start(pr))
  ipcMain.handle(IPC.sendFeedback, (_event, id: string, message: string) => reviewSessions.feedback(id, message))
  ipcMain.handle(IPC.submitReview, (_event, id: string, event: ReviewEvent, changes: DraftChanges, resolveThreadIds: string[]) =>
    reviewSessions.submit(id, event, changes, resolveThreadIds),
  )
  ipcMain.handle(IPC.getReviewThreads, (_event, id: string) => reviewSessions.threads(id))
  ipcMain.handle(IPC.resolveThreads, (_event, id: string, threadIds: string[]) => reviewSessions.resolveThreads(id, threadIds))
  ipcMain.handle(IPC.cancelReview, (_event, id: string) => reviewSessions.cancel(id))
  ipcMain.handle(IPC.discardSession, (_event, id: string) => reviewSessions.discard(id))
  ipcMain.handle(IPC.getAuthorSession, (_event, key: string) => authorSessions.getByPr(key))
  ipcMain.handle(IPC.getFeedbackItems, (_event, pr: PrRef) => fetchFeedbackItems(pr))
  ipcMain.handle(IPC.acknowledgeFeedback, (_event, pr: PrRef, itemId: string) => authorSessions.acknowledge(pr, itemId))
  ipcMain.handle(IPC.runAuthorActions, (_event, pr: PrRef, requests: ActionRequest[], note: string) =>
    authorSessions.runActions(pr, requests, note),
  )
  ipcMain.handle(IPC.startSelfReview, (_event, pr: PrRef) => authorSessions.selfReview(pr))
  ipcMain.handle(IPC.sendAuthorFeedback, (_event, id: string, message: string) => authorSessions.feedback(id, message))
  ipcMain.handle(IPC.cancelAuthorTurn, (_event, id: string) => authorSessions.cancel(id))
  ipcMain.handle(IPC.getAuthorDiff, (_event, id: string) => authorSessions.diff(id))
  ipcMain.handle(IPC.getUncommittedDiff, (_event, id: string) => authorSessions.uncommittedDiff(id))
  ipcMain.handle(IPC.pushAuthorCommits, (_event, id: string) => authorSessions.push(id))
  ipcMain.handle(IPC.resolveMergeConflicts, (_event, id: string) => authorSessions.resolveConflicts(id))
  ipcMain.handle(IPC.abortMerge, (_event, id: string) => authorSessions.abortMerge(id))
  ipcMain.handle(IPC.discardUncommitted, (_event, id: string) => authorSessions.discardUncommitted(id))
  ipcMain.handle(IPC.commitUncommitted, (_event, id: string, message: string) => authorSessions.commitUncommitted(id, message))
  ipcMain.handle(IPC.postAuthorReplies, (_event, id: string, replies: ReplyPost[], reRequestReviews: boolean) =>
    authorSessions.postReplies(id, replies, reRequestReviews),
  )
  ipcMain.handle(IPC.discardAuthorReply, (_event, id: string, itemId: string) => authorSessions.discardReply(id, itemId))
  ipcMain.handle(IPC.clearFindings, (_event, id: string, itemIds: string[]) => authorSessions.clearFindings(id, itemIds))
  ipcMain.handle(IPC.discardAuthorSession, (_event, id: string) => authorSessions.discard(id))
  ipcMain.handle(IPC.getAppInfo, () => appInfo())
  ipcMain.handle(IPC.getUpdateState, () => updater.get())
  ipcMain.handle(IPC.checkForUpdates, () => updater.check())
  ipcMain.handle(IPC.installUpdate, () => updater.install())
  ipcMain.handle(IPC.getFailedInstall, () => updater.failedInstall())
  ipcMain.handle(IPC.dismissFailedInstall, () => updater.dismissFailedInstall())

  for (const list of Object.values(prLists)) {
    list.on('changed', (state) => broadcast(IPC.prsChanged, { list: list.kind, state }))
  }
  connectSoundCues(
    { reviewing: { list: prList, sessions: reviewSessions }, authored: { list: authoredPrList, sessions: authorSessions } },
    () => configFile.get(),
    (playback) => broadcast(IPC.soundCue, playback),
  )
  reviewSessions.on('changed', (session) => {
    broadcast(IPC.sessionChanged, session)
    prList.reapplyPhases()
  })
  reviewSessions.on('removed', () => prList.reapplyPhases())
  authoredPrList.addPruner((listed) => authorSessions.pruneUnlisted(listed))
  authorSessions.on('changed', (session) => {
    broadcast(IPC.authorSessionChanged, session)
    authoredPrList.reapplyPhases()
  })
  authorSessions.on('removed', () => authoredPrList.reapplyPhases())
  updater.on('changed', (state) => broadcast(IPC.updateChanged, state))
}
