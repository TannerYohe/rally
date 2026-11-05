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
  getPrs: () => ipcRenderer.invoke(IPC.getPrs),
  refreshPrs: () => ipcRenderer.invoke(IPC.refreshPrs),
  onPrsChanged: (listener) => subscribe(IPC.prsChanged, listener),
  getSession: (key) => ipcRenderer.invoke(IPC.getSession, key),
  startReview: (pr) => ipcRenderer.invoke(IPC.startReview, pr),
  sendFeedback: (id, message) => ipcRenderer.invoke(IPC.sendFeedback, id, message),
  submitReview: (id, event, changes, resolveThreadIds) => ipcRenderer.invoke(IPC.submitReview, id, event, changes, resolveThreadIds),
  getReviewThreads: (id) => ipcRenderer.invoke(IPC.getReviewThreads, id),
  resolveThreads: (id, threadIds) => ipcRenderer.invoke(IPC.resolveThreads, id, threadIds),
  cancelReview: (id) => ipcRenderer.invoke(IPC.cancelReview, id),
  discardSession: (id) => ipcRenderer.invoke(IPC.discardSession, id),
  onSessionChanged: (listener) => subscribe(IPC.sessionChanged, listener),
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  getFailedInstall: () => ipcRenderer.invoke(IPC.getFailedInstall),
  dismissFailedInstall: () => ipcRenderer.invoke(IPC.dismissFailedInstall),
  onUpdateChanged: (listener) => subscribe(IPC.updateChanged, listener),
}

contextBridge.exposeInMainWorld('rally', api)
