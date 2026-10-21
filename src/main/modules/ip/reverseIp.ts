import { defineModule, ModuleError, type ModuleOutput } from '@shared/modules'
import { isDomain, isIPv4, normalizeHost, serviceError } from '../domain/_util'

const MAX_ENTITIES = 30

/** Réponse texte de HackerTarget : un domaine par ligne, ou un message d'erreur. */
export function parseReverseIp(text: string, lang: 'fr' | 'en'): ModuleOutput {
  const t = text.trim()
  if (/api count exceeded/i.test(t)) throw new ModuleError('HackerTarget : quota quotidien dépassé', 'rate_limited')
  if (!t || /^error|no (dns a )?records found/i.test(t)) return {}
  const domains = Array.from(new Set(t.split('\n').map((l) => l.trim().toLowerCase()).filter(isDomain)))
  if (!domains.length) return {}
  return {
    properties: { hosted_domains_count: domains.length, hosted_domains: domains.slice(0, 1000) },
    entities: domains.slice(0, MAX_ENTITIES).map((d) => ({
      type: 'domain',
      label: d,
      linkLabel: lang === 'fr' ? 'hébergé sur cette IP' : 'hosted on this IP'
    })),
    raw: { count: domains.length, domains: domains.slice(0, 1000) }
  }
}

export default defineModule({
  id: 'ip.reverse_ip',
  name: { fr: 'Domaines sur la même IP', en: 'Domains on the same IP' },
  description: {
    fr: 'Domaines dont le DNS pointe vers cette IP (hébergement mutualisé), d’après HackerTarget. 30 premiers en entités. Quota gratuit limité par jour.',
    en: 'Domains whose DNS points to this IP (shared hosting), from HackerTarget. First 30 as entities. Limited free daily quota.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://hackertarget.com/reverse-ip-lookup/',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip)) throw new ModuleError('Adresse IPv4 attendue', 'invalid_input')
    let text: string
    try {
      text = await ctx.fetchText('https://api.hackertarget.com/reverseiplookup/', { query: { q: ip } })
    } catch (e) {
      throw serviceError(e, 'HackerTarget')
    }
    return parseReverseIp(text, ctx.lang)
  }
})
