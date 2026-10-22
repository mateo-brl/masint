// Journal officiel des associations (JOAFE) : créations, modifications, dissolutions et
// comptes annuels publiés, plus les comptes des organisations syndicales et professionnelles
// (OSOP). API Opendatasoft de la DILA, sans clé. Recherche par numéro RNA, par SIREN, ou par
// nom (associations candidates à vérifier).

import { defineModule, ModuleError, type InputEntity, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, num, tr } from '../misc/_util'
import { httpStatus } from '../social/_lib'
import { normName } from './_fr'
import { rnaOf, sirenOf } from './_ids'

const JO = 'https://journal-officiel-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets'
const PAGE = 100
const MAX_EVENTS = 20
const MAX_CANDIDATES = 5

export interface JoaRecord {
  id: string
  source?: string | null
  dateparution?: string | null
  annonce_type_facette?: string | null
  typeavis?: string | null
  numero_rna?: string | null
  titre?: string | null
  titre_nouveau?: string | null
  titre_ancien?: string | null
  objet?: string | null
  siteweb?: string | null
  adresse_actuelle?: string | null
  codepostal_actuel?: string | null
  commune_actuelle?: string | null
  geo_point?: { lat?: number; lon?: number } | null
  datedeclaration?: string | null
  dca_datecloture?: string | null
  dca_siren?: string | null
  lieupref?: string | null
  contenu?: string | null
}

export interface OsopRecord {
  id_entite?: string | null
  siren?: string | null
  titre?: string | null
  titrelong?: string | null
  rue?: string | null
  codepostal?: string | null
  ville?: string | null
  url?: string | null
  datecloture?: string | null
  datepublication?: string | null
  numrna?: string | null
  typeorganisationlibelle?: string | null
  ressortgeolibelle?: string | null
}

interface OdsResponse<T> {
  total_count?: number
  results?: T[]
}

const frDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const nonEmpty = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null)

/** Nature d'une annonce : « Compte » devient « Comptes annuels ». */
export function annonceType(r: JoaRecord, lang: 'fr' | 'en' = 'fr'): string {
  const t = r.typeavis || (r.annonce_type_facette ?? '').split('/')[1] || (r.source === 'dca' ? 'Compte' : 'Annonce')
  if (/^compte/i.test(t)) return lang === 'fr' ? 'Comptes annuels' : 'Annual accounts'
  return t
}

/** Détail lisible : date de clôture, changement de titre, objet. */
export function annonceDetail(r: JoaRecord, lang: 'fr' | 'en' = 'fr'): string {
  const fr = lang === 'fr'
  if (r.dca_datecloture) return `${fr ? 'clôture' : 'closing'} ${frDate(r.dca_datecloture)}`
  if (r.titre_ancien && r.titre_nouveau) return `${fr ? 'titre' : 'name'} : ${r.titre_ancien} → ${r.titre_nouveau}`
  if (/cr[ée]ation/i.test(r.typeavis ?? '')) return nonEmpty(r.titre) ?? ''
  return ''
}

export function joaEvent(r: JoaRecord, lang: 'fr' | 'en'): OutEntity {
  const type = annonceType(r, lang)
  const detail = annonceDetail(r, lang)
  return {
    type: 'event',
    label: `JO Associations ${frDate(r.dateparution)} : ${type}${detail ? ` (${clip(detail, 90)})` : ''}`,
    data: compact({
      date: r.dateparution ?? null,
      jo_type: type,
      description: detail || null,
      association_object: r.objet ? clip(r.objet, 400) : null,
      rna: r.numero_rna ?? null,
      jo_id: r.id,
      // Page de l'annonce au JOAFE ; les comptes annuels n'ont pas de page d'annonce.
      url: r.source === 'dca' ? null : `https://www.journal-officiel.gouv.fr/pages/associations-detail-annonce/?q.id=id:${r.id}`
    }),
    linkLabel: tr({ lang }, 'annonce au JO', 'Official Journal notice')
  }
}

export function osopEvent(r: OsopRecord, lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const date = r.datepublication ?? null
  return {
    type: 'event',
    label: `${fr ? 'Comptes publiés (OSOP)' : 'Accounts published (OSOP)'} ${frDate(date)} : ${r.titre ?? ''}${r.datecloture ? ` (${fr ? 'clôture' : 'closing'} ${frDate(r.datecloture)})` : ''}`,
    data: compact({ date, description: r.typeorganisationlibelle ?? null, url: r.url ?? null }),
    linkLabel: tr({ lang }, 'comptes publiés', 'published accounts')
  }
}

