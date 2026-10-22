// Répertoire national des élus (ministère de l'Intérieur, data.gouv.fr) : maires, conseillers
// municipaux, communautaires, départementaux et régionaux, parlementaires, représentants au
// Parlement européen et élus des Français de l'étranger. Le registre publie la date de naissance
// complète : seul un élu né le même jour que la personne recherchée entre dans le graphe, les
// autres homonymes sont mis de côté dans « À vérifier ».

import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact } from '../social/_lib'
import { datasetResources, mainResources, mapPool, tabularPage, upperVariants, type DgResource } from '../company/_datagouv'
import { parsePartialDate, type PartialDate } from './frDirigeants'
import { fold, splitName, type PersonName } from './_name'

export const RNE_DATASET = 'repertoire-national-des-elus-1'
const SERVICE = 'Répertoire national des élus'
const NOM = "Nom de l'élu"
const PRENOM = "Prénom de l'élu"
/** Au-delà, la liste n'aide plus : il faut la date de naissance pour trier. */
const MAX_IDENTITIES = 8

export type RneKind = 'mai' | 'cm' | 'ca' | 'epci' | 'cd' | 'cr' | 'ma' | 'dep' | 'sen' | 'rpe' | 'consfde' | 'afe'

/** Mandat par défaut de chaque fichier, quand la ligne ne précise pas de fonction. */
export const RNE_MANDATES: Record<RneKind, { fr: string; en: string }> = {
  mai: { fr: 'Maire', en: 'Mayor' },
  cm: { fr: 'Conseiller municipal', en: 'Municipal councillor' },
  ca: { fr: "Conseiller d'arrondissement", en: 'District councillor' },
  epci: { fr: 'Conseiller communautaire', en: 'Intermunicipal councillor' },
  cd: { fr: 'Conseiller départemental', en: 'Departmental councillor' },
  cr: { fr: 'Conseiller régional', en: 'Regional councillor' },
  ma: { fr: "Membre d'assemblée territoriale", en: 'Territorial assembly member' },
  dep: { fr: 'Député', en: 'Member of the National Assembly' },
  sen: { fr: 'Sénateur', en: 'Senator' },
  rpe: { fr: 'Représentant au Parlement européen', en: 'Member of the European Parliament' },
  consfde: { fr: 'Conseiller des Français de l’étranger', en: 'Councillor for French citizens abroad' },
  afe: { fr: 'Membre de l’Assemblée des Français de l’étranger', en: 'Member of the Assembly of French Citizens Abroad' }
}

/** Les douze fichiers publiés le 19/10/2026, si le jeu de données est injoignable. */
const KNOWN_FILES: Array<{ id: string; kind: RneKind }> = [
  { id: '2876a346-d50c-4911-934e-19ee07b0e503', kind: 'mai' },
  { id: 'd5f400de-ae3f-4966-8cb6-a85c70c6c24a', kind: 'cm' },
  { id: '3b6b2281-b9d9-4959-ae9d-c2c166dff118', kind: 'ca' },
  { id: '41d95d7d-b172-4636-ac44-32656367cdc7', kind: 'epci' },
  { id: '601ef073-d986-4582-8e1a-ed14dc857fba', kind: 'cd' },
  { id: '430e13f9-834b-4411-a1a8-da0b4b6e715c', kind: 'cr' },
  { id: 'a595be27-cfab-4810-b9d4-22e193bffe35', kind: 'ma' },
  { id: '1ac42ff4-1336-44f8-a221-832039dbc142', kind: 'dep' },
  { id: 'b78f8945-509f-4609-a4a7-3048b8370479', kind: 'sen' },
  { id: '70957bb0-f19f-40c5-b97b-90b3d4d71f9e', kind: 'rpe' },
  { id: '84949a7b-53e0-4d78-9a66-8446f5ab6ad4', kind: 'consfde' },
  { id: '41cea915-fa63-46f2-825f-97fa354a26bc', kind: 'afe' }
]

