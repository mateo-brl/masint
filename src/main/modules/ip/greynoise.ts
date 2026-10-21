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

export function parseGreyNoise(d: GreyNoiseCommunity | null): ModuleOutput {
  // 404 « IP not observed » : rien à signaler.
  if (!d || (!d.noise && !d.riot)) return {}
  return {
    properties: compact({
      greynoise_noise: d.noise ?? null,
      greynoise_riot: d.riot ?? null,
      greynoise_classification: d.classification ?? null,
      greynoise_name: d.name && d.name !== 'unknown' ? d.name : null,
      greynoise_last_seen: isoDate(d.last_seen),
      greynoise_link: d.link ?? null
    }),
    raw: d
  }
}

export default defineModule({
  id: 'ip.greynoise',
  name: { fr: 'GreyNoise', en: 'GreyNoise' },
  description: {
    fr: 'Indique si l’IP scanne Internet en masse (bruit de fond), si elle appartient à un service légitime connu (RIOT : Google, Microsoft...) et sa classification (malveillante, bénigne). Clé facultative.',
    en: 'Tells whether the IP mass-scans the Internet (background noise), belongs to a known legitimate service (RIOT: Google, Microsoft...) and its classification (malicious, benign). Optional key.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  keys: [KEY],
  homepage: 'https://viz.greynoise.io',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip)) throw new ModuleError('Adresse IPv4 attendue', 'invalid_input')
    const key = ctx.key(KEY.id)
    const res = await ctx.fetch(`https://api.greynoise.io/v3/community/${ip}`, {
      headers: { accept: 'application/json', ...(key ? { key } : {}) }
    })
    const text = await res.text()
    if (res.status === 404) return {}
    if (!res.ok) throw serviceError({ status: res.status }, 'GreyNoise', !!key)
    try {
      return parseGreyNoise(JSON.parse(text) as GreyNoiseCommunity)
    } catch {
      throw new ModuleError('GreyNoise : réponse illisible', 'other')
    }
  }
})
