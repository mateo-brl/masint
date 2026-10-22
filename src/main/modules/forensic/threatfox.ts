// ThreatFox (abuse.ch) : indicateurs de compromission (serveurs de commande, URL de charge utile)
// rattachés à une famille de malware. Recherche par domaine, IP, URL ou empreinte de fichier.
// Clé Auth-Key gratuite, commune à MalwareBazaar et URLhaus.

import { defineModule, ModuleError, type InputEntity, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { isDomain, isIPv4, isIPv6, MAX_LIST_ENTITIES, normalizeDomain, normalizeHost } from '../domain/_util'
import { compact, tr, uniq } from '../misc/_util'
import { ABUSECH_KEY, abusechDate, abusechPost } from './_abusech'
import { algorithmOf, hashValue } from './_hash'

const API = 'https://threatfox-api.abuse.ch/api/v1/'
const MAX_FAMILIES = 5
const MAX_TAGS = 30
/** En dessous, l'attribution à une famille reste une hypothèse (niveau de confiance ThreatFox, en %). */
const MIN_CONFIDENCE = 50

export interface TfIoc {
  id?: string
  ioc?: string
  threat_type?: string
  ioc_type?: string
  malware?: string
  malware_printable?: string
  malware_alias?: string | null
  malware_malpedia?: string | null
  confidence_level?: number
  first_seen?: string | null
  last_seen?: string | null
  reporter?: string
  tags?: string[] | null
}

export interface TfResponse {
  query_status: string
  /** Liste d'IOC, ou message texte quand rien n'est trouvé. */
  data?: TfIoc[] | string | null
}

/** Hôte d'un IOC (`1.2.3.4:443`, `exemple.com`, `http://exemple.com/x`), `null` pour une empreinte. */
export function iocHost(ioc: TfIoc): string | null {
  const v = (ioc.ioc ?? '').trim()
  if (!v) return null
  if (ioc.ioc_type === 'url') {
    try {
      return new URL(v).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    } catch {
      return null
    }
  }
  if (ioc.ioc_type === 'ip:port') return normalizeHost(v.replace(/^\[([^\]]+)\](:\d+)?$/, '$1').replace(/^([^:]+):\d+$/, '$1'))
  if (ioc.ioc_type === 'domain') return v.toLowerCase()
  return null
}

/**
 * IOC qui concernent vraiment l'entrée : la recherche ThreatFox est approximative par défaut
 * (`1.2.3.4` trouve aussi `1.2.3.45:80`, `exemple.com` trouve `faux-exemple.com`).
 */
export function matchesInput(ioc: TfIoc, type: string, value: string): boolean {
  if (type === 'hash' || type === 'url') return true
  const host = iocHost(ioc)
  if (!host) return false
  if (type === 'ip') return host === value
  return host === value || host.endsWith(`.${value}`)
}

interface Family {
  name: string
  count: number
  confidence: number
  malpedia: string | null
  aliases: string | null
}

