// Annuaire de l'administration (Service-Public.fr, DILA) : coordonnées des services publics
// nationaux et locaux (adresse géolocalisée, téléphone, courriel, site, horaires, missions)
// et responsables quand l'annuaire les publie (nommés au Journal officiel). API Opendatasoft
// publique, sans clé.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { normalizePhone } from '@shared/detect'
import { compact, getJson, num, tr } from '../misc/_util'
import { titleCase } from '../company/_fr'

const API = 'https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records'
const MAX_CANDIDATES = 5
const MAX_HEADS = 5

interface Labelled {
  valeur?: string
  libelle?: string
  description?: string
  custom_dico2?: string
}

export interface AnnuaireAddress {
  type_adresse?: string
  complement1?: string
  complement2?: string
  numero_voie?: string
  service_distribution?: string
  code_postal?: string
  nom_commune?: string
  pays?: string
  longitude?: string
  latitude?: string
}

export interface Assignment {
  fonction?: string
  personne?: { nom?: string; prenom?: string; civilite?: string; texte_reference?: Labelled[] }
}

export interface AnnuaireRecord {
  id: string
  nom: string
  sigle?: string | null
  categorie?: string | null
  type_organisme?: string | null
  siret?: string | null
  siren?: string | null
  adresse?: AnnuaireAddress[] | string | null
  telephone?: Labelled[] | string | null
  adresse_courriel?: string | null
  site_internet?: Labelled[] | string | null
  reseau_social?: Labelled[] | string | null
  plage_ouverture?: Array<Record<string, string>> | string | null
  mission?: string | null
  affectation_personne?: Assignment[] | string | null
  hierarchie?: Array<{ type_hierarchie?: string; service?: string }> | string | null
  url_service_public?: string | null
  date_modification_datetime?: string | null
}

export interface AnnuaireResponse {
  total_count?: number
  results?: AnnuaireRecord[]
}

/** Les champs structurés arrivent en JSON ou déjà décodés selon les versions de l'API. */
function list<T>(v: T[] | string | null | undefined): T[] {
  if (!v) return []
  if (Array.isArray(v)) return v
  try {
    const parsed = JSON.parse(v) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'a', 'au', 'aux', 'en'])

/** Mots significatifs d'un nom de service (« Mairie de Carcassonne » → mairie, carcassonne). */
export function nameWords(name: string): string[] {
  return [...new Set(fold(name).split(' ').filter((w) => w.length > 1 && !STOP.has(w)))].slice(0, 6)
}

/** Clause `where` ODSQL : tous les mots doivent figurer dans le nom. */
export function whereClause(name: string): string | null {
  const words = nameWords(name)
  if (!words.length) return null
  return words.map((w) => `search(nom, "${w.replace(/"/g, '')}")`).join(' and ')
}

/**
 * Correspondance exacte (nom ou sigle), sinon le seul résultat quand il n'y en a qu'un et que
 * l'entrée est bien une administration : un nom d'organisation exige le nom exact.
 */
export function pickRecord(records: AnnuaireRecord[], name: string, loose = true): AnnuaireRecord | null {
  const q = fold(name)
  const exact = records.filter((r) => fold(r.nom) === q || (r.sigle && fold(r.sigle) === q) || fold(r.nom.replace(/\s+-\s+/g, ' de ')) === q)
  if (exact.length === 1) return exact[0]
  return loose && records.length === 1 ? records[0] : null
}

const frTime = (t: string | undefined): string => (t ? t.slice(0, 5).replace(':', 'h') : '')

/** « Lundi à Jeudi : 08h30-12h30, 13h30-17h30 ». */
export function openingHours(v: AnnuaireRecord['plage_ouverture']): string[] {
  return list<Record<string, string>>(v).map((p) => {
    const days = p.nom_jour_debut === p.nom_jour_fin || !p.nom_jour_fin ? p.nom_jour_debut : `${p.nom_jour_debut} à ${p.nom_jour_fin}`
    const slots = [1, 2, 3]
      .map((i) => (p[`valeur_heure_debut_${i}`] ? `${frTime(p[`valeur_heure_debut_${i}`])}-${frTime(p[`valeur_heure_fin_${i}`])}` : ''))
      .filter(Boolean)
    return `${days} : ${slots.join(', ')}${p.commentaire ? ` (${p.commentaire})` : ''}`
  })
}

function mainAddress(r: AnnuaireRecord): { label: string; data: Record<string, PropValue> } | null {
  const all = list<AnnuaireAddress>(r.adresse)
  const a = all.find((x) => x.type_adresse === 'Adresse') ?? all[0]
  if (!a) return null
  const street = [a.complement1, a.complement2, a.numero_voie].filter((s) => s && s.trim()).join(', ')
  const town = [a.code_postal, a.nom_commune].filter(Boolean).join(' ')
  const label = [street, a.service_distribution, town].filter((s) => s && s.trim()).join(', ')
  if (!label) return null
  const lat = num(a.latitude)
  const lon = num(a.longitude)
  return {
    label,
    data: compact({ street: a.numero_voie ?? null, postcode: a.code_postal ?? null, city: a.nom_commune ?? null, country: a.pays ?? 'France', lat: lat && lon ? lat : null, lon: lat && lon ? lon : null })
  }
}

/** Prénom et nom d'un responsable, le nom en capitales remis en casse normale. */
function headName(p: NonNullable<Assignment['personne']>): { first: string; last: string } {
  const nom = p.nom ?? ''
  return { first: p.prenom ? titleCase(p.prenom) : '', last: nom === nom.toUpperCase() ? titleCase(nom) : nom }
}

