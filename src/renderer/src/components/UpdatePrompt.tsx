import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import { api } from '../lib/api'
import { loadPref, savePref } from '../lib/prefs'
import { useApp } from '../store/app'
import { Button, Dialog } from './ui'

/** Fenêtre de mise à jour : ouverte d'elle-même quand une version est prête, ou depuis le rail. */
export const useUpdatePrompt = create<{ open: boolean; show(): void; hide(): void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))

const DISMISSED = 'update:dismissed'

/**
 * Propose la nouvelle version dès qu'elle est téléchargée, avec ses notes. « Plus tard » ne la
 * repropose plus d'elle-même (elle reste accessible depuis le rail et s'installe à la fermeture).
 */
export function UpdatePrompt(): React.JSX.Element {
  const { t } = useTranslation()
  const update = useApp((s) => s.update)
  const running = useApp((s) => Object.values(s.jobs).filter((j) => j.done < j.total).length)
  const { open, show, hide } = useUpdatePrompt()

  useEffect(() => {
    if (update.state === 'ready' && update.version && loadPref<string | null>(DISMISSED, null) !== update.version) show()
  }, [update.state, update.version, show])

  const later = (): void => {
    if (update.version) savePref(DISMISSED, update.version)
    hide()
  }
  const ready = update.state === 'ready'

  return (
    <Dialog
      open={open && (ready || update.state === 'available' || update.state === 'downloading')}
      onClose={later}
      title={ready ? t('update.title', { version: update.version }) : t('update.downloadingTitle', { version: update.version })}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={later}>
            {t('update.later')}
          </Button>
          <Button variant="primary" icon="RefreshCw" disabled={!ready} onClick={() => void api('update:install')} autoFocus>
            {t('update.install')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        {!ready && (
          <div className="flex items-center gap-2 text-muted">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-3">
              <div className="h-full w-full origin-left bg-accent transition-transform" style={{ transform: `scaleX(${(update.progress ?? 0) / 100})` }} />
            </div>
            <span className="tabular-nums">{Math.round(update.progress ?? 0)} %</span>
          </div>
        )}
        {update.notes ? <ReleaseNotes text={update.notes} /> : <p className="text-muted">{t('update.noNotes')}</p>}
        {ready && running > 0 && <p className="text-[12px] text-warning">{t('update.jobsRunning', { count: running })}</p>}
        <p className="text-[12px] text-muted">{t('update.onQuit')}</p>
      </div>
    </Dialog>
  )
}

/** Notes de version : « ## » donne un titre, « - » un élément de liste. */
function ReleaseNotes({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation()
  const lines = text.split('\n')
  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-line bg-panel-2 px-3 py-2 leading-relaxed" aria-label={t('update.notes')}>
      {lines.map((line, i) =>
        line.startsWith('## ') ? (
          <div key={i} className="mt-2 text-[12.5px] font-semibold first:mt-0">
            {line.slice(3)}
          </div>
        ) : line.startsWith('- ') ? (
          <div key={i} className="flex gap-1.5 text-[12.5px] text-muted">
            <span aria-hidden>•</span>
            <span>{line.slice(2)}</span>
          </div>
        ) : (
          <p key={i} className="text-[12.5px] text-muted">
            {line}
          </p>
        )
      )}
    </div>
  )
}
