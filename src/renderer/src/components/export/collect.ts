// Collecte des données à exporter depuis l'interface : graphe courant, images jointes,
// icônes Lucide sérialisées en SVG.

import { icons } from 'lucide-react'
import type { GraphEdge, GraphNode, Investigation } from '@shared/types'
import { api } from '../../lib/api'
import { useGraph } from '../../store/graph'
import { currentView } from '../../store/view'
import { escapeHtml } from './format'

type IconNode = Array<[string, Record<string, string | number>]>
const iconCache = new Map<string, string>()

/** Éléments SVG d'une icône Lucide, extraits de la définition du composant. */
export function lucideMarkup(name: string): string {
  const cached = iconCache.get(name)
  if (cached !== undefined) return cached
  let out = ''
  try {
    const C = (icons as Record<string, unknown>)[name] as { render?: (props: object, ref: null) => unknown } | undefined
    const el = C?.render?.({}, null) as { props?: { icon?: { node?: IconNode }; iconNode?: IconNode } } | undefined
    const node = el?.props?.icon?.node ?? el?.props?.iconNode
    if (Array.isArray(node)) {
      out = node
        .filter(([tag]) => /^[a-z]+$/.test(tag))
        .map(([tag, attrs]) => {
          const a = Object.entries(attrs)
            .filter(([k]) => k !== 'key' && /^[a-zA-Z-]+$/.test(k))
            .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
            .join('')
          return `<${tag}${a}/>`
        })
        .join('')
    }
  } catch {
    out = ''
  }
  iconCache.set(name, out)
  return out
}

export interface GraphSnapshot {
  investigation: Investigation
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Dimensions mesurées par React Flow. */
  sizes: Record<string, { width: number; height: number }>
}

/**
 * État courant du graphe, positions du canevas comprises. Un filtre en mode « masquer » vaut
 * aussi pour l'export : seuls les nœuds affichés partent (les nœuds repliés ou regroupés, eux,
 * restent des données de l'enquête et sont exportés).
 */
export function graphSnapshot(): GraphSnapshot | null {
  const { investigation, nodes: all, edges } = useGraph.getState()
  if (!investigation) return null
  const filtered = currentView().filtered
  const nodes = filtered.size ? all.filter((n) => !filtered.has(n.id)) : all
  const sizes: GraphSnapshot['sizes'] = {}
  const list = nodes.map((n) => {
    const w = n.measured?.width ?? n.width
    const h = n.measured?.height ?? n.height
    if (w && h) sizes[n.id] = { width: w, height: h }
    return { ...n.data.node, x: n.position.x, y: n.position.y }
  })
  const ids = new Set(list.map((n) => n.id))
  return {
    investigation,
    nodes: list,
    edges: edges.map((e) => e.data?.edge).filter((e): e is GraphEdge => !!e && ids.has(e.source) && ids.has(e.target)),
    sizes
  }
}

const DISPLAYABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

/**
 * Pièce jointe en data URL. Les grandes images sont réduites (côté max `maxDim`)
 * et réencodées en WebP pour garder des exports de taille raisonnable.
 */
export async function attachmentDataUrl(id: string, maxDim: number): Promise<string | null> {
  const [meta, b64] = await Promise.all([api('attachments:get', id), api('attachments:readBase64', id)])
  if (!b64) return null
  const mime = meta?.mime?.toLowerCase() ?? 'image/png'
  const url = `data:${mime};base64,${b64}`
  let img: HTMLImageElement
  try {
    img = await loadImage(url)
  } catch {
    return null
  }
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) return null
  const big = Math.max(w, h) > maxDim || b64.length > 700_000
  if (!big && DISPLAYABLE.has(mime)) return url
  const k = Math.min(1, maxDim / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * k))
  canvas.height = Math.max(1, Math.round(h * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) return DISPLAYABLE.has(mime) ? url : null
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const out = canvas.toDataURL('image/webp', 0.85)
  return out.startsWith('data:image/webp') ? out : canvas.toDataURL('image/png')
}

/**
 * Miniature d'une capture pleine page : le haut de la page (rapport largeur sur hauteur 3:4),
 * réduit à `width` pixels de large, en WebP. Une page très haute réduite en entier serait illisible.
 */
export async function pageThumbnailDataUrl(id: string, width = 420): Promise<string | null> {
  const b64 = await api('attachments:readBase64', id)
  if (!b64) return null
  let img: HTMLImageElement
  try {
    img = await loadImage(`data:image/png;base64,${b64}`)
  } catch {
    return null
  }
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) return null
  const k = Math.min(1, width / w)
  const cropH = Math.min(h, Math.round((w * 4) / 3))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * k))
  canvas.height = Math.max(1, Math.round(cropH * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, cropH, 0, 0, canvas.width, canvas.height)
  const out = canvas.toDataURL('image/webp', 0.82)
  return out.startsWith('data:image/webp') ? out : canvas.toDataURL('image/png')
}

/**
 * Images de plusieurs pièces jointes, dans l'ordre donné, en s'arrêtant à `budget`
 * caractères au total. Renvoie aussi le nombre d'images écartées.
 */
export async function collectImages(
  requests: Array<{ id: string; maxDim: number }>,
  budget: number
): Promise<{ images: Record<string, string>; omitted: number }> {
  const images: Record<string, string> = {}
  let used = 0
  let omitted = 0
  const seen = new Set<string>()
  const unique = requests.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  for (let i = 0; i < unique.length; i += 6) {
    const batch = unique.slice(i, i + 6)
    const urls = await Promise.all(batch.map((r) => attachmentDataUrl(r.id, r.maxDim).catch(() => null)))
    batch.forEach((r, j) => {
      const u = urls[j]
      if (!u) return
      if (used + u.length > budget) {
        omitted++
        return
      }
      used += u.length
      images[r.id] = u
    })
  }
  return { images, omitted }
}

/** Rendu SVG des dessins à main levée, repris tel quel depuis le canevas. */
export function drawingMarkup(nodes: GraphNode[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of nodes) {
    if (n.kind !== 'drawing') continue
    const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(n.id)}"] svg`)
    if (el) out[n.id] = el.outerHTML
  }
  return out
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
