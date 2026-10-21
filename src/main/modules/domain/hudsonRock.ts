import { defineModule, ModuleError, type ModuleOutput } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { isDomain, isoDate, normalizeDomain, serviceError } from './_util'

export interface HudsonRockDomain {
  total?: number
  employees?: number
  users?: number
  third_parties?: number
  totalUrls?: number
  last_employee_compromised?: string
  last_user_compromised?: string
  data?: {
    employees_urls?: Array<{ url: string; occurrence: number }>
    clients_urls?: Array<{ url: string; occurrence: number }>
  }
  stealerFamilies?: Record<string, number>
  antiviruses?: { list?: Array<{ name: string; count: number }> }
  thirdPartyDomains?: Array<{ domain: string; occurrence: number }>
  employeePasswords?: { totalPass?: number }
}

export function parseHudsonRockDomain(domain: string, d: HudsonRockDomain, lang: 'fr' | 'en'): ModuleOutput {
  const total = d.total ?? 0
  if (!total) return {}
  const fr = lang === 'fr'
  const families = Object.entries(d.stealerFamilies ?? {})
    .filter(([k]) => k !== 'total')
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} (${n})`)
  const topUrls = (list?: Array<{ url: string; occurrence: number }>): string[] =>
    (list ?? []).slice(0, 15).map((u) => `${u.url} (${u.occurrence})`)
  const lastEmployee = isoDate(d.last_employee_compromised)
  const lastUser = isoDate(d.last_user_compromised)
  const last = [lastEmployee, lastUser].filter(Boolean).sort().pop() ?? null

  const properties: Record<string, PropValue> = {
    infostealer_total: total,
    infostealer_employees: d.employees ?? 0,
    infostealer_users: d.users ?? 0,
    infostealer_third_parties: d.third_parties ?? 0,
    infostealer_last_employee_at: lastEmployee,
    infostealer_last_user_at: lastUser,
    infostealer_families: families.slice(0, 15),
    infostealer_employee_urls: topUrls(d.data?.employees_urls),
    infostealer_user_urls: topUrls(d.data?.clients_urls)
  }
  for (const k of Object.keys(properties)) {
    const v = properties[k]
    if (v === null || (Array.isArray(v) && !v.length)) delete properties[k]
  }
  const description = fr
    ? `${d.employees ?? 0} employé(s) et ${d.users ?? 0} utilisateur(s) de ${domain} compromis par des infostealers (base Hudson Rock Cavalier).`
    : `${d.employees ?? 0} employee(s) and ${d.users ?? 0} user(s) of ${domain} compromised by infostealers (Hudson Rock Cavalier data).`
  return {
    properties,
    entities: [
      {
        type: 'breach',
        label: `Hudson Rock: infostealers ${domain}`,
        data: {
          records: total,
          breach_date: last ?? undefined,
          data_classes: families.slice(0, 10).map((f) => f.replace(/ \(\d+\)$/, '')),
          description
        } as Record<string, PropValue>,
        linkLabel: fr ? 'identifiants volés' : 'stolen credentials'
      }
    ],
    raw: { ...d, data: { employees_urls: d.data?.employees_urls?.slice(0, 30), clients_urls: d.data?.clients_urls?.slice(0, 30) } }
  }
}

export default defineModule({
  id: 'domain.hudsonrock',
  name: { fr: 'Infostealers (Hudson Rock)', en: 'Infostealers (Hudson Rock)' },
  description: {
    fr: 'Nombre d’employés et d’utilisateurs du domaine dont les identifiants ont été volés par des logiciels espions (infostealers), familles de malware et URL de connexion les plus touchées. Base gratuite Hudson Rock Cavalier.',
    en: 'Number of employees and users of the domain whose credentials were stolen by infostealer malware, malware families and most affected login URLs. Free Hudson Rock Cavalier data.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  homepage: 'https://www.hudsonrock.com/free-tools',
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    let data: HudsonRockDomain
    try {
      data = await ctx.fetchJson<HudsonRockDomain>('https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-domain', {
        query: { domain }
      })
    } catch (e) {
      throw serviceError(e, 'Hudson Rock')
    }
    return parseHudsonRockDomain(domain, data, ctx.lang)
  }
})
