// Vérification silencieuse d'un compte Amazon : on soumet l'identifiant (email
// ou téléphone) à la première étape de connexion et on regarde la page suivante.
// Compte existant : demande du mot de passe. Sinon : proposition de créer un compte.
// Aucun code n'est envoyé tant qu'on ne clique pas sur « Envoyer le code ».

import { ModuleError, type ModuleContext } from '@shared/modules'
import { createSession, httpFailure } from './_lib'

const BASE = 'https://www.amazon.com'
const SIGNIN =
  BASE +
  '/ap/signin?openid.pape.max_auth_age=0' +
  '&openid.return_to=https%3A%2F%2Fwww.amazon.com%2F%3Fref_%3Dnav_custrec_signin' +
  '&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select' +
  '&openid.assoc_handle=usflex&openid.mode=checkid_setup' +
  '&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select' +
  '&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0'

const decode = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

export interface AmazonForm {
  action: string
  fields: Array<[string, string]>
}

/** Formulaire de connexion (action et champs cachés). */
export function parseAmazonSignin(html: string): AmazonForm | null {
  const form = html.match(/<form[^>]*name="signIn"[^>]*>[\s\S]*?<\/form>/)?.[0]
  if (!form) return null
  const action = form.match(/action="([^"]*)"/)?.[1]
  if (!action) return null
  const fields: Array<[string, string]> = []
  for (const tag of form.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = tag.match(/name="([^"]*)"/)?.[1]
    if (!name) continue
    fields.push([name, decode(tag.match(/value="([^"]*)"/)?.[1] ?? '')])
  }
  return { action: decode(action), fields }
}

export interface AmazonResult {
  found: boolean
  /** Moyens de connexion masqués proposés par Amazon (ex. `+1 ***-***-71`). */
  hints: string[]
}

/** Interprète la page obtenue après l'envoi de l'identifiant. */
export function classifyAmazon(html: string, url: string): AmazonResult {
  if (/auth-captcha-image|captchacharacters|\/errors\/validateCaptcha|cvf-widget|aa-challenge-whole-page/i.test(html))
    throw new ModuleError('Amazon : captcha demandé, réessayez plus tard ou via un autre proxy', 'blocked')
  if (/\/ax\/claim\/intent/.test(url) || /id="intent-confirmation-form"|ap_register_form/.test(html)) return { found: false, hints: [] }
  if (/id="ap_password"|name="password"[^>]*current-password/.test(html)) {
    const hints = new Set<string>()
    for (const m of html.matchAll(/selectedChallengeType=otp[^"]*"[^>]*>([^<]*\*[^<]*)</g)) {
      const masked = m[1].match(/[+\d][\d\s*().-]*\*[\d\s*().-]*\d+|[\w.*+-]*\*[\w.*+-]*@[\w.*-]+/)?.[0]
      if (masked) hints.add(masked.trim())
    }
    return { found: true, hints: Array.from(hints) }
  }
  if (/ap_email|ap_login_form/.test(html) && /a-alert-error|auth-error-message-box/.test(html))
    throw new ModuleError('Amazon : identifiant refusé', 'invalid_input')
  throw new ModuleError('Amazon : page de réponse non reconnue', 'other')
}

export async function checkAmazon(ctx: ModuleContext, claim: string): Promise<AmazonResult & { raw: unknown }> {
  const session = createSession(ctx)
  const first = await session.request(SIGNIN)
  if (first.res.status === 503 || first.res.status === 429) throw httpFailure('Amazon', 429)
  if (!first.res.ok) throw httpFailure('Amazon', first.res.status)
  const form = parseAmazonSignin(await first.res.text())
  if (!form) throw new ModuleError('Amazon : formulaire de connexion introuvable', 'other')
  const body = new URLSearchParams([...form.fields, ['email', claim]])
  const next = await session.request(new URL(form.action, first.url).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, referer: first.url },
    body: body.toString()
  })
  if (next.res.status === 503 || next.res.status === 429) throw httpFailure('Amazon', 429)
  if (!next.res.ok) throw httpFailure('Amazon', next.res.status)
  const result = classifyAmazon(await next.res.text(), next.url)
  return { ...result, raw: { url: next.url.split('?')[0], ...result } }
}
