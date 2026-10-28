import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmHost, Spinner, Toasts } from './components/ui'
import { Rail } from './components/Rail'
import { Home } from './components/home/Home'
import { Workspace } from './components/Workspace'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { CommandPalette } from './components/CommandPalette'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { UpdatePrompt } from './components/UpdatePrompt'
import { useApp } from './store/app'

export default function App(): React.JSX.Element {
  const { t } = useTranslation()
  const ready = useApp((s) => s.ready)
  const currentId = useApp((s) => s.currentId)
  const init = useApp((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!ready)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner size={20} />
      </div>
    )

  return (
    <div className="flex h-full">
      <Rail />
      <main className="relative min-w-0 flex-1">{currentId ? <Workspace key={currentId} /> : <Home />}</main>
      <ShortcutsDialog />
      <CommandPalette />
      <SettingsDialog />
      <UpdatePrompt />
      <Toasts />
      <ConfirmHost okLabel={t('common.confirm')} cancelLabel={t('common.cancel')} />
    </div>
  )
}
