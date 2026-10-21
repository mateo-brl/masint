import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { VT_KEY, vtGet, vtProperties, type VtAttributes } from './_virustotal'
import { compact, isDomain, isoDate, normalizeDomain, toUrl } from './_util'

export function parseVtDomain(domain: string, a: VtAttributes | null): ModuleOutput {
  if (!a) return {}
  const entities: OutEntity[] = []
  const records = a.last_dns_records ?? []
  for (const r of records.filter((r) => r.type === 'A' || r.type === 'AAAA').slice(0, 10))
    entities.push({ type: 'ip', label: r.value, linkLabel: `${r.type} (VirusTotal)` })
  const properties = {
    ...vtProperties(a, `https://www.virustotal.com/gui/domain/${domain}`),
    ...compact({
      registrar: a.registrar ?? null,
      created_at: a.creation_date ? isoDate(a.creation_date) : null
    })
  }
  return { properties, entities, raw: { ...a, last_analysis_results: undefined, whois: a.whois?.slice(0, 5000) } }
}

/** Identifiant d'URL VirusTotal : base64url sans remplissage. */
export function vtUrlId(url: string): string {
  return Buffer.from(url).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function parseVtUrl(url: string, a: VtAttributes | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!a) return {}
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  if (a.last_final_url && a.last_final_url !== url)
    entities.push({ type: 'url', label: a.last_final_url, linkLabel: fr ? 'redirige vers' : 'redirects to' })
  return {
    properties: {
      ...vtProperties(a, `https://www.virustotal.com/gui/url/${vtUrlId(url)}`),
      ...compact({
        title: a.title ?? null,
        status_code: a.last_http_response_code ?? null,
        vt_first_submission_at: a.first_submission_date ? isoDate(a.first_submission_date) : null,
        vt_times_submitted: a.times_submitted ?? null
      })
    },
    entities,
    raw: { ...a, last_analysis_results: undefined }
  }
}

const vtDomain = defineModule({
  id: 'domain.virustotal',
  name: { fr: 'VirusTotal (domaine)', en: 'VirusTotal (domain)' },
  description: {
    fr: 'Réputation du domaine sur VirusTotal : détections des moteurs antivirus, catégories, tags, votes, derniers enregistrements DNS observés.',
    en: 'Domain reputation on VirusTotal: antivirus engine detections, categories, tags, votes, last observed DNS records.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  keys: [VT_KEY],
  homepage: 'https://www.virustotal.com',
  experimental: true,
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    return parseVtDomain(domain, await vtGet(ctx, `domains/${encodeURIComponent(domain)}`))
  }
})

const vtUrl = defineModule({
  id: 'web.virustotal',
  name: { fr: 'VirusTotal (URL)', en: 'VirusTotal (URL)' },
  description: {
    fr: 'Dernière analyse VirusTotal de l’URL : détections, catégories, titre de la page, redirection finale. Ne soumet pas l’URL si elle est inconnue.',
    en: 'Latest VirusTotal analysis of the URL: detections, categories, page title, final redirect. Does not submit unknown URLs.'
  },
  category: 'web',
  inputTypes: ['url', 'website'],
  keys: [VT_KEY],
  homepage: 'https://www.virustotal.com',
  experimental: true,
  async run(input, ctx) {
    const url = toUrl(input.label)
    return parseVtUrl(url, await vtGet(ctx, `urls/${vtUrlId(url)}`), ctx.lang)
  }
})

export const modules = [vtDomain, vtUrl]
