import { defineModule, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, fetchRetry, httpFailure, readJson, requireEmail, tr } from './_lib'

interface Stealer {
  date_compromised?: string
  computer_name?: string
  operating_system?: string
  malware_path?: string
  antiviruses?: string[] | string
  ip?: string
  top_passwords?: string[]
  top_logins?: string[]
  total_user_services?: number
  total_corporate_services?: number
}

export interface CavalierResponse {
  message?: string
  stealers?: Stealer[]
  total_user_services?: number
  total_corporate_services?: number
}

const MAX_ENTITIES = 30
const known = (v?: string): string | undefined => (v && !/^not found$/i.test(v.trim()) ? v.trim() : undefined)

/** Nom de session Windows extrait du chemin du malware (`C:\Users\<nom>\...`). */
export function windowsUser(path?: string): string | undefined {
  const m = path?.match(/^[a-z]:\\(?:users|documents and settings)\\([^\\]+)\\/i)
  return m && !/^(public|default|all users)$/i.test(m[1]) ? m[1] : undefined
}

/** Repère d'un poste sans nom : date et IP masquée, sinon nombre de services. */
function unknownTag(s: Stealer, day: string): string {
  const ip = known(s.ip)
  if (ip) return `${day}, ${ip}`
  return `${day}, ${s.total_user_services ?? 0}/${s.total_corporate_services ?? 0} services`
}

export function parseCavalier(json: CavalierResponse, lang: 'fr' | 'en'): ModuleOutput {
  const stealers = json.stealers ?? []
  if (!stealers.length) return { raw: json }
  const sorted = [...stealers].sort((a, b) => String(b.date_compromised ?? '').localeCompare(String(a.date_compromised ?? '')))
  const entities: OutEntity[] = sorted.slice(0, MAX_ENTITIES).map((s) => {
    const day = s.date_compromised?.slice(0, 10) ?? '?'
    const host = known(s.computer_name)
    const avs = Array.isArray(s.antiviruses) ? s.antiviruses : s.antiviruses ? [s.antiviruses] : []
    return {
      type: 'infostealer',
      label: host ? `${host} (${day})` : `${tr({ lang }, 'Poste inconnu', 'Unknown computer')} (${unknownTag(s, day)})`,
      data: compact({
        date_compromised: s.date_compromised,
        computer_name: host,
        os: known(s.operating_system),
        malware_path: known(s.malware_path),
        windows_user: windowsUser(known(s.malware_path)),
        antiviruses: avs.filter(Boolean),
        ip: known(s.ip),
        top_logins: (s.top_logins ?? []).filter(Boolean),
        top_passwords: (s.top_passwords ?? []).filter(Boolean),
        user_services: s.total_user_services,
        corporate_services: s.total_corporate_services
      }),
      linkLabel: tr({ lang }, 'infecté par un infostealer', 'infected by an infostealer')
    }
  })
  const dates = sorted.map((s) => s.date_compromised).filter((d): d is string => !!d)
  return {
    properties: compact({
      infostealer_count: stealers.length,
      infostealer_last_date: dates[0],
      infostealer_first_date: dates[dates.length - 1]
    }),
    entities,
    raw: json
  }
}

export default defineModule({
  id: 'email.hudsonrock',
  name: { fr: 'Infostealers (Hudson Rock)', en: 'Infostealers (Hudson Rock)' },
  description: {
    fr: "Recherche l'adresse dans les journaux d'infostealers de Hudson Rock (Cavalier, gratuit) : date d'infection, nom du poste, système, chemin du malware, antivirus, identifiants masqués.",
    en: "Looks the address up in Hudson Rock's infostealer logs (Cavalier, free): infection date, computer name, OS, malware path, antivirus, masked credentials."
  },
  category: 'email',
  inputTypes: ['email'],
  homepage: 'https://www.hudsonrock.com/free-tools',
  async run(input, ctx) {
    const email = requireEmail(input)
    const res = await fetchRetry(ctx, 'https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email', {
      query: { email },
      headers: { accept: 'application/json' }
    })
    if (!res.ok) throw httpFailure('Hudson Rock', res.status)
    return parseCavalier(await readJson<CavalierResponse>(res, 'Hudson Rock'), ctx.lang)
  }
})
