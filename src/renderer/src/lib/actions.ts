// Actions partagées par les barres d'outils, menus et panneaux.

import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { detectEntity } from '@shared/detect'
import type { GraphNode, ModuleInfo, NodeInput } from '@shared/types'
import { useApp } from '../store/app'
import { useGraph } from '../store/graph'
import { api } from './api'
import i18n from './i18n'

/** Modules affichés pour un nœud (le filtre `accepts` du module est appliqué côté moteur). */
export function modulesForNode(node: GraphNode, modules: ModuleInfo[]): ModuleInfo[] {
  if (node.kind !== 'entity') return []
  return modules.filter((m) => m.inputTypes.includes(node.type) || m.inputTypes.includes('*'))
}

export async function enrichNode(nodeId: string, moduleIds?: string[]): Promise<void> {
  const { investigation } = useGraph.getState()
  const { toast } = useApp.getState()
  if (!investigation) return
  try {
    const { jobId } = await api('modules:enrich', investigation.id, nodeId, moduleIds)
    const job = useApp.getState().jobs[jobId]
    if (job && job.total === 0) toast('info', i18n.t('enrich.none'))
  } catch (e) {
    toast('error', e instanceof Error ? e.message : String(e))
  }
}

/** Position (coordonnées du graphe) du centre de la zone visible, avec un léger décalage aléatoire. */
export function useViewportCenter(): () => { x: number; y: number } {
  const rf = useReactFlow()
  return useCallback(() => {
    const el = document.querySelector('.react-flow') as HTMLElement | null
    const rect = el?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const p = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    return { x: p.x - 98 + (Math.random() - 0.5) * 60, y: p.y - 19 + (Math.random() - 0.5) * 60 }
  }, [rf])
}

export async function addEntityAt(
  type: string,
  pos: { x: number; y: number },
  extra: Partial<NodeInput> = {}
): Promise<GraphNode | undefined> {
  const [node] = await useGraph.getState().addNodes([{ kind: 'entity', type, label: '', x: pos.x, y: pos.y, ...extra }])
  const settings = useApp.getState().settings
  if (node && node.label && settings?.autoEnrich) void enrichNode(node.id)
  return node
}

/** Crée une entité à partir d'un texte libre (collage, saisie rapide). */
export async function addFromText(text: string, pos: { x: number; y: number }): Promise<GraphNode | undefined> {
  const d = detectEntity(text)
  if (!d) return undefined
  return addEntityAt(d.type, pos, { label: d.value, platform: d.platform ?? null })
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/** Ajoute des images (fichiers glissés ou collés) comme entités Photo. */
export async function addImageFiles(files: File[], pos: { x: number; y: number }): Promise<void> {
  const { investigation, addNodes } = useGraph.getState()
  if (!investigation) return
  const inputs: NodeInput[] = []
  let i = 0
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    const att = await api('attachments:add', investigation.id, { name: f.name || 'image', mime: f.type, base64: await fileToBase64(f) })
    inputs.push({ kind: 'entity', type: 'photo', label: f.name || 'Photo', imageId: att.id, x: pos.x + i * 30, y: pos.y + i * 30 })
    i++
  }
  if (inputs.length) await addNodes(inputs)
}
