// Actions partagées par les barres d'outils, menus et panneaux.

import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'
import { detectEntity } from '@shared/detect'
import type { GraphNode, ModuleInfo, NodeInput } from '@shared/types'
import { useApp } from '../store/app'
import { useGraph, type FlowEdge, type FlowNode } from '../store/graph'
import { confirmDialog } from '../components/ui'
import { api } from './api'
import i18n, { currentLang } from './i18n'
import { errorMessage } from './errors'
import { placeAround, visibleCenter } from './viewport'
import { ENTITY_HEIGHT } from '@shared/placement'

/** Modules affichés pour un nœud (le filtre `accepts` du module est appliqué côté moteur). */
export function modulesForNode(node: GraphNode, modules: ModuleInfo[]): ModuleInfo[] {
  if (node.kind !== 'entity') return []
  return modules.filter((m) => m.inputTypes.includes(node.type) || m.inputTypes.includes('*'))
}

/** Une entité peut être enrichie dès qu'elle a une valeur ou une image. */
export function canEnrich(node: GraphNode): boolean {
  return node.kind === 'entity' && (!!node.label.trim() || !!node.imageId)
}

/**
 * Modules réellement lancés par « Enrichir » (`auto`) et modules qui acceptent la valeur du
 * nœud (`accepted`), calculés par le moteur avec les mêmes filtres que l'exécution.
 */
export function useApplicable(node: GraphNode | undefined): { auto: Set<string>; accepted: Set<string> } | null {
  const modules = useApp((s) => s.modules)
  const [state, setState] = useState<{ auto: Set<string>; accepted: Set<string> } | null>(null)
  const key = node ? JSON.stringify([node.id, node.type, node.label, node.platform, node.imageId, node.data]) : ''
  useEffect(() => {
    if (!node || node.kind !== 'entity') return setState(null)
    let live = true
    void api('modules:applicable', node.id)
      .then((r) => live && setState({ auto: new Set(r.auto), accepted: new Set(r.accepted) }))
      .catch(() => live && setState(null))
    return () => {
      live = false
    }
    // `key` résume le nœud : inutile de refaire l'appel à chaque rendu.
  }, [key, modules])
  return state
}

export async function enrichNode(nodeId: string, moduleIds?: string[]): Promise<void> {
  const { investigation } = useGraph.getState()
  const { toast, settings, modules } = useApp.getState()
  if (!investigation) return
  // Mode passif : un module qui contacte la cible ne part que choisi à la main, après avertissement.
  if (moduleIds?.length && settings?.passiveMode) {
    const noisy = modules.filter((m) => m.noisy && moduleIds.includes(m.id))
    const lang = currentLang()
    if (
      noisy.length &&
      !(await confirmDialog(
        i18n.t('enrich.noisyTitle', { count: noisy.length }),
        i18n.t('enrich.noisyBody', { count: noisy.length, list: noisy.map((m) => m.name[lang]).join(', ') }),
        false
      ))
    )
      return
  }
  try {
    const { jobId } = await api('modules:enrich', investigation.id, nodeId, moduleIds)
    const job = useApp.getState().jobs[jobId]
    if (job && job.total === 0) toast('info', i18n.t('enrich.none'))
  } catch (e) {
    toast('error', errorMessage(e))
  }
}

/** Au-delà de ce nombre de nœuds, « Enrichir » demande confirmation. */
export const BULK_ENRICH_CONFIRM = 10

/**
 * Enrichit plusieurs nœuds. Au-delà de dix, une confirmation annonce le volume (« 100 nœuds ×
 * 25 modules environ ») : une rafale vers les mêmes services déclenche des refus (429) et peut
 * faire repérer la sortie Tor.
 */
export async function enrichNodes(nodes: GraphNode[]): Promise<void> {
  const list = nodes.filter(canEnrich)
  if (list.length > BULK_ENRICH_CONFIRM) {
    const counts = await Promise.all(list.map((n) => api('modules:applicable', n.id).then((r) => r.auto.length, () => 0)))
    const perNode = Math.round(counts.reduce((a, b) => a + b, 0) / list.length)
    const ok = await confirmDialog(
      i18n.t('enrich.bulkTitle', { count: list.length }),
      i18n.t('enrich.bulkBody', { nodes: list.length, count: perNode }),
      false
    )
    if (!ok) return
  }
  for (const n of list) void enrichNode(n.id)
}

/**
 * Place des nœuds de tailles données dans un espace libre près du centre de la zone visible
 * (ou près de `at`, en coordonnées du graphe), sans chevaucher le graphe existant.
 */
export function usePlacement(): (sizes: Array<{ width: number; height: number }>, at?: { x: number; y: number }) => Array<{ x: number; y: number }> {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  return useCallback((sizes, at) => placeAround(at ?? visibleCenter(rf), sizes), [rf])
}

