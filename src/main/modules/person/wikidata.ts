// Wikidata : fiche d'une personnalité publique (naissance, décès, lieu de
// naissance, site officiel, compte X, portrait). API publique, sans clé.

import { defineModule, ModuleError, type HttpError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'

const API = 'https://www.wikidata.org/w/api.php'
// Politique de Wikimedia : un User-Agent qui identifie l'outil et permet de le contacter.
const USER_AGENT = 'MASINT (https://github.com/mateo-brl/masint)'

interface SearchResponse {
  search?: Array<{ id: string; label?: string; description?: string }>
}

interface Claim {
  mainsnak?: { datavalue?: { value?: unknown } }
}

export interface WdEntity {
  id: string
  labels?: Record<string, { value: string }>
  descriptions?: Record<string, { value: string }>
  claims?: Record<string, Claim[]>
}

interface EntitiesResponse {
  entities?: Record<string, WdEntity>
}

/** Valeurs d'une propriété Wikidata (P569 = naissance, P18 = image...). */
function values<T>(e: WdEntity, prop: string): T[] {
  return (e.claims?.[prop] ?? []).map((c) => c.mainsnak?.datavalue?.value as T).filter((v) => v !== undefined)
}

const first = <T>(e: WdEntity, prop: string): T | undefined => values<T>(e, prop)[0]

/** `+1867-11-07T00:00:00Z` → `1867-11-07` ; précision réduite si le jour ou le mois manque. */
export function wikidataDate(v: { time?: string } | undefined): string | null {
  const m = v?.time?.match(/^\+?(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  return mo === '00' ? y : d === '00' ? `${y}-${mo}` : `${y}-${mo}-${d}`
}

/** Un élément Wikidata est une personne si P31 (nature de l'élément) vaut Q5 (être humain). */
export const isHuman = (e: WdEntity): boolean => values<{ id?: string }>(e, 'P31').some((v) => v.id === 'Q5')

/** Appel de l'API Wikidata ; un refus pour quota devient une erreur explicite. */
async function api<T>(ctx: ModuleContext, query: Record<string, string | number>): Promise<T> {
  try {
    return await ctx.fetchJson<T>(API, { query: { ...query, format: 'json' }, headers: { 'user-agent': USER_AGENT } })
  } catch (e) {
    if ((e as HttpError).status === 429) throw new ModuleError('Wikidata : trop de requêtes, réessayez plus tard', 'rate_limited')
    throw e
  }
}

const label = (e: WdEntity, lang: string): string | undefined => (e.labels?.[lang] ?? e.labels?.en)?.value

export default defineModule({
  id: 'person.wikidata',
  name: { fr: 'Wikidata (personnalité publique)', en: 'Wikidata (public figure)' },
  description: {
    fr: 'Cherche la personne dans Wikidata : description, dates de naissance et de décès, lieu de naissance (placé sur la carte), site officiel, compte X et portrait.',
    en: 'Looks the person up in Wikidata: description, birth and death dates, birthplace (shown on the map), official website, X account and portrait.'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://www.wikidata.org',
  experimental: true,
  async run(input, ctx) {
    const fr = ctx.lang === 'fr'
    const name = input.label.trim()
    if (name.length < 3) throw new ModuleError(fr ? 'Nom trop court' : 'Name too short', 'invalid_input')

    // 1. Recherche plein texte : jusqu'à 5 éléments candidats.
    const search = await api<SearchResponse>(ctx, {
      action: 'wbsearchentities',
      search: name,
      language: ctx.lang,
      uselang: ctx.lang,
      type: 'item',
      limit: 5
    })
    const ids = (search.search ?? []).map((s) => s.id)
    if (!ids.length) return {}

    // 2. Détail des candidats en une requête ; on garde le premier être humain.
    const details = await api<EntitiesResponse>(ctx, {
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'labels|descriptions|claims',
      languages: `${ctx.lang}|en`
    })
    const person = ids.map((id) => details.entities?.[id]).find((e): e is WdEntity => !!e && isHuman(e))
    if (!person) return {}

    const entities: OutEntity[] = []

    // 3. Lieu de naissance avec ses coordonnées : lat/lon le placent sur la carte.
    const birthPlaceId = first<{ id?: string }>(person, 'P19')?.id
    if (birthPlaceId) {
      const places = await api<EntitiesResponse>(ctx, {
        action: 'wbgetentities',
        ids: birthPlaceId,
        props: 'labels|claims',
        languages: `${ctx.lang}|en`
      })
      const place = places.entities?.[birthPlaceId]
      const coords = place && first<{ latitude: number; longitude: number }>(place, 'P625')
      const placeName = place && label(place, ctx.lang)
      if (placeName) {
        entities.push({
          type: 'city',
          label: placeName,
          data: coords ? { lat: coords.latitude, lon: coords.longitude } : {},
          linkLabel: fr ? 'lieu de naissance' : 'birthplace'
        })
      }
    }

    const website = first<string>(person, 'P856')
    if (website) entities.push({ type: 'website', label: website, linkLabel: fr ? 'site officiel' : 'official website' })

    const xHandle = first<string>(person, 'P2002')
    if (xHandle) {
      entities.push({
        type: 'account',
        platform: 'x',
        label: xHandle,
        data: { username: xHandle, url: `https://x.com/${xHandle}` },
        linkLabel: fr ? 'compte X' : 'X account'
      })
    }

    // 4. Portrait : l'URL est téléchargée par le moteur (via le proxy) et jointe au nœud.
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

    // Propriétés fusionnées dans le nœud d'origine ; les clés *_date alimentent la frise.
    const properties: Record<string, PropValue> = {
      wikidata_id: person.id,
      wikidata_url: `https://www.wikidata.org/wiki/${person.id}`,
      description: (person.descriptions?.[ctx.lang] ?? person.descriptions?.en)?.value ?? null,
      birth_date: wikidataDate(first(person, 'P569')),
      death_date: wikidataDate(first(person, 'P570'))
    }

    return { properties, entities, raw: { id: person.id, candidates: ids } }
  }
})
