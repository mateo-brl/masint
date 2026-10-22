// Annonces légales d'une entreprise : BODACC (immatriculation, modifications, dépôts des
// comptes, procédures collectives, radiation) et BALO (sociétés cotées : convocations,
// comptes annuels), via les API Opendatasoft de la DILA, sans clé. Les annonces deviennent
// des événements datés ; anciens dirigeants, anciennes adresses et anciennes dénominations
// sont relevés dans les annonces.

import { defineModule, ModuleError, type InputEntity, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cappedList } from '../domain/_util'
import { compact, tr } from '../misc/_util'
import { httpStatus } from '../social/_lib'
import { fold } from '../person/_name'
import type { BodaccRecord } from '../person/bodacc'
import { sirenOf } from './_ids'

const BODACC = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records'
const BALO = 'https://journal-officiel-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/balo/records'
const PAGE = 100
const MAX_PAGES = 3
const MAX_BODACC_EVENTS = 25
const MAX_BALO_EVENTS = 10

export interface CompanyBodaccRecord extends BodaccRecord {
  familleavis?: string
  acte?: string | object | null
  modificationsgenerales?: string | object | null
  radiationaurcs?: string | object | null
  depot?: string | object | null
  divers?: string | object | null
}

export interface BaloRecord {
  id_annonce: string
  dateparution?: string
  societes_noms?: string[]
  siren?: string[]
  facette_categorie_libelle?: string | null
  fichiers_joints_fichier_pdf_text?: string | null
  ftcontent?: string | null
}

interface OdsResponse<T> {
  total_count?: number
  results?: T[]
}

type Json = Record<string, unknown>