/** Type de mandat d'après le nom du fichier (`elus-maires-mai.csv`). */
export function rneKind(title: string): RneKind | null {
  const m = title.toLowerCase().match(/-(mai|cm|ca|epci|cd|cr|ma|dep|sen|rpe|consfde|afe)\.csv$/)
  return m ? (m[1] as RneKind) : null
}

/** Fichier le plus récent de chaque type de mandat. */
export function rneFiles(resources: DgResource[]): Array<{ id: string; kind: RneKind }> {
  const seen = new Set<RneKind>()
  const out: Array<{ id: string; kind: RneKind }> = []
  for (const r of mainResources(resources)) {
    const kind = rneKind(r.title)
    if (!kind || seen.has(kind)) continue
    seen.add(kind)
    out.push({ id: r.id, kind })
  }
  return out
}

export type RneRow = Record<string, string | number | null>

const str = (row: RneRow, key: string): string | undefined => {
  const v = row[key]
  return v === null || v === undefined || v === '' ? undefined : String(v).trim()
}

/** `1977-12-24` ou `24/12/1977` vers `1977-12-24`. */
export function rneDate(v: string | undefined): string | undefined {
  if (!v) return undefined
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const fr = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : undefined
}

const frDate = (iso: string): string => iso.split('-').reverse().join('/')

/** « 1Ère Circonscription » vers « 1re circonscription ». */
function circo(s: string): string {
  return s.replace(/^(\d+)\s*(?:ère|ere|e|ème|eme)\b/i, (_, n: string) => (n === '1' ? '1re' : `${n}e`)).replace(/Circonscription/i, 'circonscription')
}

export interface Collectivity {
  label: string
  data: Record<string, PropValue>
}

/** Collectivité ou assemblée où s'exerce le mandat, avec un libellé qui la distingue des homonymes. */
export function collectivity(kind: RneKind, row: RneRow): Collectivity | null {
  const dept = str(row, 'Libellé du département') ?? str(row, 'Libellé du  département')
  const deptCode = str(row, 'Code du département')
  const csp = str(row, 'Libellé de la collectivité à statut particulier')
  const commune = str(row, 'Libellé de la commune')
  switch (kind) {
    case 'mai':
    case 'cm':
      if (!commune) return null
      return {
        label: `${commune} (commune${deptCode ? `, ${deptCode}` : ''})`,
        data: compact({ kind: 'commune', citycode: str(row, 'Code de la commune'), department: dept ?? csp })
      }
    case 'ca': {
      const sector = str(row, 'Libellé du secteur')
      if (!sector && !commune) return null
      return { label: sector ?? `${commune} (arrondissements)`, data: compact({ kind: 'secteur', city: commune, citycode: str(row, 'Code de la commune') }) }
    }
    case 'epci': {
      const epci = str(row, "Libellé de l'EPCI")
      if (!epci) return null
      return { label: epci, data: compact({ kind: 'EPCI', siren: str(row, 'N° SIREN'), city: str(row, 'Libellé de la commune de rattachement'), department: dept ?? csp }) }
    }
    case 'cd': {
      if (!dept && !csp) return null
      return { label: `${dept ?? csp} (département)`, data: compact({ kind: 'département', collectivity_code: deptCode }) }
    }
    case 'cr': {
      const region = str(row, 'Libellé de la région')
      if (!region) return null
      return { label: `${region} (région)`, data: compact({ kind: 'région', collectivity_code: str(row, 'Code de la région') }) }
    }
    case 'ma': {
      const name = csp ?? str(row, 'Libellé de la région')
      if (!name) return null
      return { label: `Assemblée de ${name}`, data: { kind: 'assemblée territoriale' } }
    }
    case 'dep':
      return { label: 'Assemblée nationale', data: { kind: 'assemblée parlementaire', country: 'France' } }
    case 'sen':
      return { label: 'Sénat', data: { kind: 'assemblée parlementaire', country: 'France' } }
    case 'rpe':
      return { label: 'Parlement européen', data: { kind: 'assemblée parlementaire' } }
    case 'consfde': {
      const c = str(row, 'Libellé de la circonscription consulaire')
      return c ? { label: `Conseil consulaire ${c}`, data: { kind: 'conseil consulaire' } } : null
    }
    case 'afe':
      return { label: 'Assemblée des Français de l’étranger', data: { kind: 'assemblée' } }
  }
}

