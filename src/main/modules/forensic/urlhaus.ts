// URLhaus (abuse.ch) : URL de diffusion de malwares observées sur un domaine ou une IP, avec leur
// statut (en ligne ou non), les dates et les étiquettes. Clé Auth-Key gratuite, commune à
// MalwareBazaar et ThreatFox.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cappedList, isDomain, isIPv4, MAX_LIST_ENTITIES, normalizeDomain, normalizeHost } from '../domain/_util'
import { compact, tr, uniq } from '../misc/_util'
import { ABUSECH_KEY, abusechDate, abusechPost } from './_abusech'

const MAX_TAGS = 30

export interface UrlhausUrl {
  id?: string
  urlhaus_reference?: string
  url?: string
  url_status?: string
  date_added?: string
  threat?: string
  reporter?: string
  larted?: string
  tags?: string[] | null
}

export interface UrlhausHost {
  query_status?: string
  /** Faute de frappe de l'exemple de la documentation, tolérée par prudence. */
  query_staus?: string
  urlhaus_reference?: string
  host?: string
  firstseen?: string | null
  url_count?: string | number
  blacklists?: { spamhaus_dbl?: string; surbl?: string }
  /** 100 URL au plus, les plus récentes. */
  urls?: UrlhausUrl[] | null
}

const listed = (v: string | undefined): string | null => (v && !/^not listed$/i.test(v) ? v : null)

export function parseUrlhausHost(ctx: Pick<ModuleContext, 'lang'>, d: UrlhausHost): ModuleOutput {
  const status = d.query_status ?? d.query_staus
  if (status === 'no_results') return {}
  if (status === 'invalid_host') throw new ModuleError('URLhaus : hôte invalide', 'invalid_input')
  if (status !== 'ok') throw new ModuleError(`URLhaus : ${status ?? 'réponse illisible'}`, 'other')
  const urls = [...(d.urls ?? [])].filter((u) => !!u.url).sort((a, b) => (b.date_added ?? '').localeCompare(a.date_added ?? ''))
  const total = Number(d.url_count) || urls.length
  const added = urls.map((u) => abusechDate(u.date_added)).filter((v): v is string => !!v).sort()
  const online = urls.filter((u) => u.url_status === 'online').length
  const properties = compact({
    ...cappedList('urlhaus_urls', urls.map((u) => u.url!)),
    urlhaus_urls_count: total,
    urlhaus_online: online,
    urlhaus_first_seen: abusechDate(d.firstseen) ?? added[0] ?? null,
    urlhaus_last_seen: added[added.length - 1] ?? null,
    urlhaus_threats: uniq(urls.map((u) => u.threat ?? '').filter(Boolean)),
    urlhaus_tags: uniq(urls.flatMap((u) => u.tags ?? []).filter(Boolean)).slice(0, MAX_TAGS),
    urlhaus_spamhaus_dbl: listed(d.blacklists?.spamhaus_dbl),
    urlhaus_surbl: listed(d.blacklists?.surbl),
    urlhaus_link: d.urlhaus_reference ?? null
  }) as Record<string, PropValue>
  // Les URL signalées n'entrent pas dans le graphe d'office : un hébergeur ou un service de partage
  // légitime en accumule beaucoup sans rapport avec la cible.
  const entities: OutEntity[] = urls.slice(0, MAX_LIST_ENTITIES).map((u) => ({
    type: 'url',
    label: u.url!,
    data: compact({
      status: u.url_status ?? null,
      threat: u.threat ?? null,
      reported_at: abusechDate(u.date_added),
      tags: u.tags ?? []
    }) as Record<string, PropValue>,
    linkLabel: tr(ctx, 'URL malveillante (URLhaus)', 'malicious URL (URLhaus)'),
    review: true,
    reviewReason: tr(
      ctx,
      `URL signalée par URLhaus (${u.threat ?? 'malware'}, ${u.url_status ?? 'statut inconnu'}) : vérifier qu’elle concerne bien la cible`,
      `URL reported by URLhaus (${u.threat ?? 'malware'}, ${u.url_status ?? 'unknown status'}): check it relates to the target`
    )
  }))
  return { properties, entities, raw: { ...d, urls: urls.slice(0, 100) } }
}

export default defineModule({
  id: 'forensic.urlhaus',
  name: { fr: 'URL malveillantes (URLhaus)', en: 'Malicious URLs (URLhaus)' },
  description: {
    fr: 'URL de diffusion de malwares observées par URLhaus (abuse.ch) sur ce domaine ou cette IP : nombre, statut en ligne, dates, menaces, étiquettes et listes noires Spamhaus DBL et SURBL. Les 10 URL les plus récentes sont proposées dans « À vérifier ».',
    en: 'Malware distribution URLs seen by URLhaus (abuse.ch) on this domain or IP: count, online status, dates, threats, tags and Spamhaus DBL and SURBL blocklists. The 10 most recent URLs are listed in "To review".'
  },
  category: 'forensic',
  inputTypes: ['domain', 'ip'],
  keys: [ABUSECH_KEY],
  homepage: 'https://urlhaus.abuse.ch',
  experimental: true,
  async run(input, ctx) {
    const host = input.type === 'ip' ? normalizeHost(input.label) : normalizeDomain(input.label)
    // URLhaus indexe les hôtes : IPv4 ou nom de domaine.
    if (input.type === 'ip' ? !isIPv4(host) : !isDomain(host)) throw new ModuleError('Domaine ou adresse IPv4 attendu', 'invalid_input')
    const d = await abusechPost<UrlhausHost>(ctx, 'URLhaus', 'https://urlhaus-api.abuse.ch/v1/host/', {
      body: new URLSearchParams({ host }).toString()
    })
    return parseUrlhausHost(ctx, d)
  }
})
