// Immobilier à une adresse française : parcelle cadastrale (IGN), ventes DVF de la parcelle
// et des parcelles voisines, diagnostics de performance énergétique (ADEME) et autorisations
// d'urbanisme (Sitadel). Cadre légal : le cadastre ne donne aucun propriétaire, et les ventes
// DVF (art. R112 A-3 du LPF) sont rattachées au bien, jamais à une personne.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, tr } from '../misc/_util'
import { parcelAt, type Parcel } from './_cadastre'
import { dpeAt, dpeSummary, dpeUrl, type Dpe } from './_dpe'
import { fetchSales, MAX_SALES, saleEntity, type Sale } from './_dvf'
import { acceptsFrench, locateFrench, notFrench, type FrenchPlace } from './_france'
import { inDistrict, parcelFilters, permitEntity, sitadelSearch, type Permit } from './_sitadel'

const MAX_PERMITS = 5

export interface PropertyFacts {
  place: FrenchPlace
  parcel: Parcel | null
  sales: { sales: Sale[]; source: string } | null
  dpe: { total: number; dpe: Dpe[] } | null
  permits: { total: number; permits: Permit[] } | null
  /** Sources qui n'ont pas répondu : signalées sans faire échouer le module. */
  errors: string[]
}

export function immobilierOutput(ctx: Pick<ModuleContext, 'lang'>, f: PropertyFacts): ModuleOutput {
  const fr = ctx.lang === 'fr'
  const properties: Record<string, PropValue> = {}
  const entities: OutEntity[] = []

  if (f.parcel) {
    Object.assign(properties, {
      cadastral_parcel: f.parcel.idu,
      cadastral_section: f.parcel.section,
      parcel_area_m2: f.parcel.area,
      // Point hors parcelle (sur la voie) : parcelle la plus proche, à cette distance.
      parcel_distance_m: f.parcel.distance,
      citycode: f.parcel.insee
    })
  }

  if (f.sales) {
    const onParcel = f.sales.sales.filter((s) => s.onParcel).length
    properties.dvf_sales_parcel = onParcel
    properties.dvf_sales_nearby = f.sales.sales.length - onParcel
    properties.dvf_source = f.sales.source
    for (const s of f.sales.sales.slice(0, MAX_SALES)) entities.push(saleEntity(s, ctx.lang))
  }

  const latest = f.dpe?.dpe[0]
  if (latest) {
    Object.assign(properties, {
      dpe_number: latest.number,
      dpe_class: latest.energyClass,
      ghg_class: latest.ghgClass,
      dpe_date: latest.date,
      dpe_valid_until: latest.validUntil,
      dpe_building_type: latest.buildingType,
      dpe_living_area_m2: latest.area,
      construction_period: latest.period,
      dpe_url: dpeUrl(latest.number),
      dpe_count: f.dpe!.total
    })
    // Plusieurs logements à la même adresse : un DPE par logement.
    if (f.dpe!.dpe.length > 1) properties.dpe_records = f.dpe!.dpe.map((d) => dpeSummary(d, ctx.lang))
  }

  if (f.permits) {
    properties.building_permits_count = f.permits.total
    for (const p of f.permits.permits.slice(0, MAX_PERMITS)) entities.push(permitEntity(p, ctx.lang))
  }

  if (f.errors.length) properties.unavailable_sources = f.errors

  return {
    properties: compact(properties),
    entities,
    raw: {
      place: f.place,
      parcel: f.parcel,
      sales: f.sales?.sales.slice(0, MAX_SALES),
      dpe: f.dpe?.dpe,
      permits: f.permits?.permits.slice(0, MAX_PERMITS),
      errors: f.errors,
      note: fr
        ? 'DVF : ventes rattachées au bien, sans aucune personne (art. R112 A-3 du LPF).'
        : 'DVF: sales attached to the property, never to a person (LPF art. R112 A-3).'
    }
  }
}

/** Autorisations d'urbanisme dont la première parcelle est celle de l'adresse. */
async function permitsOnParcel(ctx: ModuleContext, parcel: Parcel): Promise<{ total: number; permits: Permit[] }> {
  const r = await sitadelSearch(ctx, parcelFilters(parcel.communeInsee, parcel.section, parcel.number))
  if (parcel.communeInsee === parcel.insee) return r
  const permits = r.permits.filter((p) => inDistrict(p, parcel.insee))
  return { total: permits.length, permits }
}

/** Exécute une étape ; une source en panne est notée sans interrompre les autres. */
async function step<T>(errors: string[], name: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof ModuleError && e.code === 'invalid_input') throw e
    errors.push(`${name} : ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export default defineModule({
  id: 'location.immobilier',
  name: { fr: 'Immobilier (cadastre, DVF, DPE, permis)', en: 'Real estate (cadastre, DVF, EPC, permits)' },
  description: {
    fr: "Pour une adresse ou des coordonnées en France : parcelle cadastrale et contenance (IGN), ventes DVF de la parcelle et des parcelles voisines (date, prix, type, surface, sans aucune personne), DPE de l'ADEME (classe énergie, date, numéro) et autorisations d'urbanisme Sitadel sur la parcelle.",
    en: 'For an address or coordinates in France: cadastral parcel and area (IGN), DVF sales of the parcel and neighbouring parcels (date, price, type, area, never any person), ADEME energy performance certificates (class, date, number) and Sitadel planning permissions on the parcel.'
  },
  category: 'location',
  inputTypes: ['address', 'coordinates'],
  accepts: acceptsFrench,
  homepage: 'https://app.dvf.etalab.gouv.fr',
  timeoutMs: 240_000,
  async run(input, ctx) {
    const place = await locateFrench(input, ctx)
    if (!place) {
      if (notFrench(input)) return {}
      throw new ModuleError(tr(ctx, 'Adresse française non reconnue par la Base Adresse Nationale', 'French address not recognised by the National Address Base'), 'invalid_input')
    }
    const errors: string[] = []
    ctx.progress(1, 4, tr(ctx, 'cadastre', 'cadastre'))
    const parcel = await step(errors, 'Cadastre', () => parcelAt(ctx, place))
    ctx.progress(2, 4, 'DVF')
    const [sales, dpe, permits] = await Promise.all([
      step(errors, 'DVF', () => fetchSales(ctx, place, parcel)),
      place.banId ? step(errors, 'DPE', () => dpeAt(ctx, place.banId!)) : Promise.resolve(null),
      parcel ? step(errors, 'Sitadel', () => permitsOnParcel(ctx, parcel)) : Promise.resolve(null)
    ])
    ctx.progress(4, 4)
    if (!parcel && !sales && !dpe && !permits && errors.length) throw new ModuleError(errors.join(' ; '), 'unavailable')
    return immobilierOutput(ctx, { place, parcel, sales, dpe, permits, errors })
  }
})
