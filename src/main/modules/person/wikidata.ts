// Wikidata : fiche d'une personnalité publique (naissance, décès, lieu de naissance, fonctions
// occupées, employeurs, études, proches, site officiel, comptes en ligne, portrait). API
// publique, sans clé ; repli sur SPARQL et Special:EntityData quand l'API refuse (429).

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cappedList } from '../domain/_util'
import {
  accountEntities,
  claimsOf,
  descriptionOf,
  distinctLabel,
  first,
  getEntities,
  isHuman,
  itemId,
  labelOf,
  period,
  qualifier,
  resolveItems,
  sameName,
  searchCandidates,
  wikidataDate,
  type Claim,
  type Resolved,
  type WdEntity
} from './_wikidata'

export { isHuman, wikidataDate, type WdEntity } from './_wikidata'

/** Entités reliées au graphe par type de relation (fonctions en propriété, sans plafond strict). */
const MAX_RELATED = 10

/** Proches : propriété Wikidata et libellé du lien. */
const RELATIVES: Array<[prop: string, fr: string, en: string]> = [
  ['P22', 'père', 'father'],
  ['P25', 'mère', 'mother'],
  ['P26', 'conjoint ou conjointe', 'spouse'],
  ['P40', 'enfant', 'child']
]

const wdData = (id: string): Record<string, PropValue> => ({ wikidata_id: id, wikidata_url: `https://www.wikidata.org/wiki/${id}` })

/** Éléments cités par la fiche, dont il faut le libellé (et les coordonnées du lieu de naissance). */
export function personReferences(p: WdEntity): { ids: string[]; withCoords: string[] } {
  const props = ['P19', 'P39', 'P108', 'P69', ...RELATIVES.map(([prop]) => prop)]
  const ids = props.flatMap((prop) => claimsOf(p, prop).map((c) => itemId(c.mainsnak?.datavalue?.value)))
  // Organisation dirigée ou concernée par une fonction (« président, En Marche »).
  for (const c of claimsOf(p, 'P39')) ids.push(itemId(qualifier(c, 'P2389')), itemId(qualifier(c, 'P642')))
  const birthPlace = itemId(first(p, 'P19'))
  return { ids: ids.filter((x): x is string => !!x), withCoords: birthPlace ? [birthPlace] : [] }
}

/** Fonctions occupées (P39) : la plus récente d'abord, en cours avant terminées. */
export function positionsHeld(p: WdEntity, names: Map<string, Resolved>, lang: 'fr' | 'en'): string[] {
  const rows = claimsOf(p, 'P39')
    .map((c) => {
      const office = names.get(itemId(c.mainsnak?.datavalue?.value) ?? '')?.label
      const of = names.get(itemId(qualifier(c, 'P2389')) ?? itemId(qualifier(c, 'P642')) ?? '')?.label
      const label = office && of ? `${office}, ${of}` : office
      const start = wikidataDate(qualifier(c, 'P580')) ?? ''
      const ended = !!qualifier(c, 'P582')
      const when = period(c, lang)
      return label ? { text: when ? `${label} (${when})` : label, start, ended } : null
    })
    .filter((r): r is { text: string; start: string; ended: boolean } => !!r)
  rows.sort((a, b) => Number(a.ended) - Number(b.ended) || b.start.localeCompare(a.start))
  return [...new Set(rows.map((r) => r.text))]
}

/** Élément relié (employeur, établissement, proche) avec la période de la relation. */
function related(c: Claim, names: Map<string, Resolved>, type: string, fr: string, en: string, lang: 'fr' | 'en', self?: string): OutEntity | null {
  const id = itemId(c.mainsnak?.datavalue?.value)
  const label = id ? names.get(id)?.label : undefined
  if (!id || !label) return null
  const when = period(c, lang)
  const rel = lang === 'fr' ? fr : en
  return { type, label: distinctLabel(label, id, self), data: wdData(id), linkLabel: when ? `${rel} (${when})` : rel }
}

/**
 * Sortie du module à partir de la fiche et des libellés des éléments cités. `self` est le
 * libellé du nœud d'entrée : un proche du même nom (père et fils homonymes) reçoit son
 * identifiant Wikidata dans le libellé, pour ne pas être fusionné avec la personne recherchée.
 */
