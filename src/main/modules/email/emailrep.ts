import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { accountEntity, compact, fetchRetry, httpFailure, readJson, requireEmail, socialPlatform, tr } from './_lib'

export interface EmailRepResponse {
  email?: string
  reputation?: string
  suspicious?: boolean
  references?: number
  details?: {
    blacklisted?: boolean
    malicious_activity?: boolean
    credentials_leaked?: boolean
    data_breach?: boolean
    first_seen?: string
    last_seen?: string
    domain_exists?: boolean
    domain_reputation?: string
    new_domain?: boolean
    days_since_domain_creation?: number
    spam?: boolean
    free_provider?: boolean
    disposable?: boolean
    deliverable?: boolean
    accept_all?: boolean
    valid_mx?: boolean
    spoofable?: boolean
    spf_strict?: boolean
    dmarc_enforced?: boolean
    profiles?: string[]
  }
}

/** `MM/DD/YYYY` vers `YYYY-MM-DD` ; `never` et valeurs inconnues ignorées. */
export function usDate(v?: string): string | undefined {
  const m = v?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined
}

export function parseEmailRep(json: EmailRepResponse, email: string, lang: 'fr' | 'en'): ModuleOutput {
  const d = json.details ?? {}
  const entities: OutEntity[] = []
  for (const p of d.profiles ?? []) {
    const platform = socialPlatform(p) ?? p
    entities.push(
      accountEntity(platform, p, email, { linkLabel: tr({ lang }, 'profil signalé (EmailRep)', 'profile reported (EmailRep)') })
    )
  }
  return {
    properties: compact({
      reputation: json.reputation,
      suspicious: json.suspicious,
      references: json.references,
      blacklisted: d.blacklisted,
      malicious_activity: d.malicious_activity,
      credentials_leaked: d.credentials_leaked,
      data_breach: d.data_breach,
      first_seen: usDate(d.first_seen),
      last_seen: usDate(d.last_seen),
      domain_reputation: d.domain_reputation,
      disposable: d.disposable,
      deliverable: d.deliverable,
      accept_all: d.accept_all,
      valid_mx: d.valid_mx,
      spoofable: d.spoofable
    }),
    entities,
    raw: json
  }
}

export default defineModule({
  id: 'email.emailrep',
  name: { fr: 'Réputation (EmailRep)', en: 'Reputation (EmailRep)' },
  description: {
    fr: "Réputation de l'adresse selon EmailRep : ancienneté (première et dernière apparition), fuites, activité malveillante, délivrabilité et profils en ligne détectés. Clé requise (le service n'en délivre plus de nouvelles).",
    en: 'Address reputation from EmailRep: age (first and last seen), leaks, malicious activity, deliverability and detected online profiles. Key required (the service no longer issues new keys).'
  },
  category: 'email',
  inputTypes: ['email'],
  keys: [{ id: 'emailrep', label: 'EmailRep API key', url: 'https://emailrep.io/key' }],
  homepage: 'https://emailrep.io',
  experimental: true,
  async run(input, ctx) {
    const email = requireEmail(input)
    const key = ctx.key('emailrep')
    if (!key) throw new ModuleError('Clé EmailRep manquante', 'auth')
    const res = await fetchRetry(ctx, `https://emailrep.io/${encodeURIComponent(email)}`, {
      headers: { key, accept: 'application/json' }
    })
    if (res.status === 401) throw new ModuleError('EmailRep : clé API refusée', 'auth')
    if (res.status === 400) throw new ModuleError('EmailRep : adresse refusée', 'invalid_input')
    if (!res.ok) throw httpFailure('EmailRep', res.status)
    return parseEmailRep(await readJson<EmailRepResponse>(res, 'EmailRep'), email, ctx.lang)
  }
})
