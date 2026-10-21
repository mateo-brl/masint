import { defineModule, ModuleError, type ModuleOutput } from '@shared/modules'
import { compact, countryName, isIPv4, isIPv6, isoDate, normalizeHost } from '../domain/_util'
import { expandIPv6 } from './reverseDns'

export interface OnionooRelay {
  nickname?: string
  fingerprint?: string
  or_addresses?: string[]
  exit_addresses?: string[]
  flags?: string[]
  running?: boolean
  first_seen?: string
  last_seen?: string
  country?: string
  as?: string
  as_name?: string
  contact?: string
}

const sameIp = (a: string, b: string): boolean => a === b || (a.includes(':') && b.includes(':') && expandIPv6(a) === expandIPv6(b))

/** Adresse d'une entrée `or_addresses` (`1.2.3.4:9001` ou `[2001:db8::1]:9001`). */
function hostOf(addr: string): string {
  const v6 = addr.match(/^\[([^\]]+)\]/)
  return v6 ? v6[1] : addr.replace(/:\d+$/, '')
}

/** Relais dont une adresse correspond exactement à l'IP (Onionoo cherche par préfixe). */
export function matchRelays(ip: string, relays: OnionooRelay[]): OnionooRelay[] {
  return relays.filter(
    (r) => (r.or_addresses ?? []).some((a) => sameIp(hostOf(a), ip)) || (r.exit_addresses ?? []).some((a) => sameIp(a, ip))
  )
}

export function buildTorOutput(ip: string, relays: OnionooRelay[], inExitList: boolean | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!relays.length) return inExitList ? { properties: { tor_relay: true, tor_exit: true, tor_source: 'check.torproject.org' } } : {}
  const isExit = relays.some((r) => r.flags?.includes('Exit') || (r.exit_addresses ?? []).some((a) => sameIp(a, ip)))
  const running = relays.some((r) => r.running)
  const first = relays.map((r) => r.first_seen ?? '').filter(Boolean).sort()[0]
  const last = relays.map((r) => r.last_seen ?? '').filter(Boolean).sort().pop()
  return {
    properties: compact({
      tor_relay: true,
      tor_exit: isExit,
      tor_running: running,
      tor_nicknames: relays.map((r) => r.nickname ?? '').filter(Boolean),
      tor_fingerprints: relays.map((r) => r.fingerprint ?? '').filter(Boolean),
      tor_flags: Array.from(new Set(relays.flatMap((r) => r.flags ?? []))),
      tor_first_seen: isoDate(first),
      tor_last_seen: isoDate(last),
      tor_contact: relays.find((r) => r.contact)?.contact ?? null,
      tor_country: countryName(relays[0].country, lang),
      tor_source: 'Onionoo'
    }),
    raw: relays.slice(0, 10)
  }
}

export default defineModule({
  id: 'ip.tor',
  name: { fr: 'Nœud Tor', en: 'Tor node' },
  description: {
    fr: 'Indique si l’IP est un relais ou un nœud de sortie Tor (Onionoo, repli sur la liste officielle check.torproject.org), avec surnom, empreinte, dates et contact de l’opérateur.',
    en: 'Tells whether the IP is a Tor relay or exit node (Onionoo, falling back to the official check.torproject.org list), with nickname, fingerprint, dates and operator contact.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://metrics.torproject.org',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    try {
      const res = await ctx.fetchJson<{ relays?: OnionooRelay[] }>('https://onionoo.torproject.org/details', {
        query: {
          search: ip,
          fields: 'nickname,fingerprint,or_addresses,exit_addresses,flags,running,first_seen,last_seen,country,as,as_name,contact'
        }
      })
      return buildTorOutput(ip, matchRelays(ip, res.relays ?? []), null, ctx.lang)
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.log(`Onionoo en échec : ${e instanceof Error ? e.message : e}`)
    }
    let list: string
    try {
      list = await ctx.fetchText('https://check.torproject.org/torbulkexitlist')
    } catch (e) {
      throw new ModuleError(`Services Tor injoignables : ${e instanceof Error ? e.message : e}`, 'unavailable')
    }
    const exits = new Set(list.split('\n').map((l) => l.trim()))
    return buildTorOutput(ip, [], exits.has(ip), ctx.lang)
  }
})
