import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, isDomain, MAX_LIST_ENTITIES, MAX_LIST_PROPERTY, serviceError, uniq } from '../domain/_util'

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

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }

/** « Feb 2025 » vers « 2025-02 ». */
const monthIso = (s: string): string | undefined => {
  const m = s.trim().match(/^([A-Z][a-z]{2})\s+(\d{4})$/)
  return m && MONTHS[m[1]] ? `${m[2]}-${MONTHS[m[1]]}` : undefined
}

export interface BuiltWithDomain {
  domain: string
  first?: string
  last?: string
}

/** Page publique BuiltWith « relationships/tag » : domaines où l'identifiant a été vu, avec les dates. */
export function parseBuiltWith(html: string): BuiltWithDomain[] {
  const out: BuiltWithDomain[] = []
  const re = /<td><a href="\/relationships\/([^"]+)">[^<]*<\/a><\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g
  for (const m of html.matchAll(re)) {
    const domain = m[1].trim().toLowerCase()
    if (isDomain(domain) && !out.some((d) => d.domain === domain)) out.push({ domain, first: monthIso(m[2]), last: monthIso(m[3]) })
  }
  return out
}

export function buildTrackerOutput(
  id: string,
  kind: string | null,
  account: string | null,
  domains: string[] | null,
  lang: 'fr' | 'en',
  builtwith: BuiltWithDomain[] | null = null
): ModuleOutput {
  const fr = lang === 'fr'
  const dated = new Map((builtwith ?? []).map((d) => [d.domain, d]))
  const all = uniq([...(domains ?? []), ...(builtwith ?? []).map((d) => d.domain)])
  const known = domains !== null || builtwith !== null
  const entities: OutEntity[] = all.slice(0, MAX_LIST_ENTITIES).map((d) => ({
    type: 'domain',
    label: d,
    ...(dated.get(d)?.first || dated.get(d)?.last ? { data: compact({ first_seen: dated.get(d)?.first ?? null, last_seen: dated.get(d)?.last ?? null }) } : {}),
    linkLabel: fr ? 'même identifiant' : 'same tracker ID'
  }))
  return {
    properties: compact({
      kind,
      account_id: account,
      shared_domains_count: known ? all.length : null,
      shared_domains: all.slice(0, MAX_LIST_PROPERTY)
    }),
    entities,
    // Recherche dans le code source des pages : réservée aux comptes, donc à la main.
    manual: [
      {
        label: 'PublicWWW',
        url: `https://publicwww.com/websites/%22${encodeURIComponent(id)}%22/`,
        hint: fr ? 'Pages dont le code source contient l’identifiant (vérification du navigateur).' : 'Pages whose source code contains the ID (browser check).'
      }
    ],
    raw: { id, hackertarget: domains?.slice(0, 500), builtwith: builtwith?.slice(0, 500) }
  }
}

async function builtWith(ctx: ModuleContext, tag: string): Promise<BuiltWithDomain[] | null> {
  try {
    const res = await ctx.fetch(`https://builtwith.com/relationships/tag/${encodeURIComponent(tag)}`, { timeoutMs: 20000 })
    const html = await res.text()
    if (!res.ok || !/Connected Domains|Usage and History/.test(html)) throw new Error(`HTTP ${res.status}`)
    return parseBuiltWith(html)
  } catch (e) {
    ctx.log(`BuiltWith : ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export default defineModule({
  id: 'tracker.lookup',
  name: { fr: 'Recherche inversée du traceur', en: 'Tracker reverse lookup' },
  description: {
    fr: 'Autres sites qui utilisent le même identifiant Google Analytics, GA4, Tag Manager ou AdSense (HackerTarget et BuiltWith, avec les dates de première et dernière détection). Un identifiant partagé indique souvent un même propriétaire. La recherche dans le code source (PublicWWW) est proposée dans « À vérifier ».',
    en: 'Other sites using the same Google Analytics, GA4, Tag Manager or AdSense ID (HackerTarget and BuiltWith, with first and last detection dates). A shared ID often indicates the same owner. The source code search (PublicWWW) is listed in "To review".'
  },
  category: 'web',
  inputTypes: ['tracker'],
  homepage: 'https://builtwith.com/',
  async run(input, ctx) {
    const t = normalizeTracker(input.label)
    if (!t) throw new ModuleError('Identifiant de traçage invalide', 'invalid_input')
    let domains: string[] | null = null
    let failure: ModuleError | null = null
    const google = /^(UA-|G-|GTM-|ca-pub-)/.test(t.id)
    // HackerTarget ne connaît que les identifiants Google (UA, GA4, GTM, AdSense).
    if (google) {
      try {
        // AdSense s'interroge sous la forme « pub-… ».
        const q = t.id.startsWith('ca-pub-') ? t.id.slice(3) : t.id
        const text = await ctx.fetchText('https://api.hackertarget.com/analyticslookup/', { query: { q } })
        domains = parseAnalyticsLookup(text)
      } catch (e) {
        failure = e instanceof ModuleError ? e : serviceError(e, 'HackerTarget')
      }
    }
    // BuiltWith range Universal Analytics par compte (UA-123456) et AdSense sous la forme « ca-pub-… ».
    const builtwith = google ? await builtWith(ctx, t.id.startsWith('UA-') ? (t.account ?? t.id) : t.id) : null
    // Aucune des deux sources n'a répondu : l'erreur de HackerTarget est la plus parlante.
    if (failure && !builtwith) throw failure
    const kind = t.kind ?? (typeof input.data.kind === 'string' ? input.data.kind : null)
    return buildTrackerOutput(t.id, kind, t.account, domains, ctx.lang, builtwith)
  }
})
