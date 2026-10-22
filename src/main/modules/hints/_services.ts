// Services qui affichent un email ou un téléphone de récupération masqué avant tout envoi,
// et vérification d'existence d'une adresse Microsoft côté inscription.
//
// Microsoft (login.live.com, GetCredentialType) : l'étape « identifiant » renvoie les moyens
// de connexion par code (`OtcLoginEligibleProofs`), masqués. Le code de la page de connexion
// montre que, pour un compte sans mot de passe, le serveur peut envoyer seul un code
// (`otcSent`) ou une notification Authenticator (`RemoteNgcParams`) dès cette étape. La
// requête annonce donc que la connexion par code et Authenticator ne sont pas pris en charge
// (`otclogindisallowed`, `isRemoteNGCSupported`, `isFidoSupported`), comme le fait la page
// quand ces options sont désactivées. Le cas d'un compte sans mot de passe n'a pas pu être
// observé : si la réponse indique malgré tout un envoi, un avertissement est remonté.
//
// Adobe (auth.services.adobe.com) : `POST /signin/v1/authenticationstate` ouvre l'étape de
// connexion, `GET /signin/v3/challenges?purpose=passwordRecovery` liste les moyens de
// récupération (email secondaire, téléphone de sécurité, masqués). L'envoi d'un code
// demande un `POST /signin/v3/challenges` avec un jeton captcha, jamais appelé ici.

import { ModuleError, type ModuleContext } from '@shared/modules'
import { parsePhoneNumberFromString, getCountryCallingCode, type CountryCode } from 'libphonenumber-js'
import { createSession, httpFailure, readJson } from '../email/_lib'
import { interpretMsa, parseMsaLoginPage, type MsaResponse } from '../email/_microsoft'
import { emailMatches, parseEmailMask, parsePhoneMask, phoneMatches } from './_mask'

export interface ServiceHints {
  service: string
  found: boolean
  emails: string[]
  phones: string[]
  /** La réponse laisse penser qu'un code ou une notification a pu partir. */
  alert?: boolean
  raw?: unknown
}

const MASK = /[*•●∗·⋅…■▪◦]/

/** Écarte les indices qui ne sont que la valeur recherchée, masquée. */
function notSelf(query: string): (v: string) => boolean {
  if (query.includes('@')) {
    return (v) => {
      const m = v.includes('@') ? parseEmailMask(v) : null
      return !m || !emailMatches(m, query)
    }
  }
  return (v) => {
    const m = v.includes('@') ? null : parsePhoneMask(v)
    return !m || !phoneMatches(m, query)
  }
}

// ---------------------------------------------------------------------------
// Microsoft

interface MsaProof {
  type?: number
  display?: string
  ctryISO?: string
  otcSent?: boolean
}

/** Réponse GetCredentialType, avec les champs qui signalent un envoi automatique. */
export interface MsaHintResponse extends Omit<MsaResponse, 'Credentials'> {
  Credentials?: {
    PrefCredential?: number
    OtcLoginEligibleProofs?: MsaProof[]
    OTCNotAutoSent?: number
    RemoteNgcParams?: { SessionIdentifier?: string }
  }
}

/** Corps de GetCredentialType : code à usage unique, Authenticator et clé d'accès refusés. */
export function msaSafeBody(username: string, uaid: string, flowToken: string): Record<string, unknown> {
  return {
    username,
    uaid,
    isOtherIdpSupported: false,
    checkPhones: !username.includes('@'),
    isRemoteNGCSupported: false,
    isCookieBannerShown: false,
    isFidoSupported: false,
    forceotclogin: false,
    otclogindisallowed: true,
    isExternalFederationDisallowed: false,
    isRemoteConnectSupported: false,
    federationFlags: 3,
    isSignup: false,
    flowToken
  }
}

/** Téléphone affiché par Microsoft (`*******42`, pays `FR`) avec son indicatif : `+33 *******42`. */
function msaPhone(display: string, iso?: string): string {
  if (!iso || display.trim().startsWith('+')) return display.trim()
  try {
    return `+${getCountryCallingCode(iso.toUpperCase() as CountryCode)} ${display.trim()}`
  } catch {
    return display.trim()
  }
}

