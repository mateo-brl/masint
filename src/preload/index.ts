import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ApiChannel, EventChannel, MasintBridge } from '@shared/api'

const bridge: MasintBridge = {
  invoke: (channel: ApiChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (event: EventChannel, listener: (payload: unknown) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file)
} as MasintBridge

contextBridge.exposeInMainWorld('masint', bridge)
