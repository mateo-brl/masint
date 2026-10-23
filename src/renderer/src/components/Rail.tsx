import { useTranslation } from 'react-i18next'
import { VIEW_ICONS, VIEW_ORDER, viewShortcut } from '../lib/commands'
import { useApp } from '../store/app'
import { Logo } from './Logo'
import { IconButton } from './ui'

/** Barre verticale de gauche : accueil, vues de l'enquête (Ctrl+1 à Ctrl+7), paramètres. */
export function Rail(): React.JSX.Element {
  const { t } = useTranslation()
  const currentId = useApp((s) => s.currentId)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const goHome = useApp((s) => s.goHome)
  const openSettings = useApp((s) => s.openSettings)
  const update = useApp((s) => s.update)

  return (
    <nav aria-label={t('rail.nav')} className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-app py-3">
      <button onClick={goHome} title={t('rail.home')} aria-label={t('rail.home')} className="mb-2 rounded-lg transition hover:scale-105">
        <Logo size={32} />
      </button>
      {currentId &&
        VIEW_ORDER.map((id) => (
          <IconButton
            key={id}
            icon={VIEW_ICONS[id]}
            // Raccourci dans l'infobulle ; libellé seul pour les lecteurs d'écran.
            title={`${t(`rail.${id}`)} (${viewShortcut(id)})`}
            aria-label={t(`rail.${id}`)}
            aria-current={view === id ? 'page' : undefined}
            active={view === id}
            onClick={() => setView(id)}
          />
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
