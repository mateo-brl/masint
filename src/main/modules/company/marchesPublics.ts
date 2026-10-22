// Commande publique : marchés attribués à une entreprise.
// - DECP (données essentielles consolidées, API tabulaire de data.gouv.fr) : recherche exacte par
//   SIREN du titulaire, nombre de marchés, montant cumulé, principaux marchés et acheteurs ;
// - BOAMP (DILA, Opendatasoft) : avis d'attribution qui citent la raison sociale ;
// - TED (Journal officiel de l'UE) : avis européens dont l'entreprise est lauréate.
// BOAMP et TED ne cherchent que par nom : leurs avis sont mis de côté dans « À vérifier », sauf
// quand TED publie le SIREN du lauréat.

import { defineModule, ModuleError, type OutEntity, type OutLink } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { normName } from './_fr'
import { companyName, euros, latestResourceId, sirenOf, tabularAll, withRetry } from './_datagouv'
import { compact, httpStatus } from '../social/_lib'

// DECP ------------------------------------------------------------------------------------------

const DECP_DATASET = 'donnees-essentielles-de-la-commande-publique-consolidees-format-tabulaire'
const DECP_RESOURCE = '22847056-61df-452d-837d-8b8ceadbfc52'
const DECP_SERVICE = 'DECP (data.gouv.fr)'
/** Marchés lus au plus : au-delà, seul le nombre total est exact. */
const DECP_MAX_ROWS = 1000
const MAX_EVENTS = 15
const MAX_BUYERS = 10

export interface DecpRow {
  uid?: string | null
  id?: string | null
  nature?: string | null
  acheteur_id?: string | null
  acheteur_nom?: string | null
  titulaire_id?: string | null
  titulaire_nom?: string | null
  objet?: string | null
  montant?: number | null
  codeCPV?: string | null
  procedure?: string | null
  dureeMois?: number | null
  dateNotification?: string | null
  donneesActuelles?: boolean | null
  acheteur_commune_nom?: string | null
  acheteur_latitude?: number | null
  acheteur_longitude?: number | null
}

const clean = (v: string | null | undefined): string | undefined => (v && v.trim() ? v.trim().replace(/\s+/g, ' ') : undefined)

/** Raccourcit un texte libre (objet du marché) pour un libellé de nœud. */
export function shorten(s: string, max = 90): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`
}

/** Marchés du titulaire, version actuelle uniquement, sans doublons. */
export function decpContracts(rows: DecpRow[], siren: string): DecpRow[] {
  const seen = new Set<string>()
  const out: DecpRow[] = []
  for (const r of rows) {
    if (!(r.titulaire_id ?? '').replace(/\s/g, '').startsWith(siren)) continue
    if (r.donneesActuelles === false) continue
    const key = r.uid ?? `${r.acheteur_id}|${r.id}|${r.codeCPV}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

const amountOf = (r: DecpRow): number => (typeof r.montant === 'number' && Number.isFinite(r.montant) ? r.montant : 0)

export interface Buyer {
  id: string
  name: string
  count: number
  amount: number
  row: DecpRow
}

/** Acheteurs, du plus gros montant cumulé au plus petit. */
export function decpBuyers(contracts: DecpRow[]): Buyer[] {
  const byId = new Map<string, Buyer>()
  for (const r of contracts) {
    const name = clean(r.acheteur_nom)
    const id = clean(r.acheteur_id) ?? name
    if (!id || !name) continue
    const b = byId.get(id) ?? { id, name, count: 0, amount: 0, row: r }
    b.count++
    b.amount += amountOf(r)
    byId.set(id, b)
  }
  return [...byId.values()].sort((a, b) => b.amount - a.amount || b.count - a.count)
}

