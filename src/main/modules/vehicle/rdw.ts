// Registre néerlandais des véhicules (RDW, données ouvertes Socrata, sans clé) : marque,
// modèle, couleur, première immatriculation, contrôle technique (APK) et rappels constructeur
// d'une plaque néerlandaise. Le RDW ne publie rien sur le détenteur, et ce module n'en
// reprend rien : ni date de changement de détenteur, ni assurance.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, getJson, num, tr } from '../misc/_util'
import { dutchPlate } from '../misc/licensePlate'

const RDW = 'https://opendata.rdw.nl/resource'
/** Véhicules immatriculés (jeu principal). */
const VEHICLES = `${RDW}/m9d7-ebf2.json`
const FUEL = `${RDW}/8ys7-d773.json`
/** État des rappels par véhicule, puis description des campagnes de rappel. */
const RECALL_STATUS = `${RDW}/t49b-isb7.json`
const RECALLS = `${RDW}/j9yg-7rg9.json`
/** Déclarations des organismes de contrôle (contrôles APK). */
const INSPECTIONS = `${RDW}/sgfe-77wx.json`
const MAX_RECALLS = 5

export interface RdwVehicle {
  kenteken: string
  voertuigsoort?: string
  merk?: string
  handelsbenaming?: string
  inrichting?: string
  eerste_kleur?: string
  tweede_kleur?: string
  aantal_zitplaatsen?: string
  aantal_deuren?: string
  cilinderinhoud?: string
  massa_ledig_voertuig?: string
  catalogusprijs?: string
  europese_voertuigcategorie?: string
  datum_eerste_toelating?: string
  datum_eerste_tenaamstelling_in_nederland?: string
  vervaldatum_apk?: string
  openstaande_terugroepactie_indicator?: string
  taxi_indicator?: string
  export_indicator?: string
  tellerstandoordeel?: string
  zuinigheidsclassificatie?: string
}

export interface RdwFuel {
  brandstof_omschrijving?: string
  nettomaximumvermogen?: string
  co2_uitstoot_gecombineerd?: string
  uitlaatemissieniveau?: string
}

export interface RdwRecallStatus {
  referentiecode_rdw: string
  code_status?: string
  status?: string
}

export interface RdwRecall {
  referentiecode_rdw: string
  publicatiedatum_rdw?: string
  meldende_producent_distributeur?: string
  omschrijving_defect?: string
  categorie_defect?: string
}

export interface RdwInspection {
  meld_datum_door_keuringsinstantie?: string
  soort_melding_ki_omschrijving?: string
  vervaldatum_keuring?: string
}

