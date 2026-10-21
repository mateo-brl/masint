// Vérifications de comptes silencieuses façon holehe : chaque service est
// interrogé sur la disponibilité de l'adresse (inscription ou connexion),
// sans envoi d'email ni réinitialisation de mot de passe.
// Chaque parseur est exporté pour être testé hors ligne.

import { defineModule, ModuleError, type ModuleContext } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { accountCheck, createSession, fetchRetry, httpFailure, readJson, requireEmail, splitEmail } from './_lib'

type Parsed = { found: boolean; data?: Record<string, PropValue | undefined>; image?: string; label?: string }

async function getJson<T>(ctx: ModuleContext, service: string, url: string, init: Parameters<typeof fetchRetry>[2] = {}): Promise<{ status: number; json: T }> {
  const res = await fetchRetry(ctx, url, { ...init, headers: { accept: 'application/json', ...(init.headers as Record<string, string>) } })
  if (res.status === 429 || res.status >= 500) throw httpFailure(service, res.status)
  return { status: res.status, json: await readJson<T>(res, service) }
}

// ---------------------------------------------------------------------------
// Spotify

export function parseSpotify(json: { status?: number }): Parsed {
  if (json.status === 20) return { found: true }
  if (json.status === 1) return { found: false }
  if (json.status === 130) throw new ModuleError('Spotify : adresse refusée comme invalide', 'invalid_input')
  throw new ModuleError(`Spotify : statut inattendu (${json.status})`, 'other')
}

const spotify = accountCheck({
  id: 'email.spotify',
  service: 'Spotify',
  platform: 'spotify',
  description: {
    fr: "Vérifie si l'adresse est déjà inscrite sur Spotify (contrôle du formulaire d'inscription).",
    en: 'Checks whether the address is already registered on Spotify (sign-up form validation).'
  },
  homepage: 'https://www.spotify.com',
  async check(email, ctx) {
    const { json } = await getJson<{ status?: number }>(ctx, 'Spotify', 'https://spclient.wg.spotify.com/signup/public/v1/account', {
      query: { validate: 1, email }
    })
    return { ...parseSpotify(json), raw: { status: json.status } }
  }
})

// ---------------------------------------------------------------------------
// X (Twitter)

export function parseTwitter(json: { valid?: boolean; taken?: boolean; msg?: string }): Parsed {
  if (json.taken === true) return { found: true }
  if (json.valid === true) return { found: false }
  if (json.taken === false && json.valid === false)
    throw new ModuleError(`X : adresse refusée (${json.msg ?? 'invalide'})`, 'invalid_input')
  throw new ModuleError('X : réponse inattendue', 'other')
}

