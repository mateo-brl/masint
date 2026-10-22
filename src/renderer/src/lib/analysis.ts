// Analyse du graphe : plus court chemin, nœuds pivots (degré, intermédiarité) et communautés.
// Les liens sont pris sans orientation : « A possède B » relie A et B dans les deux sens.
// Fonctions pures, sans dépendance : utilisables dans un Worker (voir analysis.worker.ts).

export interface AnalysisEdge {
  id: string
  source: string
  target: string
}

export interface AnalysisGraph {
  nodes: readonly string[]
  edges: readonly AnalysisEdge[]
}

export interface GraphPath {
  /** Nœuds du chemin, de l'origine à la destination. */
  nodes: string[]
  /** Liens empruntés, dans l'ordre. */
  edges: string[]
}

/** Graphe indexé : nœuds numérotés, voisins distincts de chaque nœud (sans boucle). */
interface Indexed {
  ids: string[]
  index: Map<string, number>
  /** Voisins de chaque nœud. */
  adj: number[][]
  /** Lien retenu pour chaque paire de voisins (`i:j`, i < j). */
  edgeOf: Map<string, string>
}

function indexGraph(g: AnalysisGraph): Indexed {
  const ids = Array.from(new Set(g.nodes))
  const index = new Map(ids.map((id, i) => [id, i]))
  const sets: Array<Set<number>> = ids.map(() => new Set())
  const edgeOf = new Map<string, string>()
  for (const e of g.edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    sets[a].add(b)
    sets[b].add(a)
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (!edgeOf.has(key)) edgeOf.set(key, e.id)
  }
  return { ids, index, adj: sets.map((s) => Array.from(s)), edgeOf }
}

/**
 * Plus court chemin (en nombre de liens) entre deux nœuds, par parcours en largeur. Parmi les
 * chemins de même longueur, le premier trouvé dans l'ordre des liens. `null` s'ils ne sont pas
 * reliés.
 */
export function shortestPath(g: AnalysisGraph, from: string, to: string): GraphPath | null {
  const { ids, index, adj, edgeOf } = indexGraph(g)
  const s = index.get(from)
  const t = index.get(to)
  if (s === undefined || t === undefined) return null
  if (s === t) return { nodes: [from], edges: [] }
  const prev = new Int32Array(ids.length).fill(-1)
  prev[s] = s
  const queue = [s]
  for (let head = 0; head < queue.length && prev[t] < 0; head++) {
    const v = queue[head]
    for (const w of adj[v])
      if (prev[w] < 0) {
        prev[w] = v
        queue.push(w)
      }
  }
  if (prev[t] < 0) return null
  const nodes: number[] = [t]
  while (nodes[nodes.length - 1] !== s) nodes.push(prev[nodes[nodes.length - 1]])
  nodes.reverse()
  const edges: string[] = []
  for (let i = 1; i < nodes.length; i++) {
    const a = Math.min(nodes[i - 1], nodes[i])
    const b = Math.max(nodes[i - 1], nodes[i])
    edges.push(edgeOf.get(`${a}:${b}`)!)
  }
  return { nodes: nodes.map((i) => ids[i]), edges }
}

/** Degré de chaque nœud : nombre de voisins distincts. */
export function degrees(g: AnalysisGraph): Map<string, number> {
  const { ids, adj } = indexGraph(g)
  return new Map(ids.map((id, i) => [id, adj[i].length]))
}

/**
 * Intermédiarité (algorithme de Brandes, graphe non orienté, non pondéré) : part des plus courts
 * chemins entre deux autres nœuds qui passent par chaque nœud, ramenée entre 0 et 1. Au-delà de
 * `maxSources` nœuds, le calcul part d'un échantillon régulier de sources et extrapole (estimation).
 */
export function betweenness(g: AnalysisGraph, opts: { maxSources?: number } = {}): Map<string, number> {
  const { ids, adj } = indexGraph(g)
  const n = ids.length
  const cb = new Float64Array(n)
  const sigma = new Float64Array(n)
  const dist = new Int32Array(n)
  const delta = new Float64Array(n)
  const stack = new Int32Array(n)
  const queue = new Int32Array(n)
  const preds: number[][] = ids.map(() => [])
  const maxSources = opts.maxSources ?? n
  const step = n > maxSources ? n / maxSources : 1
  let sources = 0
  for (let k = 0; k < n; k += step) {
    const s = Math.floor(k)
    sources++
    sigma.fill(0)
    dist.fill(-1)
    delta.fill(0)
    for (const p of preds) p.length = 0
    sigma[s] = 1
    dist[s] = 0
    let qh = 0
    let qt = 0
    let sp = 0
    queue[qt++] = s
    while (qh < qt) {
      const v = queue[qh++]
      stack[sp++] = v
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1
          queue[qt++] = w
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v]
          preds[w].push(v)
        }
      }
    }
    while (sp > 0) {
      const w = stack[--sp]
      for (const v of preds[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w])
      if (w !== s) cb[w] += delta[w]
    }
  }
  // Graphe non orienté : chaque chemin est compté dans les deux sens. Normalisation par le nombre
  // de paires d'autres nœuds ; extrapolation si seul un échantillon de sources a été parcouru.
  const pairs = ((n - 1) * (n - 2)) / 2
  const scale = (n / Math.max(1, sources)) * (pairs > 0 ? 1 / (2 * pairs) : 0)
  return new Map(ids.map((id, i) => [id, cb[i] * scale]))
}

