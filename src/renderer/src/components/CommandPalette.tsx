import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { getEntityType } from '@shared/entityTypes'
import { buildCommands, entityCommand, VIEW_ORDER, searchInView, type Command } from '../lib/commands'
import { focusNode } from '../lib/focus'
import { fuzzyFilter, type FuzzyMatch } from '../lib/fuzzy'
import { useLang } from '../lib/i18n'
import { EntityBadge, Icon } from '../lib/icons'
import { useApp } from '../store/app'
import { useGraph } from '../store/graph'
import { useModal } from './ui'

/** Élément de la palette : commande, nœud de l'enquête ou enquête. */
interface Item {
  key: string
  kind: 'command' | 'node' | 'investigation'
  title: string
  hint?: string
  shortcut?: string
  icon?: string
  node?: { type: string; platform: string | null }
  color?: string
  run: () => void | Promise<void>
  match: FuzzyMatch
}

/** Résultats affichés au plus, par nature. */
const MAX = { command: 40, node: 25, investigation: 12 }

/**
 * Palette de commandes (Ctrl+K) : toutes les actions, les nœuds de l'enquête et les enquêtes,
 * avec une recherche floue. Entrée exécute, Échap ferme, flèches pour se déplacer.
 */
export function CommandPalette(): React.JSX.Element | null {
  const open = useApp((s) => s.paletteOpen)
  useGlobalShortcuts()
  if (!open) return null
  return <Palette onClose={() => useApp.getState().setPaletteOpen(false)} />
}

function Palette({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  useModal(box, true, onClose)

  // Commandes figées à l'ouverture : l'état (sélection, enquête) est celui du moment.
  const commands = useMemo(() => buildCommands(t), [t])
  const investigations = useApp((s) => s.investigations)
  const currentId = useApp((s) => s.currentId)

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const detected = entityCommand(query, t, tx)
    const sectionTitle = (c: Command): string => t(`palette.section.${c.section}`)
    for (const { item: c, match } of fuzzyFilter(commands, query, (c) => `${c.title} ${c.keywords ?? ''}`, MAX.command))
      out.push({ key: `c:${c.id}`, kind: 'command', title: c.title, hint: sectionTitle(c), shortcut: c.shortcut, icon: c.icon, run: c.run, match })
    if (query.trim()) {
      // Nœuds de l'enquête : libellé, puis type.
      const nodes = useGraph.getState().nodes.filter((n) => n.data.node.kind === 'entity' && n.data.node.label)
      for (const { item: n, match } of fuzzyFilter(nodes, query, (n) => n.data.node.label, MAX.node)) {
        const node = n.data.node
        out.push({
          key: `n:${n.id}`,
          kind: 'node',
          title: node.label,
          hint: tx(getEntityType(node.type).label),
          node: { type: node.type, platform: node.platform },
          run: () => focusNode(n.id),
          // Un nœud passe après une commande de même score.
          match: { ...match, score: match.score - 5 }
        })
      }
      for (const { item: inv, match } of fuzzyFilter(investigations, query, (i) => i.name, MAX.investigation))
        if (inv.id !== currentId)
          out.push({
            key: `i:${inv.id}`,
            kind: 'investigation',
            title: inv.name,
            hint: t('palette.section.investigation'),
            color: inv.color,
            icon: 'FolderOpen',
            run: () => useApp.getState().openInvestigation(inv.id),
            match: { ...match, score: match.score - 3 }
          })
      out.sort((a, b) => b.match.score - a.match.score)
    }
    // Valeur reconnue : « Ajouter … » en tête pour un identifiant net (email, numéro, domaine...),
    // en dernier pour un simple mot (pseudo ou mot-clé par défaut), qui est surtout une recherche.
    if (detected) {
      const item: Item = { key: 'c:detected', kind: 'command', title: detected.title, hint: t('palette.section.actions'), icon: detected.icon, run: detected.run, match: { score: 0, positions: [] } }
      if (detected.weak) out.push(item)
      else out.unshift(item)
    }
    return out
  }, [commands, query, investigations, currentId, t, tx])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (item: Item | undefined): void => {
    if (!item) return
    onClose()
    // Après la fermeture : le focus revient d'abord à son élément d'origine.
    setTimeout(() => void item.run(), 0)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(items.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      setActive((a) => Math.min(items.length - 1, a + 8))
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 8))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(items[active])
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-6 pt-[12vh]" onMouseDown={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        tabIndex={-1}
        className="popover flex max-h-[70vh] w-[640px] max-w-full flex-col overflow-hidden rounded-2xl outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Icon name="Command" size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            autoFocus
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('palette.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <kbd className="rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{t('palette.esc')}</kbd>
        </div>
        <div ref={list} id={listId} role="listbox" aria-label={t('palette.results')} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-muted">{t('palette.empty')}</div>}
          {items.map((item, i) => (
            <div
              key={item.key}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => run(item)}
              className={`flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] ${i === active ? 'bg-panel-3' : ''}`}
            >
              {item.node ? (
                <EntityBadge type={item.node.type} platform={item.node.platform} size={18} />
              ) : item.color ? (
                <span className="flex h-[18px] w-[18px] items-center justify-center">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                </span>
              ) : (
                <span className="flex h-[18px] w-[18px] items-center justify-center text-muted">
                  <Icon name={item.icon ?? 'Circle'} size={15} aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">
                <Highlight text={item.title} positions={item.match.positions} />
              </span>
              {item.hint && <span className="shrink-0 text-[11px] text-muted">{item.hint}</span>}
              {item.shortcut && <kbd className="shrink-0 rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{item.shortcut}</kbd>}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span>
            <kbd className="font-mono">↑ ↓</kbd> {t('palette.navigate')}
          </span>
          <span>
            <kbd className="font-mono">{t('palette.enter')}</kbd> {t('palette.run')}
          </span>
          <span>
            <kbd className="font-mono">{t('palette.esc')}</kbd> {t('common.close')}
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Texte avec les caractères trouvés en gras. */
function Highlight({ text, positions }: { text: string; positions: number[] }): React.JSX.Element {
  if (!positions.length) return <>{text}</>
  const set = new Set(positions)
  const parts: Array<{ s: string; on: boolean }> = []
  for (let i = 0; i < text.length; i++) {
    const on = set.has(i)
    const last = parts[parts.length - 1]
    if (last && last.on === on) last.s += text[i]
    else parts.push({ s: text[i], on })
  }
  return (
    <>
      {parts.map((p, i) =>
        p.on ? (
          <b key={i} className="font-semibold text-fg">
            {p.s}
          </b>
        ) : (
          <span key={i}>{p.s}</span>
        )
      )}
    </>
  )
}

/**
 * Raccourcis valables partout : Ctrl+K (palette), Ctrl+F (recherche de la vue), Ctrl+1 à
 * Ctrl+7 (vues de l'enquête, dans l'ordre de la barre latérale).
 */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || e.altKey) return
      const key = e.key.toLowerCase()
      const app = useApp.getState()
      if (key === 'k') {
        e.preventDefault()
        app.setPaletteOpen(!app.paletteOpen)
      } else if (key === 'f' && !e.shiftKey) {
        e.preventDefault()
        if (app.paletteOpen) app.setPaletteOpen(false)
        searchInView()
      } else if (/^[1-9]$/.test(e.key) && app.currentId && !e.shiftKey) {
        const view = VIEW_ORDER[Number(e.key) - 1]
        if (!view) return
        e.preventDefault()
        app.setView(view)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
