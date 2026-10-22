import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { attachmentUrl } from '@shared/api'
import { ENTITY_TYPES, getEntityType, type CategoryId } from '@shared/entityTypes'
import { propertyLabel } from '@shared/propertyLabels'
import { emailProvider, getPlatform, PLATFORMS } from '@shared/platforms'
import { captureUrlOf } from '@shared/evidence'
import type { Capture, GraphEdge, GraphNode, ModuleRun, PropValue } from '@shared/types'
import { canEnrich, enrichNode, enrichNodes, fileToBase64, modulesForNode, useApplicable } from '../../lib/actions'
import { api, onEvent, openLink } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Button, confirmDialog, Dialog, Spinner, Switch, Tabs } from '../ui'
import { ReviewList } from './ReviewList'
import { revealNode, useView } from '../../store/view'
import { computeView } from '../../lib/collapse'
import { analyzeConsistency } from '../../lib/consistency'

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

  const selBundle = useView((s) => Object.entries(s.bundles).find(([, b]) => b.selected)?.[0])
  let content: React.JSX.Element | null = null
  if (selBundle && !selNodes.length) content = <BundlePanel key={selBundle} bundleId={selBundle} />
  else if (selNodes.length === 1) content = <NodePanel key={selNodes[0].id} node={selNodes[0]} />
  else if (selNodes.length > 1) content = <MultiPanel nodes={selNodes} />
  else if (selEdges.length === 1) content = <EdgePanel key={selEdges[0].id} edge={selEdges[0]} />
  if (!content) return null

  return (
    <aside data-panel="properties" className="glass absolute top-4 right-4 bottom-20 z-20 flex w-[318px] flex-col overflow-hidden rounded-2xl">
      {content}
    </aside>
  )
}

