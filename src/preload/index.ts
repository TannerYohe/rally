import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('rally', {})