export function decpOutput(contracts: DecpRow[], total: number, complete: boolean, lang: 'fr' | 'en') {
  const fr = lang === 'fr'
  const amount = contracts.reduce((s, r) => s + amountOf(r), 0)
  const dates = contracts.map((r) => r.dateNotification).filter((d): d is string => !!d).sort()
  const properties: Record<string, PropValue> = compact({
    public_contracts_count: complete ? contracts.length : total,
    public_contracts_amount: euros(amount),
    public_contracts_scope: complete
      ? undefined
      : fr
        ? `montant calculé sur les ${contracts.length} marchés les plus récents`
        : `amount computed on the ${contracts.length} most recent contracts`,
    public_contracts_first_date: dates[0],
    public_contracts_last_date: dates[dates.length - 1]
  })

  const buyers = decpBuyers(contracts).slice(0, MAX_BUYERS)
  const buyerRef = new Map(buyers.map((b, i) => [b.id, `buyer${i}`]))
  const entities: OutEntity[] = buyers.map((b, i) => {
    const lat = b.row.acheteur_latitude
    const lon = b.row.acheteur_longitude
    const geo = typeof lat === 'number' && typeof lon === 'number'
    return {
      ref: `buyer${i}`,
      type: 'administration',
      label: b.name,
      data: compact({
        siret: /^\d{14}$/.test(b.id) ? b.id : undefined,
        siren: /^\d{14}$/.test(b.id) ? b.id.slice(0, 9) : undefined,
        city: clean(b.row.acheteur_commune_nom),
        lat: geo ? lat : undefined,
        lon: geo ? lon : undefined
      }),
      linkLabel: fr
        ? `client public : ${b.count} marché${b.count > 1 ? 's' : ''}, ${euros(b.amount)}`
        : `public client: ${b.count} contract${b.count > 1 ? 's' : ''}, ${euros(b.amount)}`
    }
  })

  // Les plus gros marchés, les plus récents à montant égal.
  const top = [...contracts]
    .sort((a, b) => amountOf(b) - amountOf(a) || (b.dateNotification ?? '').localeCompare(a.dateNotification ?? ''))
    .slice(0, MAX_EVENTS)
  const links: OutLink[] = []
  top.forEach((r, i) => {
    const buyer = clean(r.acheteur_nom)
    const ref = `contract${i}`
    entities.push({
      ref,
      type: 'event',
      label: `${fr ? 'Marché' : 'Contract'} ${clean(r.id) ?? '?'}${buyer ? ` (${buyer})` : ''} : ${shorten(clean(r.objet) ?? '?')}`,
      data: compact({
        date: r.dateNotification ?? undefined,
        amount: euros(r.montant),
        contract_buyer: buyer,
        contract_buyer_siret: clean(r.acheteur_id),
        contract_subject: clean(r.objet),
        contract_cpv: clean(r.codeCPV),
        contract_procedure: clean(r.procedure),
        contract_nature: clean(r.nature),
        contract_duration_months: typeof r.dureeMois === 'number' ? r.dureeMois : undefined,
        source: 'DECP'
      }),
      linkLabel: fr ? 'marché public' : 'public contract'
    })
    const b = r.acheteur_id ? buyerRef.get(r.acheteur_id.trim()) : undefined
    if (b) links.push({ from: b, to: ref, label: fr ? 'acheteur' : 'buyer' })
  })
  return { properties, entities, links }
}

