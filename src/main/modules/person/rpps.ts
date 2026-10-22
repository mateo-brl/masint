// Annuaire Santé (Agence du numérique en santé) : extraction en libre accès du RPPS publiée sur
// data.gouv.fr. Un numéro RPPS donne directement la profession, la spécialité et les lieux
// d'exercice ; une recherche par nom ne donne que des homonymes possibles, mis de côté dans
// « À vérifier » avec la profession et le lieu d'exercice de chacun.

import { isRpps } from '@shared/detect'
import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { titleCase } from '../company/_fr'
import { latestResourceId, tabularPage, upperVariants } from '../company/_datagouv'
import { compact } from '../social/_lib'
import { splitName, type PersonName } from './_name'

const DATASET = 'annuaire-sante-extractions-des-donnees-en-libre-acces-des-professionnels-intervenant-dans-le-systeme-de-sante-rpps'
const RESOURCE = 'fffda7e9-0ea2-4c35-bba0-4496f3af935d'
const SERVICE = 'Annuaire Santé (RPPS)'
/** Homonymes proposés et lieux d'exercice retenus, au plus. */
const MAX = 10

export type RppsRow = Record<string, string | number | null>

const S = '(coord. structure)'
const str = (row: RppsRow, key: string): string | undefined => {
  const v = row[key]
  return v === null || v === undefined || v === '' ? undefined : String(v).trim()
}

export interface RppsActivity {
  structure?: string
  siret?: string
  siren?: string
  finess?: string
  sector?: string
  mode?: string
  role?: string
  street?: string
  postcode?: string
  city?: string
  country?: string
  address?: string
  phones: string[]
  email?: string
}

export interface RppsPerson {
  rpps: string
  title?: string
  lastName: string
  firstName: string
  profession?: string
  category?: string
  specialties: string[]
  activities: RppsActivity[]
}

/** Activité (lieu d'exercice) décrite par une ligne, ou `null` si la ligne n'en porte pas. */
export function activityOf(row: RppsRow): RppsActivity | null {
  const street = [str(row, `Numéro Voie ${S}`), str(row, `Indice répétition voie ${S}`), str(row, `Libellé type de voie ${S}`), str(row, `Libellé Voie ${S}`)]
    .filter(Boolean)
    .join(' ')
  const postcode = str(row, `Code postal ${S}`)
  const city = str(row, `Libellé commune ${S}`)
  const country = str(row, `Libellé pays ${S}`)
  const extra = [str(row, `Complément point géographique ${S}`), str(row, `Mention distribution ${S}`)].filter(Boolean).join(', ')
  const address = [street || undefined, extra || undefined, [postcode, city].filter(Boolean).join(' ') || undefined, country && country !== 'France' ? country : undefined]
    .filter(Boolean)
    .join(', ')
  const a: RppsActivity = {
    structure: str(row, 'Enseigne commerciale site') ?? str(row, 'Raison sociale site'),
    siret: str(row, 'Numéro SIRET site'),
    siren: str(row, 'Numéro SIREN site'),
    finess: str(row, 'Numéro FINESS site'),
    sector: str(row, "Libellé secteur d'activité"),
    mode: str(row, 'Libellé mode exercice'),
    role: str(row, 'Libellé rôle'),
    street: street || undefined,
    postcode,
    city,
    country,
    address: address || undefined,
    phones: [str(row, `Téléphone ${S}`), str(row, `Téléphone 2 ${S}`)].filter((p): p is string => !!p),
    email: str(row, `Adresse e-mail ${S}`)?.toLowerCase()
  }
  return a.structure || a.address || a.siret || a.finess ? a : null
}

/** Regroupe les lignes (une par activité) par numéro RPPS. */
export function groupRpps(rows: RppsRow[]): RppsPerson[] {
  const byId = new Map<string, RppsPerson>()
  for (const row of rows) {
    const rpps = str(row, 'Identifiant PP')
    if (!rpps) continue
    let p = byId.get(rpps)
    if (!p) {
      p = {
        rpps,
        title: str(row, "Libellé civilité d'exercice"),
        lastName: str(row, "Nom d'exercice") ?? '',
        firstName: str(row, "Prénom d'exercice") ?? '',
        profession: str(row, 'Libellé profession'),
        category: str(row, 'Libellé catégorie professionnelle'),
        specialties: [],
        activities: []
      }
      byId.set(rpps, p)
    }
    const sf = str(row, 'Libellé savoir-faire')
    if (sf && !p.specialties.includes(sf)) p.specialties.push(sf)
    const a = activityOf(row)
    if (a && !p.activities.some((x) => x.structure === a.structure && x.address === a.address)) p.activities.push(a)
  }
  return [...byId.values()]
}

