// Entreprises norvégiennes : registre des entités de Brønnøysund (Enhetsregisteret, licence
// NLOD, sans clé). Identité, adresse, dates, anciens noms et rôles (dirigeants, conseil,
// commissaire aux comptes). Conditions de Brreg : la date de naissance des personnes ne sert
// qu'à départager des homonymes ; elle n'est ni affichée ni conservée.

import { defineModule, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { getJson, tr } from '../misc/_util'
import { acceptsCountry, candidatesOutput, countryHint, euOutput, exactMatch, norwegianOrgNr, numberFrom, personName, sirenAmbiguous, type Officer } from './_eu'

const API = 'https://data.brreg.no/enhetsregisteret/api'

interface BrregAddress {
  adresse?: string[]
  postnummer?: string
  poststed?: string
  land?: string
}

export interface BrregEntity {
  organisasjonsnummer: string
  navn: string
  organisasjonsform?: { kode?: string; beskrivelse?: string }
  hjemmeside?: string
  forretningsadresse?: BrregAddress
  postadresse?: BrregAddress
  naeringskode1?: { kode?: string; beskrivelse?: string }
  antallAnsatte?: number
  stiftelsesdato?: string
  registreringsdatoEnhetsregisteret?: string
  slettedato?: string
  konkurs?: boolean
  underAvvikling?: boolean
  underTvangsavviklingEllerTvangsopplosning?: boolean
  registrertIMvaregisteret?: boolean
  historiskeNavn?: Array<{ navn: string; fraDato?: string; tilDato?: string }>
  kapital?: { belop?: number; valuta?: string }
  sisteInnsendteAarsregnskap?: string
}

export interface BrregSearch {
  _embedded?: { enheter?: BrregEntity[] }
}

interface BrregRole {
  type?: { kode?: string; beskrivelse?: string }
  avregistrert?: boolean
  fratraadt?: boolean
  person?: { fodselsdato?: string; erDoed?: boolean; navn?: { fornavn?: string; mellomnavn?: string; etternavn?: string } }
  enhet?: { organisasjonsnummer?: string; navn?: string[]; erSlettet?: boolean }
}

export interface BrregRoles {
  rollegrupper?: Array<{ type?: { kode?: string }; roller?: BrregRole[] }>
}

const ROLES: Record<string, [string, string]> = {
  DAGL: ['directeur général', 'chief executive'],
  LEDE: ['président du conseil', 'chair of the board'],
  NEST: ['vice-président du conseil', 'deputy chair'],
  MEDL: ['administrateur', 'board member'],
  VARA: ['administrateur suppléant', 'deputy board member'],
  OBS: ['observateur au conseil', 'board observer'],
  REVI: ['commissaire aux comptes', 'auditor'],
  REGN: ['expert-comptable', 'accountant'],
  DTPR: ['associé (responsabilité partagée)', 'partner (shared liability)'],
  DTSO: ['associé (responsabilité solidaire)', 'partner (joint liability)'],
  INNH: ['titulaire', 'owner'],
  KOMP: ['commandité', 'general partner'],
  FFØR: ['gérant de succursale', 'branch manager'],
  REPR: ['représentant en Norvège', 'Norwegian representative']
}

/** Rôles actifs : ni radiés, ni démissionnaires, ni personnes décédées. Pas de contact (KONT). */
export function brregOfficers(lang: 'fr' | 'en', roles: BrregRoles | null): Officer[] {
  const out: Officer[] = []
  for (const g of roles?.rollegrupper ?? []) {
    for (const r of g.roller ?? []) {
      const code = r.type?.kode ?? ''
      if (r.avregistrert || r.fratraadt || code === 'KONT') continue
      const role = ROLES[code]?.[lang === 'fr' ? 0 : 1] ?? r.type?.beskrivelse ?? code
      if (r.person?.navn && !r.person.erDoed) {
        const n = r.person.navn
        out.push({ kind: 'person', name: personName(n.fornavn, n.mellomnavn, n.etternavn), role, birthYear: r.person.fodselsdato?.slice(0, 4) ?? null })
      } else if (r.enhet?.navn?.length && !r.enhet.erSlettet) {
        out.push({ kind: 'company', name: r.enhet.navn.join(' '), role, number: r.enhet.organisasjonsnummer ?? null })
      }
    }
  }
  return out
}

function addressOf(a: BrregAddress | undefined): { label: string; street: string | null; postcode: string | null; city: string | null } | null {
  if (!a) return null
  const street = (a.adresse ?? []).filter(Boolean).join(', ') || null
  const city = a.poststed ?? null
  const label = [street, [a.postnummer, city].filter(Boolean).join(' '), a.land].filter(Boolean).join(', ')
  return label ? { label, street, postcode: a.postnummer ?? null, city } : null
}

function statusOf(e: BrregEntity, lang: 'fr' | 'en'): string {
  const fr = lang === 'fr'
  if (e.slettedato) return fr ? 'radiée' : 'deleted'
  if (e.konkurs) return fr ? 'en faillite' : 'bankrupt'
  if (e.underTvangsavviklingEllerTvangsopplosning) return fr ? 'en liquidation forcée' : 'in compulsory liquidation'
  if (e.underAvvikling) return fr ? 'en liquidation' : 'in liquidation'
  return fr ? 'active' : 'active'
}

export function brregOutput(ctx: Pick<ModuleContext, 'lang'>, e: BrregEntity, roles: BrregRoles | null): ModuleOutput {
  const form = e.organisasjonsform
  const officers = brregOfficers(ctx.lang, roles)
  return euOutput(ctx, {
    country: 'NO',
    name: e.navn,
    number: e.organisasjonsnummer,
    properties: {
      legal_form: form?.beskrivelse ? `${form.beskrivelse}${form.kode ? ` (${form.kode})` : ''}` : null,
      status: statusOf(e, ctx.lang),
      created_at: e.stiftelsesdato ?? null,
      registration_date: e.registreringsdatoEnhetsregisteret ?? null,
      closed_at: e.slettedato ?? null,
      activity: e.naeringskode1 ? [e.naeringskode1.kode, e.naeringskode1.beskrivelse].filter(Boolean).join(' ') : null,
      employees: e.antallAnsatte ?? null,
      share_capital: e.kapital?.belop ? `${e.kapital.belop.toLocaleString('fr-FR').replace(/ | /g, ' ')} ${e.kapital.valuta ?? ''}`.trim() : null,
      vat: e.registrertIMvaregisteret ? `NO${e.organisasjonsnummer}MVA` : null,
      previous_names: (e.historiskeNavn ?? []).map((h) => `${h.navn}${h.tilDato ? ` (${tr(ctx, "jusqu'en", 'until')} ${h.tilDato.slice(0, 4)})` : ''}`),
      last_accounts_date: e.sisteInnsendteAarsregnskap ?? null,
      registry_url: `https://virksomhet.brreg.no/nb/oppslag/enheter/${e.organisasjonsnummer}`
    },
    address: addressOf(e.forretningsadresse) ?? addressOf(e.postadresse),
    website: e.hjemmeside ?? null,
    officers,
    // Ni date de naissance ni identité complète des personnes dans la réponse archivée.
    raw: { entity: e, officers: officers.map((o) => ({ kind: o.kind, name: o.name, role: o.role, number: o.number })) }
  })
}

export const brregNumber = (s: string): string | null => norwegianOrgNr(s)

export default defineModule({
  id: 'company.brreg',
  name: { fr: 'Entreprise norvégienne (Brønnøysund)', en: 'Norwegian company (Brønnøysund)' },
  description: {
    fr: "Registre norvégien des entités (Brreg, données ouvertes NLOD) : numéro d'organisation, forme, statut, dates de création et d'immatriculation, anciens noms, adresse, activité, effectif et rôles (dirigeants, conseil, commissaire aux comptes). Par numéro ou par nom.",
    en: 'Norwegian Central Coordinating Register (Brreg, NLOD open data): organisation number, form, status, foundation and registration dates, former names, address, activity, headcount and roles (management, board, auditor). By number or by name.'
  },
  category: 'company',
  inputTypes: ['company'],
  homepage: 'https://www.brreg.no',
  accepts: (input) => {
    if (!acceptsCountry(input, 'NO', brregNumber)) return false
    // Neuf chiffres qui forment aussi un SIREN valide : seulement si la Norvège est indiquée.
    const n = numberFrom(input, brregNumber)
    return !n || !sirenAmbiguous(n) || countryHint(input.data) === 'NO'
  },
  async run(input, ctx) {
    let number = numberFrom(input, brregNumber)
    if (number && sirenAmbiguous(number) && countryHint(input.data) !== 'NO') number = null
    if (!number) {
      const name = input.label.trim()
      if (name.length < 2) return {}
      const s = await getJson<BrregSearch>(ctx, `${API}/enheter`, 'Brreg', { query: { navn: name, size: 20 } })
      const list = s?._embedded?.enheter ?? []
      const hit = exactMatch(list, name, (e) => [e.navn])
      if (!hit) {
        return candidatesOutput(
          ctx,
          'NO',
          list.filter((e) => !e.slettedato).map((e) => ({ name: e.navn, number: e.organisasjonsnummer, address: addressOf(e.forretningsadresse)?.label ?? null, created: e.stiftelsesdato ?? null })),
          tr(ctx, 'norvégien', 'Norwegian')
        )
      }
      number = hit.organisasjonsnummer
    }
    const entity = await getJson<BrregEntity>(ctx, `${API}/enheter/${number}`, 'Brreg', { notFoundStatus: [404, 410] })
    if (!entity) return {}
    const roles = await getJson<BrregRoles>(ctx, `${API}/enheter/${number}/roller`, 'Brreg')
    return brregOutput(ctx, entity, roles)
  }
})
