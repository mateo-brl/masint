// Import en masse : fichier CSV ou texte, ou collage. Chaque colonne reçoit un type d'entité
// (suggéré d'après ses valeurs) ; les valeurs déjà présentes dans l'enquête sont reprises au
// lieu d'être recréées, et les nouvelles sont rangées en grille dans un espace libre.

import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canonicalKey } from '@shared/canonical'
import { ENTITY_TYPES } from '@shared/entityTypes'
import { overlaps } from '@shared/placement'
import {
  detectSeparator,
  gridLayout,
  guessHeader,
  MAX_IMPORT_ROWS,
  parseDelimited,
  planImport,
  suggestColumnType,
  type ImportColumn,
  type Separator
} from '@shared/tabular'
import type { EdgeInput, NodeInput } from '@shared/types'
import { enrichNode, useVisibleCenter } from '../../lib/actions'
import { errorMessage } from '../../lib/errors'
import { useLang } from '../../lib/i18n'
import { occupiedBoxes, placeAround } from '../../lib/viewport'
import { useApp, type ImportSeed } from '../../store/app'
import { asOneStep, useGraph } from '../../store/graph'
import { Button, Dialog, Switch } from '../ui'

/** Taille maximale d'un fichier importé. */
const MAX_FILE_BYTES = 20 * 1024 * 1024
const PREVIEW_ROWS = 10
const MAX_COLUMNS = 40

type SepMode = 'auto' | 'comma' | 'semicolon' | 'tab' | 'none'
const SEP_OF: Record<Exclude<SepMode, 'auto'>, Separator | null> = { comma: ',', semicolon: ';', tab: '\t', none: null }
const SEP_NAME = (s: Separator | null): Exclude<SepMode, 'auto'> => (s === ',' ? 'comma' : s === ';' ? 'semicolon' : s === '\t' ? 'tab' : 'none')

/**
 * Texte d'un fichier : UTF-8, sinon Windows-1252 (CSV enregistrés par Excel en français),
 * reconnu aux caractères de remplacement du décodage UTF-8.
 */
export async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) return utf8
  try {
    return new TextDecoder('windows-1252').decode(buf)
  } catch {
    return utf8
  }
}

interface ImportResult {
  created: number
  existing: number
  ignored: number
  links: number
}

export function ImportDialog(): React.JSX.Element | null {
  const open = useApp((s) => s.importOpen)
  const seed = useApp((s) => s.importSeed)
  if (!open) return null
  return <ImportBody seed={seed} onClose={() => useApp.getState().setImportOpen(false)} />
}

