import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { snippetParts, SEARCH_MIN_TERM } from '@shared/correlation'
import { detectEntity } from '@shared/detect'
import { getEntityType } from '@shared/entityTypes'
import type { GlobalSearchHit, Investigation } from '@shared/types'
import { api } from '../../lib/api'
import { openInvestigationAt } from '../../lib/focus'
import { useUiEvent } from '../../lib/uiEvents'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Logo } from '../Logo'
import { Button, confirmDialog, Dialog, Dropdown, Empty, Switch } from '../ui'
import { errorMessage } from '../../lib/errors'
import { readTextFile } from '../import/ImportDialog'

const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d8d93']

export function Home(): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const investigations = useApp((s) => s.investigations)
  const refresh = useApp((s) => s.refreshInvestigations)
  const open = useApp((s) => s.openInvestigation)
  const toast = useApp((s) => s.toast)
  const [query, setQuery] = useState('')
  const [enrich, setEnrich] = useState(true)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Investigation | 'new' | null>(null)
  const isolated = useApp((s) => s.settings?.isolateInvestigations ?? false)
  const [content, setContent] = useState('')
  const contentInput = useRef<HTMLInputElement>(null)
  const filterInput = useRef<HTMLInputElement>(null)
  // Ctrl+F : recherche dans le contenu des enquêtes (ou par nom si elles sont cloisonnées).
  useUiEvent('focus-search', () => (isolated ? filterInput : contentInput).current?.focus())
  useUiEvent('new-investigation', () => setEditing('new'))

  const detection = useMemo(() => detectEntity(query), [query])

  const quickStart = async (): Promise<void> => {
    if (!detection) return
    const inv = await api('investigations:create', { name: detection.value })
    await open(inv.id)
    const [node] = await useGraph
      .getState()
      .addNodes([{ kind: 'entity', type: detection.type, label: detection.value, platform: detection.platform ?? null, x: 0, y: 0 }])
    if (enrich && node) await api('modules:enrich', inv.id, node.id)
  }

  const importArchive = async (): Promise<void> => {
    try {
      const inv = await api('investigations:importArchive')
      if (inv) {
        toast('success', t('home.imported', { name: inv.name }))
        await refresh()
      }
    } catch (e) {
      toast('error', errorMessage(e))
    }
  }

  // Nouvelle enquête depuis un fichier CSV ou texte : nommée d'après le fichier, puis import en masse.
  const fileInput = useRef<HTMLInputElement>(null)
  const fromFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) return toast('error', t('importer.tooBig'))
    try {
      const text = await readTextFile(file)
      const inv = await api('investigations:create', { name: file.name.replace(/\.[^.]+$/, '') || file.name })
      await open(inv.id)
      useApp.getState().setImportOpen(true, { name: file.name, text })
    } catch (e) {
      toast('error', errorMessage(e))
    }
  }

  const list = investigations.filter((i) => !filter || `${i.name} ${i.description}`.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div
      className="h-full overflow-auto bg-canvas"
      style={{ backgroundImage: 'radial-gradient(var(--canvas-dot) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
    >
      <div className="mx-auto max-w-5xl px-8 pt-16 pb-16">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {t('home.tagline')}
          </div>
          <h1 className="flex items-center justify-center gap-3 text-[34px] font-semibold tracking-tight">
            <Logo size={44} /> MASINT
          </h1>
          <p className="mt-1 text-muted">{t('home.subtitle')}</p>
        </div>

        <div className="glass mx-auto max-w-2xl rounded-2xl p-2">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void quickStart()
            }}
            className="flex items-center gap-2"
          >
            <Icon name="Search" size={18} className="ml-2 shrink-0 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('home.searchPlaceholder')}
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            />
            <Button variant="primary" type="submit" disabled={!detection} icon="ArrowRight">
              {t('home.start')}
            </Button>
          </form>
          {detection && (
            <div className="mt-1 flex items-center gap-3 border-t border-line px-3 pt-2 pb-1 text-[12px] text-muted">
              <EntityBadge type={detection.type} platform={detection.platform} size={18} />
              <span>
                {t('home.detected')} <b className="text-fg">{tx(getEntityType(detection.type).label)}</b>
              </span>
              <div className="flex-1" />
              <label className="flex items-center gap-2">
                {t('home.runModules')} <Switch checked={enrich} onChange={setEnrich} />
              </label>
            </div>
          )}
        </div>

        <div className="mt-14 mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-[15px] font-semibold">{t('home.investigations')}</h2>
          <span className="text-[12px] text-faint">{investigations.length}</span>
          <div className="flex-1" />
          <input
            ref={filterInput}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('common.filter')}
            aria-label={t('home.filterByName')}
            className="field !h-8 !w-44 !py-1"
          />
          {!isolated && (
            <div className="relative">
              <Icon name="TextSearch" size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" aria-hidden />
              <input
                ref={contentInput}
                type="search"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setContent('')}
                placeholder={t('home.contentSearch')}
                aria-label={t('home.contentSearch')}
                title={t('home.contentSearchHint')}
                className="field !h-8 !w-60 !py-1 !pl-8"
              />
            </div>
          )}
          <Button icon="Upload" className="whitespace-nowrap" onClick={() => void importArchive()}>
            {t('home.import')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              void fromFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button icon="FileSpreadsheet" className="whitespace-nowrap" title={t('home.fromFileHint')} onClick={() => fileInput.current?.click()}>
            {t('home.fromFile')}
          </Button>
          <Button variant="primary" icon="Plus" className="whitespace-nowrap" onClick={() => setEditing('new')}>
            {t('home.new')}
          </Button>
        </div>

        {!isolated && content.trim() && <ContentResults query={content} />}

        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line">
            <Empty icon="FolderSearch" title={t('home.emptyTitle')}>
              {t('home.emptyBody')}
            </Empty>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {list.map((inv) => (
              <InvestigationCard key={inv.id} inv={inv} onEdit={() => setEditing(inv)} />
            ))}
          </div>
        )}
      </div>
      {editing && <InvestigationDialog value={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function InvestigationCard({ inv, onEdit }: { inv: Investigation; onEdit: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const open = useApp((s) => s.openInvestigation)
  const refresh = useApp((s) => s.refreshInvestigations)
  const toast = useApp((s) => s.toast)
  const date = new Date(inv.updatedAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void open(inv.id)}
      onKeyDown={(e) => e.key === 'Enter' && void open(inv.id)}
      className="group relative cursor-pointer rounded-2xl border border-line bg-panel p-4 transition hover:border-line-strong"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: inv.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{inv.name}</div>
          <div className="mt-0.5 line-clamp-2 min-h-[18px] text-[12px] text-muted">{inv.description || t('home.noDescription')}</div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Dropdown
            align="right"
            trigger={() => (
              <button
                className="rounded-md p-1 text-muted opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-panel-3 hover:text-fg focus-visible:opacity-100"
                aria-label={t('home.actions', { name: inv.name })}
                title={t('home.actions', { name: inv.name })}
              >
                <Icon name="Ellipsis" size={16} />
              </button>
            )}
            items={[
              { label: t('common.open'), icon: 'FolderOpen', onClick: () => void open(inv.id) },
              { label: t('home.edit'), icon: 'Pencil', onClick: onEdit },
              {
                label: t('home.duplicate'),
                icon: 'Copy',
                onClick: () => void api('investigations:duplicate', inv.id).then(() => refresh())
              },
              {
                label: t('home.exportArchive'),
                icon: 'Download',
                onClick: () =>
                  void api('investigations:exportArchive', inv.id).then((p) => p && toast('success', t('home.exported', { path: p })))
              },
              { separator: true, label: '' },
              {
                label: t('common.delete'),
                icon: 'Trash',
                danger: true,
                onClick: async () => {
                  if (await confirmDialog(t('home.deleteTitle', { name: inv.name }), t('home.deleteBody'))) {
                    await api('investigations:delete', inv.id)
                    await refresh()
                  }
                }
              }
            ]}
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 text-[11.5px] text-faint">
        <span className="flex items-center gap-1">
          <Icon name="Circle" size={11} /> {inv.nodeCount ?? 0}
        </span>
        <span className="flex items-center gap-1">
          <Icon name="Spline" size={11} /> {inv.edgeCount ?? 0}
        </span>
        <div className="flex-1" />
        <span>{date}</span>
      </div>
    </div>
  )
}

function InvestigationDialog({ value, onClose }: { value: Investigation | 'new'; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const refresh = useApp((s) => s.refreshInvestigations)
  const open = useApp((s) => s.openInvestigation)
  const isNew = value === 'new'
  const [name, setName] = useState(isNew ? '' : value.name)
  const [description, setDescription] = useState(isNew ? '' : value.description)
  const [color, setColor] = useState(isNew ? COLORS[0] : value.color)

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    if (isNew) {
      const inv = await api('investigations:create', { name: name.trim(), description, color })
      onClose()
      await open(inv.id)
    } else {
      await api('investigations:update', value.id, { name: name.trim(), description, color })
      await refresh()
      onClose()
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t('home.new') : t('home.edit')}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>
            {isNew ? t('common.create') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="label-xs">{t('home.name')}</span>
          <input
            autoFocus
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-xs">{t('home.description')}</span>
          <textarea className="field min-h-20 resize-y" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="label-xs">{t('home.color')}</span>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={t('home.colorChoice', { color: c })}
                aria-pressed={color === c}
                className="h-6 w-6 rounded-full transition"
                style={{ background: c, outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * Résultats de la recherche dans le contenu de toutes les enquêtes (libellés, propriétés,
 * notes), regroupés par enquête. Un clic ouvre l'enquête sur le nœud trouvé.
 */
function ContentResults({ query }: { query: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const [hits, setHits] = useState<GlobalSearchHit[] | null>(null)
  const ready = query.trim().split(/\s+/).some((w) => Array.from(w).length >= SEARCH_MIN_TERM)
  // Léger différé : pas une requête par frappe.
  useEffect(() => {
    if (!ready) return setHits(null)
    let live = true
    const timer = setTimeout(() => {
      void api('search:global', query, 150).then((r) => live && setHits(r))
    }, 180)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, ready])

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; color: string; hits: GlobalSearchHit[] }>()
    for (const h of hits ?? []) {
      const g = m.get(h.investigationId) ?? { name: h.investigationName, color: h.investigationColor, hits: [] }
      g.hits.push(h)
      m.set(h.investigationId, g)
    }
    return Array.from(m.entries())
  }, [hits])

  return (
    <section aria-label={t('home.contentResults')} aria-live="polite" className="mb-6 rounded-2xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-2 px-1 text-[12px] text-muted">
        <Icon name="TextSearch" size={14} aria-hidden />
        {!ready
          ? t('home.contentMin', { count: SEARCH_MIN_TERM })
          : hits === null
            ? t('home.contentSearching')
            : `${t('home.contentCount', { count: hits.length })} ${t('home.contentIn', { count: groups.length })}`}
      </div>
      <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">
        {groups.map(([id, g]) => (
          <div key={id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 px-1 text-[12px] font-semibold">
              <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
              {g.name}
              <span className="font-normal text-faint">{g.hits.length}</span>
            </div>
            {g.hits.map((h) => (
              <button
                key={h.nodeId}
                onClick={() => void openInvestigationAt(h.investigationId, h.nodeId)}
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-panel-3"
              >
                {h.kind === 'entity' ? <EntityBadge type={h.type} platform={h.platform} size={18} /> : <Icon name="StickyNote" size={16} className="mt-0.5 text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{h.label || t('node.untitled')}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {h.kind === 'entity' && <span className="text-faint">{tx(getEntityType(h.type).label)} · </span>}
                    {snippetParts(h.snippet).map((p, i) =>
                      p.hit ? (
                        <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-fg">
                          {p.text}
                        </mark>
                      ) : (
                        <span key={i}>{p.text}</span>
                      )
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