/** Fiche d'une association à partir de ses annonces (de la plus récente à la plus ancienne). */
export function associationOutput(ctx: Pick<ModuleContext, 'lang'>, records: JoaRecord[], total: number, osop: OsopRecord[] = []): ModuleOutput {
  const sorted = [...records].sort((a, b) => (b.dateparution ?? '').localeCompare(a.dateparution ?? ''))
  const latest = <K extends keyof JoaRecord>(k: K): JoaRecord[K] | undefined => sorted.find((r) => r[k] !== null && r[k] !== undefined && r[k] !== '')?.[k]
  const withAddress = sorted.find((r) => nonEmpty(r.adresse_actuelle) || nonEmpty(r.commune_actuelle))
  const address = withAddress ? [withAddress.adresse_actuelle, withAddress.codepostal_actuel, withAddress.commune_actuelle].map(nonEmpty).filter(Boolean).join(' ') : null
  const titles = sorted.map((r) => nonEmpty(r.titre_nouveau) ?? nonEmpty(r.titre)).filter((t): t is string => !!t)
  const current = titles[0] ?? null
  const previous = Array.from(new Set([...titles.slice(1), ...sorted.map((r) => nonEmpty(r.titre_ancien)).filter((t): t is string => !!t)])).filter(
    (t) => normName(t) !== normName(current ?? '')
  )
  const dissolution = sorted.find((r) => /dissolution/i.test(annonceType(r)))
  const site = nonEmpty(latest('siteweb') ?? null) ?? nonEmpty(osop.find((o) => o.url)?.url)
  const siren = latest('dca_siren') ?? osop.find((o) => o.siren)?.siren ?? null
  const properties: Record<string, PropValue> = compact({
    rna: latest('numero_rna') ?? null,
    siren,
    association_name: current,
    association_object: latest('objet') ? clip(latest('objet')!, 600) : null,
    address,
    website: site,
    previous_names: previous,
    dissolved_on: dissolution ? frDate(dissolution.dateparution) : null,
    jo_announcements: total || null,
    jo_last_date: sorted[0]?.dateparution ?? null,
    osop_accounts: osop.length || null
  })
  const entities: OutEntity[] = [
    ...sorted.slice(0, MAX_EVENTS).map((r) => joaEvent(r, ctx.lang)),
    ...osop.slice(0, MAX_EVENTS).map((o) => osopEvent(o, ctx.lang))
  ]
  if (site) entities.push({ type: 'website', label: site, linkLabel: tr(ctx, 'site déclaré au JO', 'website declared in the Official Journal') })
  const geo = withAddress?.geo_point
  if (address && geo && num(geo.lat) !== null && num(geo.lon) !== null) {
    entities.push({
      type: 'address',
      label: address,
      data: compact({ postcode: withAddress?.codepostal_actuel ?? null, city: withAddress?.commune_actuelle ?? null, country: 'France', lat: num(geo.lat), lon: num(geo.lon) }),
      linkLabel: tr(ctx, 'siège déclaré (JO)', 'declared head office (Official Journal)')
    })
  }
  return { properties, entities, raw: { total, ids: sorted.slice(0, MAX_EVENTS).map((r) => r.id), osop: osop.length } }
}