function ImportBody({ seed, onClose }: { seed: ImportSeed | null; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const center = useVisibleCenter()
  const toast = useApp((s) => s.toast)
  const graphNodes = useGraph((s) => s.nodes)
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(seed?.text ?? '')
  const [fileName, setFileName] = useState(seed?.name ?? '')
  const [sepMode, setSepMode] = useState<SepMode>('auto')
  const [header, setHeader] = useState<boolean | null>(null)
  const [overrides, setOverrides] = useState<Record<number, string | null>>({})
  const [link, setLink] = useState(false)
  const [enrich, setEnrich] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const detected = useMemo(() => detectSeparator(text), [text])
  const sep = sepMode === 'auto' ? detected : SEP_OF[sepMode]
  // Une ligne de plus que la limite, pour savoir si le fichier a été tronqué.
  const allRows = useMemo(() => parseDelimited(text, sep, MAX_IMPORT_ROWS + 2), [text, sep])
  const guessedHeader = useMemo(() => guessHeader(allRows), [allRows])
  const hasHeader = header ?? guessedHeader
  const { headerRow, rows, truncated } = useMemo(() => {
    const body = hasHeader ? allRows.slice(1) : allRows
    return { headerRow: hasHeader ? allRows[0] : null, rows: body.slice(0, MAX_IMPORT_ROWS), truncated: body.length > MAX_IMPORT_ROWS }
  }, [allRows, hasHeader])
  const columnCount = Math.min(MAX_COLUMNS, rows.reduce((m, r) => Math.max(m, r.length), headerRow?.length ?? 0))
  const suggested = useMemo(
    () => Array.from({ length: columnCount }, (_, c) => suggestColumnType(rows.map((r) => r[c] ?? ''))),
    [rows, columnCount]
  )
  const columns: ImportColumn[] = useMemo(
    () =>
      Array.from({ length: columnCount }, (_, c) => ({
        type: c in overrides ? overrides[c] : suggested[c],
        header: headerRow?.[c]?.trim() ?? ''
      })),
    [columnCount, overrides, suggested, headerRow]
  )
  // Valeurs déjà dans l'enquête, par clé canonique (même règle que la base).
  const existingKeys = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of graphNodes) {
      const node = n.data.node
      if (node.kind === 'entity' && node.label.trim()) {
        const key = canonicalKey(node.type, node.label, node.platform)
        if (!map.has(key)) map.set(key, node.id)
      }
    }
    return map
  }, [graphNodes])
  const plan = useMemo(() => planImport(rows, columns, existingKeys, link), [rows, columns, existingKeys, link])

  const loadFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return toast('error', t('importer.tooBig'))
    try {
      setText(await readTextFile(file))
      setFileName(file.name)
      setOverrides({})
      setHeader(null)
      setResult(null)
    } catch {
      toast('error', t('importer.readError'))
    }
  }

  const run = async (): Promise<void> => {
    const inv = useGraph.getState().investigation
    if (!inv) return
    setBusy(true)
    try {
      const layout = gridLayout(plan.create, columns, link)
      const origin = freeArea(center(), layout.width, layout.height)
      const inputs: NodeInput[] = plan.create.map((e, i) => ({
        id: crypto.randomUUID(),
        kind: 'entity',
        type: e.type,
        label: e.label,
        platform: e.platform,
        x: origin.x + layout.positions[i].x,
        y: origin.y + layout.positions[i].y
      }))
      const idByKey = new Map<string, string>(plan.existing)
      plan.create.forEach((e, i) => idByKey.set(e.key, inputs[i].id!))
      const { edges } = useGraph.getState()
      const pair = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
      const linked = new Set(edges.map((e) => pair(e.source, e.target)))
      const edgeInputs: EdgeInput[] = []
      for (const l of plan.links) {
        const source = idByKey.get(l.from)
        const target = idByKey.get(l.to)
        if (!source || !target || source === target || linked.has(pair(source, target))) continue
        linked.add(pair(source, target))
        edgeInputs.push({ source, target, label: l.label })
      }
      // Nœuds puis liens : une seule étape d'annulation pour tout l'import.
      await asOneStep(async () => {
        if (inputs.length) await useGraph.getState().addNodes(inputs, true)
        if (edgeInputs.length) await useGraph.getState().addEdges(edgeInputs)
      })
      if (enrich && inputs.length) {
        for (const n of inputs) await enrichNode(n.id!, undefined, inputs.length > 1 ? { chain: false } : {})
        toast('info', t('importer.enriching', { count: inputs.length }))
      }
      setResult({ created: inputs.length, existing: plan.existing.size, ignored: plan.ignored, links: edgeInputs.length })
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const sepLabel = (s: Exclude<SepMode, 'auto'>): string => t(`importer.sep.${s}`)
  const nothing = !plan.create.length && !plan.links.length

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('importer.title')}
      width={880}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon="Upload" disabled={busy || nothing} onClick={() => void run()}>
              {busy ? t('importer.running') : t('importer.run')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col items-start gap-2 text-[13px]">
          <div className="text-[14px] font-semibold">{t('importer.done')}</div>
          <ul className="flex flex-col gap-1 text-muted">
            <li>{t('importer.created', { count: result.created })}</li>
            <li>{t('importer.existing', { count: result.existing })}</li>
            <li>{t('importer.ignored', { count: result.ignored })}</li>
            {result.links > 0 && <li>{t('importer.links', { count: result.links })}</li>}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-[12.5px]">
          <p className="text-muted">{t('importer.intro')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                void loadFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <Button icon="FolderOpen" onClick={() => fileInput.current?.click()}>
              {t('importer.chooseFile')}
            </Button>
            {fileName && <span className="truncate font-medium">{fileName}</span>}
            {text && (
              <Button
                variant="ghost"
                size="sm"
                icon="X"
                onClick={() => {
                  setText('')
                  setFileName('')
                  setOverrides({})
                  setHeader(null)
                }}
              >
                {t('importer.clear')}
              </Button>
            )}
          </div>
          {!fileName && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('importer.pastePlaceholder')}
              rows={5}
              className="field font-mono !text-[12px]"
              spellCheck={false}
            />
          )}
          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <span className="text-muted">{t('importer.separator')}</span>
                  <select value={sepMode} onChange={(e) => setSepMode(e.target.value as SepMode)} className="field !w-auto !py-1">
                    <option value="auto">{t('importer.sepAuto', { sep: sepLabel(SEP_NAME(detected)) })}</option>
                    {(['comma', 'semicolon', 'tab', 'none'] as const).map((s) => (
                      <option key={s} value={s}>
                        {sepLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={hasHeader} onChange={(v) => setHeader(v)} />
                  <span>{t('importer.header')}</span>
                </label>
              </div>
              <div>
                <div className="mb-1.5 text-[11.5px] text-muted">{t('importer.preview', { count: Math.min(PREVIEW_ROWS, rows.length) })}</div>
                <div className="max-h-72 overflow-auto rounded-lg border border-line">
                  <table className="w-full border-collapse text-[12px]">
                    <thead className="sticky top-0 bg-panel-2">
                      <tr>
                        {columns.map((col, c) => (
                          <th key={c} className="min-w-36 border-b border-line px-2 py-1.5 text-left font-normal">
                            <div className="mb-1 truncate font-semibold" title={col.header}>
                              {col.header || t('importer.column', { n: c + 1 })}
                            </div>
                            <select
                              value={col.type ?? ''}
                              onChange={(e) => setOverrides({ ...overrides, [c]: e.target.value || null })}
                              className="field !py-0.5 !text-[12px]"
                            >
                              <option value="">{t('importer.ignore')}</option>
                              {ENTITY_TYPES.map((et) => (
                                <option key={et.id} value={et.id}>
                                  {tx(et.label)}
                                </option>
                              ))}
                            </select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                        <tr key={i} className="border-b border-line/60 last:border-0">
                          {columns.map((col, c) => (
                            <td key={c} className={`max-w-56 truncate px-2 py-1 ${col.type ? '' : 'text-faint'}`} title={r[c] ?? ''}>
                              {r[c] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <Switch checked={link} onChange={setLink} disabled={columns.filter((c) => c.type).length < 2} />
                  <span>{t('importer.link')}</span>
                  <span className="text-faint">{t('importer.linkHint')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={enrich} onChange={setEnrich} />
                  <span>{t('importer.enrich')}</span>
                </label>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
                <span>{t('importer.rows', { count: rows.length })}</span>
                <span className="text-fg">{t('importer.toCreate', { count: plan.create.length })}</span>
                <span>{t('importer.existing', { count: plan.existing.size })}</span>
                <span>{t('importer.ignored', { count: plan.ignored })}</span>
                {link && <span>{t('importer.links', { count: plan.links.length })}</span>}
              </div>
              {truncated && <div className="text-warning">{t('importer.truncated', { count: MAX_IMPORT_ROWS })}</div>}
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

/**
 * Coin haut gauche d'une zone libre de `width` × `height` près de `center` ; si la zone visible
 * est encombrée, à droite de tout le graphe (toujours libre).
 */
function freeArea(center: { x: number; y: number }, width: number, height: number): { x: number; y: number } {
  const size = { width: Math.max(width, 1), height: Math.max(height, 1) }
  const [spot] = placeAround(center, [size])
  const occupied = occupiedBoxes()
  const box = { ...spot, ...size }
  if (!occupied.some((o) => overlaps(box, o, 24))) return spot
  const right = Math.max(...occupied.map((o) => o.x + o.width))
  const top = Math.min(...occupied.map((o) => o.y))
  return { x: right + 160, y: top }
}