const parse = (v: unknown): Json | null => {
  if (v && typeof v === 'object') return v as Json
  if (typeof v !== 'string') return null
  try {
    const o = JSON.parse(v) as unknown
    return o && typeof o === 'object' ? (o as Json) : null
  } catch {
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const frDate = (iso: string | undefined | null): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Personne morale décrite par l'annonce (la première de `listepersonnes`). */
export function legalPerson(r: CompanyBodaccRecord): Json | null {
  const root = parse(r.listepersonnes)
  const p = root?.personne ?? root
  const first = Array.isArray(p) ? p[0] : p
  return first && typeof first === 'object' ? (first as Json) : null
}

/** Résumé d'une annonce : nature et détail lisible (« capital (augmentation) »). */
export function describe(r: CompanyBodaccRecord, lang: 'fr' | 'en' = 'fr'): { kind: string; detail: string } {
  const kind = r.familleavis_lib || r.familleavis || 'Annonce'
  const parts: string[] = []
  const mod = parse(r.modificationsgenerales)
  if (mod) parts.push(str(mod.descriptif).replace(/^modification survenue sur (l['’]|le |la |les )?/i, ''))
  const depot = parse(r.depot)
  if (depot)
    parts.push([str(depot.typeDepot), depot.dateCloture ? `${lang === 'fr' ? 'clôture' : 'closing'} ${frDate(str(depot.dateCloture))}` : ''].filter(Boolean).join(', '))
  const jug = parse(r.jugement)
  if (jug) parts.push([str(jug.nature) || str(jug.famille), jug.date ? `${lang === 'fr' ? 'du' : 'on'} ${frDate(str(jug.date))}` : ''].filter(Boolean).join(' '))
  const acte = parse(r.acte)
  if (acte) {
    const sub = (k: string): Json | null => parse(acte[k])
    parts.push(
      str(sub('immatriculation')?.categorieImmatriculation) ||
        str(sub('creation')?.categorieCreation) ||
        str(sub('vente')?.categorieVente) ||
        str(acte.descriptif)
    )
  }
  const rad = parse(r.radiationaurcs)
  if (rad) parts.push(str(rad.commentaire) || (rad.dateCessationActivitePM ? `${lang === 'fr' ? 'cessation d’activité le' : 'ceased trading on'} ${frDate(str(rad.dateCessationActivitePM))}` : ''))
  const divers = parse(r.divers)
  if (divers) parts.push(str(divers.texte))
  return { kind, detail: clip(parts.filter(Boolean).join(' ; '), 200) }
}

/** Événement daté pour une annonce BODACC. */
export function bodaccEvent(r: CompanyBodaccRecord, lang: 'fr' | 'en'): OutEntity {
  const { kind, detail } = describe(r, lang)
  const jug = parse(r.jugement)
  return {
    type: 'event',
    label: `BODACC ${frDate(r.dateparution)} : ${kind}${detail ? ` (${clip(detail, 90)})` : ''}`,
    data: compact({
      date: r.dateparution ?? null,
      bodacc_type: kind,
      description: detail || null,
      judgment: jug ? clip(str(jug.complementJugement), 600) || null : null,
      court: r.tribunal ?? null,
      bodacc_id: r.id,
      url: r.url_complete ?? null
    }),
    linkLabel: tr({ lang }, 'annonce BODACC', 'BODACC notice')
  }
}

/** Adresse du siège publiée dans l'annonce. */
function seatAddress(p: Json | null): string | null {
  const a = parse(p?.adresseSiegeSocial)
  if (!a) return null
  const street = [a.numeroVoie, a.typeVoie, a.nomVoie].map(str).filter(Boolean).join(' ')
  if (!street) return null
  return [street, str(a.codePostal), str(a.ville)].filter(Boolean).join(' ')
}

const ABBREV: Record<string, string> = { bd: 'boulevard', av: 'avenue', ave: 'avenue', pl: 'place', r: 'rue', rte: 'route', che: 'chemin', chem: 'chemin', imp: 'impasse', all: 'allee', sq: 'square' }
/** Clé de comparaison d'une adresse (casse, accents, abréviations de voie). */
export function addressKey(s: string): string {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => ABBREV[w] ?? w)
    .join(' ')
}

export interface History {
  formerOfficers: string[]
  formerAddresses: string[]
  previousNames: string[]
  proceedings: string[]
}

/**
 * Relève dans les annonces (de la plus récente à la plus ancienne) les dirigeants partants,
 * les adresses de siège et dénominations antérieures à celles de la dernière annonce, et les
 * procédures collectives.
 */
export function history(records: CompanyBodaccRecord[], lang: 'fr' | 'en' = 'fr'): History {
  const sorted = [...records].sort((a, b) => (b.dateparution ?? '').localeCompare(a.dateparution ?? ''))
  const out: History = { formerOfficers: [], formerAddresses: [], previousNames: [], proceedings: [] }
  const seenAddr = new Set<string>()
  const seenName = new Set<string>()
  const seenOfficer = new Set<string>()
  for (const r of sorted) {
    const p = legalPerson(r)
    const when = r.dateparution ? r.dateparution.slice(0, 7).split('-').reverse().join('/') : ''
    // « Administrateur partant : Nom, Prénom ; Président : ... »
    for (const part of str(p?.administration).split(';')) {
      const m = part.match(/^\s*([^:]*?)\s+partante?s?\s*:\s*(.+?)\s*$/i)
      if (!m) continue
      const who = m[2].replace(/\s+/g, ' ')
      const key = fold(who)
      if (seenOfficer.has(key)) continue
      seenOfficer.add(key)
      out.formerOfficers.push(`${who} (${m[1]}${when ? `, ${lang === 'fr' ? 'départ publié en' : 'departure published'} ${when}` : ''})`)
    }
    const addr = seatAddress(p)
    if (addr) {
      const key = addressKey(addr)
      if (!seenAddr.size) seenAddr.add(key)
      else if (!seenAddr.has(key)) {
        seenAddr.add(key)
        out.formerAddresses.push(`${addr}${when ? ` (${lang === 'fr' ? 'publiée jusqu’en' : 'published until'} ${when})` : ''}`)
      }
    }
    const name = str(p?.denomination)
    if (name) {
      const key = fold(name).replace(/[^a-z0-9]/g, '')
      if (!seenName.size) seenName.add(key)
      else if (!seenName.has(key)) {
        seenName.add(key)
        out.previousNames.push(`${name}${when ? ` (${when})` : ''}`)
      }
    }
    if (r.familleavis === 'collective' || parse(r.jugement)) {
      const { detail } = describe(r, lang)
      out.proceedings.push(`${frDate(r.dateparution)} : ${clip(detail || r.familleavis_lib || '', 140)}`)
    }
  }
  return out
}

/** Catégorie lisible d'une annonce BALO (« PUBLICATIONS PERIODIQUES##Comptes annuels »). */
export function baloCategory(r: BaloRecord): string {
  const parts = (r.facette_categorie_libelle ?? '').split('##').map((s) => s.trim()).filter(Boolean)
  const last = parts[parts.length - 1] ?? 'Annonce'
  return last === last.toUpperCase() ? last.charAt(0) + last.slice(1).toLowerCase() : last
}

export function baloEvent(r: BaloRecord, lang: 'fr' | 'en'): OutEntity {
  const category = baloCategory(r)
  const pdf = r.fichiers_joints_fichier_pdf_text
  const d = r.dateparution ?? ''
  return {
    type: 'event',
    label: `BALO ${frDate(d)} : ${category} (${r.societes_noms?.[0] ?? ''})`.replace(' ()', ''),
    data: compact({
      date: d || null,
      balo_type: category,
      description: r.ftcontent ? clip(r.ftcontent.replace(/\s+/g, ' ').trim(), 400) : null,
      url: pdf && d ? `https://www.journal-officiel.gouv.fr/telechargements/BALO/pdf/${d.slice(0, 4)}/${d.slice(5, 7)}${d.slice(8, 10)}/${pdf}` : null
    }),
    linkLabel: tr({ lang }, 'annonce BALO', 'BALO notice')
  }
}

export function announcementsOutput(
  ctx: Pick<ModuleContext, 'lang'>,
  siren: string,
  bodacc: { records: CompanyBodaccRecord[]; total: number },
  balo: { records: BaloRecord[]; total: number } | null
): ModuleOutput {
  const sorted = [...bodacc.records].sort((a, b) => (b.dateparution ?? '').localeCompare(a.dateparution ?? ''))
  const h = history(sorted, ctx.lang)
  const entities = [
    ...sorted.slice(0, MAX_BODACC_EVENTS).map((r) => bodaccEvent(r, ctx.lang)),
    ...(balo?.records ?? []).slice(0, MAX_BALO_EVENTS).map((r) => baloEvent(r, ctx.lang))
  ]
  const properties: Record<string, PropValue> = compact({
    bodacc_announcements: bodacc.total || null,
    bodacc_last_date: sorted[0]?.dateparution ?? null,
    bodacc_url: bodacc.total ? `https://www.bodacc.fr/pages/annonces-commerciales/?q=${siren}` : null,
    ...cappedList('former_officers', h.formerOfficers),
    ...cappedList('former_addresses', h.formerAddresses),
    previous_names: h.previousNames,
    collective_proceedings: h.proceedings,
    balo_announcements: balo?.total || null,
    balo_last_date: balo?.records[0]?.dateparution ?? null
  })
  return {
    properties,
    entities,
    raw: {
      bodacc: { total: bodacc.total, fetched: sorted.length, ids: sorted.slice(0, MAX_BODACC_EVENTS).map((r) => r.id) },
      balo: balo ? { total: balo.total, ids: balo.records.map((r) => r.id_annonce) } : null
    }
  }
}

async function ods<T>(ctx: ModuleContext, url: string, service: string, query: Record<string, string | number>): Promise<OdsResponse<T>> {
  let last: unknown
  // Les hôtes de la DILA coupent parfois la connexion : deux nouvelles tentatives espacées.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ctx.fetchJson<OdsResponse<T>>(url, { query, timeoutMs: 30000 })
    } catch (e) {
      last = e
      const status = httpStatus(e)
      if (status === 429) throw new ModuleError(`${service} : trop de requêtes, réessayez plus tard`, 'rate_limited')
      if ((status && status < 500) || ctx.signal.aborted) break
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw new ModuleError(`${service} injoignable : ${last instanceof Error ? last.message : String(last)}`, 'unavailable')
}

async function bodaccRecords(ctx: ModuleContext, siren: string): Promise<{ records: CompanyBodaccRecord[]; total: number }> {
  const where = `registre like "${siren}"`
  const first = await ods<CompanyBodaccRecord>(ctx, BODACC, 'BODACC', { where, order_by: 'dateparution desc', limit: PAGE, offset: 0 })
  const records = [...(first.results ?? [])]
  const total = first.total_count ?? records.length
  for (let n = 1; n < MAX_PAGES && records.length < total; n++)
    records.push(...((await ods<CompanyBodaccRecord>(ctx, BODACC, 'BODACC', { where, order_by: 'dateparution desc', limit: PAGE, offset: n * PAGE })).results ?? []))
  return { records, total }
}

export default defineModule({
  id: 'company.bodacc',
  name: { fr: 'Annonces BODACC et BALO (entreprise)', en: 'BODACC and BALO notices (company)' },
  description: {
    fr: 'Annonces légales de l’entreprise d’après son SIREN (API de la DILA, sans clé) : au BODACC, immatriculation, modifications, dépôts des comptes, procédures collectives et radiation ; au BALO, avis des sociétés cotées. Les 25 annonces BODACC et les 10 annonces BALO les plus récentes deviennent des événements datés ; le total, les anciens dirigeants, anciennes adresses du siège, anciennes dénominations et procédures collectives sont relevés en propriétés.',
    en: 'Legal notices of the company from its SIREN (DILA API, no key): in BODACC, registration, changes, filed accounts, insolvency proceedings and removal; in BALO, listed company notices. The 25 latest BODACC and 10 latest BALO notices become dated events; the total, former officers, former head office addresses, former names and insolvency proceedings are kept as properties.'
  },
  category: 'company',
  inputTypes: ['company', 'organization'],
  accepts: (input: InputEntity) => !!sirenOf(input),
  homepage: 'https://www.bodacc.fr/',
  async run(input, ctx) {
    const siren = sirenOf(input)
    if (!siren) throw new ModuleError('SIREN inconnu : lancez d’abord la recherche dans l’annuaire des entreprises', 'invalid_input')
    const bodacc = await bodaccRecords(ctx, siren)
    // Le BALO ne concerne que les sociétés faisant appel public à l'épargne : facultatif.
    let balo: { records: BaloRecord[]; total: number } | null = null
    try {
      const res = await ods<BaloRecord>(ctx, BALO, 'BALO', { where: `siren="${siren}"`, order_by: 'dateparution desc', limit: MAX_BALO_EVENTS })
      balo = { records: res.results ?? [], total: res.total_count ?? 0 }
    } catch (e) {
      ctx.log(`BALO indisponible : ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!bodacc.total && !balo?.total) return { raw: { siren, bodacc: 0, balo: balo ? 0 : null } }
    return announcementsOutput(ctx, siren, bodacc, balo)
  }
})
