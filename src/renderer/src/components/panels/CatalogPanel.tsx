import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CATEGORIES, type CategoryId } from '@shared/entityTypes'
import { addEntityAt, useVisibleCenter } from '../../lib/actions'
import { CATALOG, CATALOG_BY_CATEGORY, DRAG_MIME, type CatalogItem } from '../../lib/catalog'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'

/** Panneau « Icônes » : catalogue des types d'entités et plateformes, à glisser sur le canevas. */
export function CatalogPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const toggle = useApp((s) => s.toggleCatalog)
  const [query, setQuery] = useState('')
  const [openCat, setOpenCat] = useState<CategoryId | null>('identity')
  const center = useVisibleCenter()

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? CATALOG.filter((i) => i.keywords.includes(q)).slice(0, 80) : null
  }, [query])

  const label = (i: CatalogItem): string => (typeof i.label === 'string' ? i.label : tx(i.label))

  const add = (i: CatalogItem): void => {
    void addEntityAt(i.type, center(), { platform: i.platform ?? null })
  }

  const renderItem = (i: CatalogItem): React.JSX.Element => (
    <button
      key={i.key}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: i.type, platform: i.platform }))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => add(i)}
      title={t('catalog.addHint')}
      className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-panel-3"
    >
      <EntityBadge type={i.type} platform={i.platform} size={20} />
      <span className="truncate">{label(i)}</span>
    </button>
  )

  return (
    <aside data-panel="catalog" className="glass absolute top-4 bottom-4 left-4 z-20 flex w-[272px] flex-col rounded-2xl">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Icon name="Layers" size={15} className="text-muted" />
        <span className="font-semibold">{t('catalog.title')}</span>
        <span className="text-[11px] text-faint">{CATALOG.length}</span>
        <div className="flex-1" />
        <button onClick={() => toggle(false)} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('common.collapse')} aria-label={t('common.collapse')}>
          <Icon name="ChevronLeft" size={16} />
        </button>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Icon name="Search" size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('catalog.search')} className="field !pl-8" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {results ? (
          <div className="grid grid-cols-1 gap-0.5">
            {results.length === 0 && <div className="px-3 py-4 text-[12px] text-muted">{t('catalog.noResult')}</div>}
            {results.map(renderItem)}
          </div>
        ) : (
          CATEGORIES.map((c) => {
            const items = CATALOG_BY_CATEGORY[c.id]
            const open = openCat === c.id
            return (
              <div key={c.id} className="border-b border-line/60 last:border-0">
                <button
                  onClick={() => setOpenCat(open ? null : c.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-panel-2"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted">
                    <Icon name={c.icon} size={14} />
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium">{tx(c.label)}</span>
                  <span className="rounded-md bg-panel-2 px-1.5 text-[10px] text-faint">{items.length}</span>
                  <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} className="text-faint" />
                </button>
                {open && <div className="grid grid-cols-2 gap-0.5 pb-2">{items.map(renderItem)}</div>}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
