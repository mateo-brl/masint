// Proton : le serveur de clés public (api.protonmail.ch/pks) publie la clé des adresses
// hébergées chez Proton, y compris sur un domaine personnel. Sur ses propres domaines
// (proton.me, pm.me...), Proton répond une clé leurre pour toute adresse, même inexistante :
// ces adresses sont exclues, la réponse n'y prouve rien.

import { ModuleError } from '@shared/modules'
import { getPlatform } from '@shared/platforms'
import { accountCheck, fetchRetry, httpFailure, splitEmail, type CheckResult } from './_lib'
import { describeKey, oldestKeyDate, parseHkpIndex } from './_pgp'

/** Domaines de Proton, où toute adresse reçoit une clé (anti-énumération). */
export const PROTON_DOMAINS = new Set([...(getPlatform('proton')?.domains ?? []), 'protonmail.ch', 'proton.ch'])

export function parseProton(text: string, email: string, lang: 'fr' | 'en' = 'fr'): Omit<CheckResult, 'raw'> {
  if (/"Code"\s*:\s*2028/.test(text)) throw new ModuleError('Proton : trop de recherches de clés, réessayez plus tard', 'rate_limited')
  const index = parseHkpIndex(text)
  if (!index) throw new ModuleError(`Proton : réponse inattendue (${text.slice(0, 60).replace(/\s+/g, ' ')})`, 'other')
  if (!index.count || !index.keys.length) return { found: false }
  const own = index.keys.filter((k) => k.uids.some((u) => u.email === email))
  if (!own.length) {
    // Domaine hébergé chez Proton avec une adresse fourre-tout : la clé est celle du catch-all,
    // l'existence de l'adresse elle-même ne peut pas être établie.
    const catchall = index.keys.flatMap((k) => k.uids.map((u) => u.email)).find((e): e is string => !!e)
    return { found: null, properties: { proton_catchall: catchall } }
  }
  return {
    found: true,
    data: {
      pgp_fingerprints: own.map((k) => k.fingerprint),
      pgp_keys: own.map((k) => describeKey(k, lang)),
      pgp_key_created_at: oldestKeyDate(own)
    }
  }
}

export default accountCheck({
  id: 'email.proton',
  service: 'Proton',
  platform: 'proton',
  name: { fr: 'Adresse hébergée chez Proton', en: 'Address hosted by Proton' },
  description: {
    fr: "Interroge le serveur de clés public de Proton : une clé publiée signale une adresse hébergée chez Proton (domaine personnel) et donne sa date de création. Les domaines de Proton (proton.me, pm.me...) sont exclus : Proton y répond une clé leurre pour toute adresse. Une adresse fourre-tout est signalée sans conclure.",
    en: "Queries Proton's public key server: a published key reveals an address hosted by Proton (custom domain) and gives its creation date. Proton's own domains (proton.me, pm.me...) are excluded: Proton answers a decoy key for any address there. A catch-all address is reported without concluding."
  },
  homepage: 'https://proton.me',
  experimental: true,
  accepts: (input) => {
    const domain = splitEmail(input.label)?.domain
    return !!domain && !PROTON_DOMAINS.has(domain)
  },
  async check(email, ctx) {
    const res = await fetchRetry(ctx, 'https://api.protonmail.ch/pks/lookup', { query: { op: 'index', search: email } })
    const text = await res.text()
    if (res.status === 422 || res.status === 429 || /"Code"\s*:\s*2028/.test(text))
      throw new ModuleError('Proton : trop de recherches de clés, réessayez plus tard', 'rate_limited')
    if (!res.ok && res.status !== 404) throw httpFailure('Proton', res.status)
    return { ...parseProton(text, email, ctx.lang), raw: text.slice(0, 2000) }
  }
})
