// Vérification silencieuse d'un compte Microsoft personnel (Outlook, Hotmail,
// Xbox, Skype...) via l'étape « identifiant » de login.live.com. Aucun code
// n'est envoyé : on lit seulement la réponse de GetCredentialType.

import { ModuleError, type ModuleContext } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, createSession, httpFailure, readJson } from './_lib'

const LOGIN_PAGE = 'https://login.live.com/login.srf'

export interface MsaLoginTokens {
  url: string
  flowToken: string
  uaid: string
}

/** Extrait l'URL GetCredentialType, le jeton de flux (PPFT) et l'uaid de la page de connexion. */
export function parseMsaLoginPage(html: string): MsaLoginTokens | null {
  const url = html.match(/"urlGetCredentialType":"([^"]+)"/)?.[1]
  const flowToken = html.match(/name=\\?"PPFT\\?"[^>]*?value=\\?"([^"\\]+)/)?.[1]
  if (!url || !flowToken) return null
  const decoded = url.replace(/\\u0026/g, '&').replace(/&amp;/g, '&')
  const uaid = decoded.match(/[?&]uaid=([a-f0-9]+)/i)?.[1] ?? html.match(/uaid=([a-f0-9]{32})/i)?.[1] ?? ''
  return { url: decoded, flowToken, uaid }
}

interface MsaProof {
  type?: number
  display?: string
  ctryISO?: string
  isDefault?: boolean
}

export interface MsaResponse {
  Username?: string
  IfExistsResult?: number
  ThrottleStatus?: number
  ErrorHR?: string
  Credentials?: {
    PrefCredential?: number
    HasPassword?: number
    HasPhone?: number
    HasFido?: number
    HasRemoteNGC?: number
    HasGoogleFed?: number
    HasGitHubFed?: number
    HasLinkedInFed?: number
    HasAppleFed?: number
    OtcLoginEligibleProofs?: MsaProof[]
  }
}

export interface MsaResult {
  found: boolean
  data: Record<string, PropValue>
}

/** Interprète la réponse GetCredentialType de login.live.com. */
export function interpretMsa(json: MsaResponse): MsaResult {
  // 8004113F : identifiant au format refusé (numéro non attribuable, adresse invalide).
  if (json.ErrorHR === '8004113F') throw new ModuleError('Microsoft : identifiant refusé comme invalide', 'invalid_input')
  // 800478AC : domaine réservé à une organisation (microsoft.com...), fermé aux comptes
  // personnels. Ce n'est pas un refus de session : aucun compte personnel à cette adresse.
  if (json.ErrorHR === '800478AC') return { found: false, data: {} }
  if (json.ErrorHR) throw new ModuleError(`Microsoft : session refusée (code ${json.ErrorHR})`, 'blocked')
  if (json.ThrottleStatus === 1) throw new ModuleError('Microsoft : trop de requêtes, réessayez plus tard', 'rate_limited')
  const r = json.IfExistsResult
  if (r === 1) return { found: false, data: {} }
  if (r !== 0 && r !== 5 && r !== 6) throw new ModuleError(`Microsoft : réponse inattendue (IfExistsResult ${r})`, 'other')

  const c = json.Credentials ?? {}
  const linked = [
    c.HasGoogleFed ? 'Google' : '',
    c.HasGitHubFed ? 'GitHub' : '',
    c.HasLinkedInFed ? 'LinkedIn' : '',
    c.HasAppleFed ? 'Apple' : ''
  ].filter(Boolean)
  const emails: string[] = []
  const phones: string[] = []
  for (const p of c.OtcLoginEligibleProofs ?? []) {
    if (!p.display) continue
    if (p.display.includes('@')) emails.push(p.display)
    else phones.push(p.ctryISO ? `${p.display} (${p.ctryISO})` : p.display)
  }
  return {
    found: true,
    data: compact({
      has_password: c.HasPassword === undefined ? undefined : c.HasPassword === 1,
      has_phone: c.HasPhone === undefined ? undefined : c.HasPhone === 1,
      passkey: c.HasFido ? true : undefined,
      authenticator_app: c.HasRemoteNGC ? true : undefined,
      linked_logins: linked,
      recovery_emails: emails,
      recovery_phones: phones
    })
  }
}