/** `20090813` → `2009-08-13`. */
export function rdwDate(v: string | undefined): string | null {
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const COLORS: Record<string, [string, string]> = {
  BEIGE: ['beige', 'beige'],
  BLAUW: ['bleu', 'blue'],
  BRUIN: ['marron', 'brown'],
  CREME: ['crème', 'cream'],
  GEEL: ['jaune', 'yellow'],
  GRIJS: ['gris', 'grey'],
  GROEN: ['vert', 'green'],
  ORANJE: ['orange', 'orange'],
  PAARS: ['violet', 'purple'],
  ROOD: ['rouge', 'red'],
  ROSE: ['rose', 'pink'],
  WIT: ['blanc', 'white'],
  ZWART: ['noir', 'black']
}

const KINDS: Record<string, [string, string]> = {
  Personenauto: ['voiture particulière', 'passenger car'],
  Bedrijfsauto: ['véhicule utilitaire', 'commercial vehicle'],
  Motorfiets: ['moto', 'motorcycle'],
  Bromfiets: ['cyclomoteur', 'moped'],
  Aanhangwagen: ['remorque', 'trailer'],
  Oplegger: ['semi-remorque', 'semi-trailer'],
  Bus: ['autobus', 'bus']
}

const FUELS: Record<string, [string, string]> = {
  Benzine: ['essence', 'petrol'],
  Diesel: ['diesel', 'diesel'],
  Elektriciteit: ['électricité', 'electricity'],
  LPG: ['GPL', 'LPG'],
  CNG: ['GNV', 'CNG'],
  Waterstof: ['hydrogène', 'hydrogen']
}

// Codes d'état d'un rappel pour un véhicule donné.
const RECALL_STATES: Record<string, [string, string]> = {
  O: ['non réparé', 'not repaired'],
  P: ['réparation signalée par le constructeur', 'repair reported by the manufacturer'],
  H: ['réparé', 'repaired'],
  A: ['réparé', 'repaired']
}

const ODOMETER: Record<string, [string, string]> = {
  Logisch: ['cohérent', 'consistent'],
  Onlogisch: ['incohérent', 'inconsistent'],
  'Geen oordeel': ['pas de jugement', 'no judgement']
}

const pick = (map: Record<string, [string, string]>, v: string | undefined, lang: 'fr' | 'en'): string | null => {
  if (!v || /niet geregistreerd/i.test(v)) return null
  const hit = map[v] ?? map[v.toUpperCase()]
  return hit ? hit[lang === 'fr' ? 0 : 1] : v.toLowerCase()
}

const yes = (v: string | undefined): boolean | null => (v === 'Ja' ? true : v === 'Nee' ? false : null)

/** « TOYOTA AYGO » → « Toyota Aygo » ; un sigle sans voyelle (« BMW ») reste en capitales. */
export function brandCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (/^[b-df-hj-np-tv-xz]{2,4}$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('')
}

export interface RdwData {
  vehicle: RdwVehicle
  fuel: RdwFuel[]
  recallStatus: RdwRecallStatus[]
  recalls: RdwRecall[]
  inspections: RdwInspection[]
}

export function rdwOutput(ctx: Pick<ModuleContext, 'lang'>, formatted: string, d: RdwData): ModuleOutput {
  const fr = ctx.lang === 'fr'
  const v = d.vehicle
  const brand = v.merk ? brandCase(v.merk) : null
  // La dénomination commerciale répète souvent la marque (« TOYOTA AYGO »).
  const model = v.handelsbenaming ? brandCase(v.handelsbenaming.replace(new RegExp(`^${(v.merk ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '')) : null
  const fuel = d.fuel[0]
  const lastInspection = d.inspections
    .map((i) => rdwDate(i.meld_datum_door_keuringsinstantie))
    .filter((x): x is string => !!x)
    .sort()
    .pop()
  const openRecall = yes(v.openstaande_terugroepactie_indicator)

  const vehicleRef = 'vehicle'
  const entities: OutEntity[] = [
    {
      ref: vehicleRef,
      type: 'vehicle',
      label: [brand, model, `(${formatted})`].filter(Boolean).join(' '),
      data: compact({
        plate: formatted,
        brand,
        model,
        color: pick(COLORS, v.eerste_kleur, ctx.lang),
        secondary_color: pick(COLORS, v.tweede_kleur, ctx.lang),
        vehicle_kind: pick(KINDS, v.voertuigsoort, ctx.lang),
        body_type: v.inrichting && !/niet geregistreerd/i.test(v.inrichting) ? v.inrichting : null,
        eu_category: v.europese_voertuigcategorie ?? null,
        first_registration_date: rdwDate(v.datum_eerste_toelating),
        first_registration_nl_date: rdwDate(v.datum_eerste_tenaamstelling_in_nederland),
        inspection_expiry_date: rdwDate(v.vervaldatum_apk),
        last_inspection_date: lastInspection ?? null,
        fuel: pick(FUELS, fuel?.brandstof_omschrijving, ctx.lang),
        power_kw: num(fuel?.nettomaximumvermogen),
        co2_g_km: num(fuel?.co2_uitstoot_gecombineerd),
        euro_standard: fuel?.uitlaatemissieniveau ?? null,
        engine_cc: num(v.cilinderinhoud),
        seats: num(v.aantal_zitplaatsen),
        empty_mass_kg: num(v.massa_ledig_voertuig),
        catalog_price: num(v.catalogusprijs) ? `${num(v.catalogusprijs)} €` : null,
        odometer_judgement: pick(ODOMETER, v.tellerstandoordeel, ctx.lang),
        open_recall: openRecall,
        taxi: yes(v.taxi_indicator) || null,
        exported: yes(v.export_indicator) || null,
        country: fr ? 'Pays-Bas' : 'Netherlands',
        source: 'RDW',
        url: `https://ovi.rdw.nl/default.aspx?kenteken=${encodeURIComponent(v.kenteken)}`
      }),
      linkLabel: tr(ctx, 'véhicule immatriculé', 'registered vehicle')
    }
  ]

  const details = new Map(d.recalls.map((r) => [r.referentiecode_rdw, r]))
  for (const s of d.recallStatus.slice(0, MAX_RECALLS)) {
    const r = details.get(s.referentiecode_rdw)
    const state = s.code_status ? RECALL_STATES[s.code_status] : undefined
    entities.push({
      type: 'event',
      label: fr ? `Rappel constructeur ${s.referentiecode_rdw} (RDW)` : `Manufacturer recall ${s.referentiecode_rdw} (RDW)`,
      from: vehicleRef,
      data: compact({
        date: rdwDate(r?.publicatiedatum_rdw),
        recall_reference: s.referentiecode_rdw,
        description: r?.omschrijving_defect ?? null,
        defect_category: r?.categorie_defect ?? null,
        recall_issuer: r?.meldende_producent_distributeur ?? null,
        recall_status: state ? state[fr ? 0 : 1] : (s.status ?? null),
        source: 'RDW'
      }),
      linkLabel: tr(ctx, 'rappel constructeur', 'manufacturer recall')
    })
  }

  return {
    properties: compact({ normalized: formatted, country: fr ? 'Pays-Bas' : 'Netherlands', country_code: 'NL' }),
    entities,
    raw: { vehicle: v, fuel: d.fuel, recalls: d.recallStatus, inspections: d.inspections }
  }
}