/** Indices masqués d'une réponse GetCredentialType. */
export function interpretMsaHints(json: MsaHintResponse, query: string): ServiceHints {
  const { found } = interpretMsa(json)
  const c = json.Credentials ?? {}
  const proofs = c.OtcLoginEligibleProofs ?? []
  const keep = notSelf(query)
  const emails: string[] = []
  const phones: string[] = []
  for (const p of proofs) {
    const display = p.display?.trim()
    if (!display || !MASK.test(display)) continue
    if (display.includes('@')) emails.push(display)
    else phones.push(msaPhone(display, p.ctryISO))
  }
  const alert = proofs.some((p) => p.otcSent === true) || !!c.RemoteNgcParams?.SessionIdentifier
  return {
    service: 'Microsoft',
    found,
    emails: emails.filter(keep),
    phones: phones.filter(keep),
    ...(alert ? { alert } : {}),
    raw: {
      IfExistsResult: json.IfExistsResult,
      PrefCredential: c.PrefCredential,
      OTCNotAutoSent: c.OTCNotAutoSent,
      proofs: proofs.map(({ type, display, ctryISO, otcSent }) => ({ type, display, ctryISO, otcSent }))
    }
  }
}

export async function microsoftHints(ctx: ModuleContext, username: string): Promise<ServiceHints> {
  const session = createSession(ctx)
  const page = await session.request('https://login.live.com/login.srf')
  if (!page.res.ok) throw httpFailure('Microsoft', page.res.status)
  const tokens = parseMsaLoginPage(await page.res.text())
  if (!tokens) throw new ModuleError('Microsoft : page de connexion non reconnue', 'other')
  const { res } = await session.request(tokens.url, {
    method: 'POST',
    headers: { accept: 'application/json', origin: 'https://login.live.com', referer: page.url },
    json: msaSafeBody(username, tokens.uaid, tokens.flowToken)
  })
  if (!res.ok) throw httpFailure('Microsoft', res.status)
  return interpretMsaHints(await readJson<MsaHintResponse>(res, 'Microsoft'), username)
}

// ---------------------------------------------------------------------------
// Adobe

const ADOBE = 'https://auth.services.adobe.com/signin'
const ADOBE_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'x-ims-clientid': 'adobedotcom2',
  origin: 'https://auth.services.adobe.com'
}

export interface AdobeChallengeProfile {
  availableFactors?: string[]
  primaryEmail?: string | null
  secondaryEmail?: string | null
  securityPhoneNumber?: string | null
  primaryPhoneNumber?: string | null
}

/** Indices masqués du profil de récupération Adobe. L'email principal est l'adresse recherchée. */
export function interpretAdobeProfile(p: AdobeChallengeProfile, query: string): ServiceHints {
  const keep = notSelf(query)
  const masked = (v: string | null | undefined): v is string => typeof v === 'string' && MASK.test(v)
  const emails = [p.secondaryEmail, query.includes('@') ? null : p.primaryEmail].filter(masked)
  const phones = [p.securityPhoneNumber, p.primaryPhoneNumber].filter(masked)
  return {
    service: 'Adobe',
    found: true,
    emails: emails.map((e) => e.trim()).filter(keep),
    phones: phones.map((e) => e.trim()).filter(keep),
    raw: { availableFactors: p.availableFactors, secondaryEmail: p.secondaryEmail ?? null, securityPhoneNumber: p.securityPhoneNumber ?? null, primaryPhoneNumber: p.primaryPhoneNumber ?? null }
  }
}

export async function adobeHints(ctx: ModuleContext, email: string): Promise<ServiceHints> {
  const state = await ctx.fetch(`${ADOBE}/v1/authenticationstate`, {
    method: 'POST',
    headers: ADOBE_HEADERS,
    json: { username: email, accountType: 'individual' }
  })
  if (state.status === 429 || state.status >= 500) throw httpFailure('Adobe', state.status)
  const body = await readJson<{ errorCode?: string; id?: string }>(state, 'Adobe')
  if (body.errorCode === 'invalid_authentication') return { service: 'Adobe', found: false, emails: [], phones: [] }
  if (!state.ok || body.errorCode) throw new ModuleError(`Adobe : réponse inattendue (${body.errorCode ?? `HTTP ${state.status}`})`, 'other')
  const token = state.headers.get('x-ims-authentication-state-encrypted')
  if (!token) throw new ModuleError('Adobe : jeton de connexion absent', 'other')
  // Lecture seule : la liste des moyens de récupération, sans démarrer de vérification.
  const res = await ctx.fetch(`${ADOBE}/v3/challenges`, {
    query: { purpose: 'passwordRecovery' },
    headers: { ...ADOBE_HEADERS, 'x-ims-authentication-state-encrypted': token }
  })
  if (!res.ok) throw httpFailure('Adobe', res.status)
  return interpretAdobeProfile(await readJson<AdobeChallengeProfile>(res, 'Adobe'), email)
}

