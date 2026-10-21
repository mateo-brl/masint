import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { VT_KEY, vtGet, vtProperties, type VtAttributes } from '../domain/_virustotal'
import { compact, isIPv4, isIPv6, normalizeHost } from '../domain/_util'

export function parseVtIp(ip: string, a: VtAttributes | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!a) return {}
  const entities: OutEntity[] = []
  if (a.asn)
    entities.push({
      type: 'asn',
      label: `AS${a.asn}`,
      data: compact({ name: a.as_owner ?? null, registry: a.regional_internet_registry ?? null }) as Record<string, PropValue>,
      linkLabel: lang === 'fr' ? 'réseau' : 'network'
    })
  return {
    properties: {
      ...vtProperties(a, `https://www.virustotal.com/gui/ip-address/${ip}`),
      ...compact({
        asn: a.asn ? `AS${a.asn}` : null,
        org: a.as_owner ?? null,
        prefix: a.network ?? null,
        country_code: a.country ?? null
      })
    },
    entities,
    raw: { ...a, last_analysis_results: undefined, whois: a.whois?.slice(0, 5000) }
  }
}

export default defineModule({
  id: 'ip.virustotal',
  name: { fr: 'VirusTotal (IP)', en: 'VirusTotal (IP)' },
  description: {
    fr: 'Réputation de l’IP sur VirusTotal : détections des moteurs, tags, votes, ASN et réseau.',
    en: 'IP reputation on VirusTotal: engine detections, tags, votes, ASN and network.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  keys: [VT_KEY],
  homepage: 'https://www.virustotal.com',
  experimental: true,
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    return parseVtIp(ip, await vtGet(ctx, `ip_addresses/${ip}`), ctx.lang)
  }
})