/** Circonscription ou ressort du mandat, ajouté au libellé du mandat. */
function seat(kind: RneKind, row: RneRow): string | undefined {
  const dept = str(row, 'Libellé du département') ?? str(row, 'Libellé de la collectivité à statut particulier')
  if (kind === 'dep') {
    const c = str(row, 'Libellé de la circonscription législative')
    return [dept, c ? circo(c) : undefined].filter(Boolean).join(', ') || undefined
  }
  if (kind === 'sen') return dept
  if (kind === 'cd') {
    const canton = str(row, 'Libellé du canton')
    return canton ? `canton de ${canton}` : undefined
  }
  if (kind === 'cr') {
    const section = str(row, 'Libellé de la section départementale')
    return section ? `section ${section}` : undefined
  }
  if (kind === 'ma') return str(row, 'Libellé de la section - collectivité à statut particulier') ?? str(row, 'Libellé de la circonscription métropolitaine')
  if (kind === 'afe') return str(row, 'Libellé la circ. AFE') ?? str(row, 'Libellé la circonscription AFE')
  return undefined
}

export interface RneMandate {
  kind: RneKind
  /** Fonction exercée (« Maire », « Président du conseil communautaire »...). */
  role: string
  collectivity: Collectivity | null
  seat?: string
  since?: string
  roleSince?: string
}

/** Une personne du registre : identité et mandats. */
export interface RneIdentity {
  lastName: string
  firstName: string
  birthDate?: string
  gender?: string
  occupation?: string
  mandates: RneMandate[]
}

/** La ligne correspond-elle au nom cherché (nom identique, premier prénom présent) ? */
export function rneMatches(row: RneRow, name: PersonName): boolean {
  const norm = (s: string): string => fold(s).replace(/[^a-z]/g, '')
  const nom = norm(str(row, NOM) ?? '')
  const prenoms = fold(str(row, PRENOM) ?? '')
    .split(/[\s,]+/)
    .map((p) => p.replace(/[^a-z-]/g, ''))
  const first = fold(name.firstNames[0] ?? '').replace(/[^a-z-]/g, '')
  return !!nom && nom === norm(name.lastName) && !!first && prenoms.includes(first)
}

/** Regroupe les lignes par personne (nom, prénom, date de naissance) et dédoublonne les mandats. */
export function groupIdentities(rows: Array<{ kind: RneKind; row: RneRow }>, lang: 'fr' | 'en' = 'fr'): RneIdentity[] {
  const byKey = new Map<string, RneIdentity>()
  for (const { kind, row } of rows) {
    const lastName = str(row, NOM) ?? ''
    const firstName = str(row, PRENOM) ?? ''
    const birthDate = rneDate(str(row, 'Date de naissance'))
    const key = `${fold(lastName)}|${fold(firstName)}|${birthDate ?? ''}`
    let id = byKey.get(key)
    if (!id) {
      id = {
        lastName,
        firstName,
        birthDate,
        gender: str(row, 'Code sexe'),
        occupation: str(row, 'Libellé de la catégorie socio-professionnelle'),
        mandates: []
      }
      byKey.set(key, id)
    }
    const mandate: RneMandate = {
      kind,
      role: str(row, 'Libellé de la fonction') ?? RNE_MANDATES[kind][lang],
      collectivity: collectivity(kind, row),
      seat: seat(kind, row),
      since: rneDate(str(row, 'Date de début du mandat')),
      roleSince: rneDate(str(row, 'Date de début de la fonction'))
    }
    // Un maire figure aussi parmi les conseillers municipaux avec la fonction « Maire ».
    const dup = id.mandates.some((m) => m.role === mandate.role && m.collectivity?.label === mandate.collectivity?.label && m.seat === mandate.seat)
    if (!dup) id.mandates.push(mandate)
  }
  return [...byKey.values()]
}