export function annuaireOutput(ctx: Pick<ModuleContext, 'lang'>, r: AnnuaireRecord): ModuleOutput {
  const entities: OutEntity[] = []
  const address = mainAddress(r)
  if (address) entities.push({ type: 'address', label: address.label, data: address.data, linkLabel: tr(ctx, 'adresse', 'address') })

  const phones = list<Labelled>(r.telephone).filter((t) => t.valeur)
  for (const t of phones.slice(0, 3)) {
    const e164 = normalizePhone(t.valeur!)
    if (e164) entities.push({ type: 'phone', label: e164, linkLabel: t.description ? `${tr(ctx, 'téléphone', 'phone')} (${t.description})` : tr(ctx, 'téléphone', 'phone') })
  }
  if (r.adresse_courriel) {
    for (const mail of r.adresse_courriel.split(/[;,\s]+/).filter((m) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(m)).slice(0, 2))
      entities.push({ type: 'email', label: mail.toLowerCase(), linkLabel: tr(ctx, 'courriel', 'email') })
  }
  const sites = list<Labelled>(r.site_internet).filter((s) => s.valeur && /^https?:\/\//i.test(s.valeur))
  if (sites[0]) entities.push({ type: 'website', label: sites[0].valeur!, linkLabel: tr(ctx, 'site officiel', 'official website') })

  // Responsables publiés par l'annuaire : agents publics nommés dans leur fonction.
  const heads = list<Assignment>(r.affectation_personne).filter((h) => h.personne?.nom)
  for (const h of heads.slice(0, MAX_HEADS)) {
    const p = h.personne!
    const { first, last } = headName(p)
    const jorf = list<Labelled>(p.texte_reference)[0]
    entities.push({
      type: 'person',
      label: [first, last].filter(Boolean).join(' '),
      data: compact({ first_name: first || null, last_name: last, occupation: h.fonction ?? null, appointment_text: jorf?.libelle ?? null, appointment_url: jorf?.valeur ?? null }),
      linkLabel: h.fonction || tr(ctx, 'responsable', 'head')
    })
  }

  const properties: Record<string, PropValue> = compact({
    name: r.nom,
    acronym: r.sigle ?? null,
    kind: r.type_organisme ?? null,
    siret: r.siret ?? null,
    siren: r.siren ?? null,
    address: address?.label ?? null,
    phones: phones.map((t) => (t.description ? `${t.valeur} (${t.description})` : t.valeur!)),
    emails: r.adresse_courriel ? [r.adresse_courriel] : [],
    websites: sites.map((s) => s.valeur!),
    social_networks: list<Labelled>(r.reseau_social)
      .filter((s) => s.valeur)
      .map((s) => s.valeur!),
    opening_hours: openingHours(r.plage_ouverture),
    mission: r.mission ? r.mission.slice(0, 1000) : null,
    heads: heads.map((h) => {
      const { first, last } = headName(h.personne!)
      return [h.fonction, [first, last].filter(Boolean).join(' ')].filter(Boolean).join(' : ')
    }),
    annuaire_id: r.id,
    annuaire_url: r.url_service_public ?? `https://lannuaire.service-public.gouv.fr/${r.id}`,
    updated_at: r.date_modification_datetime ?? null
  })
  return { properties, entities, raw: { id: r.id, nom: r.nom, categorie: r.categorie } }
}

export function candidatesOutput(ctx: Pick<ModuleContext, 'lang'>, records: AnnuaireRecord[]): ModuleOutput {
  return {
    entities: records.slice(0, MAX_CANDIDATES).map((r) => ({
      type: 'administration',
      label: r.nom,
      data: compact({ address: mainAddress(r)?.label ?? null, annuaire_id: r.id, annuaire_url: r.url_service_public ?? null }),
      linkLabel: tr(ctx, 'correspondance possible', 'possible match'),
      review: true,
      reviewReason: tr(ctx, "plusieurs services de l'Annuaire de l'administration portent un nom proche", 'several services in the French administration directory have a similar name')
    })),
    raw: records.slice(0, MAX_CANDIDATES).map((r) => ({ id: r.id, nom: r.nom }))
  }
}

export default defineModule({
  id: 'administration.annuaire',
  name: { fr: "Annuaire de l'administration (Service-Public.fr)", en: 'French administration directory (Service-Public.fr)' },
  description: {
    fr: "Cherche le service public par son nom dans l'Annuaire de l'administration (DILA, plus de 90 000 services) : adresse géolocalisée, téléphone, courriel, site, réseaux sociaux, horaires, missions, SIRET et responsables quand ils sont publiés.",
    en: 'Looks the public body up by name in the French administration directory (DILA, over 90,000 services): geolocated address, phone, email, website, social networks, opening hours, missions, SIRET and heads when published.'
  },
  category: 'company',
  inputTypes: ['administration', 'organization'],
  homepage: 'https://lannuaire.service-public.gouv.fr',
  async run(input, ctx) {
    const name = input.label.trim()
    const siret = typeof input.data.siret === 'string' ? input.data.siret.replace(/\D/g, '') : ''
    const where = /^\d{14}$/.test(siret) ? `siret = "${siret}"` : whereClause(name)
    if (!where || name.length < 3) return {}
    const r = await getJson<AnnuaireResponse>(ctx, API, "Annuaire de l'administration", { query: { where, limit: 20 }, timeoutMs: 30000 })
    const records = r?.results ?? []
    if (!records.length) return {}
    const hit = /^\d{14}$/.test(siret) ? records[0] : pickRecord(records, name, input.type === 'administration')
    if (hit) return annuaireOutput(ctx, hit)
    // Un nom d'organisation non administrative ne donne pas de candidats au hasard.
    return input.type === 'administration' ? candidatesOutput(ctx, records) : {}
  }
})