/** Vérifie un identifiant (email ou numéro E.164) sur login.live.com. */
export async function checkMicrosoft(ctx: ModuleContext, username: string): Promise<MsaResult & { raw: MsaResponse }> {
  const session = createSession(ctx)
  const page = await session.request(LOGIN_PAGE)
  if (!page.res.ok) throw httpFailure('Microsoft', page.res.status)
  const tokens = parseMsaLoginPage(await page.res.text())
  if (!tokens) throw new ModuleError('Microsoft : page de connexion non reconnue', 'other')
  const { res } = await session.request(tokens.url, {
    method: 'POST',
    headers: { accept: 'application/json', origin: 'https://login.live.com', referer: page.url },
    json: {
      username,
      uaid: tokens.uaid,
      isOtherIdpSupported: false,
      checkPhones: true,
      // Authenticator, clé d'accès et code à usage unique annoncés comme non pris en charge :
      // pour un compte sans mot de passe, le serveur pourrait sinon envoyer une notification
      // ou un code à la personne dès cette étape.
      isRemoteNGCSupported: false,
      isCookieBannerShown: false,
      isFidoSupported: false,
      forceotclogin: false,
      otclogindisallowed: true,
      isExternalFederationDisallowed: false,
      isRemoteConnectSupported: false,
      federationFlags: 3,
      isSignup: false,
      flowToken: tokens.flowToken
    }
  })
  if (!res.ok) throw httpFailure('Microsoft', res.status)
  const json = await readJson<MsaResponse>(res, 'Microsoft')
  // Les jetons de preuve (`data`) sont opaques et volumineux : inutiles à archiver.
  const proofs = json.Credentials?.OtcLoginEligibleProofs?.map(({ type, display, ctryISO, isDefault }) => ({ type, display, ctryISO, isDefault }))
  const raw = json.Credentials ? { ...json, Credentials: { ...json.Credentials, OtcLoginEligibleProofs: proofs } } : json
  return { ...interpretMsa(json), raw }
}

// ---------------------------------------------------------------------------
// Microsoft Entra ID (comptes professionnels / Microsoft 365)

export interface EntraResponse {
  IfExistsResult?: number
  ThrottleStatus?: number
  error?: { code?: number; message?: string }
  Credentials?: { FederationRedirectUrl?: string }
  EstsProperties?: { DomainType?: number }
}

export interface EntraResult {
  /** `undefined` quand le domaine est fédéré : l'existence ne peut pas être établie. */
  found?: boolean
  tenant: 'none' | 'consumer' | 'managed' | 'federated' | 'unknown'
  identityProvider?: string
}

/**
 * DomainType : 1 domaine inconnu d'Entra, 2 grand public, 3 géré, 4 fédéré.
 * IfExistsResult : 0 existe, 1 inconnu, 5 compte personnel seulement, 6 les deux.
 * Un domaine fédéré (ADFS, Okta...) répond toujours 0 : résultat non fiable.
 */
export function interpretEntra(json: EntraResponse): EntraResult {
  if (json.error) throw new ModuleError(`Microsoft Entra : ${json.error.message ?? 'erreur'}`, 'other')
  const type = json.EstsProperties?.DomainType
  const r = json.IfExistsResult
  if (type === 1) return { found: false, tenant: 'none' }
  if (type === 4) {
    const url = json.Credentials?.FederationRedirectUrl
    let idp: string | undefined
    try {
      idp = url ? new URL(url).hostname : undefined
    } catch {
      idp = undefined
    }
    return { tenant: 'federated', identityProvider: idp }
  }
  if (type === 2) return { found: false, tenant: 'consumer' }
  // Sous limitation, la réponse d'un domaine géré n'est plus fiable.
  if (json.ThrottleStatus === 1) throw new ModuleError('Microsoft Entra : trop de requêtes', 'rate_limited')
  return { found: r === 0 || r === 6, tenant: type === 3 ? 'managed' : 'unknown' }
}

export async function checkEntra(ctx: ModuleContext, username: string): Promise<EntraResult & { raw: EntraResponse }> {
  const res = await ctx.fetch('https://login.microsoftonline.com/common/GetCredentialType', {
    method: 'POST',
    headers: { accept: 'application/json' },
    json: { username, isOtherIdpSupported: true }
  })
  if (!res.ok && res.status !== 400) throw httpFailure('Microsoft Entra', res.status)
  const json = await readJson<EntraResponse>(res, 'Microsoft Entra')
  const raw = {
    IfExistsResult: json.IfExistsResult,
    ThrottleStatus: json.ThrottleStatus,
    error: json.error,
    EstsProperties: { DomainType: json.EstsProperties?.DomainType },
    Credentials: { FederationRedirectUrl: json.Credentials?.FederationRedirectUrl }
  }
  return { ...interpretEntra(json), raw }
}