export type BirthCheck = 'same' | 'compatible' | 'different' | 'unknown'

/** Comparaison de la date de naissance publiée avec celle connue de la personne. */
export function birthCheck(published: string | undefined, known: PartialDate | null): BirthCheck {
  const p = parsePartialDate(published)
  if (!p || !known) return 'unknown'
  if (p.year !== known.year) return 'different'
  if (known.month && p.month && known.month !== p.month) return 'different'
  if (known.day && p.day && known.day !== p.day) return 'different'
  return known.day && known.month && p.day && p.month ? 'same' : 'compatible'
}

/** « Maire · Paris (commune, 75) · depuis le 22/03/2026 ». */
export function mandateLabel(m: RneMandate, lang: 'fr' | 'en' = 'fr'): string {
  const where = [m.collectivity?.label, m.seat].filter(Boolean).join(', ')
  const since = m.since ? (lang === 'fr' ? `depuis le ${frDate(m.since)}` : `since ${m.since}`) : undefined
  return [m.role, where, since].filter(Boolean).join(' · ')
}

const identityLabel = (id: RneIdentity): string => `${id.lastName} ${id.firstName}`.trim()

/** Sortie du module : graphe direct pour une naissance identique, « À vérifier » sinon. */
export function rneOutput(identities: RneIdentity[], known: PartialDate | null, lang: 'fr' | 'en' = 'fr') {
  const fr = lang === 'fr'
  const checked = identities.map((id) => ({ id, check: birthCheck(id.birthDate, known) }))
  const kept = checked.filter((c) => c.check !== 'different')
  const excluded = checked.length - kept.length
  const confirmed = kept.filter((c) => c.check === 'same')
  const entities: OutEntity[] = []
  const properties: Record<string, PropValue> = {}

  const entitiesFor = (id: RneIdentity, review: string | null): void => {
    const byLabel = new Map<string, { c: Collectivity; roles: string[] }>()
    for (const m of id.mandates) {
      if (!m.collectivity) continue
      const e = byLabel.get(m.collectivity.label) ?? { c: m.collectivity, roles: [] }
      if (!e.roles.includes(m.role)) e.roles.push(m.role)
      byLabel.set(m.collectivity.label, e)
    }
    for (const { c, roles } of byLabel.values()) {
      entities.push({
        type: 'administration',
        label: c.label,
        data: c.data,
        linkLabel: `${fr ? 'mandat' : 'office'} : ${roles.join(', ')}`,
        ...(review ? { review: true, reviewReason: review } : {})
      })
    }
  }

  if (confirmed.length) {
    const mandates = confirmed.flatMap((c) => c.id.mandates)
    properties.elected_mandates = mandates.map((m) => mandateLabel(m, lang))
    properties.socio_professional_category = confirmed[0].id.occupation ?? null
    for (const c of confirmed) entitiesFor(c.id, null)
  } else {
    for (const { id, check } of kept.slice(0, MAX_IDENTITIES)) {
      const born = id.birthDate ? (fr ? `né(e) le ${frDate(id.birthDate)}` : `born ${id.birthDate}`) : null
      const what = id.mandates.map((m) => mandateLabel(m, lang)).join(' ; ')
      const reason =
        check === 'compatible'
          ? fr
            ? `naissance compatible mais incomplète : ${identityLabel(id)}, ${born}, ${what} ; complétez la date de naissance pour confirmer`
            : `compatible but partial birth date: ${identityLabel(id)}, ${born}, ${what}; complete the birth date to confirm`
          : fr
            ? `homonyme possible : ${identityLabel(id)}${born ? `, ${born}` : ''}, ${what} ; ajoutez la date de naissance à la fiche pour confirmer`
            : `possible namesake: ${identityLabel(id)}${born ? `, ${born}` : ''}, ${what}; add the birth date to the record to confirm`
      entitiesFor(id, reason)
    }
    if (kept.length) properties.rne_namesakes_count = kept.length
  }
  if (excluded) properties.rne_namesakes_excluded = excluded
  return { entities, properties: compact(properties) }
}