/** Champs du jeu principal demandés : rien sur le détenteur (date de changement, assurance). */
const VEHICLE_FIELDS = [
  'kenteken', 'voertuigsoort', 'merk', 'handelsbenaming', 'inrichting', 'eerste_kleur', 'tweede_kleur', 'aantal_zitplaatsen',
  'aantal_deuren', 'cilinderinhoud', 'massa_ledig_voertuig', 'catalogusprijs', 'europese_voertuigcategorie', 'datum_eerste_toelating',
  'datum_eerste_tenaamstelling_in_nederland', 'vervaldatum_apk', 'openstaande_terugroepactie_indicator', 'taxi_indicator',
  'export_indicator', 'tellerstandoordeel', 'zuinigheidsclassificatie'
]

/**
 * Seulement pour un format néerlandais plausible, sauf si l'analyse de la plaque l'a déjà
 * rattachée à un autre pays sans retenir les Pays-Bas parmi les pays possibles.
 */
export function acceptsPlate(input: { label: string; data: Record<string, unknown> }): boolean {
  if (!dutchPlate(input.label)) return false
  const code = input.data.country_code
  if (!code || code === 'NL') return true
  const possible = input.data.possible_countries
  return Array.isArray(possible) && possible.some((c) => /^(pays-bas|netherlands)$/i.test(String(c)))
}

export default defineModule({
  id: 'vehicle.rdw',
  name: { fr: 'Véhicule néerlandais (RDW)', en: 'Dutch vehicle (RDW)' },
  description: {
    fr: "Pour une plaque néerlandaise : marque, modèle, couleur, carburant, première immatriculation, fin de validité du contrôle technique (APK) et rappels constructeur, d'après les données ouvertes du RDW. Aucune donnée sur le détenteur.",
    en: 'For a Dutch plate: make, model, colour, fuel, first registration, roadworthiness test (APK) expiry and manufacturer recalls, from RDW open data. No data about the keeper.'
  },
  category: 'misc',
  inputTypes: ['license_plate'],
  homepage: 'https://opendata.rdw.nl',
  accepts: acceptsPlate,
  async run(input, ctx) {
    const nl = dutchPlate(input.label)
    if (!nl) return {}
    const k = nl.kenteken
    const vehicles = await getJson<RdwVehicle[]>(ctx, VEHICLES, 'RDW', { query: { kenteken: k, $select: VEHICLE_FIELDS.join(',') } })
    const vehicle = vehicles?.[0]
    if (!vehicle) return {}
    const [fuel, recallStatus, inspections] = await Promise.all([
      getJson<RdwFuel[]>(ctx, FUEL, 'RDW', { query: { kenteken: k } }),
      getJson<RdwRecallStatus[]>(ctx, RECALL_STATUS, 'RDW', { query: { kenteken: k } }),
      getJson<RdwInspection[]>(ctx, INSPECTIONS, 'RDW', { query: { kenteken: k, $order: 'meld_datum_door_keuringsinstantie DESC', $limit: 5 } })
    ])
    const refs = (recallStatus ?? []).slice(0, MAX_RECALLS).map((r) => r.referentiecode_rdw).filter((r) => /^[A-Z0-9-]+$/i.test(r))
    const recalls = refs.length
      ? await getJson<RdwRecall[]>(ctx, RECALLS, 'RDW', {
          query: {
            $where: `referentiecode_rdw in (${refs.map((r) => `'${r}'`).join(',')})`,
            $select: 'referentiecode_rdw,publicatiedatum_rdw,meldende_producent_distributeur,omschrijving_defect,categorie_defect'
          }
        })
      : []
    return rdwOutput(ctx, nl.formatted, { vehicle, fuel: fuel ?? [], recallStatus: recallStatus ?? [], recalls: recalls ?? [], inspections: inspections ?? [] })
  }
})
