// Installations classées pour la protection de l'environnement (ICPE) d'un établissement, via
// l'API Géorisques (ministère de la Transition écologique, sans clé) : régime, statut Seveso,
// état d'activité, rubriques, dernières inspections et documents publiés. Chaque site est placé
// sur la carte. L'API ne cherche que par SIRET (un paramètre SIREN serait ignoré).

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { siretOf, withRetry } from './_datagouv'
import { compact } from '../social/_lib'

const API = 'https://georisques.gouv.fr/api/v1/installations_classees'
const MAX_SITES = 10
const MAX_DOCS = 5

interface GeoFile {
  nomFichier?: string | null
  typeFichier?: string | null
  dateFichier?: string | null
  urlFichier?: string | null
}

export interface IcpeSite {
  raisonSociale?: string | null
  adresse1?: string | null
  adresse2?: string | null
  adresse3?: string | null
  codePostal?: string | null
  codeInsee?: string | null
  commune?: string | null
  codeNaf?: string | null
  longitude?: number | null
  latitude?: number | null
  statutSeveso?: string | null
  prioriteNationale?: boolean | null
  ied?: boolean | null
  etatActivite?: string | null
  codeAIOT?: string | null
  siret?: string | null
  serviceAIOT?: string | null
  regime?: string | null
  date_maj?: string | null
  inspections?: Array<{ dateInspection?: string | null; fichierInspection?: GeoFile | null }> | null
  documentsHorsInspection?: GeoFile[] | null
  rubriques?: Array<{ numeroRubrique?: string | null; nature?: string | null; regimeAutoriseAlinea?: string | null; quantiteTotale?: string | null; unite?: string | null }> | null
}

export interface IcpeResponse {
  results?: number
  data?: IcpeSite[]
}

const clean = (v: string | null | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined)

/** Activités classées : « 2712 Stockage, dépollution... de VHU (Enregistrement, 27265 m2) ». */
export function rubriques(s: IcpeSite): string[] {
  return (s.rubriques ?? []).map((r) => {
    const qty = r.quantiteTotale ? `${Number(r.quantiteTotale).toLocaleString('fr-FR').replace(/[  ]/g, ' ')}${r.unite ? ` ${r.unite}` : ''}` : undefined
    const detail = [clean(r.regimeAutoriseAlinea), qty].filter(Boolean).join(', ')
    return `${[clean(r.numeroRubrique), clean(r.nature)].filter(Boolean).join(' ')}${detail ? ` (${detail})` : ''}`
  })
}

export function siteEntity(s: IcpeSite, lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const inspections = (s.inspections ?? []).filter((i) => i.dateInspection).sort((a, b) => (b.dateInspection ?? '').localeCompare(a.dateInspection ?? ''))
  const reports = inspections
    .map((i) => (i.fichierInspection?.urlFichier ? `${i.dateInspection} : ${i.fichierInspection.urlFichier}` : null))
    .filter((x): x is string => !!x)
    .slice(0, MAX_DOCS)
  const docs = (s.documentsHorsInspection ?? [])
    .filter((d) => d.urlFichier)
    .sort((a, b) => (b.dateFichier ?? '').localeCompare(a.dateFichier ?? ''))
    .slice(0, MAX_DOCS)
    .map((d) => `${[d.dateFichier, clean(d.typeFichier) ?? clean(d.nomFichier)].filter(Boolean).join(' ')} : ${d.urlFichier}`)
  const address = [clean(s.adresse1), clean(s.adresse2), clean(s.adresse3), [clean(s.codePostal), clean(s.commune)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const geo = typeof s.latitude === 'number' && typeof s.longitude === 'number'
  return {
    type: 'place',
    label: `${fr ? 'Site ICPE' : 'Classified facility'} ${clean(s.codeAIOT) ?? ''} : ${clean(s.raisonSociale) ?? '?'}${s.commune ? ` (${s.commune})` : ''}`.replace(/\s+:/, ' :'),
    data: compact({
      kind: fr ? 'installation classée (ICPE)' : 'classified facility (ICPE)',
      siret: clean(s.siret),
      address: address || undefined,
      citycode: clean(s.codeInsee),
      lat: geo ? s.latitude! : undefined,
      lon: geo ? s.longitude! : undefined,
      icpe_regime: clean(s.regime),
      seveso_status: clean(s.statutSeveso),
      icpe_ied: s.ied === true ? true : undefined,
      icpe_national_priority: s.prioriteNationale === true ? true : undefined,
      icpe_activity_status: clean(s.etatActivite),
      icpe_inspection_service: clean(s.serviceAIOT),
      icpe_categories: rubriques(s),
      icpe_last_inspection_date: inspections[0]?.dateInspection ?? undefined,
      inspections_count: inspections.length || undefined,
      inspection_reports: reports,
      icpe_documents: docs,
      url: s.codeAIOT ? `https://www.georisques.gouv.fr/risques/installations/donnees/details/${s.codeAIOT}` : undefined
    }),
    linkLabel: fr ? 'installation classée' : 'classified facility'
  }
}

export function icpeOutput(sites: IcpeSite[], lang: 'fr' | 'en') {
  const kept = sites.slice(0, MAX_SITES)
  const seveso = [...new Set(kept.map((s) => clean(s.statutSeveso)).filter((x): x is string => !!x && !/^non/i.test(x)))]
  const properties: Record<string, PropValue> = compact({
    icpe_sites_count: sites.length,
    seveso_status: seveso.join(', ') || undefined
  })
  return { properties, entities: kept.map((s) => siteEntity(s, lang)) }
}

export default defineModule({
  id: 'company.icpe',
  name: { fr: 'Installations classées (Géorisques)', en: 'Classified facilities (Géorisques)' },
  description: {
    fr: 'Installations classées pour la protection de l’environnement de l’établissement, par SIRET, via l’API Géorisques (sans clé) : régime, statut Seveso, état d’activité, rubriques, dernières inspections et liens vers les rapports et arrêtés. Chaque site est placé sur la carte (10 au plus).',
    en: 'Classified environmental facilities (ICPE) of the establishment, by SIRET, from the Géorisques API (no key): regime, Seveso status, activity status, categories, latest inspections and links to reports and orders. Each site is shown on the map (up to 10).'
  },
  category: 'company',
  inputTypes: ['company'],
  accepts: (input) => !!siretOf(input.label, input.data),
  homepage: 'https://www.georisques.gouv.fr',
  async run(input, ctx) {
    const siret = siretOf(input.label, input.data)
    if (!siret) throw new ModuleError('SIRET nécessaire (l’API Géorisques ne cherche pas par SIREN)', 'invalid_input')
    const res = await withRetry(
      ctx,
      () => ctx.fetchJson<IcpeResponse>(API, { query: { siret, page: 1, page_size: MAX_SITES }, timeoutMs: 30000 }),
      { service: 'Géorisques', attempts: 4 }
    )
    // Garde-fou : l'API ignore les paramètres inconnus et renverrait alors toute la base.
    const sites = (res.data ?? []).filter((s) => s.siret === siret)
    if (!sites.length) return { raw: { total: 0 } }
    return { ...icpeOutput(sites, ctx.lang), raw: { total: res.results, sites } }
  }
})
