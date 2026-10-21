import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, fetchRetry, httpFailure, readJson, requireEmail, tr } from './_lib'

export interface LeakcheckResponse {
  success?: boolean
  found?: number
  fields?: string[]
  sources?: Array<{ name?: string; date?: string }>
  error?: string
  message?: string
}

const MAX_ENTITIES = 40

/** Réponse de l'API publique LeakCheck (sans clé). */
export function parseLeakcheck(json: LeakcheckResponse, lang: 'fr' | 'en'): ModuleOutput {
  if (!json.success) {
    if (/not found/i.test(json.error ?? '')) return { raw: json }
    if (/limit|too many/i.test(`${json.error ?? ''} ${json.message ?? ''}`))
      throw new ModuleError('LeakCheck : quota de requêtes atteint', 'rate_limited')
    throw new ModuleError(`LeakCheck : ${json.error ?? json.message ?? 'réponse inattendue'}`, 'other')
  }
  const sources = (json.sources ?? []).filter((s) => s.name)
  const sorted = [...sources].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const entities: OutEntity[] = sorted.slice(0, MAX_ENTITIES).map((s) => ({
    type: 'breach',
    label: s.name!,
    data: compact({ breach_date: s.date || undefined }),
    linkLabel: tr({ lang }, 'exposé dans', 'exposed in')
  }))
  return {
    properties: compact({
      breaches: sources.map((s) => s.name!),
      leak_count: json.found,
      leak_fields: json.fields ?? []
    }),
    entities,
    raw: json
  }
}

export default defineModule({
  id: 'email.leakcheck',
  name: { fr: 'Fuites de données (LeakCheck)', en: 'Data breaches (LeakCheck)' },
  description: {
    fr: "Bases de données piratées contenant l'adresse, via l'API publique gratuite de LeakCheck : nom de la source, date et types de champs exposés (mots de passe, téléphone, adresse...).",
    en: "Leaked databases containing the address, via LeakCheck's free public API: source name, date and exposed field types (passwords, phone, address...)."
  },
  category: 'email',
  inputTypes: ['email'],
  homepage: 'https://leakcheck.io',
  async run(input, ctx) {
    const email = requireEmail(input)
    const res = await fetchRetry(ctx, 'https://leakcheck.io/api/public', { query: { check: email } }, { retries: 2 })
    if (!res.ok && res.status !== 400 && res.status !== 404) throw httpFailure('LeakCheck', res.status)
    return parseLeakcheck(await readJson<LeakcheckResponse>(res, 'LeakCheck'), ctx.lang)
  }
})
