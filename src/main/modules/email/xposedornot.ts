import { defineModule, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, fetchRetry, httpFailure, readJson, requireEmail, tr } from './_lib'

interface XonBreach {
  breach?: string
  details?: string
  domain?: string
  industry?: string
  password_risk?: string
  verified?: string
  xposed_data?: string
  xposed_date?: string
  xposed_records?: number
  added?: string
}

export interface XonResponse {
  ExposedBreaches?: { breaches_details?: XonBreach[] } | null
  PastesSummary?: { cnt?: number } | null
  BreachMetrics?: { risk?: Array<{ risk_label?: string; risk_score?: number }> } | null
  Error?: string
}

const MAX_ENTITIES = 40

export function parseXposedOrNot(json: XonResponse, lang: 'fr' | 'en'): ModuleOutput {
  const list = json.ExposedBreaches?.breaches_details ?? []
  if (!list.length) return { raw: json }
  // Les plus récentes d'abord ; la liste complète des noms reste dans `breaches`.
  const sorted = [...list].sort((a, b) =>
    `${b.xposed_date ?? ''}${b.added ?? ''}`.localeCompare(`${a.xposed_date ?? ''}${a.added ?? ''}`)
  )
  const entities: OutEntity[] = sorted
    .filter((b) => b.breach)
    .slice(0, MAX_ENTITIES)
    .map((b) => ({
      type: 'breach',
      label: b.breach!,
      data: compact({
        breach_date: b.xposed_date,
        records: b.xposed_records,
        data_classes: (b.xposed_data ?? '').split(';').map((s) => s.trim()).filter(Boolean),
        description: b.details,
        domain: b.domain,
        industry: b.industry,
        password_risk: b.password_risk,
        verified: b.verified ? b.verified === 'Yes' : undefined
      }),
      linkLabel: tr({ lang }, 'exposé dans', 'exposed in')
    }))
  const risk = json.BreachMetrics?.risk?.[0]
  return {
    properties: compact({
      breaches: list.map((b) => b.breach ?? '').filter(Boolean),
      breach_count: list.length,
      breach_risk: risk?.risk_label ? `${risk.risk_label} (${risk.risk_score ?? '?'})` : undefined,
      pastes: json.PastesSummary?.cnt || undefined
    }),
    entities,
    raw: { count: list.length, breaches: sorted.map((b) => `${b.breach} (${b.xposed_date ?? '?'})`), risk }
  }
}

export default defineModule({
  id: 'email.xposedornot',
  name: { fr: 'Fuites de données (XposedOrNot)', en: 'Data breaches (XposedOrNot)' },
  description: {
    fr: "Fuites de données publiques contenant l'adresse (XposedOrNot, gratuit, sans clé) : nom de la fuite, année, volume et types de données exposées.",
    en: 'Public data breaches containing the address (XposedOrNot, free, no key): breach name, year, size and exposed data types.'
  },
  category: 'email',
  inputTypes: ['email'],
  homepage: 'https://xposedornot.com',
  async run(input, ctx) {
    const email = requireEmail(input)
    const res = await fetchRetry(ctx, 'https://api.xposedornot.com/v1/breach-analytics', {
      query: { email },
      headers: { accept: 'application/json' }
    })
    if (res.status === 404) return {}
    if (!res.ok) throw httpFailure('XposedOrNot', res.status)
    return parseXposedOrNot(await readJson<XonResponse>(res, 'XposedOrNot'), ctx.lang)
  }
})
