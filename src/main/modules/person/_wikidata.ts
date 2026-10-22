// Accès à Wikidata partagé par les modules personne et organisation : recherche, fiches et
// libellés. L'API api.php renvoie parfois 429 par adresse IP quel que soit le User-Agent ; le
// module se replie alors sur le point SPARQL (query.wikidata.org, recherche EntitySearch et
// libellés) et sur Special:EntityData (fiche complète, servie par le cache de Wikimedia).

import { ModuleError, type HttpError, type ModuleContext, type OutEntity } from '@shared/modules'
import { getPlatform } from '@shared/platforms'

const API = 'https://www.wikidata.org/w/api.php'
const SPARQL = 'https://query.wikidata.org/sparql'
const ENTITY_DATA = 'https://www.wikidata.org/wiki/Special:EntityData'
// Politique de Wikimedia : un User-Agent qui identifie l'outil et permet de le contacter.
const USER_AGENT = 'MASINT (https://github.com/mateo-brl/masint)'

interface Snak {
  datavalue?: { value?: unknown }
}

export interface Claim {
  mainsnak?: Snak
  rank?: 'preferred' | 'normal' | 'deprecated'
  qualifiers?: Record<string, Snak[]>
}

export interface WdEntity {
  id: string
  labels?: Record<string, { value: string }>
  descriptions?: Record<string, { value: string }>
  claims?: Record<string, Claim[]>
}

export interface EntitiesResponse {
  entities?: Record<string, WdEntity>
}

interface SearchResponse {
  search?: Array<{ id: string; label?: string; description?: string }>
}

type Binding = Record<string, { value: string } | undefined>

/** Libellé et coordonnées d'un élément cité (lieu, employeur, proche...). */
export interface Resolved {
  label?: string
  lat?: number
  lon?: number
}

/** Candidat d'une recherche, avec ce qu'il faut pour choisir. */
export interface Candidate {
  id: string
  label?: string
  description?: string
  human: boolean
  organization: boolean
}

// ---------------------------------------------------------------------------
// Lecture des déclarations

/** Déclarations d'une propriété, sans les valeurs dépréciées. */
export function claimsOf(e: WdEntity, prop: string): Claim[] {
  return (e.claims?.[prop] ?? []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue?.value !== undefined)
}

/** Toutes les valeurs d'une propriété (P569 = naissance, P18 = image...), préférées d'abord. */
export function values<T>(e: WdEntity, prop: string): T[] {
  const list = claimsOf(e, prop)
  return [...list.filter((c) => c.rank === 'preferred'), ...list.filter((c) => c.rank !== 'preferred')].map((c) => c.mainsnak!.datavalue!.value as T)
}

/** Meilleure valeur : la préférée s'il y en a une, sinon la première. */
export const first = <T>(e: WdEntity, prop: string): T | undefined => values<T>(e, prop)[0]

/** Identifiant d'élément d'une valeur (`{ id: 'Q90' }`). */
export const itemId = (v: unknown): string | undefined => {
  const id = (v as { id?: unknown } | null)?.id
  return typeof id === 'string' && /^Q\d+$/.test(id) ? id : undefined
}

/** Valeur d'un qualificatif (P580 début, P582 fin...). */
export function qualifier<T>(c: Claim, prop: string): T | undefined {
  return c.qualifiers?.[prop]?.[0]?.datavalue?.value as T | undefined
}

/**
 * `+1867-11-07T00:00:00Z` → `1867-11-07` ; précision réduite si le jour ou le mois manque,
 * ou si Wikidata indique une précision à l'année (9) ou au mois (10).
 */
