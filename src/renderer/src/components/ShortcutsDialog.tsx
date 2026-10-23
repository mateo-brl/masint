import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiEvent } from '../lib/uiEvents'
import { Dialog } from './ui'

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+K', 'palette'],
  ['Ctrl+F', 'search'],
  ['Ctrl+1 … Ctrl+7', 'views'],
  ['Alt + ← ↑ → ↓', 'neighbors'],
  ['Ctrl+Z', 'undo'],
  ['Ctrl+Y / Ctrl+Shift+Z', 'redo'],
  ['Ctrl+V', 'paste'],
  ['Ctrl+A', 'selectAll'],
  ['Ctrl+E', 'enrich'],
  ['Suppr / Del', 'delete'],
  ['F', 'fit'],
  ['Shift + glisser / drag', 'boxSelect'],
  ['Ctrl + clic / click', 'multiSelect'],
  ['Double-clic / double-click', 'quickAdd'],
  ['Échap / Esc', 'escape'],
  ['?', 'help']
]

/** Aide des raccourcis clavier, ouverte avec la touche « ? ». */
export function ShortcutsDialog(): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === '?') setOpen((o) => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Ouverture depuis la palette de commandes.
  useUiEvent('shortcuts', () => setOpen(true))
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title={t('shortcuts.title')} width={480}>
      <div className="flex flex-col">
        {SHORTCUTS.map(([keys, id]) => (
          <div key={id} className="flex items-center justify-between border-b border-line py-2 text-[12.5px] last:border-0">
            <span className="text-muted">{t(`shortcuts.${id}`)}</span>
            <kbd className="rounded-md border border-line bg-panel-2 px-2 py-0.5 font-mono text-[11px]">{keys}</kbd>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