const displayPerson = (p: RppsPerson): string => `${titleCase(p.firstName)} ${titleCase(p.lastName)}`.trim()

const where = (a: RppsActivity): string | undefined => [a.structure, a.city].filter(Boolean).join(', ') || undefined

/** Entités d'un lieu d'exercice : la structure (SIRET ou FINESS) et son adresse. */
function activityEntities(a: RppsActivity, i: number, from: string, lang: 'fr' | 'en', review?: string): OutEntity[] {
  const fr = lang === 'fr'
  const out: OutEntity[] = []
  const flag = review ? { review: true, reviewReason: review } : {}
  const ref = `site${i}`
  const hasStructure = !!a.structure && !!(a.siret || a.siren || a.finess)
  if (hasStructure) {
    out.push({
      ref,
      from,
      type: 'company',
      label: a.structure!,
      data: compact({
        siret: a.siret,
        siren: a.siren ?? a.siret?.slice(0, 9),
        finess: a.finess,
        activity: a.sector,
        address: a.address,
        structure_phone: a.phones[0],
        structure_email: a.email
      }),
      linkLabel: [fr ? "lieu d'exercice" : 'practice', a.mode?.toLowerCase()].filter(Boolean).join(' · '),
      ...flag
    })
  }
  if (a.address) {
    out.push({
      from: hasStructure ? ref : from,
      type: 'address',
      label: a.address,
      data: compact({ street: a.street, postcode: a.postcode, city: a.city, country: a.country ?? 'France' }),
      linkLabel: hasStructure ? (fr ? 'adresse' : 'address') : fr ? "lieu d'exercice" : 'practice',
      ...flag
    })
  }
  return out
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)]

/** Fiche d'un professionnel identifié par son numéro RPPS : valeur exacte, directement dans le graphe. */
export function exactOutput(p: RppsPerson, lang: 'fr' | 'en', from: string = '$input') {
  const activities = p.activities.slice(0, MAX)
  const properties: Record<string, PropValue> = compact({
    rpps: p.rpps,
    occupation: p.profession,
    professional_category: p.category,
    medical_specialties: p.specialties,
    practice_modes: uniq(activities.map((a) => a.mode).filter((m): m is string => !!m)),
    practice_phones: uniq(activities.flatMap((a) => a.phones)),
    practice_emails: uniq(activities.map((a) => a.email).filter((m): m is string => !!m)),
    practice_count: p.activities.length || undefined
  })
  const entities = activities.flatMap((a, i) => activityEntities(a, i, from, lang))
  return { properties, entities }
}

/** Homonymes trouvés par nom : un numéro RPPS à vérifier par personne. */
export function namesakesOutput(people: RppsPerson[], lang: 'fr' | 'en') {
  const fr = lang === 'fr'
  const entities: OutEntity[] = people.slice(0, MAX).map((p) => {
    const sites = p.activities.map(where).filter(Boolean).slice(0, 3).join(' ; ')
    const what = [p.profession, p.specialties.join(', ')].filter(Boolean).join(', ')
    return {
      type: 'id_document',
      label: p.rpps,
      data: compact({
        kind: 'RPPS',
        number: p.rpps,
        document_holder: displayPerson(p),
        occupation: p.profession,
        medical_specialties: p.specialties,
        practice_locations: sites || undefined,
        practice_phones: uniq(p.activities.flatMap((a) => a.phones)).slice(0, 3)
      }),
      linkLabel: fr ? 'numéro RPPS' : 'RPPS number',
      review: true,
      reviewReason: fr
        ? `homonyme possible : ${displayPerson(p)}, ${what || 'professionnel de santé'}${sites ? `, exerce à ${sites}` : ''} ; vérifiez la profession et le lieu d'exercice`
        : `possible namesake: ${displayPerson(p)}, ${what || 'health professional'}${sites ? `, practises at ${sites}` : ''}; check the profession and practice location`
    }
  })
  return { entities, properties: compact({ rpps_namesakes_count: people.length || undefined }) }
}

