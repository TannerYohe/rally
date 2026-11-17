import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type RallyApi } from '@shared/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: RallyApi = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  saveConfig: (config) => ipcRenderer.invoke(IPC.saveConfig, config),
  getHealth: () => ipcRenderer.invoke(IPC.getHealth),
  getPrs: (list) => ipcRenderer.invoke(IPC.getPrs, list),
  refreshPrs: (list) => ipcRenderer.invoke(IPC.refreshPrs, list),
  onPrsChanged: (listener) => subscribe(IPC.prsChanged, listener),
  hidePr: (list, id, mode) => ipcRenderer.invoke(IPC.hidePr, list, id, mode),
  unhidePr: (list, id) => ipcRenderer.invoke(IPC.unhidePr, list, id),
  getSession: (key) => ipcRenderer.invoke(IPC.getSession, key),
  startReview: (pr) => ipcRenderer.invoke(IPC.startReview, pr),
  sendFeedback: (id, message) => ipcRenderer.invoke(IPC.sendFeedback, id, message),
  submitReview: (id, event, changes, resolveThreadIds) => ipcRenderer.invoke(IPC.submitReview, id, event, changes, resolveThreadIds),
  getReviewThreads: (id) => ipcRenderer.invoke(IPC.getReviewThreads, id),
  resolveThreads: (id, threadIds) => ipcRenderer.invoke(IPC.resolveThreads, id, threadIds),
  cancelReview: (id) => ipcRenderer.invoke(IPC.cancelReview, id),
  discardSession: (id) => ipcRenderer.invoke(IPC.discardSession, id),
  onSessionChanged: (listener) => subscribe(IPC.sessionChanged, listener),
  getAuthorSession: (key) => ipcRenderer.invoke(IPC.getAuthorSession, key),
  getFeedbackItems: (pr) => ipcRenderer.invoke(IPC.getFeedbackItems, pr),
  acknowledgeFeedback: (pr, itemId) => ipcRenderer.invoke(IPC.acknowledgeFeedback, pr, itemId),
  runAuthorActions: (pr, requests, note) => ipcRenderer.invoke(IPC.runAuthorActions, pr, requests, note),
  startSelfReview: (pr) => ipcRenderer.invoke(IPC.startSelfReview, pr),
  sendAuthorFeedback: (id, message) => ipcRenderer.invoke(IPC.sendAuthorFeedback, id, message),
  cancelAuthorTurn: (id) => ipcRenderer.invoke(IPC.cancelAuthorTurn, id),
  getAuthorDiff: (id) => ipcRenderer.invoke(IPC.getAuthorDiff, id),
  pushAuthorCommits: (id) => ipcRenderer.invoke(IPC.pushAuthorCommits, id),
  resolveMergeConflicts: (id) => ipcRenderer.invoke(IPC.resolveMergeConflicts, id),
  abortMerge: (id) => ipcRenderer.invoke(IPC.abortMerge, id),
  discardUncommitted: (id) => ipcRenderer.invoke(IPC.discardUncommitted, id),
  postAuthorReplies: (id, replies, reRequestReviews) => ipcRenderer.invoke(IPC.postAuthorReplies, id, replies, reRequestReviews),
  discardAuthorReply: (id, itemId) => ipcRenderer.invoke(IPC.discardAuthorReply, id, itemId),
  dismissFinding: (id, itemId) => ipcRenderer.invoke(IPC.dismissFinding, id, itemId),
  discardAuthorSession: (id) => ipcRenderer.invoke(IPC.discardAuthorSession, id),
  onAuthorSessionChanged: (listener) => subscribe(IPC.authorSessionChanged, listener),
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  getFailedInstall: () => ipcRenderer.invoke(IPC.getFailedInstall),
  dismissFailedInstall: () => ipcRenderer.invoke(IPC.dismissFailedInstall),
  onUpdateChanged: (listener) => subscribe(IPC.updateChanged, listener),
}

contextBridge.exposeInMainWorld('rally', api)
