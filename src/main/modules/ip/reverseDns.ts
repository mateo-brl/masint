import { defineModule, ModuleError, type ModuleOutput } from '@shared/modules'
import { isIPv4, isIPv6, normalizeHost } from '../domain/_util'

/** Développe une adresse IPv6 abrégée en 8 groupes de 4 chiffres hexadécimaux. */
export function expandIPv6(ip: string): string | null {
  let addr = ip.toLowerCase()
  // Adresse terminée par une IPv4 (::ffff:1.2.3.4).
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const o = v4[1].split('.').map(Number)
    addr = addr.replace(v4[1], `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`)
  }
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => g.padStart(4, '0')).join(':')
}

/** Nom à interroger pour le PTR (`4.4.8.8.in-addr.arpa`). */
export function arpaName(ip: string): string | null {
  if (isIPv4(ip)) return ip.split('.').reverse().join('.') + '.in-addr.arpa'
  const full = expandIPv6(ip)
  if (!full) return null
  return full.replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa'
}

export function buildPtrOutput(names: string[], confirmed: Record<string, boolean>, lang: 'fr' | 'en'): ModuleOutput {
  const hosts = Array.from(new Set(names.map((n) => n.toLowerCase().replace(/\.$/, '')).filter(Boolean)))
  if (!hosts.length) return {}
  return {
    properties: {
      reverse: hosts[0],
      ...(hosts.length > 1 ? { reverse_all: hosts } : {}),
      reverse_confirmed: !!confirmed[hosts[0]]
    },
    entities: hosts.slice(0, 5).map((h) => ({
      type: 'domain',
      label: h,
      linkLabel: confirmed[h] ? (lang === 'fr' ? 'reverse DNS (confirmé)' : 'reverse DNS (confirmed)') : 'reverse DNS'
    })),
    raw: { ptr: hosts, confirmed }
  }
}

export default defineModule({
  id: 'ip.reverse_dns',
  name: { fr: 'DNS inverse (PTR)', en: 'Reverse DNS (PTR)' },
  description: {
    fr: 'Nom d’hôte associé à l’IP (enregistrement PTR), avec vérification que ce nom pointe bien vers l’IP. Révèle souvent le FAI, l’hébergeur ou le nom du serveur.',
    en: 'Hostname associated with the IP (PTR record), checking that the name resolves back to the IP. Often reveals the ISP, host or server name.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    const name = arpaName(ip)
    if (!name) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    const ptr = await ctx.resolveDns(name, 'PTR')
    const confirmed: Record<string, boolean> = {}
    const v6 = isIPv6(ip)
    await Promise.all(
      ptr.slice(0, 5).map(async (h) => {
        const host = h.toLowerCase().replace(/\.$/, '')
        const back = await ctx.resolveDns(host, v6 ? 'AAAA' : 'A').catch(() => [] as string[])
        confirmed[host] = back.some((b) => (v6 ? expandIPv6(b) === expandIPv6(ip) : b === ip))
      })
    )
    return buildPtrOutput(ptr, confirmed, ctx.lang)
  }
})