export function wikidataDate(v: { time?: string; precision?: number } | undefined): string | null {
  const m = v?.time?.match(/^\+?(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  if (mo === '00' || (v?.precision !== undefined && v.precision <= 9)) return y
  return d === '00' || v?.precision === 10 ? `${y}-${mo}` : `${y}-${mo}-${d}`
}

/** Un élément Wikidata est une personne si P31 (nature de l'élément) vaut Q5 (être humain). */
export const isHuman = (e: WdEntity): boolean => values<{ id?: string }>(e, 'P31').some((v) => v.id === 'Q5')

/** Propriétés propres aux organisations : LEI, SIREN, maison mère, filiales, siège, secteur... */
export const ORG_PROPS = ['P1278', 'P1616', 'P749', 'P355', 'P159', 'P452', 'P1128', 'P414', 'P2139', 'P3608', 'P1454', 'P112', 'P169', 'P1320']

export const isOrganization = (e: WdEntity): boolean => !isHuman(e) && ORG_PROPS.some((p) => claimsOf(e, p).length > 0)

/** Libellé dans la langue de l'interface, sinon le libellé multilingue (`mul`), sinon l'anglais. */
export const labelOf = (e: WdEntity, lang: string): string | undefined => (e.labels?.[lang] ?? e.labels?.mul ?? e.labels?.en)?.value

export const descriptionOf = (e: WdEntity, lang: string): string | undefined => (e.descriptions?.[lang] ?? e.descriptions?.en)?.value

/** Comparaison de noms sans casse ni accents. */
export const sameName = (a: string, b: string): boolean => {
  const n = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  return n(a) === n(b)
}

/**
 * Libellé d'un élément relié : suivi de son identifiant (« Danone (Q3015341) ») quand il porte
 * le même nom que le nœud d'entrée, sinon le moteur les fusionnerait.
 */
export function distinctLabel(label: string, id: string, self?: string): string {
  return self && sameName(label, self) ? `${label} (${id})` : label
}

// ---------------------------------------------------------------------------
// Requêtes

const isRateLimited = (e: unknown): boolean => e instanceof ModuleError && e.code === 'rate_limited'

/** Appel de l'API Wikidata ; un refus pour quota devient une erreur explicite. */
async function api<T>(ctx: ModuleContext, query: Record<string, string | number>): Promise<T> {
  try {
    return await ctx.fetchJson<T>(API, { query: { ...query, format: 'json' }, headers: { 'user-agent': USER_AGENT } })
  } catch (e) {
    if ((e as HttpError).status === 429) throw new ModuleError('Wikidata : trop de requêtes, réessayez plus tard', 'rate_limited')
    throw e
  }
}

/** Requête SPARQL sur query.wikidata.org. */
export async function sparql(ctx: ModuleContext, query: string): Promise<Binding[]> {
  try {
    const res = await ctx.fetchJson<{ results?: { bindings?: Binding[] } }>(SPARQL, {
      query: { query, format: 'json' },
      headers: { 'user-agent': USER_AGENT, accept: 'application/sparql-results+json' },
      timeoutMs: 45000
    })
    return res.results?.bindings ?? []
  } catch (e) {
    if ((e as HttpError).status === 429) throw new ModuleError('Wikidata (SPARQL) : trop de requêtes, réessayez plus tard', 'rate_limited')
    throw e
  }
}

/** Chaîne littérale SPARQL : guillemets, barres obliques inverses et sauts de ligne échappés. */
export function sparqlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`
}

const qid = (uri: string | undefined): string | undefined => uri?.match(/(Q\d+)$/)?.[1]
const langs = (lang: string): string => `${lang},mul,en`

/** Recherche plein texte EntitySearch par SPARQL, avec la nature de chaque candidat. */
export function entitySearchQuery(name: string, lang: string, limit = 5): string {
  const orgPath = ORG_PROPS.map((p) => `wdt:${p}`).join('|')
  return `SELECT ?item ?itemLabel ?itemDescription ?human ?org WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch";
      mwapi:search ${sparqlString(name)}; mwapi:language "${lang}"; mwapi:limit "${limit}".
    ?item wikibase:apiOutputItem mwapi:item.
    ?num wikibase:apiOrdinal true.
  }
  BIND(EXISTS { ?item wdt:P31 wd:Q5 } AS ?human)
  BIND(EXISTS { ?item ${orgPath} [] } AS ?org)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${langs(lang)}". }
} ORDER BY ?num`
}

/** Candidats lus dans une réponse SPARQL EntitySearch. */
export function parseSearchBindings(bindings: Binding[]): Candidate[] {
  const out: Candidate[] = []
  for (const b of bindings) {
    const id = qid(b.item?.value)
    if (!id || out.some((c) => c.id === id)) continue
    const label = b.itemLabel?.value
    out.push({
      id,
      label: label && label !== id ? label : undefined,
      description: b.itemDescription?.value,
      human: b.human?.value === 'true',
      organization: b.human?.value !== 'true' && b.org?.value === 'true'
    })
  }
  return out
}

/** Fiches complètes ; repli sur Special:EntityData (une fiche par requête) en cas de quota. */
export async function getEntities(ctx: ModuleContext, ids: string[]): Promise<Record<string, WdEntity>> {
  if (!ids.length) return {}
  try {
    const res = await api<EntitiesResponse>(ctx, {
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'labels|descriptions|claims',
      languages: `${ctx.lang}|mul|en`
    })
    return res.entities ?? {}
  } catch (e) {
    if (!isRateLimited(e)) throw e
    const out: Record<string, WdEntity> = {}
    for (const id of ids) {
      const res = await entityData(ctx, id)
      // Élément fusionné : la réponse porte l'identifiant de la cible.
      const entity = res.entities?.[id] ?? Object.values(res.entities ?? {})[0]
      if (entity) out[id] = entity
    }
    return out
  }
}

/** Fiche Special:EntityData ; un 429 passager est retenté une fois après une courte pause. */
async function entityData(ctx: ModuleContext, id: string): Promise<EntitiesResponse> {
  const get = (): Promise<EntitiesResponse> =>
    ctx.fetchJson<EntitiesResponse>(`${ENTITY_DATA}/${id}.json`, { headers: { 'user-agent': USER_AGENT }, timeoutMs: 45000 })
  try {
    return await get()
  } catch (e) {
    if ((e as HttpError).status !== 429) throw e
  }
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 2000)
    ctx.signal.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })
  try {
    return await get()
  } catch (e) {
    if ((e as HttpError).status === 429) throw new ModuleError('Wikidata : trop de requêtes, réessayez plus tard', 'rate_limited')
    throw e
  }
}

/**
 * Recherche d'un élément par son nom : les 5 premiers candidats, avec leur nature. API de
 * recherche puis fiches détaillées ; en cas de quota, une seule requête SPARQL.
 * `entities` contient les fiches déjà lues (vide après un repli SPARQL).
 */
export async function searchCandidates(ctx: ModuleContext, name: string): Promise<{ candidates: Candidate[]; entities: Record<string, WdEntity> }> {
  try {
    const search = await api<SearchResponse>(ctx, { action: 'wbsearchentities', search: name, language: ctx.lang, uselang: ctx.lang, type: 'item', limit: 5 })
    const ids = (search.search ?? []).map((s) => s.id)
    if (!ids.length) return { candidates: [], entities: {} }
    const entities = await getEntities(ctx, ids)
    const candidates = ids
      .map((id) => entities[id])
      .filter((e): e is WdEntity => !!e)
      .map((e) => ({ id: e.id, label: labelOf(e, ctx.lang), description: descriptionOf(e, ctx.lang), human: isHuman(e), organization: isOrganization(e) }))
    return { candidates, entities }
  } catch (e) {
    if (!isRateLimited(e)) throw e
    return { candidates: parseSearchBindings(await sparql(ctx, entitySearchQuery(name, ctx.lang))), entities: {} }
  }
}

/** Élément portant une valeur d'identifiant (P1616 SIREN, P1278 LEI...), par SPARQL. */
export async function findByStatement(ctx: ModuleContext, prop: string, value: string): Promise<string | undefined> {
  const rows = await sparql(ctx, `SELECT ?item WHERE { ?item wdt:${prop} ${sparqlString(value)} } LIMIT 2`)
  const ids = rows.map((b) => qid(b.item?.value)).filter((x): x is string => !!x)
  // Deux éléments pour le même identifiant : doublon à fusionner dans Wikidata, on ne choisit pas.
  return ids.length === 1 ? ids[0] : undefined
}

/** Coordonnées WKT `Point(2.35 48.85)` → latitude et longitude. */
export function parsePoint(wkt: string | undefined): { lat: number; lon: number } | undefined {
  const m = wkt?.match(/Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i)
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : undefined
}

/**
 * Libellés des éléments cités (et coordonnées de ceux de `withCoords`). API par lots de 50,
 * repli SPARQL en cas de quota.
 */
export async function resolveItems(ctx: ModuleContext, ids: string[], withCoords: string[] = []): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>()
  const unique = [...new Set(ids)]
  if (!unique.length) return out
  try {
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50)
      const res = await api<EntitiesResponse>(ctx, { action: 'wbgetentities', ids: chunk.join('|'), props: 'labels', languages: `${ctx.lang}|mul|en` })
      for (const id of chunk) {
        const e = res.entities?.[id]
        if (e) out.set(id, { label: labelOf(e, ctx.lang) })
      }
    }
    const coords = withCoords.filter((id) => unique.includes(id))
    if (coords.length) {
      const res = await api<EntitiesResponse>(ctx, { action: 'wbgetentities', ids: coords.join('|'), props: 'claims', languages: ctx.lang })
      for (const id of coords) {
        const c = res.entities?.[id] && first<{ latitude: number; longitude: number }>(res.entities[id], 'P625')
        if (c) out.set(id, { ...out.get(id), lat: c.latitude, lon: c.longitude })
      }
    }
    return out
  } catch (e) {
    if (!isRateLimited(e)) throw e
    const rows = await sparql(
      ctx,
      `SELECT ?item ?itemLabel ?coord WHERE {
  VALUES ?item { ${unique.map((id) => `wd:${id}`).join(' ')} }
  OPTIONAL { ?item wdt:P625 ?coord }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${langs(ctx.lang)}". }
}`
    )
    for (const b of rows) {
      const id = qid(b.item?.value)
      if (!id || out.get(id)?.label) continue
      const label = b.itemLabel?.value
      const point = withCoords.includes(id) ? parsePoint(b.coord?.value) : undefined
      out.set(id, { label: label && label !== id ? label : undefined, ...point })
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// Comptes en ligne déclarés dans Wikidata

const enc = encodeURIComponent

/** Identifiant de compte → plateforme et URL du profil. */
export const ACCOUNT_PROPS: Array<[prop: string, platform: string, url: (v: string) => string]> = [
  ['P2002', 'x', (v) => `https://x.com/${enc(v)}`],
  ['P2003', 'instagram', (v) => `https://www.instagram.com/${enc(v)}/`],
  ['P2013', 'facebook', (v) => (/^\d+$/.test(v) ? `https://www.facebook.com/profile.php?id=${v}` : `https://www.facebook.com/${enc(v)}`)],
  ['P6634', 'linkedin', (v) => `https://www.linkedin.com/in/${enc(v)}`],
  ['P4264', 'linkedin', (v) => `https://www.linkedin.com/company/${enc(v)}`],
  ['P7085', 'tiktok', (v) => `https://www.tiktok.com/@${enc(v)}`],
  ['P2397', 'youtube', (v) => `https://www.youtube.com/channel/${enc(v)}`],
  ['P2037', 'github', (v) => `https://github.com/${enc(v)}`],
  ['P3789', 'telegram', (v) => `https://t.me/${enc(v)}`]
]