export default defineModule({
  id: 'person.rne_elus',
  name: { fr: 'Répertoire national des élus', en: 'French national register of elected officials' },
  description: {
    fr: 'Cherche la personne parmi les élus en fonction (maires, conseillers municipaux, communautaires, départementaux et régionaux, députés, sénateurs, députés européens, élus des Français de l’étranger) dans le répertoire du ministère de l’Intérieur publié sur data.gouv.fr. Nom et prénom exacts, accents compris. Les mandats ne sont ajoutés à la fiche que si la date de naissance publiée est identique à celle connue ; sinon chaque homonyme est mis de côté dans « À vérifier ».',
    en: 'Looks the person up among current French elected officials (mayors, municipal, intermunicipal, departmental and regional councillors, MPs, senators, MEPs, representatives of French citizens abroad) in the Interior Ministry register published on data.gouv.fr. Exact name and first name, accents included. Offices are only added when the published birth date matches the known one; otherwise each namesake is put aside in "To review".'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://www.data.gouv.fr/fr/datasets/repertoire-national-des-elus-1/',
  timeoutMs: 240000,
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const files = await rneFilesFor(ctx)
    const filters = [
      { column: NOM, op: 'in' as const, value: upperVariants(name.lastName) },
      { column: PRENOM, op: 'contains' as const, value: name.firstNames[0] }
    ]
    let done = 0
    ctx.progress(0, files.length)
    const settled = await mapPool(files, 4, async (f) => {
      const res = await tabularPage<RneRow>(ctx, f.id, filters, { service: SERVICE, pageSize: 50, timeoutMs: 40000 })
      ctx.progress(++done, files.length, RNE_MANDATES[f.kind][ctx.lang])
      return res.data.filter((row) => rneMatches(row, name)).map((row) => ({ kind: f.kind, row }))
    })
    const failed = settled.filter((s) => s.status === 'rejected')
    if (failed.length === files.length) throw (failed[0] as PromiseRejectedResult).reason
    const rows = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
    const identities = groupIdentities(rows, ctx.lang)
    const known = parsePartialDate(input.data.birth_date)
    const out = rneOutput(identities, known, ctx.lang)
    if (failed.length) {
      // Fichiers injoignables : le résultat est partiel, on le signale plutôt que de conclure à l'absence.
      out.properties.rne_files_unavailable = files.filter((_, i) => settled[i].status === 'rejected').map((f) => RNE_MANDATES[f.kind][ctx.lang])
    }
    return {
      ...out,
      raw: { query: { nom: upperVariants(name.lastName), prenom: name.firstNames[0] }, files: files.length, failed: failed.length, identities }
    }
  }
})

async function rneFilesFor(ctx: ModuleContext): Promise<Array<{ id: string; kind: RneKind }>> {
  try {
    const files = rneFiles(await datasetResources(ctx, RNE_DATASET, { service: SERVICE }))
    if (files.length >= 6) {
      // Un type de mandat absent du jeu de données en ligne : on reprend le fichier connu.
      const kinds = new Set(files.map((f) => f.kind))
      return [...files, ...KNOWN_FILES.filter((f) => !kinds.has(f.kind))]
    }
  } catch (e) {
    ctx.log(`jeu de données injoignable, fichiers connus utilisés : ${e instanceof Error ? e.message : String(e)}`)
  }
  return KNOWN_FILES
}

