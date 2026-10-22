// Conteneur Google Tag Manager : le script public `gtm.js` liste les balises qu'il déclenche
// (mesure GA4, Universal Analytics, conversions Google Ads, Floodlight). Ces identifiants relient
// des sites qui ne partagent pas forcément le conteneur. La requête va chez Google, pas chez la cible.

import { defineModule, ModuleError, type HttpError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, serviceError } from '../domain/_util'
import { normalizeTracker } from './tracker'

/** Plafond des identifiants reliés au conteneur. */
const MAX_TAGS = 15
const MAX_SCRIPT = 3_000_000

// Identifiants de balises Google : mesure GA4, Universal Analytics, Google Ads, Floodlight.
const TAG_IDS = /(?<![A-Za-z0-9_-])(G-[A-Z0-9]{6,12}|UA-\d{4,10}-\d{1,4}|AW-\d{9,11}|DC-\d{6,10})(?![A-Za-z0-9_])/g

/**
 * Partie déclarative du script (`var data = { "resource": ... }`), avant le moteur de Google :
 * c'est là que se trouvent les identifiants configurés. Script entier si le découpage échoue.
 */
export function gtmResource(script: string): string {
  const start = script.indexOf('"resource"')
  if (start < 0) return script
  // L'objet `data` se ferme par `};` en début de ligne ; le moteur suit.
  const end = script.slice(start).search(/\n\s*\};/)
  return end > 0 ? script.slice(start, start + end) : script.slice(start)
}

/** Identifiants de balises du conteneur, dans l'ordre d'apparition, sans le conteneur lui-même. */
export function gtmTagIds(script: string): Array<{ id: string; kind: string }> {
  const out = new Map<string, { id: string; kind: string }>()
  for (const m of gtmResource(script).matchAll(TAG_IDS)) {
    const t = normalizeTracker(m[1])
    if (t?.kind && !out.has(t.id)) out.set(t.id, { id: t.id, kind: t.kind })
  }
  return Array.from(out.values())
}

export function buildGtmOutput(container: string, tags: Array<{ id: string; kind: string }>, version: string | null, lang: 'fr' | 'en'): ModuleOutput {
  // Conteneur vide : Google répond aussi 200 pour un identifiant inconnu, sans aucune balise.
  if (!tags.length) return {}
  const fr = lang === 'fr'
  const entities: OutEntity[] = tags.slice(0, MAX_TAGS).map((t) => ({
    type: 'tracker',
    label: t.id,
    data: { kind: t.kind },
    linkLabel: fr ? 'déclenché par le conteneur' : 'fired by the container'
  }))
  return {
    properties: compact({
      kind: 'Google Tag Manager',
      gtm_version: version,
      gtm_tags: tags.map((t) => `${t.kind}: ${t.id}`),
      gtm_tags_count: tags.length
    }),
    entities,
    raw: { container, version, tags }
  }
}

export default defineModule({
  id: 'tracker.gtm',
  name: { fr: 'Contenu du conteneur Google Tag Manager', en: 'Google Tag Manager container content' },
  description: {
    fr: 'Télécharge le script public du conteneur GTM chez Google (sans contacter le site) et relie les identifiants qu’il déclenche : Google Analytics 4 (G-), Universal Analytics (UA-), Google Ads (AW-) et Floodlight (DC-), 15 au plus.',
    en: 'Downloads the public GTM container script from Google (without contacting the site) and links the IDs it fires: Google Analytics 4 (G-), Universal Analytics (UA-), Google Ads (AW-) and Floodlight (DC-), 15 at most.'
  },
  category: 'web',
  inputTypes: ['tracker'],
  homepage: 'https://tagmanager.google.com',
  accepts: (input) => normalizeTracker(input.label)?.kind === 'Google Tag Manager',
  async run(input, ctx) {
    const t = normalizeTracker(input.label)
    if (t?.kind !== 'Google Tag Manager') throw new ModuleError('Identifiant GTM attendu (GTM-XXXX)', 'invalid_input')
    let script: string
    try {
      script = await ctx.fetchText('https://www.googletagmanager.com/gtm.js', { query: { id: t.id }, timeoutMs: 30000 })
    } catch (e) {
      // 404 : conteneur bloqué ou supprimé (un identifiant inconnu renvoie un conteneur vide).
      if ((e as Partial<HttpError>)?.status === 404) return {}
      throw serviceError(e, 'Google Tag Manager')
    }
    script = script.slice(0, MAX_SCRIPT)
    if (!script.includes('google_tag_manager')) throw new ModuleError('Google Tag Manager : réponse inattendue', 'other')
    const version = gtmResource(script).match(/"version"\s*:\s*"(\d+)"/)?.[1] ?? null
    return buildGtmOutput(t.id, gtmTagIds(script), version, ctx.lang)
  }
})
