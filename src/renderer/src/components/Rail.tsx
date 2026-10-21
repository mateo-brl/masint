import { useTranslation } from 'react-i18next'
import { useApp, type View } from '../store/app'
import { IconButton } from './ui'

const VIEWS: Array<{ id: View; icon: string }> = [
  { id: 'graph', icon: 'Share2' },
  { id: 'map', icon: 'Map' },
  { id: 'timeline', icon: 'CalendarDays' },
  { id: 'modules', icon: 'Puzzle' },
  { id: 'notes', icon: 'NotebookPen' }
]

/** Barre verticale de gauche : accueil, vues de l'enquête, paramètres. */
export function Rail(): React.JSX.Element {
  const { t } = useTranslation()
  const currentId = useApp((s) => s.currentId)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const goHome = useApp((s) => s.goHome)
  const openSettings = useApp((s) => s.openSettings)
  const update = useApp((s) => s.update)

  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-app py-3">
      <button
        onClick={goHome}
        title={t('rail.home')}
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[11px] font-black tracking-tight text-white shadow-[0_0_18px_var(--accent-soft)]"
      >
        M
      </button>
      {currentId &&
        VIEWS.map((v) => (
          <IconButton key={v.id} icon={v.icon} title={t(`rail.${v.id}`)} active={view === v.id} onClick={() => setView(v.id)} />
        ))}
      <div className="flex-1" />
      {update.state === 'ready' && (
        <IconButton icon="CloudDownload" title={t('update.ready', { version: update.version })} className="text-success" onClick={() => openSettings('about')} />
      )}
      <IconButton icon="KeyRound" title={t('rail.keys')} onClick={() => openSettings('keys')} />
      <IconButton icon="Settings" title={t('rail.settings')} onClick={() => openSettings('general')} />
    </nav>
  )
}