/** Centre (coordonnées du graphe) de la partie visible du canevas. */
export function useVisibleCenter(): () => { x: number; y: number } {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  return useCallback(() => visibleCenter(rf), [rf])
}

export const ENTITY_SIZE = { width: 196, height: ENTITY_HEIGHT }

/** Crée une entité à la place libre la plus proche de `at` (centre visé, coordonnées du graphe). */
export async function addEntityAt(
  type: string,
  at: { x: number; y: number },
  extra: Partial<NodeInput> = {}
): Promise<GraphNode | undefined> {
  const [spot] = placeAround(at, [ENTITY_SIZE])
  return createEntity(type, spot, extra)
}

async function createEntity(type: string, spot: { x: number; y: number }, extra: Partial<NodeInput>): Promise<GraphNode | undefined> {
  const [node] = await useGraph.getState().addNodes([{ kind: 'entity', type, label: '', x: spot.x, y: spot.y, ...extra }])
  const settings = useApp.getState().settings
  if (node && node.label && settings?.autoEnrich) void enrichNode(node.id)
  return node
}

/** Crée une entité à partir d'un texte libre (collage, saisie rapide). */
export async function addFromText(text: string, at: { x: number; y: number }): Promise<GraphNode | undefined> {
  const d = detectEntity(text)
  if (!d) return undefined
  return addEntityAt(d.type, at, { label: d.value, platform: d.platform ?? null })
}

/** Lignes prises en compte au plus par un collage. */
export const PASTE_MAX_LINES = 200

/**
 * Crée une entité par ligne reconnue, rangées ensemble dans un espace libre près de `at`.
 * Un collage plus long est coupé, avec un message ; l'enrichissement automatique passe par
 * `enrichNodes` (confirmation au-delà de dix nœuds).
 */
export async function addFromLines(lines: string[], at: { x: number; y: number }): Promise<void> {
  const { toast, settings } = useApp.getState()
  if (lines.length > PASTE_MAX_LINES) toast('info', i18n.t('canvas.pasteTruncated', { count: PASTE_MAX_LINES, total: lines.length }))
  const found = lines
    .slice(0, PASTE_MAX_LINES)
    .map((l) => detectEntity(l))
    .filter((d) => d !== null)
  if (!found.length) return
  const spots = placeAround(at, found.map(() => ENTITY_SIZE))
  const created = await useGraph
    .getState()
    .addNodes(found.map((d, i) => ({ kind: 'entity' as const, type: d.type, label: d.value, platform: d.platform ?? null, x: spots[i].x, y: spots[i].y })))
  if (settings?.autoEnrich) await enrichNodes(created)
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/** Ajoute des images (fichiers glissés ou collés) comme entités Photo, à la place libre la plus proche de `at`. */
export async function addImageFiles(files: File[], at: { x: number; y: number }): Promise<void> {
  const { investigation, addNodes } = useGraph.getState()
  if (!investigation) return
  const images = files.filter((f) => f.type.startsWith('image/'))
  const spots = placeAround(at, images.map(() => ENTITY_SIZE))
  const inputs: NodeInput[] = []
  for (const [i, f] of images.entries()) {
    const att = await api('attachments:add', investigation.id, { name: f.name || 'image', mime: f.type, base64: await fileToBase64(f) })
    inputs.push({ kind: 'entity', type: 'photo', label: f.name || 'Photo', imageId: att.id, x: spots[i].x, y: spots[i].y })
  }
  if (inputs.length) await addNodes(inputs)
}

/**
 * Colle les images du presse-papiers (image copiée ou fichiers image copiés dans l'explorateur).
 * La première va sur la photo sélectionnée si elle n'a pas encore d'image ; les autres deviennent
 * des entités Photo près de `at`. Renvoie `false` si le presse-papiers ne contient pas d'image.
 */
export async function pasteImages(at: { x: number; y: number }): Promise<boolean> {
  const { investigation, addNodes, updateNode, selectedNodes } = useGraph.getState()
  if (!investigation) return false
  const atts = await api('attachments:paste', investigation.id)
  if (!atts.length) return false
  const sel = selectedNodes()
  const target =
    sel.length === 1 && !sel[0].imageId && (sel[0].kind === 'image' || (sel[0].kind === 'entity' && sel[0].type === 'photo')) ? sel[0] : null
  const rest = target ? atts.slice(1) : atts
  if (target) await updateNode(target.id, { imageId: atts[0].id, label: target.label || (target.kind === 'entity' ? atts[0].name : target.label) })
  if (rest.length) {
    const spots = placeAround(at, rest.map(() => ENTITY_SIZE))
    await addNodes(rest.map((a, i) => ({ kind: 'entity' as const, type: 'photo', label: a.name, imageId: a.id, x: spots[i].x, y: spots[i].y })))
  }
  return true
}