const decpModule = defineModule({
  id: 'company.marches_publics',
  name: { fr: 'Marchés publics (DECP)', en: 'Public contracts (France, DECP)' },
  description: {
    fr: 'Marchés publics attribués à l’entreprise, par SIREN, dans les données essentielles de la commande publique consolidées (data.gouv.fr) : nombre de marchés, montant cumulé déclaré (plafonds des accords-cadres compris), les 15 plus gros marchés datés et les 10 principaux acheteurs publics. Requête lente (jusqu’à une minute).',
    en: 'Public contracts awarded to the company, by SIREN, from the consolidated French public procurement data (data.gouv.fr): number of contracts, total declared amount (framework agreement ceilings included), the 15 largest dated contracts and the 10 main public buyers. Slow query (up to a minute).'
  },
  category: 'company',
  inputTypes: ['company'],
  accepts: (input) => !!sirenOf(input.label, input.data),
  homepage: 'https://www.data.gouv.fr/fr/datasets/donnees-essentielles-de-la-commande-publique-consolidees-format-tabulaire/',
  timeoutMs: 360000,
  async run(input, ctx) {
    const siren = sirenOf(input.label, input.data)
    if (!siren) throw new ModuleError('SIREN ou SIRET nécessaire', 'invalid_input')
    const id = await latestResourceId(ctx, DECP_DATASET, (r) => /^decp\.csv$/i.test(r.title), DECP_RESOURCE)
    // Les identifiants des titulaires sont des SIRET : un intervalle couvre tous les établissements.
    const res = await tabularAll<DecpRow>(
      ctx,
      id,
      [
        { column: 'titulaire_id', op: 'greater', value: siren },
        { column: 'titulaire_id', op: 'less', value: `${siren}99999` },
        { column: 'donneesActuelles', op: 'exact', value: 'true' }
      ],
      {
        service: DECP_SERVICE,
        pageSize: 200,
        maxRows: DECP_MAX_ROWS,
        timeoutMs: 90000,
        onPage: (n, total) => ctx.progress(n, total, 'DECP')
      }
    )
    const contracts = decpContracts(res.rows, siren)
    if (!contracts.length) return { raw: { total: res.total } }
    return { ...decpOutput(contracts, res.total, res.complete, ctx.lang), raw: { total: res.total, fetched: res.rows.length, contracts: contracts.length } }
  }
})

// BOAMP -----------------------------------------------------------------------------------------

const BOAMP_API = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records'
const MAX_NOTICES = 10

export interface BoampRecord {
  idweb?: string
  objet?: string | null
  dateparution?: string | null
  nomacheteur?: string | null
  titulaire?: string[] | string | null
  nature_libelle?: string | null
  type_marche?: string[] | null
  famille_libelle?: string | null
  url_avis?: string | null
}

interface OdsResponse<T> {
  total_count?: number
  results?: T[]
}

const list = (v: string[] | string | null | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean)

/** Texte sûr dans une chaîne ODSQL entre guillemets. */
const odsString = (s: string): string => s.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()

/** Le nom recherché figure-t-il parmi les titulaires (après normalisation) ? */
export function namesWinner(winners: string[], name: string): 'same' | 'contains' | null {
  const q = normName(name)
  if (!q) return null
  const norm = winners.map(normName)
  if (norm.includes(q)) return 'same'
  return norm.some((w) => ` ${w} `.includes(` ${q} `)) ? 'contains' : null
}

export function boampOutput(records: BoampRecord[], total: number, name: string, lang: 'fr' | 'en') {
  const fr = lang === 'fr'
  const kept = records.map((r) => ({ r, match: namesWinner(list(r.titulaire), name) })).filter((x) => x.match)
  const entities: OutEntity[] = kept.slice(0, MAX_NOTICES).map(({ r, match }) => ({
    type: 'event',
    label: `${fr ? 'Avis BOAMP' : 'BOAMP notice'} ${r.idweb ?? '?'} : ${shorten(clean(r.objet) ?? '?')}`,
    data: compact({
      date: r.dateparution ?? undefined,
      contract_buyer: clean(r.nomacheteur),
      contract_winners: [...new Set(list(r.titulaire))].slice(0, 15),
      contract_notice_type: clean(r.nature_libelle),
      contract_subject: clean(r.objet),
      url: r.url_avis ?? (r.idweb ? `https://www.boamp.fr/pages/avis/?q=idweb:${r.idweb}` : undefined),
      source: 'BOAMP'
    }),
    linkLabel: fr ? 'attributaire (BOAMP)' : 'awardee (BOAMP)',
    review: true,
    reviewReason:
      match === 'same'
        ? fr
          ? 'même raison sociale parmi les titulaires, sans SIREN publié : vérifiez qu’il s’agit bien de cette entreprise'
          : 'same company name among the awardees, no SIREN published: check it is this company'
        : fr
          ? 'nom proche parmi les titulaires (filiale ou homonyme possible) : vérifiez l’avis'
          : 'similar name among the awardees (subsidiary or namesake): check the notice'
  }))
  return { entities, properties: compact({ boamp_awards_count: total || undefined }) }
}

