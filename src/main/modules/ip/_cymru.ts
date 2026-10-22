// Team Cymru IP to ASN : origine BGP d'une adresse par une simple requête DNS TXT
// (`<ip inversée>.origin.asn.cymru.com`), avec le pays, le registre et la date d'allocation du bloc.
// La requête passe par ctx.resolveDns (DNS-over-HTTPS à travers le proxy).

import type { ModuleContext } from '@shared/modules'
import { arpaName } from './reverseDns'

export interface CymruOrigin {
  asn: number
  prefix: string
  country: string | null
  registry: string | null
  /** Date d'allocation du bloc par le registre régional (`2013-04-23`). */
  allocated: string | null
}

/** Nom à interroger : `86.184.24.185.origin.asn.cymru.com` ou `...origin6.asn.cymru.com`. */
export function cymruName(ip: string): string | null {
  const arpa = arpaName(ip)
  if (!arpa) return null
  return arpa.endsWith('.in-addr.arpa') ? arpa.replace(/\.in-addr\.arpa$/, '.origin.asn.cymru.com') : arpa.replace(/\.ip6\.arpa$/, '.origin6.asn.cymru.com')
}

/**
 * Réponses `60855 | 185.24.184.0/24 | FR | ripencc | 2013-04-23` : on garde le préfixe le plus
 * précis (plusieurs préfixes annoncés peuvent couvrir l'adresse).
 */
export function parseCymruOrigin(records: string[]): CymruOrigin | null {
  const parsed = records
    .map((r) => r.replace(/"/g, '').split('|').map((f) => f.trim()))
    .filter((f) => /^\d+/.test(f[0] ?? '') && /\/\d+$/.test(f[1] ?? ''))
    .map((f) => ({
      // Plusieurs ASN d'origine possibles (« 15169 36040 ») : le premier suffit.
      asn: Number(f[0].split(/\s+/)[0]),
      prefix: f[1],
      country: f[2] || null,
      registry: f[3] || null,
      allocated: /^\d{4}-\d{2}-\d{2}$/.test(f[4] ?? '') ? f[4] : null
    }))
    .sort((a, b) => Number(b.prefix.split('/')[1]) - Number(a.prefix.split('/')[1]))
  return parsed[0] ?? null
}

/** Origine de l'adresse, ou `null` si la résolution échoue (donnée complémentaire). */
export async function cymruOrigin(ctx: ModuleContext, ip: string): Promise<CymruOrigin | null> {
  const name = cymruName(ip)
  if (!name) return null
  try {
    return parseCymruOrigin(await ctx.resolveDns(name, 'TXT'))
  } catch {
    return null
  }
}