/** Numéro RPPS connu de l'entité : libellé d'une pièce d'identité, ou propriété `rpps`. */
export function knownRpps(type: string, label: string, data: Record<string, unknown>): string | null {
  const fromData = typeof data.rpps === 'string' || typeof data.rpps === 'number' ? String(data.rpps).replace(/\s/g, '') : ''
  if (isRpps(fromData)) return fromData
  const l = label.replace(/\s/g, '')
  return type === 'id_document' && isRpps(l) ? l : null
}

/** Variantes du prénom d'exercice : premier prénom, prénoms composés, avec et sans accents. */
export function firstNameVariants(name: PersonName): string[] {
  const forms = [name.firstNames[0], name.firstNames.join('-'), name.firstNames.join(' ')].filter(Boolean)
  return uniq(forms.flatMap(upperVariants))
}

async function resource(ctx: ModuleContext): Promise<string> {
  return latestResourceId(ctx, DATASET, (r) => /personne-activite/i.test(r.title), RESOURCE)
}

async function byRpps(ctx: ModuleContext, rpps: string): Promise<RppsPerson | null> {
  const res = await tabularPage<RppsRow>(ctx, await resource(ctx), [{ column: 'Identifiant PP', op: 'exact', value: rpps }], {
    service: SERVICE,
    pageSize: 50,
    timeoutMs: 60000
  })
  return groupRpps(res.data).find((p) => p.rpps === rpps) ?? null
}

export default defineModule({
  id: 'person.rpps',
  name: { fr: 'Professionnel de santé (RPPS)', en: 'Health professional (RPPS)' },
  description: {
    fr: 'Cherche le professionnel de santé dans l’extraction publique de l’Annuaire Santé (RPPS, data.gouv.fr) : numéro RPPS, profession, spécialité, lieux d’exercice avec SIRET ou FINESS, téléphone et courriel de la structure. Le numéro RPPS donne une fiche exacte ; une recherche par nom et prénom propose les homonymes dans « À vérifier » (10 au plus).',
    en: 'Looks the health professional up in the public extract of the French health directory (RPPS, data.gouv.fr): RPPS number, profession, specialty, practice locations with SIRET or FINESS, practice phone and email. An RPPS number gives an exact record; a name search puts namesakes in "To review" (up to 10).'
  },
  category: 'person',
  inputTypes: ['person', 'id_document'],
  accepts: (input) => input.type === 'person' || isRpps(input.label.replace(/\s/g, '')),
  homepage: 'https://annuaire.esante.gouv.fr/',
  timeoutMs: 240000,
  async run(input, ctx) {
    const rpps = knownRpps(input.type, input.label, input.data)
    if (rpps) {
      const p = await byRpps(ctx, rpps)
      if (!p) return { properties: { rpps } }
      if (input.type === 'person') {
        const out = exactOutput(p, ctx.lang)
        return { ...out, raw: p }
      }
      // Pièce d'identité RPPS : le titulaire devient une personne, les lieux d'exercice lui sont rattachés.
      const holder: OutEntity = {
        ref: 'holder',
        type: 'person',
        label: displayPerson(p),
        data: compact({ first_name: titleCase(p.firstName), last_name: titleCase(p.lastName), occupation: p.profession, rpps: p.rpps }),
        linkLabel: ctx.lang === 'fr' ? 'titulaire' : 'holder'
      }
      const out = exactOutput(p, ctx.lang, 'holder')
      return {
        properties: compact({ kind: 'RPPS', number: p.rpps, document_holder: displayPerson(p), occupation: p.profession, medical_specialties: p.specialties }),
        entities: [holder, ...out.entities],
        raw: p
      }
    }
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer un prénom et un nom, ou un numéro RPPS', 'invalid_input')
    const res = await tabularPage<RppsRow>(
      ctx,
      await resource(ctx),
      [
        { column: "Nom d'exercice", op: 'in', value: upperVariants(name.lastName) },
        { column: "Prénom d'exercice", op: 'in', value: firstNameVariants(name) }
      ],
      { service: SERVICE, pageSize: 100, timeoutMs: 60000 }
    )
    const people = groupRpps(res.data)
    if (!people.length) return { raw: { total: 0 } }
    return { ...namesakesOutput(people, ctx.lang), raw: { total: res.meta?.total, people: people.slice(0, MAX) } }
  }
})
