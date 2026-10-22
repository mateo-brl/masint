import { defineModule, ModuleError, type HttpError, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { sharedInfrastructure, sharedLabel } from '../domain/_hosting'
import { cappedList, compact, isDomain, isIPv4, isIPv6, MAX_LIST_ENTITIES, normalizeHost, serviceError, uniq } from '../domain/_util'

/** À partir de ce nombre de domaines sur une IP, elle est considérée comme mutualisée. */
export const SHARED_HOSTING_MIN = 100

/** Taille de page maximale de l'API de ip.thc.org. */
const THC_LIMIT = 200

/** Réponse JSON de ip.thc.org (`POST /api/v1/lookup`). */
export interface ThcLookup {
  processed_ip_address?: string
  matching_records?: number
  /** Vrai quand le service n'a pas pu compter (IPv6 notamment) : `matching_records` n'a alors pas de sens. */
  count_unavailable?: boolean
  domains?: Array<{ domain?: string; apex_domain?: string }> | null
  next_page_state?: string
}

/**
 * Domaines de la première page de ip.thc.org, sans doublons, et total. Le service garde un
 * enregistrement par domaine et par extension vue : sur une seule page on compte les domaines
 * distincts ; au-delà, `matching_records` (des enregistrements) donne l'ordre de grandeur.
 */
export function parseThc(d: ThcLookup | null): { domains: string[]; total: number } {
  const domains = uniq(
    (d?.domains ?? []).map((x) => (x.domain ?? '').trim().toLowerCase().replace(/\.$/, '')).filter(isDomain)
  )
  const more = !!d?.next_page_state && !d.count_unavailable
  return { domains, total: more ? Math.max(d?.matching_records ?? 0, domains.length) : domains.length }
}

/**
 * Domaines vus sur l'IP et total connu. `hint` : ASN / organisation de l'IP déjà connus, pour
 * reconnaître un CDN.
 */
export function buildReverseIpOutput(
  domains: string[],
  total: number,
  lang: 'fr' | 'en',
  ip?: string,
  hint: { asn?: unknown; org?: unknown } = {},
  source?: string
): ModuleOutput {
  if (!domains.length) return {}
  // IP de CDN ou résolveur public : les domaines co-hébergés n'ont pas de lien avec la cible.
  const shared = ip ? sharedInfrastructure(ip, hint) : null
  // Hébergement mutualisé (proxy d'Infomaniak, cluster OVH...) : des centaines de clients sans lien entre
  // eux. Les premiers domaines attendent dans « À vérifier » au lieu d'entrer dans le graphe.
  const fr = lang === 'fr'
  const count = Math.max(total, domains.length)
  const mutualized = !shared && count >= SHARED_HOSTING_MIN
  return {
    properties: compact({
      ...cappedList('hosted_domains', domains),
      hosted_domains_count: count,
      hosted_domains_source: source ?? null,
      shared_infrastructure: shared
        ? sharedLabel(shared, lang)
        : mutualized
          ? fr
            ? `hébergement mutualisé (${count} domaines)`
            : `shared hosting (${count} domains)`
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
                  ? `IP partagée par ${count} domaines (hébergement mutualisé) : lien avec la cible non établi`
                  : `IP shared by ${count} domains (shared hosting): no proven link with the target`
              }
            : {})
        })),
    raw: { source, count, domains: domains.slice(0, 1000) }
  }
}

/**
 * Réponse texte de HackerTarget : un domaine par ligne, ou un message d'erreur.
 * `hint` : ASN / organisation de l'IP déjà connus, pour reconnaître un CDN.
 */
export function parseReverseIp(text: string, lang: 'fr' | 'en', ip?: string, hint: { asn?: unknown; org?: unknown } = {}): ModuleOutput {
  const t = text.trim()
  if (/api count exceeded/i.test(t)) throw new ModuleError('HackerTarget : quota quotidien dépassé', 'rate_limited')
  if (!t || /^error|no (dns a )?records found/i.test(t)) return {}
  const domains = uniq(t.split('\n').map((l) => l.trim().toLowerCase()).filter(isDomain))
  return buildReverseIpOutput(domains, domains.length, lang, ip, hint, 'HackerTarget')
}

/** ip.thc.org : gratuit, sans clé, 250 requêtes d'avance puis une toutes les deux secondes. */
async function thc(ctx: ModuleContext, ip: string): Promise<ThcLookup | null> {
  try {
    return await ctx.fetchJson<ThcLookup>('https://ip.thc.org/api/v1/lookup', {
      method: 'POST',
      json: { ip_address: ip, limit: THC_LIMIT },
      headers: { accept: 'application/json' },
      timeoutMs: 30000
    })
  } catch (e) {
    // 404 : aucun domaine connu pour cette adresse.
    if ((e as Partial<HttpError>)?.status === 404) return null
    throw serviceError(e, 'ip.thc.org')
  }
}

export default defineModule({
  id: 'ip.reverse_ip',
  name: { fr: 'Domaines sur la même IP', en: 'Domains on the same IP' },
  description: {
    fr: 'Domaines dont le DNS pointe vers cette IP, d’après ip.thc.org (gratuit, sans clé), avec HackerTarget en repli (IPv4, quota quotidien partagé). 10 premiers en entités, à vérifier à partir de 100 domaines (hébergement mutualisé), aucun pour une IP de CDN ou de DNS public (sans lien avec la cible).',
    en: 'Domains whose DNS points to this IP, from ip.thc.org (free, no key), falling back to HackerTarget (IPv4, shared daily quota). First 10 as entities, left for review from 100 domains on (shared hosting), none for a CDN or public DNS IP (unrelated to the target).'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://ip.thc.org',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    const hint = { asn: input.data.asn, org: input.data.org ?? input.data.isp }
    let thcError: ModuleError | null = null
    try {
      const { domains, total } = parseThc(await thc(ctx, ip))
      return buildReverseIpOutput(domains, total, ctx.lang, ip, hint, 'ip.thc.org')
    } catch (e) {
      if (ctx.signal.aborted) throw e
      thcError = e instanceof ModuleError ? e : serviceError(e, 'ip.thc.org')
      ctx.log(`${thcError.message} : repli sur HackerTarget`)
    }
    // Repli : HackerTarget ne connaît que l'IPv4 et son quota gratuit est partagé avec d'autres modules.
    if (!isIPv4(ip)) throw thcError
    let text: string
    try {
      text = await ctx.fetchText('https://api.hackertarget.com/reverseiplookup/', { query: { q: ip } })
    } catch (e) {
      throw serviceError(e, 'HackerTarget')
    }
    return parseReverseIp(text, ctx.lang, ip, hint)
  }
})
