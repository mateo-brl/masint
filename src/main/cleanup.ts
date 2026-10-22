// Rangement des enquêtes créées avant l'arrivée de « À vérifier » : les liens de recherche et
// les pseudos générés, ajoutés au graphe sans vérification, deviennent des résultats à vérifier.
// Ne touche qu'aux nœuds laissés tels quels (créés par un module, sans note, sans enfant).

import type { Repo } from './db/repo'

const GENERATED_USERNAME = new Set(['pseudo possible', 'possible username'])

export function moveNoiseToReview(repo: Repo): number {
  let moved = 0
  for (const inv of repo.listInvestigations()) {
    const edges = repo.listEdges(inv.id)
    const parents = new Set(edges.map((e) => e.source))
    const incoming = new Map<string, typeof edges>()
    for (const e of edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e])
    const remove: string[] = []
    for (const n of repo.listNodes(inv.id)) {
      const links = incoming.get(n.id) ?? []
      if (n.kind !== 'entity' || n.source === 'manual' || n.notes.trim() || parents.has(n.id) || links.length !== 1) continue
      const e = links[0]
      const base = { investigationId: inv.id, nodeId: e.source, moduleId: n.source, platform: n.platform, linkLabel: e.label }
      if (n.type === 'search_link' && typeof n.data.url === 'string') {
        const engine = typeof n.data.engine === 'string' ? n.data.engine : n.label.split(' : ')[0]
        repo.addSuggestion({ ...base, kind: 'manual', type: 'search_link', label: engine, data: {}, url: n.data.url, reason: '' })
      } else if (n.type === 'username' && GENERATED_USERNAME.has(e.label)) {
        repo.addSuggestion({ ...base, kind: 'entity', type: 'username', label: n.label, data: n.data, url: null, reason: 'pseudo généré, non vérifié' })
      } else continue
      remove.push(n.id)
    }
    if (remove.length) {
      repo.deleteNodes(inv.id, remove)
      moved += remove.length
    }
  }
  return moved
}