export interface Communities {
  /** Communauté de chaque nœud : 0 pour la plus grande, puis par taille décroissante. */
  of: Map<string, number>
  /** Membres de chaque communauté, dans le même ordre. */
  members: string[][]
  /** Modularité de la partition (entre -0,5 et 1 ; au-delà de 0,3, structure nette). */
  modularity: number
}

/**
 * Communautés par la méthode de Louvain : chaque nœud rejoint la communauté de ses voisins qui
 * augmente le plus la modularité, puis les communautés sont fusionnées en super-nœuds, et ainsi
 * de suite tant que la modularité progresse. Ordre de parcours fixe : résultat reproductible.
 */
export function communities(g: AnalysisGraph): Communities {
  const { ids, adj } = indexGraph(g)
  const n = ids.length
  // Graphe pondéré du niveau courant : voisins et poids, boucles à part.
  let nbr: number[][] = adj.map((list) => list.slice())
  let wts: number[][] = adj.map((list) => list.map(() => 1))
  let loops = new Float64Array(n)
  /** Communauté (au niveau courant) de chaque nœud d'origine. */
  const assign = Int32Array.from({ length: n }, (_, i) => i)
  let size = n

  for (let level = 0; level < 32; level++) {
    const k = new Float64Array(size)
    let m2 = 0
    for (let i = 0; i < size; i++) {
      let s = 2 * loops[i]
      for (const w of wts[i]) s += w
      k[i] = s
      m2 += s
    }
    if (m2 === 0) break
    const comm = Int32Array.from({ length: size }, (_, i) => i)
    const tot = Float64Array.from(k)
    const link = new Float64Array(size)
    const touched: number[] = []
    let moved = false
    for (let pass = 0; pass < 64; pass++) {
      let improved = false
      for (let i = 0; i < size; i++) {
        const ci = comm[i]
        for (let x = 0; x < nbr[i].length; x++) {
          const c = comm[nbr[i][x]]
          if (link[c] === 0) touched.push(c)
          link[c] += wts[i][x]
        }
        tot[ci] -= k[i]
        let best = ci
        let bestGain = link[ci] - (tot[ci] * k[i]) / m2
        for (const c of touched) {
          const gain = link[c] - (tot[c] * k[i]) / m2
          if (gain > bestGain + 1e-12) {
            best = c
            bestGain = gain
          }
        }
        tot[best] += k[i]
        comm[i] = best
        for (const c of touched) link[c] = 0
        touched.length = 0
        if (best !== ci) improved = moved = true
      }
      if (!improved) break
    }
    if (!moved) break
    // Agrégation : une communauté devient un nœud ; liens internes en boucle, autres liens sommés.
    const renum = new Map<number, number>()
    for (let i = 0; i < size; i++) if (!renum.has(comm[i])) renum.set(comm[i], renum.size)
    const next = renum.size
    const nextLoops = new Float64Array(next)
    const maps: Array<Map<number, number>> = Array.from({ length: next }, () => new Map())
    for (let i = 0; i < size; i++) {
      const ci = renum.get(comm[i])!
      nextLoops[ci] += loops[i]
      for (let x = 0; x < nbr[i].length; x++) {
        const j = nbr[i][x]
        if (j < i) continue
        const cj = renum.get(comm[j])!
        if (ci === cj) nextLoops[ci] += wts[i][x]
        else {
          maps[ci].set(cj, (maps[ci].get(cj) ?? 0) + wts[i][x])
          maps[cj].set(ci, (maps[cj].get(ci) ?? 0) + wts[i][x])
        }
      }
    }
    for (let v = 0; v < n; v++) assign[v] = renum.get(comm[assign[v]])!
    nbr = maps.map((m) => Array.from(m.keys()))
    wts = maps.map((m) => Array.from(m.values()))
    loops = nextLoops
    size = next
    if (next === 1) break
  }

  // Numérotation par taille décroissante (à taille égale, ordre d'apparition).
  const groups = new Map<number, string[]>()
  for (let v = 0; v < n; v++) {
    const list = groups.get(assign[v])
    if (list) list.push(ids[v])
    else groups.set(assign[v], [ids[v]])
  }
  const members = Array.from(groups.values()).sort((a, b) => b.length - a.length)
  const of = new Map<string, number>()
  members.forEach((list, c) => list.forEach((id) => of.set(id, c)))
  return { of, members, modularity: modularity(adj, ids, of) }
}

/** Modularité d'une partition sur le graphe non pondéré d'origine. */
function modularity(adj: number[][], ids: string[], of: Map<string, number>): number {
  let m2 = 0
  for (const list of adj) m2 += list.length
  if (!m2) return 0
  const inner = new Map<number, number>()
  const tot = new Map<number, number>()
  adj.forEach((list, i) => {
    const c = of.get(ids[i])!
    tot.set(c, (tot.get(c) ?? 0) + list.length)
    for (const j of list) if (of.get(ids[j]) === c) inner.set(c, (inner.get(c) ?? 0) + 1)
  })
  let q = 0
  for (const [c, t] of tot) q += (inner.get(c) ?? 0) / m2 - (t / m2) ** 2
  return q
}

/** Premiers éléments d'un classement, du plus fort au plus faible, hors valeurs nulles. */
export function topScores(scores: ReadonlyMap<string, number>, limit: number): Array<{ id: string; score: number }> {
  return Array.from(scores, ([id, score]) => ({ id, score }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
}
