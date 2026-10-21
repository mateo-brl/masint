import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { isDomain, normalizeDomain, serviceError, sleep } from './_util'

const MAX_ENTITIES = 50
const MAX_LISTED = 1000

export interface CrtShRow {
  name_value?: string
  common_name?: string
  not_before?: string
  not_after?: string
  issuer_name?: string
}

export interface CertSpotterIssuance {
  id: string
  dns_names?: string[]
  not_before?: string
  not_after?: string
}

/** Garde les noms appartenant au domaine, sans joker ni doublon. */
export function cleanSubdomains(domain: string, names: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const raw of names) {
    const n = raw.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    if (!n || n === domain || n.includes('*') || n.includes(' ') || n.includes('@')) continue
    if (n.endsWith('.' + domain) && isDomain(n)) out.add(n)
  }
  return Array.from(out).sort(bySignificance)
}

/** Tri : les noms courts (moins profonds) d'abord, puis par ordre alphabétique. */
function bySignificance(a: string, b: string): number {
  return a.split('.').length - b.split('.').length || a.localeCompare(b)
}

export function parseCrtSh(domain: string, rows: CrtShRow[]): string[] {
  return cleanSubdomains(
    domain,
    rows.flatMap((r) => [...(r.name_value ?? '').split('\n'), r.common_name ?? ''])
  )
}

export function parseCertSpotter(domain: string, rows: CertSpotterIssuance[]): string[] {
  return cleanSubdomains(
    domain,
    rows.flatMap((r) => r.dns_names ?? [])
  )
}

/** Réponse texte de HackerTarget : `hôte,ip` par ligne. */
export function parseHackerTarget(domain: string, text: string): { names: string[]; ips: Record<string, string> } {
  if (/^error|api count exceeded|no records found/i.test(text.trim())) return { names: [], ips: {} }
  const ips: Record<string, string> = {}
  const names: string[] = []
  for (const line of text.split('\n')) {
    const [host, ip] = line.trim().split(',')
    if (!host) continue
    names.push(host)
    if (ip) ips[host.toLowerCase()] = ip
  }
  return { names: cleanSubdomains(domain, names), ips }
}

async function fromCrtSh(ctx: ModuleContext, domain: string): Promise<string[]> {
  let last: unknown
  // crt.sh renvoie souvent 502/503 sous charge : quelques essais espacés.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = await ctx.fetchJson<CrtShRow[]>('https://crt.sh/', {
        query: { q: `%.${domain}`, output: 'json' },
        timeoutMs: 45000
      })
      return parseCrtSh(domain, rows)
    } catch (e) {
      last = e
      const status = (e as { status?: number }).status
      if (status && status < 500) break
      if (attempt < 2) await sleep(1500 * (attempt + 1), ctx.signal)
    }
  }
  throw serviceError(last, 'crt.sh')
}

async function fromCertSpotter(ctx: ModuleContext, domain: string): Promise<string[]> {
  const rows: CertSpotterIssuance[] = []
  let after: string | undefined
  for (let page = 0; page < 5; page++) {
    const batch = await ctx.fetchJson<CertSpotterIssuance[]>('https://api.certspotter.com/v1/issuances', {
      query: { domain, include_subdomains: 'true', expand: 'dns_names', after }
    })
    rows.push(...batch)
    if (batch.length < 100) break
    after = batch[batch.length - 1].id
  }
  return parseCertSpotter(domain, rows)
}

async function fromHackerTarget(ctx: ModuleContext, domain: string) {
  const text = await ctx.fetchText('https://api.hackertarget.com/hostsearch/', { query: { q: domain } })
  if (/api count exceeded/i.test(text)) throw new ModuleError('HackerTarget : quota quotidien dépassé', 'rate_limited')
  return parseHackerTarget(domain, text)
}

export function buildSubdomainOutput(
  names: string[],
  source: string,
  lang: 'fr' | 'en',
  ips: Record<string, string> = {}
): ModuleOutput {
  if (!names.length) return {}
  const entities: OutEntity[] = names.slice(0, MAX_ENTITIES).map((n) => ({
    type: 'domain',
    label: n,
    data: ips[n] ? { a: [ips[n]] } : undefined,
    linkLabel: lang === 'fr' ? 'sous-domaine' : 'subdomain'
  }))
  return {
    properties: {
      subdomain_count: names.length,
      subdomains: names.slice(0, MAX_LISTED),
      subdomain_source: source
    },
    entities,
    raw: { source, count: names.length, names: names.slice(0, MAX_LISTED) }
  }
}

export default defineModule({
  id: 'domain.subdomains',
  name: { fr: 'Sous-domaines', en: 'Subdomains' },
  description: {
    fr: 'Sous-domaines connus d’après les journaux Certificate Transparency (crt.sh, repli sur Cert Spotter) puis HackerTarget. Les 50 premiers deviennent des entités, la liste complète reste dans les propriétés.',
    en: 'Known subdomains from Certificate Transparency logs (crt.sh, falling back to Cert Spotter) then HackerTarget. The first 50 become entities, the full list stays in the properties.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  homepage: 'https://crt.sh',
  timeoutMs: 120000,
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    const errors: string[] = []
    const sources: Array<[string, () => Promise<{ names: string[]; ips?: Record<string, string> }>]> = [
      ['crt.sh', async () => ({ names: await fromCrtSh(ctx, domain) })],
      ['Cert Spotter', async () => ({ names: await fromCertSpotter(ctx, domain) })],
      ['HackerTarget', () => fromHackerTarget(ctx, domain)]
    ]
    for (const [name, load] of sources) {
      try {
        const res = await load()
        if (res.names.length) return buildSubdomainOutput(res.names, name, ctx.lang, res.ips)
      } catch (e) {
        if (ctx.signal.aborted) throw e
        errors.push(`${name} : ${e instanceof Error ? e.message : e}`)
        ctx.log(`${name} en échec : ${e instanceof Error ? e.message : e}`)
      }
    }
    // Toutes les sources ont échoué : erreur ; au moins une a répondu sans résultat : résultat vide.
    if (errors.length === sources.length) throw new ModuleError(errors.join(' ; '), 'unavailable')
    return {}
  }
})
