// Sleeper (fantasy sports) : la première étape de connexion du site interroge
// `login_context_by_email_or_phone_or_username`, qui dit si l'identifiant correspond à un
// compte et renvoie le nom affiché et les contacts masqués. Aucun code n'est envoyé : c'est
// l'envoi d'un code (create_verification_code) ou le mot de passe qui viennent ensuite.

import { ModuleError, type ModuleContext } from '@shared/modules'
import { accountCheck, fetchRetry, httpFailure, readJson } from '../email/_lib'
import { toE164 } from './_phone'

const API = 'https://api.sleeper.app/graphql'
const QUERY =
  'query login_context_by_email_or_phone_or_username($email_or_phone_or_username: String!) {\n' +
  '  login_context_by_email_or_phone_or_username(email_or_phone_or_username: $email_or_phone_or_username)\n' +
  '}'

export interface SleeperLoginContext {
  user_id?: string
  display_name?: string
  real_name?: string | null
  avatar?: string | null
  has_email?: boolean
  has_phone?: boolean
  has_password?: boolean
  has_passkeys?: boolean
  masked_email?: string | null
  masked_phone?: string | null
}

export interface SleeperResponse {
  data?: { login_context_by_email_or_phone_or_username?: SleeperLoginContext | null } | null
  errors?: Array<{ message?: string }>
}

/**
 * Compte trouvé, absent, ou réponse inattendue (erreur). Un compte sans téléphone ne peut pas
 * correspondre à un numéro : il est compté absent.
 */
export function interpretSleeper(json: SleeperResponse): { found: boolean; account?: SleeperLoginContext } {
  const account = json.data?.login_context_by_email_or_phone_or_username
  if (account && typeof account === 'object' && account.user_id) return account.has_phone === false ? { found: false } : { found: true, account }
  const message = (json.errors ?? []).map((e) => e.message ?? '').join(' ')
  if (/unable to find anyone/i.test(message)) return { found: false }
  throw new ModuleError(`Sleeper : réponse inattendue${message ? ` (${message.slice(0, 120)})` : ''}`, 'other')
}

/**
 * Avatar Sleeper (identifiant hexadécimal) ; les avatars d'équipe (`nfl_nyg`) sont ignorés. La
 * miniature est servie en `image/png`, l'image pleine taille sans type d'image.
 */
export function sleeperAvatar(id: string | null | undefined): string | undefined {
  return id && /^[0-9a-f]{32}$/i.test(id) ? `https://sleepercdn.com/avatars/thumbs/${id}` : undefined
}

export async function checkSleeper(ctx: ModuleContext, identifier: string): Promise<ReturnType<typeof interpretSleeper> & { raw: unknown }> {
  const res = await fetchRetry(ctx, API, {
    method: 'POST',
    json: { operationName: 'login_context_by_email_or_phone_or_username', variables: { email_or_phone_or_username: identifier }, query: QUERY },
    headers: { accept: 'application/json', origin: 'https://sleeper.com', referer: 'https://sleeper.com/' },
    timeoutMs: 20_000
  })
  if (!res.ok) throw httpFailure('Sleeper', res.status)
  const json = await readJson<SleeperResponse>(res, 'Sleeper')
  return { ...interpretSleeper(json), raw: json }
}

export default accountCheck({
  id: 'phone.sleeper',
  service: 'Sleeper',
  platform: 'sleeper',
  inputTypes: ['phone'],
  description: {
    fr: "Vérifie si le numéro est celui d'un compte Sleeper (fantasy sports) via la première étape de connexion, et récupère le pseudo et l'email masqué. Silencieux : aucun code n'est envoyé.",
    en: 'Checks whether the number belongs to a Sleeper (fantasy sports) account using the first sign-in step, and reads the username and masked email. Silent: no code is sent.'
  },
  homepage: 'https://sleeper.com',
  // Absence vérifiée sur des numéros non attribués ; aucun numéro inscrit connu pour confirmer le cas « trouvé ».
  experimental: true,
  async check(_value, ctx, input) {
    // Toujours en E.164 avec « + » : sans lui, l'identifiant pourrait désigner un pseudo.
    const e164 = toE164(input)
    const r = await checkSleeper(ctx, e164)
    if (!r.found || !r.account) return { found: false, raw: r.raw }
    const a = r.account
    const masked = a.masked_email ?? undefined
    return {
      found: true,
      label: a.display_name || e164,
      image: sleeperAvatar(a.avatar),
      data: {
        username: a.display_name,
        user_id: a.user_id,
        real_name: a.real_name ?? undefined,
        masked_emails: masked ? [masked] : undefined,
        masked_phones: a.masked_phone ? [a.masked_phone] : undefined
      },
      // Comme pour roso.info : l'email masqué est aussi visible sur le numéro recherché.
      properties: { masked_emails: masked ? [`${masked} (Sleeper)`] : undefined },
      raw: r.raw
    }
  }
})
