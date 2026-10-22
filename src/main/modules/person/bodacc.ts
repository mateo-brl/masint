// Annonces du BODACC (créations, modifications, radiations, procédures collectives) qui citent
// la personne comme commerçant ou dirigeant, via l'API Opendatasoft de la DILA (sans clé).
// Le BODACC ne publie pas la date de naissance : chaque entreprise trouvée est mise de côté
// dans « À vérifier » (homonyme possible), avec la fonction et les dernières annonces.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, httpStatus } from '../social/_lib'
import { displayName, fold, splitName, type PersonName } from './_name'

const API = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records'
const PAGE = 100
const MAX_PAGES = 2
/** Au-delà, ce sont presque toujours des homonymes : la recherche reste consultable à la main. */
const MAX_PROPOSED = 10

export interface BodaccRecord {
  id: string
  dateparution?: string
  numeroannonce?: number
  typeavis_lib?: string
  familleavis_lib?: string
  tribunal?: string
  commercant?: string
  ville?: string
  cp?: string
  registre?: string[] | string | null
  /** Champs JSON encodés en texte par l'API. */
  listepersonnes?: string | object | null
  listeprecedentexploitant?: string | object | null
  listeprecedentproprietaire?: string | object | null
  jugement?: string | object | null
  url_complete?: string
}

interface BodaccResponse {
  total_count?: number
  results?: BodaccRecord[]
}

type Json = Record<string, unknown>

const parse = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

