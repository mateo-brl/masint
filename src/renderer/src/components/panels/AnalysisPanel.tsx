import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { topScores, type Communities } from '../../lib/analysis'
import { centralityAsync, communitiesAsync, type Centrality } from '../../lib/analysisAsync'
import { focusNode } from '../../lib/focus'
import { EntityBadge, Icon } from '../../lib/icons'
import { analysisGraph, clearPath, showShortestPath, useAnalysis } from '../../store/analysis'
import { useApp } from '../../store/app'
import { COMMUNITY_COLORS } from '../../store/canvas'
import { useGraph, type FlowNode } from '../../store/graph'
import { useGraphView } from '../../store/view'
import { Button, Spinner, Switch } from '../ui'

/** Nombre de nœuds listés par classement. */
const TOP = 8

/**
 * Panneau « Analyse » : plus court chemin entre deux nœuds sélectionnés, nœuds pivots (degré,
 * intermédiarité) et communautés. Les calculs suivent la structure du graphe (pas les
 * déplacements) et partent dans un Worker sur les grands graphes.
 */
export function AnalysisPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const catalogOpen = useApp((s) => s.catalogOpen)
  const close = (): void => useApp.getState().togglePanel('analysisOpen', false)
  const view = useGraphView()
  // Sélection résumée en texte : le panneau n'est re-rendu que si elle change.
  const selectionKey = useGraph((s) => {
    let key = ''
    for (const n of s.nodes) if (n.selected && n.data.node.kind === 'entity') key += `${n.id}|`
    return key
  })
  const selection = useMemo(() => selectionKey.split('|').filter(Boolean), [selectionKey])
  const path = useAnalysis((s) => s.path)
  const colorBy = useAnalysis((s) => s.colorByCommunity)

  // Calculs à chaque changement de structure (même vue pendant un glisser : pas de recalcul).
  const [centrality, setCentrality] = useState<Centrality | null>(null)
  const [groups, setGroups] = useState<Communities | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    setBusy(true)
    const graph = analysisGraph(view)
    void Promise.all([centralityAsync(graph), communitiesAsync(graph)])
      .then(([c, g]) => {
        if (!live) return
        setCentrality(c)
        setGroups(g)
      })
      .finally(() => live && setBusy(false))
    return () => {
      live = false
    }
  }, [view])

  const topDegree = useMemo(() => (centrality ? topScores(centrality.degree, TOP) : []), [centrality])
  const topBetween = useMemo(() => (centrality ? topScores(centrality.betweenness, TOP) : []), [centrality])
  const bigGroups = useMemo(() => (groups ? groups.members.filter((m) => m.length >= 2).slice(0, COMMUNITY_COLORS.length) : []), [groups])

  const row = (id: string, value: string, key: string): React.JSX.Element => <NodeRow key={key} id={id} value={value} />

  return (
    <aside
      data-panel="analysis"
      aria-label={t('analysis.title')}
      // Sous la barre du haut, à droite du catalogue s'il est ouvert.
      className="surface absolute top-[72px] bottom-20 z-20 flex w-[300px] flex-col overflow-hidden rounded-2xl"
      style={{ left: catalogOpen ? 300 : 16 }}
    >
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Icon name="ChartNetwork" size={15} className="text-muted" />
        <span className="font-semibold">{t('analysis.title')}</span>
        {busy && <Spinner size={12} />}
        <div className="flex-1" />
        <button onClick={close} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('common.close')} aria-label={t('common.close')}>
          <Icon name="X" size={15} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <section className="flex flex-col gap-2">
          <h3 className="label-xs">{t('analysis.shortestPath')}</h3>
          {path ? (
            <>
              <div className="text-[12px] text-muted">{t('analysis.pathFound', { count: path.edges.length })}</div>
              <ol className="flex flex-col">
                {path.nodes.map((id, i) => row(id, String(i), id))}
              </ol>
              <Button size="sm" variant="ghost" icon="X" onClick={clearPath}>
                {t('analysis.clearPath')}
              </Button>
            </>
          ) : (
            <>
              <p className="text-[12px] leading-snug text-muted">{t('analysis.pathHint')}</p>
              <Button size="sm" icon="Route" disabled={selection.length !== 2} onClick={() => void showShortestPath(selection[0], selection[1])}>
                {t('analysis.findPath')}
              </Button>
            </>
          )}
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="label-xs" title={t('analysis.degreeHint')}>
            {t('analysis.degree')}
          </h3>
          {topDegree.length ? topDegree.map((x) => row(x.id, String(x.score), `d:${x.id}`)) : <Empty busy={busy} />}
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="label-xs" title={t('analysis.betweennessHint')}>
            {t('analysis.betweenness')}
          </h3>
          <p className="text-[11.5px] leading-snug text-muted">{t('analysis.betweennessHint')}</p>
          {topBetween.length ? topBetween.map((x) => row(x.id, `${Math.round(x.score * 1000) / 10} %`, `b:${x.id}`)) : <Empty busy={busy} />}
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="label-xs">{t('analysis.communities')}</h3>
          <label className="flex items-center justify-between text-[12.5px]">
            {t('analysis.colorByCommunity')}
            <Switch checked={colorBy} onChange={(v) => useAnalysis.getState().setColorByCommunity(v)} />
          </label>
          {groups && (
            <div className="text-[11.5px] text-muted">
              {t('analysis.communityCount', { count: bigGroups.length })} · {t('analysis.modularity', { value: groups.modularity.toFixed(2) })}
            </div>
          )}
          {bigGroups.map((members, i) => (
            <button
              key={members[0]}
              onClick={() => useGraph.getState().select(members)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] hover:bg-panel-3"
              title={t('analysis.selectCommunity')}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COMMUNITY_COLORS[i] }} />
              <span className="min-w-0 flex-1 truncate">
                <Labels ids={members.slice(0, 3)} />
              </span>
              <span className="shrink-0 text-[11px] text-muted">{members.length}</span>
            </button>
          ))}
        </section>
      </div>
    </aside>
  )
}

function Empty({ busy }: { busy: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return <div className="px-2 text-[12px] text-muted">{busy ? t('analysis.computing') : t('analysis.nothing')}</div>
}

/** Index des nœuds par identifiant, construit une fois par version de la liste. */
const indexes = new WeakMap<FlowNode[], Map<string, FlowNode>>()
function nodeIndex(nodes: FlowNode[]): Map<string, FlowNode> {
  let m = indexes.get(nodes)
  if (!m) indexes.set(nodes, (m = new Map(nodes.map((n) => [n.id, n]))))
  return m
}

/** Ligne d'un nœud : ne lit que ce nœud (même objet pendant le glisser d'un autre). */
function NodeRow({ id, value }: { id: string; value: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  const n = useGraph((s) => nodeIndex(s.nodes).get(id)?.data.node)
  if (!n) return null
  return (
    <button
      onClick={() => void focusNode(n.id)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] hover:bg-panel-3"
      title={t('analysis.goTo')}
    >
      <EntityBadge type={n.type} platform={n.platform} size={16} />
      <span className="min-w-0 flex-1 truncate">{n.label || t('node.untitled')}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted">{value}</span>
    </button>
  )
}

/** Libellés de quelques nœuds, séparés par des virgules. */
function Labels({ ids }: { ids: string[] }): React.JSX.Element {
  const text = useGraph((s) => {
    const index = nodeIndex(s.nodes)
    return ids
      .map((id) => index.get(id)?.data.node.label)
      .filter(Boolean)
      .join(', ')
  })
  return <>{text}</>
}
