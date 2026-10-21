import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { attachmentUrl } from '@shared/api'
import { ENTITY_TYPES, getEntityType, type CategoryId } from '@shared/entityTypes'
import { getPlatform, PLATFORMS } from '@shared/platforms'
import type { GraphEdge, GraphNode, ModuleRun, PropValue } from '@shared/types'
import { enrichNode, fileToBase64, modulesForNode } from '../../lib/actions'
import { api, openExternal } from '../../lib/api'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Button, confirmDialog, Dialog, Spinner, Switch, Tabs } from '../ui'

const SWATCHES = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d8d93', '#ededef']

/** Catégories de plateformes proposées selon le type d'entité. */
const PLATFORM_CATEGORIES: Record<string, CategoryId[]> = {
  account: ['social', 'messaging'],
  email: ['email'],
  carrier: ['carrier'],
  crypto_wallet: ['crypto'],
  crypto_tx: ['crypto'],
  hosting: ['hosting'],
  hlr: ['hlr']
}

export function PropertiesPanel(): React.JSX.Element | null {
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const selNodes = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.data.node), [nodes])
  const selEdges = useMemo(() => edges.filter((e) => e.selected).map((e) => e.data!.edge), [edges])

  let content: React.JSX.Element | null = null
  if (selNodes.length === 1) content = <NodePanel key={selNodes[0].id} node={selNodes[0]} />
  else if (selNodes.length > 1) content = <MultiPanel nodes={selNodes} />
  else if (selEdges.length === 1) content = <EdgePanel key={selEdges[0].id} edge={selEdges[0]} />
  if (!content) return null

  return (
    <aside className="glass absolute top-4 right-4 bottom-20 z-20 flex w-[318px] flex-col overflow-hidden rounded-2xl">{content}</aside>
  )
}