const boampModule = defineModule({
  id: 'company.boamp',
  name: { fr: "Avis d'attribution (BOAMP)", en: 'Contract award notices (BOAMP)' },
  description: {
    fr: 'Avis d’attribution du Bulletin officiel des annonces des marchés publics (DILA) qui citent la raison sociale parmi les titulaires : nombre d’avis et les 10 plus récents, proposés dans « À vérifier » (recherche par nom, sans SIREN).',
    en: 'Award notices from the French official public procurement bulletin (BOAMP) that list the company name among the awardees: number of notices and the 10 most recent, put in "To review" (name search, no SIREN).'
  },
  category: 'company',
  inputTypes: ['company'],
  accepts: (input) => !!companyName(input.label, input.data),
  homepage: 'https://www.boamp.fr',
  async run(input, ctx) {
    const name = companyName(input.label, input.data)
    if (!name || normName(name).length < 3) throw new ModuleError('Raison sociale nécessaire', 'invalid_input')
    const res = await withRetry(
      ctx,
      () =>
        ctx.fetchJson<OdsResponse<BoampRecord>>(BOAMP_API, {
          query: {
            where: `search(titulaire, "${odsString(name)}")`,
            select: 'idweb,objet,dateparution,nomacheteur,titulaire,nature_libelle,type_marche,famille_libelle,url_avis',
            order_by: 'dateparution desc',
            limit: 30
          },
          timeoutMs: 30000
        }),
      { service: 'BOAMP', attempts: 3 }
    )
    const records = res.results ?? []
    if (!records.length) return { raw: { total: 0 } }
    return { ...boampOutput(records, res.total_count ?? records.length, name, ctx.lang), raw: { total: res.total_count, ids: records.map((r) => r.idweb) } }
  }
})

// TED -------------------------------------------------------------------------------------------

const TED_API = 'https://api.ted.europa.eu/v3/notices/search'
const TED_FIELDS = [
  'publication-number',
  'publication-date',
  'notice-type',
  'notice-title',
  'buyer-name',
  'buyer-country',
  'winner-name',
  'winner-identifier',
  'total-value',
  'total-value-cur',
  'classification-cpv'
]

type Multi = Record<string, string[] | string> | null | undefined

export interface TedNotice {
  'publication-number'?: string
  'publication-date'?: string
  'notice-type'?: string
  'notice-title'?: Multi
  'buyer-name'?: Multi
  'buyer-country'?: string[]
  'winner-name'?: Multi
  'winner-identifier'?: string[]
  'total-value'?: number | null
  'total-value-cur'?: string[]
  'classification-cpv'?: string[]
}

interface TedResponse {
  notices?: TedNotice[]
  totalNoticeCount?: number
}

/** Valeur d'un champ multilingue : français, anglais, sinon la première langue. */
export function multi(v: Multi, lang: 'fr' | 'en'): string[] {
  if (!v) return []
  const pick = v[lang === 'fr' ? 'fra' : 'eng'] ?? v.fra ?? v.eng ?? Object.values(v)[0]
  return (Array.isArray(pick) ? pick : pick ? [pick] : []).map((s) => s.trim()).filter(Boolean)
}

/** Titre TED « pays, catégorie, objet » (séparés par des tirets longs) réduit à l'objet. */
export function tedTitle(t: string): string {
  const parts = t.split(/\s[\u2013\u2014]\s/)
  return (parts.length >= 3 ? parts.slice(2).join(', ') : parts[parts.length - 1]).trim()
}

/** L'un des identifiants des lauréats est-il un SIRET ou un SIREN de l'entreprise ? */
export function tedSirenMatch(n: TedNotice, siren: string | null): boolean {
  if (!siren) return false
  return (n['winner-identifier'] ?? []).some((id) => id.replace(/[\s.]/g, '').startsWith(siren) && /^\d{9}(\d{5})?$/.test(id.replace(/[\s.]/g, '')))
}

