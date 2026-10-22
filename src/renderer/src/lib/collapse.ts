// Ce que le canevas affiche réellement : nœuds repliés par l'enquêteur (« Réduire ») et groupes
// automatiques de feuilles semblables (« 28 sous-domaines »). Les données ne changent pas : seul
// l'affichage est réduit.

export interface ViewNode {
  id: string
  kind: string
  type: string
  label: string
  platform: string | null
  notes: string
  style: { collapsed?: boolean; color?: string }
}

export interface ViewEdge {
  id: string
  source: string
  target: string
  label: string
}

export interface Bundle {
  /** `bundle:<parent>:<type>:<libellé du lien>` : stable tant que le groupe existe. */
  id: string
  parentId: string
  type: string
  platform: string | null
  linkLabel: string
  members: string[]
}

export interface GraphView {
  /** Nœuds masqués (descendance repliée ou membres d'un groupe). */
  hidden: Set<string>
  /** Nombre de nœuds masqués sous chaque nœud replié. */
  collapsedCount: Map<string, number>
  bundles: Bundle[]
  /** Groupe qui contient chaque nœud masqué par regroupement. */
  bundleOf: Map<string, string>
}

/** En dessous de ce nombre de feuilles semblables sous un même nœud, pas de regroupement. */
export const BUNDLE_MIN = 6

export function bundleId(parentId: string, type: string, linkLabel: string): string {
  return `bundle:${parentId}:${type}:${linkLabel}`
}

/** Dernier calcul, renvoyé tel quel tant que la structure du graphe ne change pas. */
let memo: {
  nodes: readonly ViewNode[]
  edges: readonly ViewEdge[]
  expanded: ReadonlySet<string>
  bundleMin: number
  key: string
  view: GraphView
} | null = null

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Tout ce que lit le calcul, et rien d'autre : identifiants, types, plateformes, repli, note et
 * couleur (qui empêchent le regroupement), liens et leurs libellés, groupes dépliés. Les positions
 * n'y figurent pas : déplacer un nœud ne change pas la vue.
 */
function structureKey(nodes: readonly ViewNode[], edges: readonly ViewEdge[], expanded: ReadonlySet<string>, bundleMin: number): string {
  const parts: string[] = [String(bundleMin)]
  for (const n of nodes)
    parts.push(n.id, n.kind, n.type, n.platform ?? '', n.style.collapsed ? '1' : '0', n.style.color ? '1' : '0', n.notes.trim() ? '1' : '0')
  parts.push('')
  for (const e of edges) parts.push(e.source, e.target, e.label)
  parts.push('', ...Array.from(expanded).sort())
  return parts.join('\u0000')
}

/**
 * Vue du graphe, mémorisée sur sa structure : tant que seules les positions changent (glisser un
 * nœud, disposition), le même objet est renvoyé, ce qui évite de re-rendre tout le canevas.
 * L'objet renvoyé est partagé : il ne doit pas être modifié.
 */
export function computeView(nodes: ViewNode[], edges: ViewEdge[], expandedBundles: ReadonlySet<string>, bundleMin = BUNDLE_MIN): GraphView {
  // Mêmes objets qu'au dernier appel (cas d'un glisser) : inutile de recalculer la clé.
  if (memo && memo.bundleMin === bundleMin && memo.expanded === expandedBundles && sameItems(memo.nodes, nodes) && sameItems(memo.edges, edges))
    return memo.view
  const key = structureKey(nodes, edges, expandedBundles, bundleMin)
  if (memo && memo.key === key) {
    memo = { ...memo, nodes, edges, expanded: expandedBundles }
    return memo.view
  }
  const view = buildView(nodes, edges, expandedBundles, bundleMin)
  memo = { nodes, edges, expanded: expandedBundles, bundleMin, key, view }
  return view
}

function buildView(nodes: ViewNode[], edges: ViewEdge[], expandedBundles: ReadonlySet<string>, bundleMin: number): GraphView {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map<string, ViewEdge[]>()
  const inc = new Map<string, ViewEdge[]>()
  const push = (m: Map<string, ViewEdge[]>, id: string, e: ViewEdge): void => {
    const list = m.get(id)
    if (list) list.push(e)
    else m.set(id, [e])
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue
    push(out, e.source, e)
    push(inc, e.target, e)
  }

  // 1. Descendance des nœuds repliés. Un descendant reste visible s'il est aussi rattaché à un
  // nœud visible et déplié.
  const collapsed = nodes.filter((n) => n.style.collapsed && (out.get(n.id)?.length ?? 0) > 0)
  const hidden = new Set<string>()
  const owner = new Map<string, string>()
  for (const root of collapsed) {
    const queue = [root.id]
    while (queue.length) {
      const id = queue.shift()!
      for (const e of out.get(id) ?? []) {
        if (e.target === root.id || hidden.has(e.target)) continue
        hidden.add(e.target)
        owner.set(e.target, root.id)
        queue.push(e.target)
      }
    }
  }
  for (const root of collapsed) hidden.delete(root.id)
  let changed = true
  while (changed) {
    changed = false
    for (const id of hidden) {
      const visibleParent = (inc.get(id) ?? []).some((e) => !hidden.has(e.source) && !byId.get(e.source)!.style.collapsed)
      if (visibleParent) {
        hidden.delete(id)
        owner.delete(id)
        changed = true
      }
    }
  }
  const collapsedCount = new Map<string, number>()
  for (const root of owner.values()) collapsedCount.set(root, (collapsedCount.get(root) ?? 0) + 1)

  // 2. Regroupement des feuilles semblables d'un nœud visible et déplié : même type, même lien,
  // un seul parent, aucun enfant, rien d'ajouté à la main (note, couleur).
  const groups = new Map<string, Bundle>()
  for (const n of nodes) {
    if (hidden.has(n.id) || n.kind !== 'entity' || n.notes.trim() || n.style.color || n.style.collapsed) continue
    if ((out.get(n.id)?.length ?? 0) > 0) continue
    const parents = inc.get(n.id) ?? []
    if (parents.length !== 1) continue
    const e = parents[0]
    const parent = byId.get(e.source)!
    if (hidden.has(parent.id) || parent.style.collapsed) continue
    const id = bundleId(parent.id, n.type, e.label)
    const g = groups.get(id) ?? { id, parentId: parent.id, type: n.type, platform: n.platform, linkLabel: e.label, members: [] }
    if (g.platform !== n.platform) g.platform = null
    g.members.push(n.id)
    groups.set(id, g)
  }
  const bundles = Array.from(groups.values()).filter((g) => g.members.length >= bundleMin && !expandedBundles.has(g.id))
  const bundleOf = new Map<string, string>()
  for (const b of bundles)
    for (const m of b.members) {
      hidden.add(m)
      bundleOf.set(m, b.id)
    }
  return { hidden, collapsedCount, bundles, bundleOf }
}

/** Nœuds repliés dont il faut déplier la chaîne pour rendre `id` visible. */
export function collapsedAncestors(id: string, nodes: ViewNode[], edges: ViewEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const parents = new Map<string, string[]>()
  for (const e of edges) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source])
  const found = new Set<string>()
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    for (const p of parents.get(queue.shift()!) ?? []) {
      if (seen.has(p)) continue
      seen.add(p)
      if (byId.get(p)?.style.collapsed) found.add(p)
      queue.push(p)
    }
  }
  return Array.from(found)
}