/** Personnes d'un champ `listepersonnes` (objet ou liste sous la clé `personne`). */
function persons(v: unknown): Json[] {
  const root = parse(v)
  if (!root || typeof root !== 'object') return []
  const p = (root as Json).personne ?? root
  return (Array.isArray(p) ? p : [p]).filter((x): x is Json => !!x && typeof x === 'object')
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const norm = (s: string): string => ` ${fold(s).replace(/[^a-z0-9]+/g, ' ').trim()} `

/**
 * Le passage cite-t-il la personne ? Nom puis prénom (« NIEL Xavier », « Niel, Xavier ») ou
 * prénom puis nom, séparés par trois mots au plus (prénoms secondaires).
 */
export function citesPerson(text: string, name: PersonName): boolean {
  const t = norm(text)
  const last = norm(name.lastName).trim()
  const first = norm(name.firstNames[0] ?? '').trim()
  if (!last || !first) return false
  const gap = '(?: [a-z0-9]+){0,3}'
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(` ${esc(last)}${gap} ${esc(first)} | ${esc(first)}${gap} ${esc(last)} `).test(t)
}

export interface BodaccCitation {
  record: BodaccRecord
  /** Fonction mentionnée (« Président partant », « Gérant »), ou statut de commerçant. */
  role: string
  company: string
  siren?: string
  legalForm?: string
}

/** Passages d'une annonce qui citent la personne, avec la fonction associée. */
export function citation(r: BodaccRecord, name: PersonName, lang: 'fr' | 'en' = 'fr'): BodaccCitation | null {
  const fr = lang === 'fr'
  const registre = Array.isArray(r.registre) ? r.registre : r.registre ? [r.registre] : []
  const siren = registre.map((x) => x.replace(/\D/g, '')).find((x) => x.length === 9)
  const groups: Array<[unknown, string | null]> = [
    [r.listepersonnes, null],
    [r.listeprecedentexploitant, fr ? 'Précédent exploitant' : 'Previous operator'],
    [r.listeprecedentproprietaire, fr ? 'Précédent propriétaire' : 'Previous owner']
  ]
  for (const [field, fixedRole] of groups) {
    for (const p of persons(field)) {
      const legalForm = str(p.formeJuridique) || undefined
      if (str(p.typePersonne) === 'pp' || p.nom) {
        // Personne physique : commerçant ou entrepreneur individuel.
        const who = `${str(p.nom)} ${str(p.prenom)}`
        if (!citesPerson(who, name)) continue
        return { record: r, role: fixedRole ?? (fr ? 'Commerçant (entreprise individuelle)' : 'Sole trader'), company: r.commercant || who.trim(), siren, legalForm }
      }
      // Personne morale : les dirigeants sont dans le texte libre `administration`.
      for (const part of str(p.administration).split(';')) {
        if (!citesPerson(part, name)) continue
        const role = part.includes(':') ? part.split(':')[0].trim() : fr ? 'Dirigeant' : 'Officer'
        return { record: r, role: fixedRole ? `${fixedRole} · ${role}` : role, company: str(p.denomination) || r.commercant || '', siren, legalForm }
      }
    }
  }
  return null
}

const frDate = (iso: string): string => iso.split('-').reverse().join('/')

/** Une entreprise par SIREN (ou par nom), avec ses annonces de la plus récente à la plus ancienne. */
export function groupCitations(list: BodaccCitation[]): BodaccCitation[][] {
  const groups = new Map<string, BodaccCitation[]>()
  for (const c of [...list].sort((a, b) => (b.record.dateparution ?? '').localeCompare(a.record.dateparution ?? ''))) {
    const key = c.siren ?? fold(c.company)
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  return [...groups.values()]
}

export function companyEntity(group: BodaccCitation[], lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const last = group[0]
  const r = last.record
  return {
    type: 'company',
    label: last.company || (fr ? 'Entreprise sans nom' : 'Unnamed company'),
    data: compact({
      siren: last.siren,
      legal_form: group.find((c) => c.legalForm)?.legalForm,
      address: [r.cp, r.ville].filter(Boolean).join(' ') || undefined,
      bodacc_announcements: group.length,
      bodacc_last_date: r.dateparution,
      bodacc_events: group
        .slice(0, 10)
        .map((c) => [c.record.dateparution ? frDate(c.record.dateparution) : null, c.record.familleavis_lib, c.role].filter(Boolean).join(' · ')),
      url: r.url_complete
    }),
    linkLabel: `${last.role} (BODACC${r.dateparution ? ` ${frDate(r.dateparution)}` : ''})`,
    review: true,
    reviewReason: fr
      ? 'homonyme possible : le BODACC ne publie pas la date de naissance, comparez la ville et l’activité'
      : 'possible namesake: BODACC does not publish birth dates, compare city and activity'
  }
}

/** Échappe une valeur pour une chaîne ODSQL entre guillemets. */
const odsql = (s: string): string => s.replace(/["\\]/g, ' ').trim()

async function page(ctx: ModuleContext, name: PersonName, offset: number): Promise<BodaccResponse> {
  const where = `search(listepersonnes, "${odsql(name.lastName)}") and search(listepersonnes, "${odsql(name.firstNames[0])}")`
  try {
    return await ctx.fetchJson<BodaccResponse>(API, {
      query: { where, order_by: 'dateparution desc', limit: PAGE, offset },
      timeoutMs: 30000
    })
  } catch (e) {
    const status = httpStatus(e)
    if (status === 429) throw new ModuleError('BODACC : trop de requêtes, réessayez plus tard', 'rate_limited')
    throw new ModuleError(`BODACC injoignable : ${e instanceof Error ? e.message : String(e)}`, 'unavailable')
  }
}

export function bodaccOutput(records: BodaccRecord[], total: number, name: PersonName, lang: 'fr' | 'en'): ModuleOutput {
  const cited = records.map((r) => citation(r, name, lang)).filter((c): c is BodaccCitation => !!c)
  if (!cited.length) return { raw: { total, fetched: records.length, cited: 0 } }
  const groups = groupCitations(cited)
  const raw = {
    total,
    fetched: records.length,
    cited: cited.length,
    companies: groups.map((g) => ({ company: g[0].company, siren: g[0].siren, announcements: g.map((c) => ({ id: c.record.id, date: c.record.dateparution, role: c.role })) }))
  }
  const properties = { bodacc_companies_count: groups.length }
  if (groups.length > MAX_PROPOSED) {
    const q = `${name.firstNames[0]} ${name.lastName}`
    return {
      properties,
      manual: [
        {
          label: 'BODACC',
          url: `https://www.bodacc.fr/pages/annonces-commerciales/?q=${encodeURIComponent(`"${q}"`)}`,
          hint:
            lang === 'fr'
              ? `${groups.length} entreprises citent ${displayName(name)} : trop d’homonymes pour les proposer une à une.`
              : `${groups.length} companies mention ${displayName(name)}: too many namesakes to list them one by one.`
        }
      ],
      raw
    }
  }
  return { entities: groups.map((g) => companyEntity(g, lang)), properties, raw }
}

export default defineModule({
  id: 'person.bodacc',
  name: { fr: 'Annonces BODACC (France)', en: 'BODACC notices (France)' },
  description: {
    fr: 'Cherche les annonces du BODACC (créations, modifications, radiations, procédures collectives) qui citent la personne comme commerçant ou dirigeant, y compris les fonctions quittées (API de la DILA, sans clé). Chaque entreprise est mise de côté dans « À vérifier » : le BODACC ne publie pas la date de naissance.',
    en: 'Finds BODACC notices (registrations, changes, removals, insolvency proceedings) naming the person as trader or officer, including past roles (DILA API, no key). Each company is put aside in "To review": BODACC does not publish birth dates.'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://www.bodacc.fr/',
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const first = await page(ctx, name, 0)
    const records = [...(first.results ?? [])]
    const total = first.total_count ?? records.length
    for (let n = 1; n < MAX_PAGES && records.length < total; n++) records.push(...((await page(ctx, name, n * PAGE)).results ?? []))
    return bodaccOutput(records, total, name, ctx.lang)
  }
})
