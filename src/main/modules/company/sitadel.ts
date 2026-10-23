// Autorisations d'urbanisme demandées par une entreprise française (Sitadel, SDES) :
// permis de construire, d'aménager, de démolir et déclarations préalables depuis 2013.
// Seuls les demandeurs personnes morales sont publiés, avec leur SIREN.

import { defineModule, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { compact, tr } from '../misc/_util'
import { permitEntity, SITADEL_PAGE, sitadelSearch, type Permit } from '../location/_sitadel'
import { luhnOk } from './_fr'

const MAX_PERMITS = 10

/** SIREN d'une entreprise : propriété `siren`, SIRET ou libellé numérique. */
export function sirenOf(label: string, data: Record<string, unknown>): string | null {
  const fromData = typeof data.siren === 'string' ? data.siren.replace(/\D/g, '') : ''
  if (/^\d{9}$/.test(fromData)) return fromData
  const siret = typeof data.siret === 'string' ? data.siret.replace(/\D/g, '') : ''
  if (/^\d{14}$/.test(siret)) return siret.slice(0, 9)
  const digits = label.replace(/[\s.]/g, '')
  if (/^\d{14}$/.test(digits)) return digits.slice(0, 9)
  if (/^\d{9}$/.test(digits) && luhnOk(digits)) return digits
  return null
}

export function permitsOutput(ctx: Pick<ModuleContext, 'lang'>, total: number, permits: Permit[], errors: string[] = []): ModuleOutput {
  if (!total && !permits.length) return { properties: { building_permits_count: 0 } }
  const places = [...new Set(permits.map((p) => p.department).filter((d): d is string => !!d))]
  return {
    properties: compact({
      building_permits_count: total,
      building_permits_last_date: permits[0]?.date ?? null,
      building_permits_departments: places,
      unavailable_sources: errors
    }),
    entities: permits.slice(0, MAX_PERMITS).map((p) => permitEntity(p, ctx.lang, { linkLabel: tr(ctx, 'demandeur du permis', 'permit applicant') })),
    raw: { total, permits: permits.slice(0, MAX_PERMITS) }
  }
}

export default defineModule({
  id: 'company.sitadel',
  name: { fr: "Permis de construire de l'entreprise (Sitadel)", en: 'Company building permits (Sitadel)' },
  description: {
    fr: "Autorisations d'urbanisme où l'entreprise est demandeur (permis de construire, d'aménager, de démolir, déclarations préalables depuis 2013) : numéro, date, adresse du terrain, parcelles, logements et surfaces créés. Base Sitadel du SDES, par SIREN.",
    en: 'Planning permissions applied for by the company (building, development and demolition permits, prior declarations since 2013): number, date, site address, parcels, dwellings and floor area created. SDES Sitadel database, by SIREN.'
  },
  category: 'company',
  inputTypes: ['company'],
  homepage: SITADEL_PAGE,
  accepts: (input) => sirenOf(input.label, input.data) !== null,
  async run(input, ctx) {
    const siren = sirenOf(input.label, input.data)
    if (!siren) return {}
    const { total, permits, errors } = await sitadelSearch(ctx, { SIREN_DEM: `eq:${siren}` })
    return permitsOutput(ctx, total, permits, errors)
  }
})