export function parseThreatFox(ctx: Pick<ModuleContext, 'lang'>, d: TfResponse, input: { type: string; value: string }): ModuleOutput {
  if (d.query_status === 'no_result' || d.query_status === 'no_results') return {}
  if (/illegal|invalid/.test(d.query_status)) throw new ModuleError(`ThreatFox : recherche refusée (${d.query_status})`, 'invalid_input')
  if (/auth/.test(d.query_status)) throw new ModuleError('ThreatFox : clé API refusée', 'auth')
  if (d.query_status !== 'ok') throw new ModuleError(`ThreatFox : ${d.query_status}`, 'other')
  const iocs = (Array.isArray(d.data) ? d.data : []).filter((i) => matchesInput(i, input.type, input.value))
  if (!iocs.length) return {}

  const families = new Map<string, Family>()
  for (const i of iocs) {
    const name = i.malware_printable?.trim()
    if (!name || /^unknown/i.test(name)) continue
    const f = families.get(name) ?? { name, count: 0, confidence: 0, malpedia: i.malware_malpedia ?? null, aliases: i.malware_alias ?? null }
    f.count++
    f.confidence = Math.max(f.confidence, i.confidence_level ?? 0)
    families.set(name, f)
  }
  const ranked = Array.from(families.values()).sort((a, b) => b.count - a.count || b.confidence - a.confidence)
  const firsts = iocs.map((i) => abusechDate(i.first_seen)).filter((v): v is string => !!v).sort()
  const lasts = iocs.map((i) => abusechDate(i.last_seen ?? i.first_seen)).filter((v): v is string => !!v).sort()

  const entities: OutEntity[] = ranked.slice(0, MAX_FAMILIES).map((f) => ({
    type: 'malware',
    label: f.name,
    data: compact({ family: f.name, aliases: f.aliases, malpedia: f.malpedia, confidence: f.confidence }) as Record<string, PropValue>,
    linkLabel: tr(ctx, 'indicateur de (ThreatFox)', 'indicator of (ThreatFox)'),
    ...(f.confidence < MIN_CONFIDENCE
      ? {
          review: true,
          reviewReason: tr(ctx, `attribution ThreatFox peu sûre (confiance ${f.confidence} %)`, `uncertain ThreatFox attribution (${f.confidence}% confidence)`)
        }
      : {})
  }))

  // Autres indicateurs (URL de la charge, serveur de commande d'un échantillon) : à vérifier.
  const seen = new Set<string>([input.value])
  let linked = 0
  for (const i of iocs) {
    if (linked >= MAX_LIST_ENTITIES) break
    const host = iocHost(i)
    const type = i.ioc_type === 'url' ? 'url' : i.ioc_type === 'domain' ? 'domain' : i.ioc_type === 'ip:port' ? 'ip' : null
    const label = type === 'url' ? i.ioc!.trim() : host
    if (!type || !label || seen.has(label)) continue
    seen.add(label)
    linked++
    const family = i.malware_printable ? ` ${i.malware_printable}` : ''
    entities.push({
      type,
      label,
      data: compact({ threat_type: i.threat_type ?? null, confidence: i.confidence_level ?? null, first_seen: abusechDate(i.first_seen) }) as Record<string, PropValue>,
      linkLabel: tr(ctx, 'IOC associé (ThreatFox)', 'related IOC (ThreatFox)'),
      review: true,
      reviewReason: tr(
        ctx,
        `indicateur ThreatFox${family} (${i.threat_type ?? 'menace'}) : vérifier le lien avec la cible`,
        `ThreatFox indicator${family} (${i.threat_type ?? 'threat'}): check the link with the target`
      )
    })
  }

  const properties = compact({
    threatfox_iocs: iocs.length,
    threatfox_malware: ranked.map((f) => f.name),
    threatfox_threat_types: uniq(iocs.map((i) => i.threat_type ?? '').filter(Boolean)),
    threatfox_confidence: Math.max(...iocs.map((i) => i.confidence_level ?? 0)) || null,
    threatfox_first_seen: firsts[0] ?? null,
    threatfox_last_seen: lasts[lasts.length - 1] ?? null,
    threatfox_tags: uniq(iocs.flatMap((i) => i.tags ?? []).filter(Boolean)).slice(0, MAX_TAGS),
    threatfox_link:
      input.type === 'hash' ? null : `https://threatfox.abuse.ch/browse.php?search=ioc%3A${encodeURIComponent(input.value)}`
  }) as Record<string, PropValue>
  return { properties, entities, raw: iocs.slice(0, 100) }
}

/** Valeur recherchée et requête ThreatFox selon le type d'entité. */
export function threatFoxQuery(input: InputEntity): { value: string; body: Record<string, unknown> } | null {
  switch (input.type) {
    case 'ip': {
      const ip = normalizeHost(input.label)
      return isIPv4(ip) || isIPv6(ip) ? { value: ip, body: { query: 'search_ioc', search_term: ip } } : null
    }
    case 'domain': {
      const domain = normalizeDomain(input.label)
      return isDomain(domain) ? { value: domain, body: { query: 'search_ioc', search_term: domain } } : null
    }
    case 'url': {
      const url = input.label.trim()
      return /^https?:\/\/\S+$/i.test(url) ? { value: url, body: { query: 'search_ioc', search_term: url, exact_match: true } } : null
    }
    case 'hash': {
      const algo = algorithmOf(input)
      return algo === 'MD5' || algo === 'SHA-256' ? { value: hashValue(input), body: { query: 'search_hash', hash: hashValue(input) } } : null
    }
  }
  return null
}

export default defineModule({
  id: 'forensic.threatfox',
  name: { fr: 'Indicateurs de compromission (ThreatFox)', en: 'Indicators of compromise (ThreatFox)' },
  description: {
    fr: 'Recherche le domaine, l’IP, l’URL ou l’empreinte (MD5, SHA-256) dans ThreatFox (abuse.ch) : familles de malware reliées, types de menace (serveur de commande, diffusion), niveau de confiance, dates et étiquettes. Les autres indicateurs liés sont proposés dans « À vérifier ».',
    en: 'Looks the domain, IP, URL or hash (MD5, SHA-256) up in ThreatFox (abuse.ch): linked malware families, threat types (command and control, distribution), confidence level, dates and tags. Other related indicators are listed in "To review".'
  },
  category: 'forensic',
  inputTypes: ['domain', 'ip', 'url', 'hash'],
  keys: [ABUSECH_KEY],
  homepage: 'https://threatfox.abuse.ch',
  experimental: true,
  accepts: (input) => input.type !== 'hash' || ['MD5', 'SHA-256'].includes(algorithmOf(input) ?? ''),
  async run(input, ctx) {
    const q = threatFoxQuery(input)
    if (!q) throw new ModuleError('Valeur non reconnue pour ThreatFox', 'invalid_input')
    const d = await abusechPost<TfResponse>(ctx, 'ThreatFox', API, { json: q.body })
    return parseThreatFox(ctx, d, { type: input.type, value: q.value })
  }
})
