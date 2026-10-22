import { defineModule, ModuleError, type ModuleOutput } from '@shared/modules'
import { sharedInfrastructure, sharedLabel } from '../domain/_hosting'
import { cappedList, compact, isDomain, isIPv4, MAX_LIST_ENTITIES, normalizeHost, serviceError } from '../domain/_util'

/** À partir de ce nombre de domaines sur une IP, elle est considérée comme mutualisée. */
export const SHARED_HOSTING_MIN = 100

/**
 * Réponse texte de HackerTarget : un domaine par ligne, ou un message d'erreur.
 * `hint` : ASN / organisation de l'IP déjà connus, pour reconnaître un CDN.
 */
export function parseReverseIp(text: string, lang: 'fr' | 'en', ip?: string, hint: { asn?: unknown; org?: unknown } = {}): ModuleOutput {
  const t = text.trim()
  if (/api count exceeded/i.test(t)) throw new ModuleError('HackerTarget : quota quotidien dépassé', 'rate_limited')
  if (!t || /^error|no (dns a )?records found/i.test(t)) return {}
  const domains = Array.from(new Set(t.split('\n').map((l) => l.trim().toLowerCase()).filter(isDomain)))
  if (!domains.length) return {}
  // IP de CDN ou résolveur public : les domaines co-hébergés n'ont pas de lien avec la cible.
  const shared = ip ? sharedInfrastructure(ip, hint) : null
  // Hébergement mutualisé (proxy d'Infomaniak, cluster OVH...) : des centaines de clients sans lien entre
  // eux. Les premiers domaines attendent dans « À vérifier » au lieu d'entrer dans le graphe.
  const fr = lang === 'fr'
  const mutualized = !shared && domains.length >= SHARED_HOSTING_MIN
  return {
    properties: compact({
      ...cappedList('hosted_domains', domains),
      shared_infrastructure: shared
        ? sharedLabel(shared, lang)
        : mutualized
          ? fr
            ? `hébergement mutualisé (${domains.length} domaines)`
            : `shared hosting (${domains.length} domains)`
          : null
    }),
    entities: shared
      ? []
      : domains.slice(0, MAX_LIST_ENTITIES).map((d) => ({
          type: 'domain',
          label: d,
          linkLabel: fr ? 'hébergé sur cette IP' : 'hosted on this IP',
          ...(mutualized
            ? {
                review: true,
                reviewReason: fr
                  ? `IP partagée par ${domains.length} domaines (hébergement mutualisé) : lien avec la cible non établi`
                  : `IP shared by ${domains.length} domains (shared hosting): no proven link with the target`
              }
            : {})
        })),
    raw: { count: domains.length, domains: domains.slice(0, 1000) }
  }
}

export default defineModule({
  id: 'ip.reverse_ip',
  name: { fr: 'Domaines sur la même IP', en: 'Domains on the same IP' },
  description: {
    fr: 'Domaines dont le DNS pointe vers cette IP (hébergement mutualisé), d’après HackerTarget. 10 premiers en entités, à vérifier à partir de 100 domaines (hébergement mutualisé), aucun pour une IP de CDN ou de DNS public (sans lien avec la cible). Quota gratuit limité par jour.',
    en: 'Domains whose DNS points to this IP (shared hosting), from HackerTarget. First 10 as entities, left for review from 100 domains on (shared hosting), none for a CDN or public DNS IP (unrelated to the target). Limited free daily quota.'
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
    return parseReverseIp(text, ctx.lang, ip, { asn: input.data.asn, org: input.data.org ?? input.data.isp })
  }
})