export function personOutput(lang: 'fr' | 'en', person: WdEntity, names: Map<string, Resolved>, reviewReason?: string, self?: string): ModuleOutput {
  const fr = lang === 'fr'
  const entities: OutEntity[] = []

  // Lieu de naissance avec ses coordonnées : lat/lon le placent sur la carte.
  const birthPlace = names.get(itemId(first(person, 'P19')) ?? '')
  if (birthPlace?.label) {
    entities.push({
      type: 'city',
      label: birthPlace.label,
      data: birthPlace.lat !== undefined && birthPlace.lon !== undefined ? { lat: birthPlace.lat, lon: birthPlace.lon } : {},
      linkLabel: fr ? 'lieu de naissance' : 'birthplace'
    })
  }

  const website = first<string>(person, 'P856')
  if (website) entities.push({ type: 'website', label: website, linkLabel: fr ? 'site officiel' : 'official website' })
  entities.push(...accountEntities(person, lang))

  // Portrait : l'URL est téléchargée par le moteur (via le proxy) et jointe au nœud.
  const portrait = first<string>(person, 'P18')
  if (portrait) {
    const file = encodeURIComponent(portrait.replace(/ /g, '_'))
    entities.push({
      type: 'photo',
      label: `Wikimedia Commons : ${portrait}`,
      image: `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=512`,
      data: { url: `https://commons.wikimedia.org/wiki/File:${file}` },
      linkLabel: 'portrait'
    })
  }

  const add = (prop: string, type: string, frLabel: string, enLabel: string): void => {
    for (const c of claimsOf(person, prop).slice(0, MAX_RELATED)) {
      const e = related(c, names, type, frLabel, enLabel, lang, self ?? labelOf(person, lang))
      if (e) entities.push(e)
    }
  }
  add('P108', 'organization', 'employeur', 'employer')
  add('P69', 'school', 'études', 'education')
  for (const [prop, frLabel, enLabel] of RELATIVES) add(prop, 'person', frLabel, enLabel)

  // Propriétés fusionnées dans le nœud d'origine ; les clés *_date alimentent la frise.
  const properties: Record<string, PropValue> = {
    ...wdData(person.id),
    description: descriptionOf(person, lang) ?? null,
    birth_date: wikidataDate(first(person, 'P569')),
    death_date: wikidataDate(first(person, 'P570')),
    // Fonctions publiques : utile pour repérer une personne politiquement exposée.
    ...cappedList('positions_held', positionsHeld(person, names, lang), 30)
  }

  return {
    properties,
    entities: reviewReason ? entities.map((e) => ({ ...e, review: true, reviewReason })) : entities,
    raw: { id: person.id }
  }
}

/**
 * Personne retenue parmi les candidats : le premier être humain. Si plusieurs êtres humains
 * portent exactement ce nom, le choix est signalé comme incertain.
 */
export function pickPerson(
  name: string,
  candidates: Array<{ id: string; label?: string; description?: string; human: boolean }>,
  lang: 'fr' | 'en'
): { id: string; reviewReason?: string } | null {
  const humans = candidates.filter((c) => c.human)
  if (!humans.length) return null
  const chosen = humans[0]
  const namesakes = humans.filter((c) => c.label && sameName(c.label, name))
  if (namesakes.length < 2) return { id: chosen.id }
  const who = chosen.description ? `${chosen.description}, ${chosen.id}` : chosen.id
  return {
    id: chosen.id,
    reviewReason:
      lang === 'fr'
        ? `homonyme possible : ${namesakes.length} personnes de ce nom dans Wikidata, retenue : ${who}`
        : `possible namesake: ${namesakes.length} people with this name in Wikidata, chosen: ${who}`
  }
}

async function lookup(ctx: ModuleContext, id: string, known: Record<string, WdEntity> = {}): Promise<WdEntity | undefined> {
  return known[id] ?? (await getEntities(ctx, [id]))[id]
}

export default defineModule({
  id: 'person.wikidata',
  name: { fr: 'Wikidata (personnalité publique)', en: 'Wikidata (public figure)' },
  description: {
    fr: 'Cherche la personne dans Wikidata : description, dates de naissance et de décès, lieu de naissance (placé sur la carte), fonctions occupées (personne politiquement exposée), employeurs, études, proches, site officiel, comptes en ligne et portrait.',
    en: 'Looks the person up in Wikidata: description, birth and death dates, birthplace (shown on the map), positions held (politically exposed person), employers, education, relatives, official website, online accounts and portrait.'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://www.wikidata.org',
  experimental: true,
  async run(input, ctx) {
    const fr = ctx.lang === 'fr'
    const name = input.label.trim()
    // Identifiant déjà connu (proche relié par ce module, saisie de l'enquêteur) : pas de recherche.
    const knownId = typeof input.data.wikidata_id === 'string' && /^Q\d+$/.test(input.data.wikidata_id) ? input.data.wikidata_id : null
    if (!knownId && name.length < 3) throw new ModuleError(fr ? 'Nom trop court' : 'Name too short', 'invalid_input')

    let person: WdEntity | undefined
    let reviewReason: string | undefined
    let candidates: string[] = []
    if (knownId) {
      person = await lookup(ctx, knownId)
      if (person && !isHuman(person)) person = undefined
    } else {
      // Recherche plein texte (5 candidats) ; on garde le premier être humain.
      const found = await searchCandidates(ctx, name)
      candidates = found.candidates.map((c) => c.id)
      const pick = pickPerson(name, found.candidates, ctx.lang)
      if (!pick) return {}
      reviewReason = pick.reviewReason
      person = await lookup(ctx, pick.id, found.entities)
    }
    if (!person) return {}

    const refs = personReferences(person)
    const names = await resolveItems(ctx, refs.ids, refs.withCoords)
    const out = personOutput(ctx.lang, person, names, reviewReason, name)
    return { ...out, raw: { id: person.id, label: labelOf(person, ctx.lang), candidates } }
  }
})