const twitter = accountCheck({
  id: 'email.twitter',
  service: 'X (Twitter)',
  platform: 'x',
  description: {
    fr: "Vérifie si l'adresse est associée à un compte X (Twitter) via le contrôle de disponibilité de l'inscription.",
    en: 'Checks whether the address is linked to an X (Twitter) account using the sign-up availability check.'
  },
  homepage: 'https://x.com',
  async check(email, ctx) {
    const { json } = await getJson<{ valid?: boolean; taken?: boolean; msg?: string }>(
      ctx,
      'X',
      'https://api.x.com/i/users/email_available.json',
      { query: { email } }
    )
    return { ...parseTwitter(json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Chess.com

export function parseChess(json: { isEmailAvailable?: boolean }): Parsed {
  if (typeof json.isEmailAvailable !== 'boolean') throw new ModuleError('Chess.com : réponse inattendue', 'other')
  return { found: !json.isEmailAvailable }
}

const chess = accountCheck({
  id: 'email.chesscom',
  service: 'Chess.com',
  platform: 'chesscom',
  description: {
    fr: "Vérifie si l'adresse est déjà utilisée par un compte Chess.com.",
    en: 'Checks whether the address is already used by a Chess.com account.'
  },
  homepage: 'https://www.chess.com',
  async check(email, ctx) {
    const { json } = await getJson<{ isEmailAvailable?: boolean }>(ctx, 'Chess.com', 'https://www.chess.com/callback/email/available', {
      query: { email }
    })
    return { ...parseChess(json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// WordPress.com

export function parseWordpress(status: number, json: { error?: string; passwordless?: boolean; email_verified?: boolean }): Parsed {
  if (status === 200) return { found: true, data: { passwordless: json.passwordless, email_verified: json.email_verified } }
  if (json.error === 'email_login_not_allowed') return { found: true }
  if (json.error === 'unknown_user') return { found: false }
  throw new ModuleError(`WordPress.com : réponse inattendue (${json.error ?? status})`, 'other')
}

const wordpress = accountCheck({
  id: 'email.wordpress',
  service: 'WordPress.com',
  platform: 'wordpress',
  description: {
    fr: "Vérifie si l'adresse appartient à un compte WordPress.com (options de connexion publiques).",
    en: 'Checks whether the address belongs to a WordPress.com account (public sign-in options).'
  },
  homepage: 'https://wordpress.com',
  async check(email, ctx) {
    const { status, json } = await getJson<{ error?: string }>(
      ctx,
      'WordPress.com',
      `https://public-api.wordpress.com/rest/v1.1/users/${encodeURIComponent(email)}/auth-options`
    )
    return { ...parseWordpress(status, json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// LastPass

export function parseLastpass(text: string): Parsed {
  const t = text.trim()
  if (t === 'no') return { found: true }
  if (t === 'ok') return { found: false }
  if (t === 'emailinvalid') throw new ModuleError('LastPass : adresse refusée comme invalide', 'invalid_input')
  throw new ModuleError(`LastPass : réponse inattendue (${t.slice(0, 40)})`, 'other')
}

const lastpass = accountCheck({
  id: 'email.lastpass',
  service: 'LastPass',
  platform: 'lastpass',
  description: {
    fr: "Vérifie si l'adresse a un coffre LastPass (contrôle de disponibilité de l'inscription).",
    en: 'Checks whether the address has a LastPass vault (sign-up availability check).'
  },
  homepage: 'https://www.lastpass.com',
  async check(email, ctx) {
    const res = await fetchRetry(ctx, 'https://lastpass.com/create_account.php', {
      query: { check: 'avail', skipcontent: 1, mistype: 1, username: email }
    })
    if (!res.ok) throw httpFailure('LastPass', res.status)
    const text = await res.text()
    return { ...parseLastpass(text), raw: text.trim().slice(0, 40) }
  }
})

// ---------------------------------------------------------------------------
// Freelancer

export function parseFreelancer(
  status: number,
  json: { status?: string; error_code?: string; error?: { code?: string } }
): Parsed {
  if (json.status === 'success') return { found: false }
  const code = `${json.error_code ?? ''} ${json.error?.code ?? ''}`
  if (/EMAIL_TAKEN|EMAIL_ALREADY_IN_USE/.test(code)) return { found: true }
  throw new ModuleError(`Freelancer : réponse inattendue (${code.trim() || status})`, 'other')
}

const freelancer = accountCheck({
  id: 'email.freelancer',
  service: 'Freelancer',
  platform: 'freelancer',
  description: {
    fr: "Vérifie si l'adresse est déjà inscrite sur Freelancer.com.",
    en: 'Checks whether the address is already registered on Freelancer.com.'
  },
  homepage: 'https://www.freelancer.com',
  async check(email, ctx) {
    const { status, json } = await getJson<{ status?: string }>(
      ctx,
      'Freelancer',
      'https://www.freelancer.com/api/users/0.1/users/check',
      { method: 'POST', query: { compact: 'true', new_errors: 'true' }, json: { user: { email } } }
    )
    return { ...parseFreelancer(status, json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Adobe

interface AdobeAccount {
  type?: string
  authenticationMethods?: Array<{ id?: string }>
  status?: { code?: string }
  images?: Record<string, string>
}

export function parseAdobe(json: AdobeAccount[]): Parsed {
  if (!Array.isArray(json)) throw new ModuleError('Adobe : réponse inattendue', 'other')
  if (!json.length) return { found: false }
  const methods = Array.from(new Set(json.flatMap((a) => (a.authenticationMethods ?? []).map((m) => m.id ?? '')).filter(Boolean)))
  const image = json.map((a) => a.images?.['230'] ?? a.images?.['100']).find((u) => u && !u.includes('/default/'))
  return {
    found: true,
    image,
    data: {
      account_type: Array.from(new Set(json.map((a) => a.type ?? '').filter(Boolean))).join(', '),
      status: json[0].status?.code,
      login_methods: methods
    }
  }
}

const adobe = accountCheck({
  id: 'email.adobe',
  service: 'Adobe',
  platform: 'adobe',
  description: {
    fr: "Vérifie si l'adresse a un compte Adobe et liste ses moyens de connexion (mot de passe, Google, Facebook, Apple...) et sa photo de profil.",
    en: 'Checks whether the address has an Adobe account and lists its sign-in methods (password, Google, Facebook, Apple...) and profile picture.'
  },
  homepage: 'https://account.adobe.com',
  async check(email, ctx) {
    const { status, json } = await getJson<AdobeAccount[]>(ctx, 'Adobe', 'https://auth.services.adobe.com/signin/v2/users/accounts', {
      method: 'POST',
      headers: { 'x-ims-clientid': 'adobedotcom2' },
      json: { username: email, usernameType: 'EMAIL' }
    })
    if (status >= 400) throw httpFailure('Adobe', status)
    return { ...parseAdobe(json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Duolingo

interface DuolingoUser {
  username?: string
  name?: string
  picture?: string
  hasFacebookId?: boolean
  hasGoogleId?: boolean
  hasAppleId?: boolean
  streak?: number
  totalXp?: number
  hasPlus?: boolean
  learningLanguage?: string
  fromLanguage?: string
  creationDate?: number
  courses?: Array<{ title?: string }>
}

export function parseDuolingo(json: { users?: DuolingoUser[] }): Parsed {
  if (!Array.isArray(json.users)) throw new ModuleError('Duolingo : réponse inattendue', 'other')
  const u = json.users[0]
  if (!u) return { found: false }
  const linked = [u.hasGoogleId ? 'Google' : '', u.hasFacebookId ? 'Facebook' : '', u.hasAppleId ? 'Apple' : ''].filter(Boolean)
  // Seules les photos importées sont utiles ; les avatars dessinés ne le sont pas.
  const image = u.picture?.includes('/avatars/') ? `https:${u.picture.replace(/^https?:/, '')}/xlarge` : undefined
  return {
    found: true,
    label: u.username || undefined,
    image,
    data: {
      username: u.username,
      display_name: u.name,
      url: u.username ? `https://www.duolingo.com/profile/${u.username}` : undefined,
      linked_logins: linked,
      streak: u.streak || undefined,
      total_xp: u.totalXp || undefined,
      plus: u.hasPlus || undefined,
      learning_language: u.learningLanguage,
      courses: (u.courses ?? []).map((c) => c.title ?? '').filter(Boolean),
      created_at: u.creationDate ? new Date(u.creationDate * 1000).toISOString() : undefined
    }
  }
}

const duolingo = accountCheck({
  id: 'email.duolingo',
  service: 'Duolingo',
  platform: 'duolingo',
  description: {
    fr: "Vérifie si l'adresse a un compte Duolingo et indique les connexions Google, Facebook ou Apple liées.",
    en: 'Checks whether the address has a Duolingo account and reports linked Google, Facebook or Apple sign-ins.'
  },
  homepage: 'https://www.duolingo.com',
  async check(email, ctx) {
    const { status, json } = await getJson<{ users?: DuolingoUser[] }>(ctx, 'Duolingo', 'https://www.duolingo.com/2017-06-30/users', {
      query: { email }
    })
    if (status >= 400) throw httpFailure('Duolingo', status)
    return { ...parseDuolingo(json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Snapchat / Bitmoji

export function parseBitmoji(status: number, json: { account_type?: string } | null): Parsed {
  if (status === 204) return { found: false }
  if (status === 200 && json?.account_type) return { found: true, data: { account_type: json.account_type } }
  throw new ModuleError(`Snapchat : réponse inattendue (HTTP ${status})`, 'other')
}

const snapchat = accountCheck({
  id: 'email.snapchat',
  service: 'Snapchat',
  platform: 'snapchat',
  name: { fr: 'Compte Snapchat / Bitmoji', en: 'Snapchat / Bitmoji account' },
  description: {
    fr: "Vérifie si l'adresse est liée à un compte Snapchat ou Bitmoji (recherche de compte Bitmoji).",
    en: 'Checks whether the address is linked to a Snapchat or Bitmoji account (Bitmoji account lookup).'
  },
  homepage: 'https://www.bitmoji.com',
  async check(email, ctx) {
    const res = await fetchRetry(ctx, 'https://bitmoji.api.snapchat.com/api/user/find', {
      method: 'POST',
      headers: { accept: 'application/json' },
      json: { email }
    })
    if (res.status === 204) return { ...parseBitmoji(204, null), raw: { status: 204 } }
    if (!res.ok) throw httpFailure('Snapchat', res.status)
    const json = await readJson<{ account_type?: string }>(res, 'Snapchat')
    return { ...parseBitmoji(res.status, json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Eventbrite

interface EventbriteLookup {
  exists?: boolean
  user_id?: string
  sign_in_methods?: string[]
  is_email_verified?: boolean
}

export function parseEventbrite(json: EventbriteLookup): Parsed {
  if (typeof json.exists !== 'boolean') throw new ModuleError('Eventbrite : réponse inattendue', 'other')
  if (!json.exists) return { found: false }
  return {
    found: true,
    data: { user_id: json.user_id, login_methods: json.sign_in_methods ?? [], email_verified: json.is_email_verified }
  }
}

const eventbrite = accountCheck({
  id: 'email.eventbrite',
  service: 'Eventbrite',
  platform: 'eventbrite',
  description: {
    fr: "Vérifie si l'adresse a un compte Eventbrite et récupère son identifiant numérique et ses moyens de connexion.",
    en: 'Checks whether the address has an Eventbrite account and reads its numeric ID and sign-in methods.'
  },
  homepage: 'https://www.eventbrite.com',
  async check(email, ctx) {
    const session = createSession(ctx)
    const page = await session.request('https://www.eventbrite.com/signin/')
    await page.res.body?.cancel().catch(() => undefined)
    const csrf = session.cookie('csrftoken')
    if (!csrf) throw page.res.ok ? new ModuleError('Eventbrite : jeton CSRF absent', 'other') : httpFailure('Eventbrite', page.res.status)
    const { res } = await session.request('https://www.eventbrite.com/api/v3/users/lookup/', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-csrftoken': csrf,
        referer: 'https://www.eventbrite.com/signin/',
        origin: 'https://www.eventbrite.com'
      },
      json: { email }
    })
    if (!res.ok) throw httpFailure('Eventbrite', res.status)
    const json = await readJson<EventbriteLookup>(res, 'Eventbrite')
    return { ...parseEventbrite(json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Deezer

interface DeezerCheck {
  error?: unknown
  results?: { availability?: boolean; domain_validity?: boolean }
}

export function parseDeezer(json: DeezerCheck): Parsed {
  const r = json.results
  if (typeof r?.availability !== 'boolean') throw new ModuleError('Deezer : réponse inattendue', 'other')
  if (r.domain_validity === false) throw new ModuleError('Deezer : adresse refusée comme invalide', 'invalid_input')
  return { found: !r.availability }
}

const deezer = accountCheck({
  id: 'email.deezer',
  service: 'Deezer',
  platform: 'deezer',
  description: {
    fr: "Vérifie si l'adresse est déjà inscrite sur Deezer (contrôle du formulaire d'inscription).",
    en: 'Checks whether the address is already registered on Deezer (sign-up form validation).'
  },
  homepage: 'https://www.deezer.com',
  async check(email, ctx) {
    const { status, json } = await getJson<DeezerCheck>(ctx, 'Deezer', 'https://www.deezer.com/ajax/gw-light.php', {
      method: 'POST',
      query: { method: 'deezer.emailCheck', input: 3, api_version: '1.0', api_token: '' },
      json: { EMAIL: email }
    })
    if (status >= 400) throw httpFailure('Deezer', status)
    return { ...parseDeezer(json), raw: json.results }
  }
})

// ---------------------------------------------------------------------------
// Mail.ru (existence de la boîte)

const MAILRU_DOMAINS = ['mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'internet.ru', 'mail.ua']

export function parseMailru(json: { status?: number; body?: { exists?: boolean } }): Parsed {
  if (json.status === 200 && typeof json.body?.exists === 'boolean') return { found: json.body.exists }
  throw new ModuleError(`Mail.ru : réponse inattendue (${json.status})`, 'other')
}

const mailru = defineModule({
  id: 'email.mailru',
  name: { fr: 'Boîte Mail.ru existante', en: 'Mail.ru mailbox exists' },
  description: {
    fr: 'Vérifie que la boîte Mail.ru (mail.ru, bk.ru, inbox.ru, list.ru) existe réellement.',
    en: 'Checks that the Mail.ru mailbox (mail.ru, bk.ru, inbox.ru, list.ru) really exists.'
  },
  category: 'email',
  inputTypes: ['email'],
  homepage: 'https://mail.ru',
  accepts: (input) => MAILRU_DOMAINS.includes(splitEmail(input.label)?.domain ?? ''),
  async run(input, ctx) {
    const res = await fetchRetry(ctx, 'https://account.mail.ru/api/v1/user/exists', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ email: requireEmail(input) }).toString()
    })
    if (!res.ok) throw httpFailure('Mail.ru', res.status)
    const json = await readJson<{ status?: number; body?: { exists?: boolean } }>(res, 'Mail.ru')
    const { found } = parseMailru(json)
    // L'adresse est la boîte elle-même : on l'indique sur l'entité plutôt qu'en créant un compte.
    return { found, properties: { mailbox_exists: found }, raw: json }
  }
})

export const modules = [
  spotify,
  deezer,
  twitter,
  chess,
  wordpress,
  lastpass,
  freelancer,
  adobe,
  duolingo,
  snapchat,
  eventbrite,
  mailru
]
