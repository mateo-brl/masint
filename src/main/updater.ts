// Mises à jour automatiques depuis GitHub Releases (electron-updater). La nouvelle version est
// téléchargée en arrière-plan ; l'interface la propose dès qu'elle est prête, et elle
// s'installe de toute façon à la fermeture de MASINT.

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { releaseNotesText } from '@shared/releaseNotes'
import type { UpdateStatus } from '@shared/types'

const { autoUpdater } = electronUpdater

/** Nouvelle vérification tant que MASINT reste ouvert. */
const CHECK_INTERVAL = 4 * 60 * 60_000

let status: UpdateStatus = { state: 'idle' }
let notify: (s: UpdateStatus) => void = () => undefined

function set(next: UpdateStatus): void {
  status = next
  notify(status)
}

export function initUpdater(onStatus: (s: UpdateStatus) => void, isAuto: () => boolean): void {
  notify = onStatus
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => {
    // Une version déjà téléchargée reste proposée pendant une nouvelle vérification.
    if (status.state !== 'ready' && status.state !== 'downloading') set({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version, notes: releaseNotesText(info.releaseNotes) }))
  autoUpdater.on('update-not-available', () => {
    if (status.state !== 'ready') set({ state: 'none' })
  })
  autoUpdater.on('download-progress', (p) => set({ ...status, state: 'downloading', progress: p.percent }))
  autoUpdater.on('update-downloaded', (info) =>
    set({ state: 'ready', version: info.version, notes: releaseNotesText(info.releaseNotes) ?? status.notes })
  )
  autoUpdater.on('error', (err) => {
    if (status.state !== 'ready') set({ state: 'error', error: err?.message ?? String(err) })
  })
  const autoCheck = (): void => {
    if (isAuto() && status.state !== 'ready' && status.state !== 'downloading') void checkForUpdates()
  }
  setTimeout(autoCheck, 10_000)
  setInterval(autoCheck, CHECK_INTERVAL).unref()
}

/** État courant, pour l'interface qui démarre après un événement déjà envoyé. */
export function updateStatus(): UpdateStatus {
  return status
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
  // Installation sans assistant (Windows) puis relance de MASINT.
  if (status.state === 'ready') autoUpdater.quitAndInstall(true, true)
}
