// Partie « compléments » de l'API Recherche d'entreprises : labels et indicateurs (RGE,
// Qualiopi, ESS, SIAE, FINESS...), conventions collectives, élus d'une collectivité, et
// établissements secondaires renvoyés avec la recherche.

import type { ModuleContext, OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cappedList } from '../domain/_util'
import { compact, num, tr } from '../misc/_util'
import { nafLabel, titleCase } from './_fr'

export interface ReElu {
  nom?: string | null
  prenoms?: string | null
  annee_de_naissance?: string | null
  fonction?: string | null
  sexe?: string | null
}

export interface ReComplements {
  est_association?: boolean
  est_entrepreneur_individuel?: boolean
  identifiant_association?: string | null
  collectivite_territoriale?: { code?: string | null; code_insee?: string | null; niveau?: string | null; elus?: ReElu[] | null } | null
  liste_idcc?: string[] | null
  liste_finess_juridique?: string[] | null
  liste_id_organisme_formation?: string[] | null
  type_siae?: string | null
  egapro_renseignee?: boolean | null
  bilan_ges_renseigne?: boolean | null
  a_aide_minimis?: boolean | null
  a_aide_ademe?: boolean | null
  [flag: string]: unknown
}

export interface ReEtablissement {
  siret: string
  adresse?: string | null
  code_postal?: string | null
  libelle_commune?: string | null
  latitude?: string | null
  longitude?: string | null
  activite_principale?: string | null
  date_creation?: string | null
  date_fermeture?: string | null
  etat_administratif?: string | null
  est_siege?: boolean
  nom_commercial?: string | null
  liste_enseignes?: string[] | null
}

/** Indicateurs booléens et leur libellé, dans l'ordre d'affichage. */
const FLAGS: Array<[string, string, string]> = [
  ['est_rge', 'RGE (reconnu garant de l’environnement)', 'RGE (environmental quality label)'],
  ['est_qualiopi', 'Qualiopi (formation certifiée)', 'Qualiopi (certified training)'],
  ['est_organisme_formation', 'Organisme de formation', 'Training organization'],
  ['est_ess', 'Économie sociale et solidaire (ESS)', 'Social and solidarity economy (ESS)'],
  ['est_siae', 'Structure d’insertion par l’activité économique (SIAE)', 'Work integration social enterprise (SIAE)'],
  ['est_societe_mission', 'Société à mission', 'Mission-driven company'],
  ['est_finess', 'Établissement sanitaire ou social (FINESS)', 'Health or social care establishment (FINESS)'],
  ['est_avocat', 'Avocat', 'Lawyer'],
  ['est_bio', 'Agriculture biologique', 'Organic farming'],
  ['est_entrepreneur_spectacle', 'Entrepreneur de spectacles', 'Live entertainment contractor'],
  ['est_patrimoine_vivant', 'Entreprise du patrimoine vivant', 'Living heritage company'],
  ['est_achats_responsables', 'Label Relations fournisseurs et achats responsables', 'Responsible supplier relations label'],
  ['est_alim_confiance', 'Contrôle sanitaire Alim’confiance', 'Alim’confiance food inspection'],
  ['est_uai', 'Établissement d’enseignement (UAI)', 'Educational establishment (UAI)'],
  ['est_service_public', 'Service public', 'Public service'],
  ['est_administration', 'Administration', 'Public administration'],
  ['egapro_renseignee', 'Index de l’égalité professionnelle déclaré (Egapro)', 'Gender equality index filed (Egapro)'],
  ['bilan_ges_renseigne', 'Bilan des émissions de gaz à effet de serre publié', 'Greenhouse gas report filed'],
  ['a_aide_minimis', 'Aides publiques de minimis reçues', 'De minimis state aid received'],
  ['a_aide_ademe', 'Aides de l’ADEME reçues', 'ADEME grants received']
]

/** Libellés des indicateurs vrais. */
export function complementLabels(ctx: Pick<ModuleContext, 'lang'>, c: ReComplements | null | undefined): string[] {
  if (!c) return []
  const out = FLAGS.filter(([k]) => c[k] === true).map(([, fr, en]) => tr(ctx, fr, en))
  const siae = out.findIndex((l) => l.includes('SIAE'))
  if (c.type_siae && siae >= 0) out[siae] += ` : ${c.type_siae}`
  return out
}

/** Élus d'une collectivité, la fonction d'abord (maire, adjoints), sans date de naissance. */
export function electedOfficials(c: ReComplements | null | undefined): string[] {
  const elus = c?.collectivite_territoriale?.elus ?? []
  const rank = (e: ReElu): number => {
    const f = (e.fonction ?? '').toLowerCase()
    if (!f) return 1000
    if (/^(maire|président)/.test(f)) return 0
    const n = Number(f.match(/^(\d+)/)?.[1])
    return Number.isFinite(n) ? n : 500
  }
  return [...elus]
    .filter((e) => e.nom)
    .sort((a, b) => rank(a) - rank(b) || (a.nom ?? '').localeCompare(b.nom ?? ''))
    .map((e) => {
      const name = [e.prenoms ? titleCase(e.prenoms) : '', titleCase(e.nom ?? '')].filter(Boolean).join(' ')
      return e.fonction ? `${name} (${e.fonction})` : name
    })
}

/** Propriétés tirées des compléments. */
export function complementProperties(ctx: Pick<ModuleContext, 'lang'>, c: ReComplements | null | undefined): Record<string, PropValue> {
  if (!c) return {}
  const idcc = (c.liste_idcc ?? []).filter((x) => x && x !== '9999' && x !== '9998')
  return compact({
    company_labels: complementLabels(ctx, c),
    collective_agreements: idcc.map((x) => `IDCC ${x}`),
    finess_ids: c.liste_finess_juridique ?? [],
    training_org_ids: c.liste_id_organisme_formation ?? [],
    ...cappedList('elected_officials', electedOfficials(c))
  })
}

export const MAX_ESTABLISHMENTS = 10

/** Établissements secondaires (hors siège) : entités adresse liées « établissement ». */
export function establishmentEntities(ctx: Pick<ModuleContext, 'lang'>, list: ReEtablissement[] | null | undefined, siegeSiret?: string): OutEntity[] {
  return (list ?? [])
    .filter((e) => e.adresse && !e.est_siege && e.siret !== siegeSiret)
    .sort((a, b) => Number(b.etat_administratif === 'A') - Number(a.etat_administratif === 'A') || (b.date_creation ?? '').localeCompare(a.date_creation ?? ''))
    .slice(0, MAX_ESTABLISHMENTS)
    .map((e) => ({
      type: 'address',
      label: e.adresse!,
      data: compact({
        siret: e.siret,
        postcode: e.code_postal ?? null,
        city: e.libelle_commune ?? null,
        country: 'France',
        lat: num(e.latitude),
        lon: num(e.longitude),
        activity: e.activite_principale ? [e.activite_principale, nafLabel(e.activite_principale)].filter(Boolean).join(' ') : null,
        trade_name: e.nom_commercial ?? e.liste_enseignes?.[0] ?? null,
        status: e.etat_administratif === 'F' ? tr(ctx, 'fermé', 'closed') : tr(ctx, 'ouvert', 'open'),
        created_at: e.date_creation ?? null,
        closed_at: e.date_fermeture ?? null
      }),
      linkLabel: tr(ctx, 'établissement', 'establishment')
    }))
}
