// Mises à jour automatiques depuis GitHub Releases (electron-updater).

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

const { autoUpdater } = electronUpdater

let status: UpdateStatus = { state: 'idle' }
let notify: (s: UpdateStatus) => void = () => undefined

function set(next: UpdateStatus): void {
  status = next
  notify(status)
}

export function initUpdater(onStatus: (s: UpdateStatus) => void, auto: boolean): void {
  notify = onStatus
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => set({ ...status, state: 'downloading', progress: p.percent }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => set({ state: 'error', error: err?.message ?? String(err) }))
  if (auto) setTimeout(() => void checkForUpdates(), 10_000)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return { state: 'none', error: 'dev' }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', error: e instanceof Error ? e.message : String(e) })
  }
  return status
}

export function installUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall()
}
