// Alerte de doublon : une valeur saisie à la main (ou collée) existe déjà dans l'enquête.
// Rien n'est fusionné d'office ; le message propose d'aller au nœud existant ou de fusionner.

import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../store/app'
import { asOneStep, onDuplicate, useGraph, type DuplicateHit, type FlowEdge, type FlowNode } from '../store/graph'
import { revealNode } from '../store/view'

/** Paires déjà signalées (nœud saisi, nœud existant) : un seul message par paire. */
const notified = new Set<string>()

export function DuplicateAlerts(): null {
  const { t } = useTranslation()
  const rf = useReactFlow<FlowNode, FlowEdge>()

  useEffect(() => {
    let batch: DuplicateHit[] = []
    let timer: ReturnType<typeof setTimeout> | null = null

    const goTo = async (id: string): Promise<void> => {
      const app = useApp.getState()
      if (app.view !== 'graph') app.setView('graph')
      await revealNode(id)
      // Le canevas vient peut-être d'être affiché : on attend son rendu avant de centrer.
      setTimeout(() => {
        const n = useGraph.getState().nodes.find((x) => x.id === id)
        if (!n) return
        useGraph.getState().select([id])
        void rf.setCenter(n.position.x + 98, n.position.y + 26, { zoom: 1.2, duration: 400 })
      }, 60)
    }

    // La nouvelle saisie est absorbée par l'entité existante, qui garde ses liens et son historique.
    const merge = async (hits: DuplicateHit[]): Promise<void> => {
      const { mergeNodes, nodes } = useGraph.getState()
      const present = new Set(nodes.map((n) => n.id))
      let count = 0
      // Plusieurs fusions, une seule étape d'annulation.
      await asOneStep(async () => {
        for (const h of hits) {
          if (!present.has(h.nodeId) || !present.has(h.duplicateOf)) continue
          await mergeNodes(h.duplicateOf, [h.nodeId])
          count++
        }
      })
      if (count) useApp.getState().toast('success', t('duplicate.merged', { count }))
    }

    const flush = (): void => {
      timer = null
      const hits = batch
      batch = []
      const { nodes } = useGraph.getState()
      const live = hits.filter((h) => nodes.some((n) => n.id === h.nodeId))
      if (!live.length) return
      const { toast } = useApp.getState()
      if (live.length === 1) {
        const existing = nodes.find((n) => n.id === live[0].duplicateOf)?.data.node
        toast('info', t('duplicate.exists', { label: existing?.label ?? '' }), [
          { label: t('duplicate.goTo'), onClick: () => void goTo(live[0].duplicateOf) },
          { label: t('duplicate.merge'), onClick: () => void merge(live) }
        ])
        return
      }
      toast('info', t('duplicate.many', { count: live.length }), [
        { label: t('duplicate.select'), onClick: () => useGraph.getState().select(Array.from(new Set(live.map((h) => h.duplicateOf)))) },
        { label: t('duplicate.mergeAll'), onClick: () => void merge(live) }
      ])
    }

    const off = onDuplicate((hit) => {
      const key = `${hit.nodeId}|${hit.duplicateOf}`
      if (notified.has(key)) return
      notified.add(key)
      // Un collage de plusieurs lignes donne un seul message.
      batch.push(hit)
      if (!timer) timer = setTimeout(flush, 50)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [rf, t])

  return null
}
