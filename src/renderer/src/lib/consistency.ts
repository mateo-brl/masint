// Cohérence des indices autour d'un numéro, d'un email ou d'un pseudo : plusieurs identités
// différentes signalent un identifiant partagé ou réattribué (numéro recyclé par l'opérateur),
// et la période couverte par les indices datés aide à trancher.

import { getPlatform } from '@shared/platforms'
import { getEntityType } from '@shared/entityTypes'
import type { GraphEdge, GraphNode, PropValue } from '@shared/types'

export interface Identity {
  /** Nom le plus complet du groupe. */
  name: string
  /** Où ce nom apparaît (plateformes ou types d'entités). */
  sources: string[]
}

export interface Consistency {
  identities: Identity[]
  /** Années extrêmes des indices datés (comptes, fuites, infostealers...). */
  from?: number
  to?: number
  dated: number
}

/** Propriétés qui portent le nom d'une personne. */
const NAME_KEYS = ['display_name', 'full_name', 'real_name', 'name', 'owner_name', 'caller_name', 'twilio_caller_name', 'holder_name', 'contact_name']
/** Propriétés datées qui renseignent sur l'usage de l'identifiant (pas sur sa création par l'opérateur). */
const DATE_KEY = /(^|_)(date|created_at|created|first_seen|last_seen|joined|registered|breach_date|compromised|date_compromised|last_active|updated_at)$/
const IGNORED_DATE_KEYS = new Set(['arcep_attribution_date', 'arcep_declaration_date'])

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Mots significatifs d'un nom (initiales et mots très courts écartés). */
const tokens = (name: string): string[] => fold(name).split(' ').filter((w) => w.length >= 3)

function yearOf(v: PropValue | undefined): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const m = String(v).match(/\b(19[89]\d|20\d\d)\b/)
  const y = m ? Number(m[1]) : NaN
  return y >= 1990 && y <= new Date().getFullYear() + 1 ? y : null
}

function sourceOf(n: GraphNode): string {
  return getPlatform(n.platform)?.name ?? getEntityType(n.type).label.fr
}

/** Noms de personnes portés par un nœud (entité Personne ou propriétés de nom d'un compte). */
function namesOf(n: GraphNode): string[] {
  const out: string[] = []
  if (n.type === 'person' && n.label.trim()) out.push(n.label.trim())
  for (const k of NAME_KEYS) {
    const v = n.data[k]
    if (typeof v === 'string' && v.trim()) out.push(v.trim())
  }
  const first = n.data.first_name
  const last = n.data.last_name
  if (typeof first === 'string' && typeof last === 'string' && first.trim() && last.trim()) out.push(`${first.trim()} ${last.trim()}`)
  // Un nom d'une seule lettre ou masqué (« J*** ») n'identifie personne.
  return out.filter((s) => tokens(s).length > 0 && !/\*|•/.test(s))
}

export function analyzeConsistency(nodeId: string, nodes: GraphNode[], edges: GraphEdge[]): Consistency {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // Le nœud, ses enfants et petits-enfants : comptes trouvés et ce qu'ils révèlent.
  const scope = new Set([nodeId])
  let frontier = [nodeId]
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = []
    for (const e of edges)
      if (frontier.includes(e.source) && !scope.has(e.target)) {
        scope.add(e.target)
        next.push(e.target)
      }
    frontier = next
  }

  const groups: Array<{ words: Set<string>; names: string[]; sources: Set<string> }> = []
  const years: number[] = []
  for (const id of scope) {
    const n = byId.get(id)
    if (!n || n.kind !== 'entity') continue
    for (const name of namesOf(n)) {
      const words = tokens(name)
      // Même personne si les noms partagent un mot significatif (« Jean Dupont » / « J. Dupont »).
      const g = groups.find((x) => words.some((w) => x.words.has(w)))
      if (g) {
        words.forEach((w) => g.words.add(w))
        g.names.push(name)
        g.sources.add(sourceOf(n))
      } else groups.push({ words: new Set(words), names: [name], sources: new Set([sourceOf(n)]) })
    }
    for (const [k, v] of Object.entries(n.data)) {
      if (IGNORED_DATE_KEYS.has(k) || !DATE_KEY.test(k)) continue
      const y = yearOf(v)
      if (y) years.push(y)
    }
  }
  return {
    identities: groups
      .map((g) => ({ name: g.names.reduce((a, b) => (tokens(b).length > tokens(a).length ? b : a)), sources: Array.from(g.sources) }))
      .sort((a, b) => b.sources.length - a.sources.length),
    from: years.length ? Math.min(...years) : undefined,
    to: years.length ? Math.max(...years) : undefined,
    dated: years.length
  }
}