export function tedOutput(notices: TedNotice[], total: number, siren: string | null, lang: 'fr' | 'en') {
  const fr = lang === 'fr'
  const entities: OutEntity[] = notices.slice(0, MAX_NOTICES).map((n) => {
    const pub = n['publication-number'] ?? '?'
    const title = multi(n['notice-title'], lang)[0]
    const value = typeof n['total-value'] === 'number' ? n['total-value'] : null
    const cur = n['total-value-cur']?.[0]
    const exact = tedSirenMatch(n, siren)
    return {
      type: 'event',
      label: `${fr ? 'Avis TED' : 'TED notice'} ${pub} : ${shorten(title ? tedTitle(title) : '?')}`,
      data: compact({
        date: n['publication-date']?.slice(0, 10),
        contract_buyer: multi(n['buyer-name'], lang)[0],
        contract_buyer_country: n['buyer-country']?.[0],
        contract_winners: [...new Set(multi(n['winner-name'], lang))].slice(0, 15),
        amount: value !== null ? (cur && cur !== 'EUR' ? `${value.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} ${cur}` : euros(value)) : undefined,
        contract_cpv: [...new Set(n['classification-cpv'] ?? [])].slice(0, 5),
        contract_notice_type: n['notice-type'],
        url: `https://ted.europa.eu/${fr ? 'fr' : 'en'}/notice/-/detail/${pub}`,
        source: 'TED'
      }),
      linkLabel: fr ? 'lauréat (TED)' : 'winner (TED)',
      ...(exact
        ? {}
        : {
            review: true,
            reviewReason: fr
              ? 'lauréat trouvé par son nom dans TED (filiale étrangère ou homonyme possible) : vérifiez l’avis'
              : 'winner found by name in TED (foreign subsidiary or namesake): check the notice'
          })
    }
  })
  return { entities, properties: compact({ ted_notices_count: total || undefined }) }
}

const tedModule = defineModule({
  id: 'company.ted',
  name: { fr: 'Marchés européens (TED)', en: 'EU public contracts (TED)' },
  description: {
    fr: 'Avis d’attribution du Journal officiel de l’Union européenne (TED, API publique sans clé) dont l’entreprise est lauréate : nombre d’avis et les 10 plus récents. Recherche par nom : un avis n’entre directement dans le graphe que si TED publie le SIREN du lauréat, sinon il est proposé dans « À vérifier ».',
    en: 'Contract award notices from the EU Official Journal (TED, public API, no key) won by the company: number of notices and the 10 most recent. Name search: a notice only goes straight into the graph when TED publishes the winner’s SIREN, otherwise it is put in "To review".'
  },
  category: 'company',
  inputTypes: ['company'],
  accepts: (input) => !!companyName(input.label, input.data),
  homepage: 'https://ted.europa.eu',
  async run(input, ctx) {
    const name = companyName(input.label, input.data)
    if (!name || normName(name).length < 3) throw new ModuleError('Raison sociale nécessaire', 'invalid_input')
    const res = await withRetry(
      ctx,
      async () => {
        try {
          return await ctx.fetchJson<TedResponse>(TED_API, {
            method: 'POST',
            json: { query: `winner-name ~ "${odsString(name)}" SORT BY publication-date DESC`, fields: TED_FIELDS, limit: 30, page: 1 },
            timeoutMs: 30000
          })
        } catch (e) {
          if (httpStatus(e) === 400) throw new ModuleError('TED : requête refusée (syntaxe)', 'invalid_input')
          throw e
        }
      },
      { service: 'TED', attempts: 3 }
    )
    const notices = res.notices ?? []
    if (!notices.length) return { raw: { total: 0 } }
    // La recherche TED est approximative : on ne garde que les avis où le nom figure parmi les lauréats.
    const siren = sirenOf(input.label, input.data)
    const kept = notices.filter((n) => tedSirenMatch(n, siren) || namesWinner(multi(n['winner-name'], 'fr').concat(multi(n['winner-name'], 'en')), name))
    return { ...tedOutput(kept, res.totalNoticeCount ?? notices.length, siren, ctx.lang), raw: { total: res.totalNoticeCount, ids: notices.map((n) => n['publication-number']) } }
  }
})

export const modules = [decpModule, boampModule, tedModule]