function PanelHeader({ title, kicker }: { title: string; kicker: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-start justify-between px-5 pt-5 pb-3">
      <div>
        <div className="label-xs">{kicker}</div>
        <div className="mt-1 text-[17px] font-semibold">{title}</div>
      </div>
      <button
        onClick={() => useGraph.getState().select([])}
        className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-fg"
        title={t('common.close')}
      >
        <Icon name="X" size={16} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nœud unique

function NodePanel({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'sheet' | 'style' | 'notes'>('sheet')
  return (
    <>
      <PanelHeader kicker={t('props.selectedNode')} title={t('props.title')} />
      <div className="px-5 pb-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'sheet', label: t('props.sheet') },
            { id: 'style', label: t('props.style') },
            { id: 'notes', label: t('props.notes') }
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-line px-5 py-4">
        {tab === 'sheet' && (node.kind === 'entity' ? <EntitySheet node={node} /> : <AnnotationSheet node={node} />)}
        {tab === 'style' && <StyleTab node={node} />}
        {tab === 'notes' && <NotesTab node={node} />}
      </div>
    </>
  )
}

function useDebouncedSave<T>(value: T, save: (v: T) => void, delay = 450): void {
  const first = useRef(true)
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(() => saveRef.current(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
}

function EntitySheet({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const updateNode = useGraph((s) => s.updateNode)
  const def = getEntityType(node.type)
  const [label, setLabel] = useState(node.label)
  useDebouncedSave(label, (v) => v !== node.label && void updateNode(node.id, { label: v.trim() }))

  const platformCats = PLATFORM_CATEGORIES[node.type]
  const platformOptions = platformCats ? PLATFORMS.filter((p) => platformCats.includes(p.category)) : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <EntityBadge type={node.type} platform={node.platform} size={30} />
        <select
          value={node.type}
          onChange={(e) => void updateNode(node.id, { type: e.target.value })}
          className="field !py-1.5"
        >
          {ENTITY_TYPES.map((et) => (
            <option key={et.id} value={et.id}>
              {tx(et.label)}
            </option>
          ))}
        </select>
      </div>
      {(platformOptions.length > 0 || node.platform) && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-muted">{t('props.platform')}</span>
          <select
            value={node.platform ?? ''}
            onChange={(e) => void updateNode(node.id, { platform: e.target.value || null })}
            className="field !py-1.5"
          >
            <option value="">{t('props.noPlatform')}</option>
            {(platformOptions.length ? platformOptions : PLATFORMS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[11.5px] text-muted">{t('props.label')}</span>
        <input
          autoFocus={!node.label}
          value={label}
          placeholder={def.placeholder ?? t('props.labelPlaceholder')}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="field"
        />
      </label>

      <div className="border-t border-line" />
      <div className="text-[12.5px] font-semibold">{t('props.imageInfo')}</div>
      <ImageDrop node={node} />
      <LinkedSummary node={node} />
      <PropertyList node={node} />
      <EnrichBlock node={node} />
      <RunsList node={node} />
      <div className="text-[11px] text-faint">
        {t('props.source')} : {node.source === 'manual' ? t('props.manual') : node.source} ·{' '}
        {new Date(node.createdAt).toLocaleString()}
      </div>
    </div>
  )
}

function ImageDrop({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const updateNode = useGraph((s) => s.updateNode)
  const inv = useGraph((s) => s.investigation)
  const [over, setOver] = useState(false)

  const setFromFile = async (f: File): Promise<void> => {
    if (!inv || !f.type.startsWith('image/')) return
    const att = await api('attachments:add', inv.id, { name: f.name, mime: f.type, base64: await fileToBase64(f) })
    await updateNode(node.id, { imageId: att.id })
  }
  const pick = async (): Promise<void> => {
    if (!inv) return
    const [att] = await api('attachments:pick', inv.id)
    if (att) await updateNode(node.id, { imageId: att.id })
  }

  if (node.imageId)
    return (
      <div className="group relative overflow-hidden rounded-xl border border-line bg-panel-2">
        <img src={attachmentUrl(node.imageId)} alt="" className="max-h-52 w-full object-contain" draggable={false} />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button onClick={() => void pick()} className="rounded-md bg-black/60 p-1.5 text-white" title={t('props.replaceImage')}>
            <Icon name="RefreshCw" size={13} />
          </button>
          <button onClick={() => void updateNode(node.id, { imageId: null })} className="rounded-md bg-black/60 p-1.5 text-white" title={t('props.removeImage')}>
            <Icon name="X" size={13} />
          </button>
        </div>
      </div>
    )

  return (
    <button
      onClick={() => void pick()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) void setFromFile(f)
      }}
      className={`flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition ${
        over ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-muted'
      }`}
    >
      <Icon name="ImagePlus" size={20} className="text-accent" />
      <span className="text-[12.5px]">{t('props.dropImage')}</span>
      <span className="text-[11px] text-faint">{t('props.orBrowse')}</span>
    </button>
  )
}

/** Résumé des comptes et plateformes liés au nœud, comme sur la fiche d'un numéro. */
function LinkedSummary({ node }: { node: GraphNode }): React.JSX.Element | null {
  const { t } = useTranslation()
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const linked = useMemo(() => {
    const ids = new Set<string>()
    for (const e of edges) {
      if (e.source === node.id) ids.add(e.target)
      if (e.target === node.id) ids.add(e.source)
    }
    return nodes.filter((n) => ids.has(n.id)).map((n) => n.data.node)
  }, [nodes, edges, node.id])
  const accounts = linked.filter((n) => n.type === 'account')
  const platforms = Array.from(new Set(linked.map((n) => getPlatform(n.platform)?.name ?? (n.type === 'account' ? n.label : null)).filter(Boolean)))
  if (!linked.length) return null
  return (
    <div className="flex flex-col gap-2">
      {accounts.length > 0 && <InfoCard label={t('props.accounts')} value={String(accounts.length)} />}
      {platforms.length > 0 && <InfoCard label={t('props.platforms')} value={platforms.join(', ')} />}
      <InfoCard label={t('props.links')} value={String(linked.length)} />
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-1 text-[12.5px] leading-relaxed break-words">{value}</div>
    </div>
  )
}

function formatValue(v: PropValue): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function parseValue(text: string, previous: PropValue, kind?: string): PropValue {
  if (kind === 'list' || Array.isArray(previous)) return text.split(',').map((s) => s.trim()).filter(Boolean)
  if (kind === 'number' || typeof previous === 'number') {
    const n = Number(text.replace(',', '.'))
    return Number.isFinite(n) && text.trim() !== '' ? n : text
  }
  if (typeof previous === 'boolean') return ['true', '1', 'oui', 'yes', '✓'].includes(text.trim().toLowerCase())
  return text
}

function PropertyList({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const updateNode = useGraph((s) => s.updateNode)
  const def = getEntityType(node.type)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')

  const fieldByKey = new Map(def.fields.map((f) => [f.key, f]))
  const keys = Object.keys(node.data).filter((k) => !k.startsWith('__'))
  const ordered = [...def.fields.map((f) => f.key).filter((k) => keys.includes(k)), ...keys.filter((k) => !fieldByKey.has(k)).sort()]
  const missingFields = def.fields.filter((f) => !keys.includes(f.key))

  const setProp = (key: string, value: PropValue | undefined): void => {
    const data = { ...node.data }
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete data[key]
    else data[key] = value
    void updateNode(node.id, { data })
  }

  return (
    <div className="flex flex-col gap-2">
      {ordered.map((k) => {
        const f = fieldByKey.get(k)
        return (
          <PropertyRow
            key={k}
            label={f ? tx(f.label) : k.replace(/_/g, ' ')}
            value={node.data[k]}
            kind={f?.kind}
            onChange={(text) => setProp(k, parseValue(text, node.data[k], f?.kind))}
            onDelete={() => setProp(k, undefined)}
          />
        )
      })}
      {adding ? (
        <div className="flex gap-1.5">
          <input
            autoFocus
            list="masint-field-keys"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newKey.trim()) {
                const key = newKey.trim().toLowerCase().replace(/\s+/g, '_')
                const field = def.fields.find((f) => f.key === key || tx(f.label).toLowerCase() === newKey.trim().toLowerCase())
                setProp(field?.key ?? key, '…')
                setNewKey('')
                setAdding(false)
              }
              if (e.key === 'Escape') setAdding(false)
            }}
            placeholder={t('props.newField')}
            className="field !py-1.5"
          />
          <datalist id="masint-field-keys">
            {missingFields.map((f) => (
              <option key={f.key} value={f.key}>
                {tx(f.label)}
              </option>
            ))}
          </datalist>
          <Button size="sm" variant="ghost" icon="X" onClick={() => setAdding(false)} />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2 text-[12px] text-muted hover:border-line-strong hover:text-fg"
        >
          <Icon name="Plus" size={13} /> {t('props.addField')}
        </button>
      )}
    </div>
  )
}

function PropertyRow({
  label,
  value,
  kind,
  onChange,
  onDelete
}: {
  label: string
  value: PropValue
  kind?: string
  onChange: (text: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(formatValue(value))
  useEffect(() => setText(formatValue(value)), [value])
  const str = formatValue(value)
  const isUrl = typeof value === 'string' && /^https?:\/\//.test(value)
  const commit = (): void => {
    setEditing(false)
    if (text !== str) onChange(text)
  }
  return (
    <div className="group rounded-xl border border-line bg-panel-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted capitalize">{label}</span>
        <button onClick={onDelete} className="text-faint opacity-0 transition group-hover:opacity-100 hover:text-accent">
          <Icon name="X" size={12} />
        </button>
      </div>
      {editing ? (
        kind === 'textarea' || str.length > 60 ? (
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} className="field mt-1 min-h-20 !py-1" />
        ) : (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setText(str)
                setEditing(false)
              }
            }}
            className="field mt-1 !py-1"
          />
        )
      ) : (
        <div className="mt-0.5 flex items-start gap-1.5">
          <div onClick={() => setEditing(true)} className="min-w-0 flex-1 cursor-text text-[12.5px] leading-relaxed break-words select-text">
            {str || <span className="text-faint">…</span>}
          </div>
          {isUrl && (
            <button onClick={() => openExternal(value as string)} className="mt-0.5 text-muted hover:text-fg">
              <Icon name="ExternalLink" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function EnrichBlock({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const modules = useApp((s) => s.modules)
  const openSettings = useApp((s) => s.openSettings)
  const job = useApp((s) => Object.values(s.jobs).find((j) => j.nodeId === node.id && !j.finished))
  const [picker, setPicker] = useState(false)
  const applicable = useMemo(() => modulesForNode(node, modules), [node, modules])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  useEffect(() => {
    setChecked(new Set(applicable.filter((m) => !m.ondemand && m.enabled && m.configured).map((m) => m.id)))
  }, [applicable])

  const auto = applicable.filter((m) => !m.ondemand && m.enabled && m.configured).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {job ? (
          <Button className="flex-1" onClick={() => void api('modules:cancel', job.jobId)}>
            <Spinner /> {job.done}/{job.total} · {t('common.cancel')}
          </Button>
        ) : (
          <Button variant="primary" icon="Zap" className="flex-1" disabled={!node.label || auto === 0} onClick={() => void enrichNode(node.id)}>
            {t('enrich.button', { count: auto })}
          </Button>
        )}
        <Button icon="ListChecks" disabled={!node.label} onClick={() => setPicker(true)} title={t('enrich.choose')} />
      </div>
      <Dialog
        open={picker}
        onClose={() => setPicker(false)}
        title={t('enrich.chooseTitle')}
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setChecked(new Set())}>
              {t('enrich.none_')}
            </Button>
            <Button
              variant="primary"
              icon="Zap"
              disabled={checked.size === 0}
              onClick={() => {
                setPicker(false)
                void enrichNode(node.id, Array.from(checked))
              }}
            >
              {t('enrich.run', { count: checked.size })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1">
          {applicable.length === 0 && <div className="text-muted">{t('enrich.noneForType')}</div>}
          {applicable.map((m) => (
            <label key={m.id} className={`flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-panel-2 ${!m.configured ? 'opacity-60' : ''}`}>
              <input
                type="checkbox"
                disabled={!m.configured}
                checked={checked.has(m.id)}
                onChange={(e) => {
                  const next = new Set(checked)
                  if (e.target.checked) next.add(m.id)
                  else next.delete(m.id)
                  setChecked(next)
                }}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px]">
                  {tx(m.name)}
                  {m.ondemand && <span className="rounded bg-accent-soft px-1.5 text-[10px] text-accent">{t('modules.ondemand')}</span>}
                  {m.experimental && <span className="rounded bg-panel-3 px-1.5 text-[10px] text-warning">{t('modules.experimental')}</span>}
                </div>
                <div className="text-[11.5px] text-muted">{tx(m.description)}</div>
                {!m.configured && (
                  <button className="mt-0.5 text-[11.5px] text-accent hover:underline" onClick={() => openSettings('keys')}>
                    {t('modules.needsKey')}
                  </button>
                )}
              </div>
            </label>
          ))}
        </div>
      </Dialog>
    </div>
  )
}

function RunsList({ node }: { node: GraphNode }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { tx } = useLang()
  const inv = useGraph((s) => s.investigation)
  const modules = useApp((s) => s.modules)
  const jobKey = useApp((s) =>
    Object.values(s.jobs)
      .filter((j) => j.nodeId === node.id)
      .map((j) => `${j.jobId}:${j.done}:${j.finished}`)
      .join('|')
  )
  const [runs, setRuns] = useState<ModuleRun[]>([])
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState<{ title: string; data: unknown } | null>(null)

  useEffect(() => {
    if (!inv) return
    void api('modules:runs', inv.id, node.id).then(setRuns)
  }, [inv, node.id, jobKey])

  // Dernière exécution de chaque module.
  const latest = useMemo(() => {
    const m = new Map<string, ModuleRun>()
    for (const r of runs) if (!m.has(r.moduleId)) m.set(r.moduleId, r)
    return Array.from(m.values())
  }, [runs])
  if (!latest.length) return null

  const done = latest.filter((r) => r.status === 'done').length
  const results = latest.filter((r) => r.status === 'done' && (r.resultCount > 0 || r.found)).length
  const errors = latest.filter((r) => r.status === 'error').length
  const name = (id: string): string => {
    const m = modules.find((x) => x.id === id)
    return m ? tx(m.name) : id
  }

  return (
    <div className="border-t border-line pt-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 text-left text-[12px] text-muted hover:text-fg">
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={13} />
        {t('runs.summary', { done, results, errors })}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-0.5">
          {latest.map((r) => (
            <button
              key={r.id}
              onClick={() => void api('modules:runRaw', r.id).then((data) => setRaw({ title: name(r.moduleId), data }))}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-panel-2"
              title={r.error ?? undefined}
            >
              <RunIcon run={r} />
              <span className="min-w-0 flex-1 truncate">{name(r.moduleId)}</span>
              <span className="shrink-0 text-[11px] text-faint">
                {r.status === 'error'
                  ? t('runs.error')
                  : r.found === false
                    ? t('runs.notFound')
                    : r.found
                      ? t('runs.found')
                      : r.resultCount > 0
                        ? t('runs.results', { count: r.resultCount })
                        : r.status === 'done'
                          ? t('runs.empty')
                          : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      <Dialog open={!!raw} onClose={() => setRaw(null)} title={raw?.title} width={720}>
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-panel-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
          {raw?.data === null || raw?.data === undefined ? t('runs.noRaw') : JSON.stringify(raw.data, null, 2)}
        </pre>
      </Dialog>
    </div>
  )
}

function RunIcon({ run }: { run: ModuleRun }): React.JSX.Element {
  if (run.status === 'running' || run.status === 'queued') return <Spinner size={13} />
  if (run.status === 'error') return <Icon name="CircleX" size={13} className="text-accent" />
  if (run.status === 'cancelled') return <Icon name="CircleSlash" size={13} className="text-faint" />
  if (run.found || run.resultCount > 0) return <Icon name="CircleCheck" size={13} className="text-success" />
  return <Icon name="CircleMinus" size={13} className="text-faint" />
}

// ---------------------------------------------------------------------------
// Annotations (texte, image, carte, dessin)

function AnnotationSheet({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const updateNode = useGraph((s) => s.updateNode)
  const [label, setLabel] = useState(node.label)
  useDebouncedSave(label, (v) => v !== node.label && void updateNode(node.id, { label: v }))
  const num = (k: string): string => (typeof node.data[k] === 'number' ? String(node.data[k]) : '')
  const setNum = (k: string, v: string): void => {
    const n = Number(v.replace(',', '.'))
    void updateNode(node.id, { data: { ...node.data, [k]: Number.isFinite(n) ? n : null } })
  }
  return (
    <div className="flex flex-col gap-4">
      {node.kind !== 'drawing' && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-muted">{node.kind === 'text' ? t('props.text') : t('props.caption')}</span>
          <textarea value={label} onChange={(e) => setLabel(e.target.value)} className="field min-h-24 resize-y" />
        </label>
      )}
      {node.kind === 'image' && <ImageDrop node={node} />}
      {node.kind === 'map' && (
        <div className="grid grid-cols-3 gap-2">
          {(['lat', 'lon', 'zoom'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">{t(`props.${k}`)}</span>
              <input defaultValue={num(k)} onBlur={(e) => setNum(k, e.target.value)} className="field !py-1" />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function StyleTab({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const updateNode = useGraph((s) => s.updateNode)
  const set = (patch: Partial<GraphNode['style']>): void => void updateNode(node.id, { style: { ...node.style, ...patch } })
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-[11.5px] text-muted">{t('style.color')}</span>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => set({ color: c })}
              className="h-6 w-6 rounded-full"
              style={{ background: c, outline: node.style.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
            />
          ))}
          <input type="color" value={node.style.color ?? '#e5484d'} onChange={(e) => set({ color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
        </div>
      </div>
      {node.kind === 'entity' && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-[11.5px] text-muted">{t('style.size')}</span>
            <Tabs
              value={node.style.size ?? 'md'}
              onChange={(size) => set({ size })}
              items={[
                { id: 'sm', label: 'S' },
                { id: 'md', label: 'M' },
                { id: 'lg', label: 'L' }
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[11.5px] text-muted">{t('style.background')}</span>
            <div className="flex flex-wrap gap-2">
              {['', '#1a0f10', '#0f1a12', '#0f141a', '#16101a', '#1a170f'].map((c) => (
                <button
                  key={c || 'none'}
                  onClick={() => set({ bg: c || undefined })}
                  className="h-6 w-6 rounded-md border border-line-strong"
                  style={{ background: c || 'var(--node)', outline: (node.style.bg ?? '') === c ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between">
            <span className="text-[12.5px]">{t('style.hideSubtitle')}</span>
            <Switch checked={!!node.style.hideSubtitle} onChange={(v) => set({ hideSubtitle: v })} />
          </label>
        </>
      )}
      {node.kind === 'text' && (
        <label className="flex flex-col gap-2">
          <span className="text-[11.5px] text-muted">{t('style.fontSize')}</span>
          <input type="range" min={10} max={64} value={node.style.fontSize ?? 14} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
        </label>
      )}
      {node.kind === 'drawing' && (
        <label className="flex flex-col gap-2">
          <span className="text-[11.5px] text-muted">{t('style.strokeWidth')}</span>
          <input type="range" min={1} max={24} value={node.style.strokeWidth ?? 4} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} />
        </label>
      )}
      <Button variant="ghost" icon="RotateCcw" onClick={() => void updateNode(node.id, { style: {} })}>
        {t('style.reset')}
      </Button>
    </div>
  )
}

function NotesTab({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const updateNode = useGraph((s) => s.updateNode)
  const [notes, setNotes] = useState(node.notes)
  useDebouncedSave(notes, (v) => void updateNode(node.id, { notes: v }))
  return (
    <textarea
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      placeholder={t('props.notesPlaceholder')}
      className="field h-full min-h-72 resize-none leading-relaxed"
    />
  )
}

// ---------------------------------------------------------------------------
// Sélection multiple et liens

function MultiPanel({ nodes }: { nodes: GraphNode[] }): React.JSX.Element {
  const { t } = useTranslation()
  const updateNodes = useGraph((s) => s.updateNodes)
  const deleteNodes = useGraph((s) => s.deleteNodes)
  const entities = nodes.filter((n) => n.kind === 'entity')
  return (
    <>
      <PanelHeader kicker={t('props.selection')} title={t('props.selectedCount', { count: nodes.length })} />
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        <Button variant="primary" icon="Zap" disabled={!entities.length} onClick={() => entities.forEach((n) => void enrichNode(n.id))}>
          {t('enrich.selection', { count: entities.length })}
        </Button>
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] text-muted">{t('style.color')}</span>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => void updateNodes(nodes.map((n) => ({ id: n.id, style: { ...n.style, color: c } })))}
                className="h-6 w-6 rounded-full"
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <Button
          variant="danger"
          icon="Trash"
          onClick={async () => {
            if (await confirmDialog(t('canvas.deleteMany', { count: nodes.length }))) await deleteNodes(nodes.map((n) => n.id))
          }}
        >
          {t('canvas.deleteMany', { count: nodes.length })}
        </Button>
      </div>
    </>
  )
}

function EdgePanel({ edge }: { edge: GraphEdge }): React.JSX.Element {
  const { t } = useTranslation()
  const updateEdge = useGraph((s) => s.updateEdge)
  const deleteEdges = useGraph((s) => s.deleteEdges)
  const nodes = useGraph((s) => s.nodes)
  const [label, setLabel] = useState(edge.label)
  useDebouncedSave(label, (v) => v !== edge.label && void updateEdge(edge.id, { label: v }))
  const src = nodes.find((n) => n.id === edge.source)?.data.node
  const dst = nodes.find((n) => n.id === edge.target)?.data.node
  return (
    <>
      <PanelHeader kicker={t('props.selectedEdge')} title={t('props.edge')} />
      <div className="flex flex-col gap-4 border-t border-line px-5 py-4">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span className="truncate">{src?.label || '?'}</span>
          <Icon name="ArrowRight" size={13} className="shrink-0" />
          <span className="truncate">{dst?.label || '?'}</span>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-muted">{t('props.edgeLabel')}</span>
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} className="field" />
        </label>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => void updateEdge(edge.id, { style: { ...edge.style, color: c } })}
              className="h-6 w-6 rounded-full"
              style={{ background: c, outline: edge.style.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
            />
          ))}
        </div>
        <label className="flex items-center justify-between">
          <span className="text-[12.5px]">{t('style.dashed')}</span>
          <Switch checked={!!edge.style.dashed} onChange={(v) => void updateEdge(edge.id, { style: { ...edge.style, dashed: v } })} />
        </label>
        <label className="flex items-center justify-between">
          <span className="text-[12.5px]">{t('style.animated')}</span>
          <Switch checked={!!edge.style.animated} onChange={(v) => void updateEdge(edge.id, { style: { ...edge.style, animated: v } })} />
        </label>
        <Button variant="danger" icon="Trash" onClick={() => void deleteEdges([edge.id])}>
          {t('common.delete')}
        </Button>
        {edge.sourceModule !== 'manual' && <div className="text-[11px] text-faint">{t('props.source')} : {edge.sourceModule}</div>}
      </div>
    </>
  )
}