/** Groupe automatique sélectionné : liste de ses éléments, dépliage. */
function BundlePanel({ bundleId }: { bundleId: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { tx } = useLang()
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const expanded = useView((s) => s.expanded)
  const bundle = useMemo(
    () =>
      computeView(
        nodes.map((n) => n.data.node),
        edges.map((e) => e.data!.edge),
        expanded
      ).bundles.find((b) => b.id === bundleId),
    [nodes, edges, expanded, bundleId]
  )
  if (!bundle) return null
  const members = bundle.members.map((id) => nodes.find((n) => n.id === id)?.data.node).filter((n): n is GraphNode => !!n)
  const typeLabel = tx(getEntityType(bundle.type).label)
  return (
    <>
      <PanelHeader title={t('bundle.count', { count: members.length, type: typeLabel })} kicker={bundle.linkLabel || typeLabel} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pt-3 pb-4">
        <p className="text-[12px] leading-snug text-muted">{t('bundle.intro')}</p>
        <Button variant="primary" icon="UnfoldVertical" onClick={() => void useView.getState().expandBundle(bundle.id)}>
          {t('bundle.expand')}
        </Button>
        <div className="text-[12.5px] font-semibold">{t('bundle.members')}</div>
        <div className="flex flex-col gap-1">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => void revealNode(m.id).then(() => useGraph.getState().select([m.id]))}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] hover:bg-panel-2"
            >
              <EntityBadge type={m.type} platform={m.platform} size={18} />
              <span className="min-w-0 flex-1 truncate">{m.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
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
        onClick={() => {
          useGraph.getState().select([])
          useView.getState().selectBundle(null)
        }}
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

/**
 * Texte modifiable localement (saisie fluide, sauvegarde différée) qui suit aussi les
 * changements venus d'ailleurs (édition sur le canevas, fusion, module) tant que
 * l'utilisateur n'a pas de saisie en attente.
 */
function useSyncedText(value: string, save: (v: string) => void): [string, (v: string) => void] {
  const [local, setLocal] = useState(value)
  const synced = useRef(value)
  useEffect(() => {
    if (value === synced.current) return
    if (local === synced.current) setLocal(value)
    synced.current = value
  }, [value])
  useDebouncedSave(local, (v) => {
    if (v === synced.current) return
    synced.current = v
    save(v)
  })
  return [local, setLocal]
}

function EntitySheet({ node }: { node: GraphNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const updateNode = useGraph((s) => s.updateNode)
  const def = getEntityType(node.type)
  const [label, setLabel] = useSyncedText(node.label, (v) => {
    const provider = node.type === 'email' && !node.platform ? emailProvider(v.trim())?.id : undefined
    void updateNode(node.id, { label: v, ...(provider ? { platform: provider } : {}) })
  })

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

      <NodeReview node={node} />
      <ConsistencyBlock node={node} />
      <div className="border-t border-line" />
      <div className="text-[12.5px] font-semibold">{t('props.imageInfo')}</div>
      <ImageDrop node={node} />
      <LinkedSummary node={node} />
      <PropertyList node={node} />
      <EvidenceBlock node={node} />
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
    await updateNode(node.id, { imageId: att.id, label: node.label || att.name })
  }
  const pick = async (): Promise<void> => {
    if (!inv) return
    const [att] = await api('attachments:pick', inv.id)
    // Une entité sans valeur prend le nom du fichier, pour pouvoir l'enrichir aussitôt.
    if (att) await updateNode(node.id, { imageId: att.id, label: node.label || att.name })
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

  const paste = async (): Promise<void> => {
    if (!inv) return
    const [att] = await api('attachments:paste', inv.id)
    if (att) await updateNode(node.id, { imageId: att.id, label: node.label || (node.kind === 'entity' ? att.name : node.label) })
    else useApp.getState().toast('info', t('props.noClipboardImage'))
  }

  return (
    <div className="flex flex-col gap-1.5">
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
      <Button size="sm" icon="ClipboardPaste" onClick={() => void paste()}>
        {t('props.pasteImage')}
      </Button>
    </div>
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
  const { tx, lang } = useLang()
  const updateNode = useGraph((s) => s.updateNode)
  const def = getEntityType(node.type)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [draft, setDraft] = useState<{ key: string; label: string; kind?: string } | null>(null)

  const fieldByKey = new Map(def.fields.map((f) => [f.key, f]))
  const keys = Object.keys(node.data).filter((k) => !k.startsWith('__'))
  // Champs du type d'abord, puis les autres dans leur ordre d'ajout : un champ créé à la main
  // reste à l'endroit où on vient de le saisir.
  const ordered = [...def.fields.map((f) => f.key).filter((k) => keys.includes(k)), ...keys.filter((k) => !fieldByKey.has(k))]
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
            label={f ? tx(f.label) : propertyLabel(k, lang)}
            value={node.data[k]}
            kind={f?.kind}
            onChange={(text) => setProp(k, parseValue(text, node.data[k], f?.kind))}
            onDelete={() => setProp(k, undefined)}
            onOpen={(url) => openLink(url, { investigationId: node.investigationId, nodeId: node.id })}
          />
        )
      })}
      {draft && (
        <PropertyRow
          key={`draft:${draft.key}`}
          label={draft.label}
          value=""
          kind={draft.kind}
          startEditing
          onChange={(text) => {
            setProp(draft.key, parseValue(text, null, draft.kind))
            setDraft(null)
          }}
          onCancel={() => setDraft(null)}
          onDelete={() => setDraft(null)}
        />
      )}
      {adding ? (
        <div className="flex gap-1.5">
          <input
            autoFocus
            list="masint-field-keys"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newKey.trim()) {
                const typed = newKey.trim()
                const key = typed.toLowerCase().replace(/\s+/g, '_')
                const field = def.fields.find((f) => f.key === key || tx(f.label).toLowerCase() === typed.toLowerCase())
                // Champ libre : le nom saisi est gardé tel quel (« Lieu de naissance »).
                const k = field?.key ?? typed
                if (node.data[k] === undefined) setDraft({ key: k, label: field ? tx(field.label) : newKey.trim(), kind: field?.kind })
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
  onDelete,
  onCancel,
  onOpen = (url) => openLink(url),
  startEditing = false
}: {
  label: string
  value: PropValue
  kind?: string
  onChange: (text: string) => void
  onDelete: () => void
  /** Ouverture d'une valeur qui est une adresse web (contexte de capture fourni par la fiche). */
  onOpen?: (url: string) => void
  /** Sortie d'édition sans valeur (brouillon de nouveau champ). */
  onCancel?: () => void
  startEditing?: boolean
}): React.JSX.Element {
  const [editing, setEditing] = useState(startEditing)
  const [text, setText] = useState(formatValue(value))
  useEffect(() => setText(formatValue(value)), [value])
  const str = formatValue(value)
  const isUrl = typeof value === 'string' && /^https?:\/\//.test(value)
  const commit = (): void => {
    setEditing(false)
    if (text !== str) onChange(text)
    else if (!text) onCancel?.()
  }
  return (
    <div className="group rounded-xl border border-line bg-panel-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={label}>{label}</span>
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
                if (!str) onCancel?.()
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
            <button onClick={() => onOpen(value as string)} className="mt-0.5 text-muted hover:text-fg">
              <Icon name="ExternalLink" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Preuves du nœud : captures de pages (image, date, adresse, empreinte du manifeste) et, pour
 * un nœud `url` ou `account`, capture de sa page dans une fenêtre cachée du navigateur d'enquête.
 */
function EvidenceBlock({ node }: { node: GraphNode }): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const toast = useApp((s) => s.toast)
  const [captures, setCaptures] = useState<Capture[]>([])
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<Capture | null>(null)
  const url = captureUrlOf(node)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void api('captures:list', node.investigationId, node.id).then((list) => alive && setCaptures(list))
    }
    load()
    const off = onEvent('captures:changed', (e) => {
      if (e.investigationId === node.investigationId && (e.nodeId === node.id || e.nodeId === null)) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [node.investigationId, node.id])

  if (!url && !captures.length) return null
  const locale = i18n.language?.startsWith('en') ? 'en-GB' : 'fr-FR'
  const capture = async (): Promise<void> => {
    setBusy(true)
    try {
      const c = await api('captures:capture', node.investigationId, node.id)
      toast('success', t('evidence.captured', { hash: `${c.manifestSha256.slice(0, 12)}…` }))
    } catch (e) {
      toast('error', t('evidence.failed', { error: errorMessage(e) }))
    } finally {
      setBusy(false)
    }
  }
  const save = async (attachmentId: string): Promise<void> => {
    const path = await api('attachments:save', attachmentId).catch((e: unknown) => {
      toast('error', errorMessage(e))
      return null
    })
    if (path) toast('success', t('evidence.saved', { path }))
  }
  const copy = (hash: string): void => void navigator.clipboard.writeText(hash).then(() => toast('success', t('evidence.copied')))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon name="Camera" size={14} className="text-muted" />
        <span className="flex-1 text-[12.5px] font-semibold">{t('evidence.title')}</span>
        {captures.length > 0 && <span className="text-[11px] text-faint">{t('evidence.count', { count: captures.length })}</span>}
        {url && (
          <Button size="sm" icon={busy ? undefined : 'Camera'} disabled={busy} onClick={() => void capture()} title={t('evidence.captureTitle')}>
            {busy && <Spinner size={12} />}
            {busy ? t('evidence.capturing') : t('evidence.capture')}
          </Button>
        )}
      </div>
      {captures.length === 0 && <div className="text-[11.5px] text-muted">{t('evidence.empty')}</div>}
      {captures.map((c) => (
        <div key={c.id} className="flex gap-2.5 rounded-xl border border-line bg-panel-2 p-2">
          <button onClick={() => setViewing(c)} className="shrink-0 overflow-hidden rounded-md border border-line" title={t('evidence.openImage')}>
            <img src={attachmentUrl(c.screenshotAttachment)} alt="" loading="lazy" draggable={false} className="h-14 w-16 object-cover object-top" />
          </button>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[11.5px] font-medium" title={c.capturedAt}>
              {new Date(c.capturedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' })}
            </div>
            <div
              className="mt-0.5 truncate text-[11px] text-muted"
              title={c.url !== c.finalUrl ? `${c.url}\n${t('evidence.redirected', { url: c.finalUrl })}` : c.finalUrl}
            >
              {c.finalUrl}
            </div>
            <button onClick={() => copy(c.manifestSha256)} className="mt-0.5 block truncate font-mono text-[10.5px] text-faint hover:text-fg" title={`${t('evidence.copyHash')}\n${c.manifestSha256}`}>
              SHA-256 {c.manifestSha256.slice(0, 16)}…
            </button>
          </div>
          <div className="flex shrink-0 flex-col gap-0.5">
            <button onClick={() => setViewing(c)} className="rounded p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('evidence.openImage')}>
              <Icon name="Image" size={13} />
            </button>
            <button onClick={() => void save(c.mhtmlAttachment)} className="rounded p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('evidence.exportMhtml')}>
              <Icon name="FileArchive" size={13} />
            </button>
            <button onClick={() => copy(c.manifestSha256)} className="rounded p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('evidence.copyHash')}>
              <Icon name="Fingerprint" size={13} />
            </button>
          </div>
        </div>
      ))}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.title || viewing?.finalUrl}
        width={980}
        footer={
          viewing && (
            <>
              <span className="mr-auto min-w-0 truncate font-mono text-[11px] text-muted" title={viewing.manifestSha256}>
                {t('evidence.manifest')} SHA-256 {viewing.manifestSha256}
              </span>
              <Button icon="FileArchive" onClick={() => void save(viewing.mhtmlAttachment)}>
                {t('evidence.exportMhtml')}
              </Button>
              <Button icon="Download" onClick={() => void save(viewing.screenshotAttachment)}>
                {t('evidence.exportImage')}
              </Button>
            </>
          )
        }
      >
        {viewing && (
          <div className="max-h-[68vh] overflow-auto rounded-lg border border-line bg-white">
            <img src={attachmentUrl(viewing.screenshotAttachment)} alt="" className="block w-full" draggable={false} />
          </div>
        )}
      </Dialog>
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
  // Décompte du moteur : mêmes filtres que l'exécution (valeur acceptée, clé, module actif).
  const server = useApplicable(node)
  const accepts = (id: string): boolean => !server || server.accepted.has(id)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  // Mode passif : les modules qui contactent la cible ne sont pas cochés d'office.
  const passive = useApp((s) => s.settings?.passiveMode ?? true)
  const byDefault = useMemo(
    () => applicable.filter((m) => !m.ondemand && !(passive && m.noisy) && m.enabled && m.configured),
    [applicable, passive]
  )
  useEffect(() => {
    setChecked(server ? new Set(server.auto) : new Set(byDefault.map((m) => m.id)))
  }, [byDefault, server])

  const auto = server ? server.auto.size : byDefault.length
  const enrichable = canEnrich(node)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {job ? (
          <Button className="flex-1" onClick={() => void api('modules:cancel', job.jobId)}>
            <Spinner /> {job.done}/{job.total} · {t('common.cancel')}
          </Button>
        ) : (
          <Button variant="primary" icon="Zap" className="flex-1" disabled={!enrichable || auto === 0} onClick={() => void enrichNode(node.id)}>
            {t('enrich.button', { count: auto })}
          </Button>
        )}
        <Button icon="ListChecks" disabled={!enrichable} onClick={() => setPicker(true)} title={t('enrich.choose')} />
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
            <label
              key={m.id}
              className={`flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-panel-2 ${!m.configured || !accepts(m.id) ? 'opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                disabled={!m.configured || !accepts(m.id)}
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
                  {m.noisy && <span className="rounded bg-panel-3 px-1.5 text-[10px] text-warning">{t('modules.noisy')}</span>}
                </div>
                <div className="text-[11.5px] text-muted">{tx(m.description)}</div>
                {!accepts(m.id) && <div className="mt-0.5 text-[11.5px] text-warning">{t('enrich.notApplicable')}</div>}
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

/**
 * Cohérence des indices rattachés à un identifiant : plusieurs identités différentes signalent un
 * numéro ou un email partagé, ou réattribué par l'opérateur.
 */
function ConsistencyBlock({ node }: { node: GraphNode }): React.JSX.Element | null {
  const { t } = useTranslation()
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const c = useMemo(
    () =>
      analyzeConsistency(
        node.id,
        nodes.map((n) => n.data.node),
        edges.map((e) => e.data!.edge)
      ),
    [node.id, nodes, edges]
  )
  if (!['phone', 'email', 'username'].includes(node.type) || (!c.identities.length && !c.dated)) return null
  const many = c.identities.length > 1
  const period = c.dated ? (c.from === c.to ? t('consistency.year', { year: c.from, count: c.dated }) : t('consistency.period', { from: c.from, to: c.to, count: c.dated })) : null
  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border p-2.5 text-[12px] ${many ? 'border-warning/40 bg-warning/5' : 'border-line bg-panel-2/40'}`}>
      <div className="flex items-center gap-2 font-semibold">
        <Icon name={many ? 'TriangleAlert' : 'UserCheck'} size={14} className={many ? 'text-warning' : 'text-success'} />
        {many ? t('consistency.many', { count: c.identities.length }) : c.identities.length ? t('consistency.one') : t('consistency.title')}
      </div>
      {c.identities.map((i) => (
        <div key={i.name} className="leading-snug">
          <span className="font-medium">{i.name}</span> <span className="text-muted">· {i.sources.join(', ')}</span>
        </div>
      ))}
      {period && <div className="text-muted">{period}</div>}
      {many && <div className="leading-snug text-muted">{t('consistency.hint')}</div>}
    </div>
  )
}

/** Résultats à vérifier issus de l'enrichissement de ce nœud. */
function NodeReview({ node }: { node: GraphNode }): React.JSX.Element | null {
  const { t } = useTranslation()
  const all = useGraph((s) => s.suggestions)
  const list = useMemo(() => all.filter((s) => s.nodeId === node.id), [all, node.id])
  if (!list.length) return null
  const pending = list.filter((s) => s.status === 'pending').length
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-panel-2/40 p-2.5">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold">
        <Icon name="ListTodo" size={14} className="text-warning" />
        {t('review.title')}
        {pending > 0 && <span className="rounded-full bg-warning/15 px-1.5 text-[10.5px] text-warning">{pending}</span>}
      </div>
      <ReviewList suggestions={list} />
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
        {t('runs.summaryLine', {
          done: t('runs.nDone', { count: done }),
          results: t('runs.nResults', { count: results }),
          errors: t('runs.nErrors', { count: errors })
        })}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-0.5">
          {latest.map((r) => (
            <button
              key={r.id}
              onClick={() => void api('modules:runRaw', r.id).then((data) => setRaw({ title: name(r.moduleId), data }))}
              className="flex flex-wrap items-center gap-x-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-panel-2"
            >
              <RunIcon run={r} />
              <span className="min-w-0 flex-1 truncate">{name(r.moduleId)}</span>
              {r.status === 'error' && r.error && (
                // Le message complet, sous le nom : une infobulle serait coupée par le bord du panneau.
                <span className="order-last w-full pl-[21px] text-[11px] leading-snug [overflow-wrap:anywhere] text-accent">{r.error}</span>
              )}
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
  const [label, setLabel] = useSyncedText(node.label, (v) => void updateNode(node.id, { label: v }))
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
      {node.kind === 'drawing' && (
        <div className="flex flex-col gap-3 text-[12.5px] text-muted">
          <div className="flex items-center gap-2">
            <Icon name="Pencil" size={14} /> {t('props.drawing')}
          </div>
          <Button variant="danger" icon="Trash" onClick={() => void useGraph.getState().deleteNodes([node.id])}>
            {t('common.delete')}
          </Button>
        </div>
      )}
      {node.kind === 'map' && (
        <div className="grid grid-cols-3 gap-2">
          {(['lat', 'lon', 'zoom'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">{t(`props.${k}`)}</span>
              <input key={num(k)} defaultValue={num(k)} onBlur={(e) => setNum(k, e.target.value)} className="field !py-1" />
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
        <>
          <label className="flex flex-col gap-2">
            <span className="text-[11.5px] text-muted">{t('style.fontSize')}</span>
            <input type="range" min={10} max={64} value={node.style.fontSize ?? 14} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-[11.5px] text-muted">{t('style.postit')}</span>
            <div className="flex flex-wrap gap-2">
              {['', '#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#e9d5ff'].map((c) => (
                <button
                  key={c || 'none'}
                  onClick={() => set({ bg: c || undefined })}
                  className="h-6 w-6 rounded-md border border-line-strong"
                  style={{ background: c || 'transparent', outline: (node.style.bg ?? '') === c ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }}
                />
              ))}
            </div>
          </div>
        </>
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
        <Button variant="primary" icon="Zap" disabled={!entities.length} onClick={() => void enrichNodes(entities)}>
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
  const [label, setLabel] = useSyncedText(edge.label, (v) => void updateEdge(edge.id, { label: v }))
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
