// Capture du graphe complet (et pas seulement la partie visible) avec html-to-image.

import { getNodesBounds, getViewportForBounds } from '@xyflow/react'
import { toPng, toSvg } from 'html-to-image'
import { ATTACHMENT_PROTOCOL } from '@shared/api'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { attachmentDataUrl } from './collect'
import { exportStrings } from './format'
import { currentLang } from '../../lib/i18n'
import { displayedNodes } from '../../store/view'

const PADDING = 48
// PNG transparent de 1 pixel.
const BLANK_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
/** Côté maximal de l'image en pixels CSS (avant le facteur de résolution). */
const MAX_SIDE = 8000
/** Surface maximale du canevas final, en pixels. */
const MAX_AREA = 120_000_000

const EXCLUDED = [
  'react-flow__minimap',
  'react-flow__controls',
  'react-flow__panel',
  'react-flow__handle',
  'react-flow__resize-control',
  'react-flow__nodesselection',
  'react-flow__selection'
]

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function viewportElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.react-flow__viewport')
}

function canvasColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#0a0a0b'
}

/**
 * Les images des nœuds passent par le protocole `masint-file://`, que la capture ne sait
 * pas relire : on les remplace le temps de la capture par des data URL.
 */
async function inlineAttachments(root: HTMLElement): Promise<() => void> {
  const prefix = `${ATTACHMENT_PROTOCOL}://att/`
  const restore: Array<() => void> = []
  const cache = new Map<string, Promise<string | null>>()
  const dataFor = (url: string): Promise<string | null> => {
    const id = url.slice(prefix.length).split(/[?#]/)[0]
    if (!cache.has(id)) cache.set(id, attachmentDataUrl(id, 1600).catch(() => null))
    return cache.get(id)!
  }
  const jobs: Promise<void>[] = []
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (!src?.startsWith(prefix)) return
    jobs.push(
      dataFor(src).then(async (data) => {
        if (!data) return
        img.setAttribute('src', data)
        restore.push(() => img.setAttribute('src', src))
        await img.decode().catch(() => undefined)
      })
    )
  })
  root.querySelectorAll('image').forEach((image) => {
    const href = image.getAttribute('href')
    if (!href?.startsWith(prefix)) return
    jobs.push(
      dataFor(href).then((data) => {
        if (!data) return
        image.setAttribute('href', data)
        restore.push(() => image.setAttribute('href', href))
      })
    )
  })
  root.querySelectorAll<HTMLElement>('[style*="masint-file"]').forEach((el) => {
    const bg = el.style.backgroundImage
    const m = /url\(["']?(masint-file:\/\/att\/[^"')]+)["']?\)/.exec(bg)
    if (!m) return
    jobs.push(
      dataFor(m[1]).then((data) => {
        if (!data) return
        el.style.backgroundImage = `url("${data}")`
        restore.push(() => (el.style.backgroundImage = bg))
      })
    )
  })
  await Promise.all(jobs)
  return () => restore.forEach((r) => r())
}

/** Bascule sur la vue graphe le temps d'une capture si une autre vue est affichée. */
async function withGraphView<T>(fn: () => Promise<T>): Promise<T> {
  if (viewportElement()) return fn()
  const app = useApp.getState()
  const previous = app.view
  app.setView('graph')
  const t0 = performance.now()
  // React Flow doit monter puis mesurer les nœuds.
  while (performance.now() - t0 < 4000) {
    await sleep(60)
    if (viewportElement() && displayedNodes().every((n) => n.measured?.width)) break
  }
  await nextFrame()
  try {
    return await fn()
  } finally {
    useApp.getState().setView(previous)
  }
}

export interface CaptureOptions {
  /** Facteur de résolution (2 par défaut pour le PNG). */
  pixelRatio?: number
  /** Côté maximal de l'image en pixels CSS. */
  maxSide?: number
  /** Thème du rendu (le rapport imprimé utilise le thème clair). Par défaut, le thème affiché. */
  theme?: 'light' | 'dark'
}

/** Applique un thème le temps de la capture et renvoie la fonction de retour à l'état initial. */
async function applyTheme(theme: 'light' | 'dark' | undefined): Promise<() => void> {
  const root = document.documentElement
  const previous = root.dataset.theme
  if (!theme || (previous ?? 'dark') === theme) return () => undefined
  root.dataset.theme = theme
  await nextFrame()
  await nextFrame()
  return () => {
    if (previous === undefined) delete root.dataset.theme
    else root.dataset.theme = previous
  }
}

async function capture(kind: 'png' | 'svg', opts: CaptureOptions = {}): Promise<string> {
  const s = exportStrings(currentLang()).exportx
  if (!displayedNodes().length) throw new Error(s.emptyGraph)
  return withGraphView(async () => {
    const el = viewportElement()
    if (!el) throw new Error(s.canvasHidden)
    // La sélection ne doit pas apparaître sur l'image.
    const selected = useGraph
      .getState()
      .nodes.filter((n) => n.selected)
      .map((n) => n.id)
    if (selected.length) {
      useGraph.getState().select([])
      await nextFrame()
      await nextFrame()
    }
    const restore = await inlineAttachments(el)
    const restoreTheme = await applyTheme(opts.theme)
    try {
      // Ce qui est affiché : nœuds repliés ou regroupés exclus, groupes inclus.
      const bounds = getNodesBounds(displayedNodes())
      const ratio = kind === 'png' ? (opts.pixelRatio ?? 2) : 1
      const natW = bounds.width + PADDING * 2
      const natH = bounds.height + PADDING * 2
      const zoom = Math.min(
        1,
        (opts.maxSide ?? MAX_SIDE) / Math.max(natW, natH),
        Math.sqrt(MAX_AREA / (natW * natH * ratio * ratio))
      )
      const width = Math.max(1, Math.ceil(natW * zoom))
      const height = Math.max(1, Math.ceil(natH * zoom))
      const vp = getViewportForBounds(bounds, width, height, zoom, zoom, `${Math.round(PADDING * zoom)}px`)
      const options = {
        backgroundColor: canvasColor(),
        width,
        height,
        pixelRatio: ratio,
        skipAutoScale: true,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`
        },
        filter: (node: HTMLElement) => !node.classList || !EXCLUDED.some((c) => node.classList.contains(c)),
        // Une image injoignable (tuile de carte hors ligne...) est remplacée au lieu de faire échouer la capture.
        imagePlaceholder: BLANK_PIXEL
      }
      return kind === 'png' ? await toPng(el, options) : await toSvg(el, options)
    } finally {
      restoreTheme()
      restore()
      if (selected.length) useGraph.getState().select(selected)
    }
  })
}

/** Graphe complet en PNG haute résolution (data URL). */
export function captureGraphPng(opts?: CaptureOptions): Promise<string> {
  return capture('png', opts)
}

/** Graphe complet en SVG (data URL). */
export function captureGraphSvg(opts?: CaptureOptions): Promise<string> {
  return capture('svg', opts)
}