// ---------------------------------------------------------------------------
// Existence d'une adresse Microsoft, côté inscription (signup.live.com). On demande si
// l'adresse est libre pour créer un compte : le titulaire n'est jamais sollicité.

export type Availability = 'taken' | 'free' | 'unknown'

export interface SignupTokens {
  url: string
  canary: string
  uaid: string
}

export function parseSignupPage(html: string, pageUrl = ''): SignupTokens | null {
  const rawCanary = html.match(/"apiCanary":"([^"]+)"/)?.[1]
  const uaid = pageUrl.match(/[?&]uaid=([a-f0-9]{32})/i)?.[1] ?? html.match(/uaid=([a-f0-9]{32})/i)?.[1]
  if (!rawCanary || !uaid) return null
  let canary: string
  try {
    canary = JSON.parse(`"${rawCanary}"`) as string
  } catch {
    return null
  }
  const url = (html.match(/"urlCheckAvailableSigninNames":"([^"]+)"/)?.[1] ?? 'https://signup.live.com/API/CheckAvailableSigninNames').replace(/\\u002f/gi, '/')
  return { url, canary, uaid }
}

// Codes d'erreur de l'inscription Microsoft : identifiant déjà pris (Outlook, adresse externe, téléphone).
const TAKEN_CODES = new Set(['1058', '1242', '1052'])

export function interpretAvailability(json: { isAvailable?: boolean; error?: { code?: string } }): Availability {
  if (json.isAvailable === true) return 'free'
  if (json.error?.code && TAKEN_CODES.has(String(json.error.code))) return 'taken'
  if (json.isAvailable === false && !json.error) return 'taken'
  return 'unknown'
}

/**
 * Disponibilité de plusieurs adresses dans une même session d'inscription. `onEach` reçoit
 * chaque réponse au fil de l'eau : elle reste acquise si une requête suivante échoue.
 */
export async function microsoftAvailability(
  ctx: ModuleContext,
  emails: string[],
  onEach?: (done: number, email: string, status: Availability) => void
): Promise<Map<string, Availability>> {
  const out = new Map<string, Availability>()
  if (!emails.length) return out
  const session = createSession(ctx)
  const page = await session.request('https://signup.live.com/signup')
  if (!page.res.ok) throw httpFailure('Microsoft', page.res.status)
  const tokens = parseSignupPage(await page.res.text(), page.url)
  if (!tokens) throw new ModuleError("Microsoft : page d'inscription non reconnue", 'other')
  let canary = tokens.canary
  for (const [i, email] of emails.entries()) {
    const { res } = await session.request(tokens.url, {
      method: 'POST',
      query: { lic: 1, uaid: tokens.uaid },
      headers: { accept: 'application/json', canary, origin: 'https://signup.live.com', referer: page.url },
      json: { includeSuggestions: true, signInName: email, uiflvr: 1001, scid: 100118, uaid: tokens.uaid, hpgid: 200639 }
    })
    if (res.status === 429) throw httpFailure('Microsoft', 429)
    const json = res.ok ? await readJson<{ isAvailable?: boolean; error?: { code?: string }; apiCanary?: string }>(res, 'Microsoft') : {}
    if (json.apiCanary) canary = json.apiCanary
    const status = interpretAvailability(json)
    out.set(email, status)
    onEach?.(i + 1, email, status)
  }
  return out
}

/** Numéro de l'entité au format E.164 (numéros nationaux lus comme français). */
export function e164(raw: string): string | null {
  if (MASK.test(raw) || /x{2,}/i.test(raw)) return null
  const p = parsePhoneNumberFromString(raw.trim(), 'FR')
  return p?.isPossible() ? p.number : null
}