/** Recherche par nom : associations de même titre, à vérifier. */
export function candidatesOutput(ctx: Pick<ModuleContext, 'lang'>, records: JoaRecord[], label: string, total: number): ModuleOutput {
  const q = normName(label)
  const groups = new Map<string, JoaRecord[]>()
  for (const r of records) {
    const key = r.numero_rna || r.dca_siren
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const same = [...groups.entries()].filter(([, list]) => list.some((r) => [r.titre, r.titre_nouveau].some((t) => t && normName(t) === q)))
  const entities: OutEntity[] = same.slice(0, MAX_CANDIDATES).map(([key, list]) => {
    const r = list[0]
    const name = nonEmpty(r.titre_nouveau) ?? nonEmpty(r.titre) ?? key
    const where = [r.commune_actuelle, r.lieupref].map(nonEmpty).find(Boolean)
    return {
      type: 'organization',
      label: name,
      data: compact({ rna: r.numero_rna ?? null, siren: list.find((x) => x.dca_siren)?.dca_siren ?? null, kind: tr(ctx, 'association', 'association'), jo_last_date: r.dateparution ?? null }),
      linkLabel: tr(ctx, 'association de même nom', 'association with the same name'),
      review: true,
      reviewReason: tr(
        ctx,
        `association de même nom au Journal officiel (RNA ${r.numero_rna ?? '?'}${where ? `, ${where}` : ''}) : plusieurs associations peuvent porter ce titre, vérifiez la ville et le numéro RNA`,
        `association with the same name in the Official Journal (RNA ${r.numero_rna ?? '?'}${where ? `, ${where}` : ''}): several associations may share this name, check the city and RNA number`
      )
    }
  })
  return { entities, properties: compact({ jo_name_matches: same.length || null }), raw: { total, groups: same.map(([k]) => k) } }
}

async function ods<T>(ctx: ModuleContext, dataset: string, query: Record<string, string | number>): Promise<OdsResponse<T>> {
  let last: unknown
  // Hôte de la DILA parfois coupé : deux nouvelles tentatives espacées.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ctx.fetchJson<OdsResponse<T>>(`${JO}/${dataset}/records`, { query, timeoutMs: 30000 })
    } catch (e) {
      last = e
      const status = httpStatus(e)
      if (status === 429) throw new ModuleError('Journal officiel : trop de requêtes, réessayez plus tard', 'rate_limited')
      if ((status && status < 500) || ctx.signal.aborted) break
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw new ModuleError(`Journal officiel (DILA) injoignable : ${last instanceof Error ? last.message : String(last)}`, 'unavailable')
}

const quote = (s: string): string => s.replace(/["\\]/g, ' ').trim()

export default defineModule({
  id: 'company.jo_associations',
  name: { fr: 'Journal officiel des associations', en: 'French Official Journal of associations' },
  description: {
    fr: 'Annonces de l’association au Journal officiel (création, modifications, dissolution, comptes annuels) et comptes des organisations syndicales et professionnelles, d’après son numéro RNA ou son SIREN (API de la DILA, sans clé) : 20 événements datés au plus, objet, siège, site et anciens titres. Une recherche par nom seul propose les associations de même titre dans « À vérifier ».',
    en: 'Notices of the association in the French Official Journal (creation, changes, dissolution, annual accounts) and accounts of trade unions and employer organizations, from its RNA number or SIREN (DILA API, no key): up to 20 dated events, purpose, head office, website and former names. A name-only search puts associations with the same name aside in "To review".'
  },
  category: 'company',
  inputTypes: ['organization', 'company'],
  // Une entreprise n'est cherchée que si c'est une association, une fondation ou un syndicat.
  accepts: (input: InputEntity) =>
    input.type === 'organization' || !!rnaOf(input) || /association|fondation|syndica|^9[23]/i.test(String(input.data.legal_form ?? '')),
  homepage: 'https://www.journal-officiel.gouv.fr/pages/associations-recherche/',
  async run(input, ctx) {
    const rna = rnaOf(input)
    const siren = sirenOf(input)
    if (!rna && !siren) {
      const name = input.label.trim()
      if (normName(name).length < 4) return {}
      const res = await ods<JoaRecord>(ctx, 'jo_associations', { where: `search(titre_search, "${quote(name)}")`, order_by: 'dateparution desc', limit: PAGE })
      return candidatesOutput(ctx, res.results ?? [], name, res.total_count ?? 0)
    }
    const where = [rna ? `numero_rna="${rna}"` : null, siren ? `dca_siren="${siren}"` : null].filter(Boolean).join(' or ')
    const res = await ods<JoaRecord>(ctx, 'jo_associations', { where, order_by: 'dateparution desc', limit: PAGE })
    let records = res.results ?? []
    let total = res.total_count ?? records.length
    // SIREN seul : les comptes donnent le numéro RNA, qui ramène aussi les annonces anciennes.
    const found = records.find((r) => r.numero_rna && /^W\d{9}$/.test(r.numero_rna))?.numero_rna
    if (!rna && found) {
      const more = await ods<JoaRecord>(ctx, 'jo_associations', { where: `numero_rna="${found}" or dca_siren="${siren}"`, order_by: 'dateparution desc', limit: PAGE })
      records = more.results ?? records
      total = more.total_count ?? total
    }
    let osop: OsopRecord[] = []
    try {
      const o = await ods<OsopRecord>(ctx, 'osop-entites', {
        where: [siren ? `siren="${siren}"` : null, rna || found ? `numrna="${rna ?? found}"` : null].filter(Boolean).join(' or '),
        order_by: 'datepublication desc',
        limit: MAX_EVENTS
      })
      osop = o.results ?? []
    } catch (e) {
      ctx.log(`OSOP indisponible : ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!records.length && !osop.length) return { raw: { rna, siren, total: 0 } }
    return associationOutput(ctx, records, total, osop)
  }
})