/** Comptes en ligne déclarés (X, Instagram, Facebook, LinkedIn, TikTok, YouTube, GitHub, Telegram). */
export function accountEntities(e: WdEntity, lang: 'fr' | 'en', perProp = 2): OutEntity[] {
  const out: OutEntity[] = []
  for (const [prop, platform, url] of ACCOUNT_PROPS) {
    for (const v of values<string>(e, prop).slice(0, perProp)) {
      if (typeof v !== 'string' || !v.trim()) continue
      const name = getPlatform(platform)?.name ?? platform
      out.push({ type: 'account', platform, label: v, data: { username: v, url: url(v) }, linkLabel: lang === 'fr' ? `compte ${name}` : `${name} account` })
    }
  }
  return out
}

/** Période d'une déclaration (qualificatifs P580 début, P582 fin), en texte. */
export function period(c: Claim, lang: 'fr' | 'en'): string | null {
  const start = wikidataDate(qualifier(c, 'P580'))
  const end = wikidataDate(qualifier(c, 'P582'))
  if (start && end) return lang === 'fr' ? `${start} au ${end}` : `${start} to ${end}`
  if (start) return lang === 'fr' ? `depuis ${start}` : `since ${start}`
  if (end) return lang === 'fr' ? `jusqu'au ${end}` : `until ${end}`
  return null
}
