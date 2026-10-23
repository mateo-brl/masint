// Entreprises tchèques : ARES, registre des entités économiques du ministère des Finances
// (sans clé). Identité, siège, dates, forme, et pour les sociétés inscrites au registre public
// (obchodní rejstřík) : anciens noms, capital, référence au greffe et organes en fonction.
// Le registre publie l'adresse et la date de naissance des membres : elles ne sont pas reprises.

import { defineModule, type HttpError, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { getJson, serviceError, tr } from '../misc/_util'
import { acceptsCountry, candidatesOutput, czechIco, euOutput, exactMatch, numberFrom, personName, type Officer } from './_eu'

const API = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest'

interface AresSeat {
  textovaAdresa?: string
  nazevUlice?: string
  cisloDomovni?: number
  cisloOrientacni?: number
  nazevObce?: string
  psc?: number | string
}

export interface AresSubject {
  ico: string
  obchodniJmeno: string
  sidlo?: AresSeat
  pravniForma?: string
  datumVzniku?: string
  datumZaniku?: string
  dic?: string
  czNace2008?: string[]
  seznamRegistraci?: Record<string, string>
}

export interface AresSearch {
  pocetCelkem?: number
  ekonomickeSubjekty?: AresSubject[]
}

interface AresMember {
  datumZapisu?: string
  datumVymazu?: string
  nazevAngazma?: string
  clenstvi?: { funkce?: { nazev?: string; vznikFunkce?: string }; clenstvi?: { vznikClenstvi?: string } }
  fyzickaOsoba?: { jmeno?: string; prijmeni?: string; titulPredJmenem?: string; datumNarozeni?: string }
  pravnickaOsoba?: { obchodniJmeno?: string; ico?: string }
}

interface AresOrgan {
  nazevOrganu?: string
  datumVymazu?: string
  clenoveOrganu?: AresMember[]
}

export interface AresVr {
  zaznamy?: Array<{
    primarniZaznam?: boolean
    obchodniJmeno?: Array<{ hodnota: string; datumZapisu?: string; datumVymazu?: string }>
    spisovaZnacka?: Array<{ soud?: string; oddil?: string; vlozka?: number | string; datumVymazu?: string }>
    zakladniKapital?: Array<{ vklad?: { hodnota?: string; typObnos?: string }; datumVymazu?: string }>
    datumZapisu?: string
    statutarniOrgany?: AresOrgan[]
    ostatniOrgany?: AresOrgan[]
  }>
}

// Formes juridiques les plus courantes (code ARES, nomenclature ROS).
const FORMS: Record<string, string> = {
  '101': 'Fyzická osoba podnikající (entrepreneur individuel)',
  '111': 'Veřejná obchodní společnost (v.o.s.)',
  '112': 'Společnost s ručením omezeným (s.r.o.)',
  '113': 'Komanditní společnost (k.s.)',
  '117': 'Nadace',
  '118': 'Nadační fond',
  '121': 'Akciová společnost (a.s.)',
  '141': 'Obecně prospěšná společnost (o.p.s.)',
  '205': 'Družstvo',
  '301': 'Státní podnik',
  '325': 'Organizační složka státu',
  '331': 'Příspěvková organizace',
  '421': 'Zahraniční osoba (organizační složka)',
  '641': 'Školská právnická osoba',
  '706': 'Spolek',
  '801': 'Obec',
  '804': 'Kraj'
}

// Tribunaux tenant le registre public.
const COURTS: Record<string, string> = {
  MSPH: 'Městský soud v Praze',
  KSPH: 'Krajský soud v Praze',
  KSCB: 'Krajský soud v Českých Budějovicích',
  KSPL: 'Krajský soud v Plzni',
  KSUL: 'Krajský soud v Ústí nad Labem',
  KSHK: 'Krajský soud v Hradci Králové',
  KSBR: 'Krajský soud v Brně',
  KSOS: 'Krajský soud v Ostravě'
}

/** Formes de personne physique : jamais d'interrogation du registre public des organes. */
const NATURAL_PERSON_FORMS = new Set(['101', '102', '105', '107', '108'])

const active = <T extends { datumVymazu?: string }>(list: T[] | undefined): T[] => (list ?? []).filter((x) => !x.datumVymazu)

/** Membres en fonction des organes (conseil, gérance, conseil de surveillance), sans adresse ni date de naissance. */
export function aresOfficers(vr: AresVr | null): Officer[] {
  const z = vr?.zaznamy?.find((r) => r.primarniZaznam) ?? vr?.zaznamy?.[0]
  const out: Officer[] = []
  for (const organ of [...active(z?.statutarniOrgany), ...active(z?.ostatniOrgany)]) {
    for (const m of active(organ.clenoveOrganu)) {
      const role = m.clenstvi?.funkce?.nazev ?? m.nazevAngazma ?? organ.nazevOrganu ?? ''
      const since = m.clenstvi?.clenstvi?.vznikClenstvi ?? m.clenstvi?.funkce?.vznikFunkce ?? m.datumZapisu ?? null
      if (m.fyzickaOsoba?.prijmeni) {
        const p = m.fyzickaOsoba
        out.push({ kind: 'person', name: personName(p.jmeno, p.prijmeni), role, birthYear: p.datumNarozeni?.slice(0, 4) ?? null, appointedOn: since })
      } else if (m.pravnickaOsoba?.obchodniJmeno) {
        out.push({ kind: 'company', name: m.pravnickaOsoba.obchodniJmeno, role, number: m.pravnickaOsoba.ico ?? null, appointedOn: since })
      }
    }
  }
  return out
}

/** `16708850000;00` → `16 708 850 000 CZK`. */
function capital(v: { hodnota?: string; typObnos?: string } | undefined): string | null {
  const n = Number((v?.hodnota ?? '').split(';')[0])
  if (!Number.isFinite(n) || n <= 0) return null
  return `${n.toLocaleString('fr-FR').replace(/ | /g, ' ')} ${v?.typObnos === 'KORUNY' ? 'CZK' : (v?.typObnos ?? '')}`.trim()
}

function addressOf(s: AresSeat | undefined): { label: string; street: string | null; postcode: string | null; city: string | null } | null {
  if (!s?.textovaAdresa) return null
  const number = [s.cisloDomovni, s.cisloOrientacni].filter(Boolean).join('/')
  return { label: s.textovaAdresa, street: [s.nazevUlice, number].filter(Boolean).join(' ') || null, postcode: s.psc ? String(s.psc) : null, city: s.nazevObce ?? null }
}

export function aresOutput(ctx: Pick<ModuleContext, 'lang'>, s: AresSubject, vr: AresVr | null): ModuleOutput {
  const z = vr?.zaznamy?.find((r) => r.primarniZaznam) ?? vr?.zaznamy?.[0]
  const file = active(z?.spisovaZnacka)[0]
  const officers = aresOfficers(vr)
  return euOutput(ctx, {
    country: 'CZ',
    name: s.obchodniJmeno,
    number: s.ico,
    properties: {
      legal_form: s.pravniForma ? (FORMS[s.pravniForma] ?? s.pravniForma) : null,
      status: s.datumZaniku ? tr(ctx, 'dissoute', 'dissolved') : tr(ctx, 'active', 'active'),
      created_at: s.datumVzniku ?? null,
      registration_date: z?.datumZapisu ?? null,
      closed_at: s.datumZaniku ?? null,
      vat: s.dic ?? null,
      activity: (s.czNace2008 ?? []).slice(0, 5).join(', ') || null,
      share_capital: capital(active(z?.zakladniKapital)[0]?.vklad),
      register_file: file ? `${file.oddil ?? ''} ${file.vlozka ?? ''}, ${COURTS[file.soud ?? ''] ?? file.soud ?? ''}`.trim() : null,
      previous_names: (z?.obchodniJmeno ?? [])
        .filter((n) => n.datumVymazu && n.hodnota !== s.obchodniJmeno)
        .map((n) => `${n.hodnota} (${tr(ctx, "jusqu'en", 'until')} ${n.datumVymazu!.slice(0, 4)})`),
      registry_url: `https://ares.gov.cz/ekonomicke-subjekty?ico=${s.ico}`
    },
    address: addressOf(s.sidlo),
    officers,
    raw: { subject: s, officers: officers.map((o) => ({ kind: o.kind, name: o.name, role: o.role, number: o.number })) }
  })
}

async function publicRegister(ctx: ModuleContext, s: AresSubject): Promise<AresVr | null> {
  if (NATURAL_PERSON_FORMS.has(s.pravniForma ?? '')) return null
  const state = s.seznamRegistraci?.stavZdrojeVr
  if (state && state !== 'AKTIVNI' && state !== 'ZANIKLY') return null
  return getJson<AresVr>(ctx, `${API}/ekonomicke-subjekty-vr/${s.ico}`, 'ARES')
}

export default defineModule({
  id: 'company.ares',
  name: { fr: 'Entreprise tchèque (ARES)', en: 'Czech company (ARES)' },
  description: {
    fr: "Registre tchèque des entités économiques (ARES) : IČO, DIČ, forme, siège, dates de création et de dissolution, et pour les sociétés du registre public : anciens noms, capital, greffe et organes en fonction. Par numéro ou par nom.",
    en: 'Czech register of economic subjects (ARES): IČO, VAT number, form, seat, creation and dissolution dates, and for companies in the public register: former names, capital, court file and serving officers. By number or by name.'
  },
  category: 'company',
  inputTypes: ['company'],
  homepage: 'https://ares.gov.cz',
  accepts: (input) => acceptsCountry(input, 'CZ', czechIco),
  async run(input, ctx) {
    let ico = numberFrom(input, czechIco)
    if (!ico) {
      const name = input.label.trim()
      if (name.length < 3) return {}
      let found: AresSearch
      try {
        found = await ctx.fetchJson<AresSearch>(`${API}/ekonomicke-subjekty/vyhledat`, { method: 'POST', json: { obchodniJmeno: name, pocet: 20, start: 0 } })
      } catch (e) {
        // Trop de résultats ou nom refusé : ARES répond 400 ; on le traite comme « rien trouvé ».
        if ((e as Partial<HttpError>)?.status === 400) return {}
        throw serviceError(e, 'ARES')
      }
      const list = found.ekonomickeSubjekty ?? []
      const hit = exactMatch(list, name, (s) => [s.obchodniJmeno])
      if (!hit) {
        return candidatesOutput(
          ctx,
          'CZ',
          list.filter((s) => !s.datumZaniku && !NATURAL_PERSON_FORMS.has(s.pravniForma ?? '')).map((s) => ({ name: s.obchodniJmeno, number: s.ico, address: s.sidlo?.textovaAdresa ?? null, created: s.datumVzniku ?? null })),
          tr(ctx, 'tchèque', 'Czech')
        )
      }
      ico = hit.ico
    }
    const subject = await getJson<AresSubject>(ctx, `${API}/ekonomicke-subjekty/${ico}`, 'ARES')
    if (!subject) return {}
    const vr = await publicRegister(ctx, subject)
    return aresOutput(ctx, subject, vr)
  }
})
