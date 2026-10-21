import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, isDomain, MAX_LIST_ENTITIES, MAX_LIST_PROPERTY, serviceError } from '../domain/_util'

/** Normalise un identifiant de traçage et en déduit le service. */
export function normalizeTracker(raw: string): { id: string; kind: string | null; account: string | null } | null {
  const s = raw.trim()
  let m: RegExpMatchArray | null
  if ((m = s.match(/^UA-(\d{4,10})-(\d{1,4})$/i))) return { id: `UA-${m[1]}-${m[2]}`, kind: 'Google Analytics (UA)', account: `UA-${m[1]}` }
  if ((m = s.match(/^UA-(\d{4,10})$/i))) return { id: `UA-${m[1]}`, kind: 'Google Analytics (UA)', account: `UA-${m[1]}` }
  if ((m = s.match(/^G-([A-Z0-9]{6,12})$/i))) return { id: `G-${m[1].toUpperCase()}`, kind: 'Google Analytics 4', account: null }
  if ((m = s.match(/^GTM-([A-Z0-9]{4,9})$/i))) return { id: `GTM-${m[1].toUpperCase()}`, kind: 'Google Tag Manager', account: null }
  if ((m = s.match(/^AW-(\d{9,11})$/i))) return { id: `AW-${m[1]}`, kind: 'Google Ads', account: null }
  if ((m = s.match(/^(?:ca-)?pub-(\d{10,20})$/i))) return { id: `ca-pub-${m[1]}`, kind: 'Google AdSense', account: `pub-${m[1]}` }
  if (/^[\w.#:-]{4,64}$/.test(s)) return { id: s, kind: null, account: null }
  return null
}

/** Réponse texte de HackerTarget : `domaine<TAB>type` par ligne. */
export function parseAnalyticsLookup(text: string): string[] {
  const t = text.trim()
  if (/api count exceeded/i.test(t)) throw new ModuleError('HackerTarget : quota quotidien dépassé', 'rate_limited')
  if (!t || /^(error|no results found)/i.test(t)) return []
  return Array.from(new Set(t.split('\n').map((l) => l.split(/[\t,]/)[0].trim().toLowerCase()).filter(isDomain)))
}

export function buildTrackerOutput(id: string, kind: string | null, account: string | null, domains: string[] | null, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const q = encodeURIComponent(id)
  const searches: Array<[string, string]> = [
    ['PublicWWW', `https://publicwww.com/websites/%22${q}%22/`],
    ['BuiltWith', `https://builtwith.com/relationships/tag/${encodeURIComponent(account ?? id)}`],
    ['DNSlytics', `https://search.dnslytics.com/search?q=${q}&d=domains`],
    ['Google', `https://www.google.com/search?q=%22${q}%22`]
  ]
  const entities: OutEntity[] = [
    ...(domains ?? []).slice(0, MAX_LIST_ENTITIES).map((d) => ({
      type: 'domain',
      label: d,
      linkLabel: fr ? 'même identifiant' : 'same tracker ID'
    })),
    ...searches.map(([engine, url]) => ({
      type: 'search_link',
      label: `${engine} ${id}`,
      data: { url, engine },
      linkLabel: fr ? 'recherche inversée' : 'reverse search'
    }))
  ]
  return {
    properties: compact({
      kind,
      account_id: account,
      shared_domains_count: domains?.length ?? null,
      shared_domains: domains?.slice(0, MAX_LIST_PROPERTY) ?? []
    }),
    entities,
    raw: { id, domains: domains?.slice(0, 500) }
  }
}

export default defineModule({
  id: 'tracker.lookup',
  name: { fr: 'Recherche inversée du traceur', en: 'Tracker reverse lookup' },
  description: {
    fr: 'Autres sites qui utilisent le même identifiant Google Analytics, GA4, Tag Manager ou AdSense (HackerTarget), et liens de recherche inversée (PublicWWW, BuiltWith, DNSlytics). Un identifiant partagé indique souvent un même propriétaire.',
    en: 'Other sites using the same Google Analytics, GA4, Tag Manager or AdSense ID (HackerTarget), and reverse search links (PublicWWW, BuiltWith, DNSlytics). A shared ID often indicates the same owner.'
  },
  category: 'web',
  inputTypes: ['tracker'],
  homepage: 'https://hackertarget.com/reverse-analytics-search/',
  async run(input, ctx) {
    const t = normalizeTracker(input.label)
    if (!t) throw new ModuleError('Identifiant de traçage invalide', 'invalid_input')
    let domains: string[] | null = null
    // HackerTarget ne connaît que les identifiants Google (UA, GA4, GTM, AdSense).
    if (/^(UA-|G-|GTM-|ca-pub-)/.test(t.id)) {
      try {
        // AdSense s'interroge sous la forme « pub-… ».
        const q = t.id.startsWith('ca-pub-') ? t.id.slice(3) : t.id
        const text = await ctx.fetchText('https://api.hackertarget.com/analyticslookup/', { query: { q } })
        domains = parseAnalyticsLookup(text)
      } catch (e) {
        if (e instanceof ModuleError) throw e
        throw serviceError(e, 'HackerTarget')
      }
    }
    const kind = t.kind ?? (typeof input.data.kind === 'string' ? input.data.kind : null)
    return buildTrackerOutput(t.id, kind, t.account, domains, ctx.lang)
  }
})
