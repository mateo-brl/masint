import { defineModule, ModuleError, type ModuleOutput } from '@shared/modules'
import { compact, isIPv4, isoDate, normalizeHost, serviceError } from '../domain/_util'

const KEY = { id: 'greynoise', label: 'GreyNoise API key', url: 'https://viz.greynoise.io/account/api-key', optional: true }

export interface GreyNoiseCommunity {
  ip?: string
  noise?: boolean
  riot?: boolean
  classification?: string
  name?: string
  link?: string
  last_seen?: string
  message?: string
}

/** Réponse 429 de l'API communautaire (quota hebdomadaire sans clé). */
export interface GreyNoiseLimit {
  plan?: string
  rate_limit?: string
  message?: string
}

/**
 * Interprète la réponse communautaire, y compris le 404 « IP not observed scanning the internet ».
 * Sans clé, l'API ne signale plus l'appartenance RIOT (toujours `false`, vérifié en octobre 2026
 * sur 8.8.8.8 et 1.1.1.1) : un `riot: false` n'est donc repris que s'il vient d'un appel avec clé.
 */
export function parseGreyNoise(d: GreyNoiseCommunity | null, keyed = false): ModuleOutput {
  if (!d?.ip) return {}
  const name = d.name && d.name !== 'unknown' ? d.name : null
  const classification = d.classification && d.classification !== 'unknown' ? d.classification : null
  const link = d.link ?? `https://viz.greynoise.io/ip/${d.ip}`
  return {
    properties: compact({
      greynoise_noise: d.noise === true,
      greynoise_riot: d.riot === true ? true : keyed && d.riot === false ? false : null,
      greynoise_classification: classification,
      greynoise_name: name,
      greynoise_last_seen: isoDate(d.last_seen),
      greynoise_link: link
    }),
    raw: d
  }
}

/** Erreur lisible pour un quota atteint (« 25-W » : 25 requêtes par semaine). */
export function greyNoiseLimitError(body: GreyNoiseLimit | null, keyed: boolean): ModuleError {
  const m = body?.rate_limit?.match(/^(\d+)-([DWM])/i)
  const period = m ? { D: 'jour', W: 'semaine', M: 'mois' }[m[2].toUpperCase() as 'D' | 'W' | 'M'] : null
  const quota = m && period ? ` (${m[1]} requêtes par ${period})` : ''
  return new ModuleError(
    keyed
      ? `GreyNoise : quota de la clé atteint${quota}, réessayer plus tard`
      : `GreyNoise : quota anonyme atteint${quota}. Ajoutez une clé gratuite GreyNoise dans le coffre pour continuer.`,
    'rate_limited'
  )
}

export default defineModule({
  id: 'ip.greynoise',
  name: { fr: 'GreyNoise', en: 'GreyNoise' },
  description: {
    fr: 'Indique si l’IP scanne Internet en masse (bruit de fond), si elle appartient à un service légitime connu (RIOT : Google, Microsoft...) et sa classification (malveillante, bénigne). Sans clé, l’API ne renseigne plus RIOT et limite à 25 requêtes par semaine : clé gratuite recommandée.',
    en: 'Tells whether the IP mass-scans the Internet (background noise), belongs to a known legitimate service (RIOT: Google, Microsoft...) and its classification (malicious, benign). Without a key the API no longer reports RIOT and allows 25 requests a week: free key recommended.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  keys: [KEY],
  homepage: 'https://viz.greynoise.io',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip)) throw new ModuleError('Adresse IPv4 attendue', 'invalid_input')
    const key = ctx.key(KEY.id)
    let res: Response
    try {
      res = await ctx.fetch(`https://api.greynoise.io/v3/community/${ip}`, {
        headers: { accept: 'application/json', ...(key ? { key } : {}) }
      })
    } catch (e) {
      throw serviceError(e, 'GreyNoise', !!key)
    }
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      /* corps non JSON : traité selon le statut */
    }
    if (res.status === 429) throw greyNoiseLimitError(json as GreyNoiseLimit | null, !!key)
    // 404 : IP non observée, le corps garde le même format que la réponse 200.
    if (!res.ok && res.status !== 404) throw serviceError({ status: res.status }, 'GreyNoise', !!key)
    if (!json || typeof json !== 'object') {
      if (res.status === 404) return {}
      throw new ModuleError('GreyNoise : réponse illisible', 'other')
    }
    return parseGreyNoise({ ip, ...(json as GreyNoiseCommunity) }, !!key)
  }
})
