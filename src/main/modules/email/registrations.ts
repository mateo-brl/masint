// Vérifications de comptes silencieuses (suite) : contrôles de disponibilité de l'adresse
// sur les formulaires d'inscription ou de connexion. Aucun email n'est envoyé, aucun
// compte n'est créé, aucun mot de passe n'est testé. Parseurs exportés pour les tests.

import { ModuleError, type ModuleContext } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { accountCheck, createSession, fetchRetry, httpFailure, readJson, TOOL_USER_AGENT, type CheckResult } from './_lib'

type Parsed = Pick<CheckResult, 'found'> & { data?: Record<string, PropValue | undefined> }

/** Requête dont le corps est lu en texte ; quota et pannes deviennent des erreurs explicites. */
async function fetchBody(
  ctx: ModuleContext,
  service: string,
  url: string,
  init: Parameters<typeof fetchRetry>[2] = {}
): Promise<{ status: number; text: string }> {
  let res: Response
  try {
    res = await fetchRetry(ctx, url, init)
  } catch (e) {
    // Connexion impossible ou délai dépassé : service injoignable, pas une réponse négative.
    if (e instanceof Error && (e.name === 'TimeoutError' || e.message === 'fetch failed'))
      throw new ModuleError(`${service} : pas de réponse (${e.name === 'TimeoutError' ? 'délai dépassé' : 'connexion impossible'})`, 'unavailable')
    throw e
  }
  if (res.status === 429 || res.status >= 500) throw httpFailure(service, res.status)
  return { status: res.status, text: await res.text() }
}

function parseJson<T>(text: string, service: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ModuleError(`${service} : réponse illisible (${text.slice(0, 80).replace(/\s+/g, ' ')})`, 'other')
  }
}

const form = (data: Record<string, string>): string => new URLSearchParams(data).toString()
const FORM = { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' }
/** Messages en anglais : certains services traduisent leurs réponses selon la langue demandée. */
const ENGLISH = { 'accept-language': 'en-US,en;q=0.9' }

// ---------------------------------------------------------------------------
// Firefox (compte Mozilla)

export function parseFirefox(status: number, json: { exists?: boolean; errno?: number }): Parsed {
  if (typeof json.exists === 'boolean') return { found: json.exists }
  // errno 107 : paramètre invalide (adresse refusée par le validateur).
  if (status === 400 && json.errno === 107) throw new ModuleError('Firefox : adresse refusée comme invalide', 'invalid_input')
  throw new ModuleError(`Firefox : réponse inattendue (HTTP ${status})`, 'other')
}

const firefox = accountCheck({
  id: 'email.firefox',
  service: 'Firefox',
  platform: 'firefox',
  name: { fr: 'Compte Mozilla (Firefox)', en: 'Mozilla (Firefox) account' },
  description: {
    fr: "Vérifie si l'adresse ouvre un compte Mozilla (synchronisation Firefox, Mozilla VPN, Relay), via l'API publique de statut de compte.",
    en: 'Checks whether the address opens a Mozilla account (Firefox Sync, Mozilla VPN, Relay), using the public account status API.'
  },
  homepage: 'https://accounts.firefox.com',
  async check(email, ctx) {
    // L'API répond 406 à un User-Agent de navigateur : l'outil s'identifie.
    const { status, text } = await fetchBody(ctx, 'Firefox', 'https://api.accounts.firefox.com/v1/account/status', {
      method: 'POST',
      headers: { accept: 'application/json', 'user-agent': TOOL_USER_AGENT },
      json: { email }
    })
    if (status === 406) throw new ModuleError('Firefox : User-Agent refusé (HTTP 406)', 'blocked')
    const json = parseJson<{ exists?: boolean; errno?: number }>(text, 'Firefox')
    return { ...parseFirefox(status, json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Rambler

interface RamblerReply {
  result?: { exists?: number; type?: string; status?: string }
  error?: { message?: string }
}

export function parseRambler(json: RamblerReply): Parsed {
  const r = json.result
  if (r?.type === 'non-email') throw new ModuleError('Rambler : adresse refusée comme invalide', 'invalid_input')
  if (typeof r?.exists !== 'number') throw new ModuleError(`Rambler : réponse inattendue (${json.error?.message ?? r?.status ?? '?'})`, 'other')
  // type « rambler » : boîte Rambler ; « external » : compte Rambler ID ouvert avec une adresse d'un autre fournisseur.
  return { found: r.exists === 1, data: { account_type: r.type } }
}

const rambler = accountCheck({
  id: 'email.rambler',
  service: 'Rambler',
  platform: 'rambler',
  name: { fr: 'Compte Rambler', en: 'Rambler account' },
  description: {
    fr: "Vérifie si l'adresse a un compte Rambler ID (service russe de mail et de médias), qu'il s'agisse d'une boîte Rambler ou d'une adresse externe.",
    en: 'Checks whether the address has a Rambler ID account (Russian mail and media service), whether a Rambler mailbox or an external address.'
  },
  homepage: 'https://id.rambler.ru',
  async check(email, ctx) {
    const { text } = await fetchBody(ctx, 'Rambler', 'https://id.rambler.ru/jsonrpc', {
      method: 'POST',
      headers: { accept: 'application/json', origin: 'https://id.rambler.ru', referer: 'https://id.rambler.ru/champ/registration' },
      json: { method: 'Rambler::Id::get_email_account_info', params: [{ email }], rpc: '2.0' }
    })
    const json = parseJson<RamblerReply>(text, 'Rambler')
    return { ...parseRambler(json), raw: json.result }
  }
})

// ---------------------------------------------------------------------------
// Codecademy

export function parseCodecademy(status: number, json: { errors?: { email?: string | string[] } }): Parsed {
  const message = [json.errors?.email ?? []].flat().join(' ')
  if (/already been taken/i.test(message)) return { found: true }
  if (status === 200 && !message) return { found: false }
  if (/invalid/i.test(message)) throw new ModuleError('Codecademy : adresse refusée comme invalide', 'invalid_input')
  throw new ModuleError(`Codecademy : réponse inattendue (${message || `HTTP ${status}`})`, 'other')
}

const codecademy = accountCheck({
  id: 'email.codecademy',
  service: 'Codecademy',
  platform: 'codecademy',
  description: {
    fr: "Vérifie si l'adresse est déjà inscrite sur Codecademy (validation du formulaire d'inscription).",
    en: 'Checks whether the address is already registered on Codecademy (sign-up form validation).'
  },
  homepage: 'https://www.codecademy.com',
  async check(email, ctx) {
    const { status, text } = await fetchBody(ctx, 'Codecademy', 'https://www.codecademy.com/register/validate', {
      method: 'POST',
      headers: { ...ENGLISH, accept: 'application/json', origin: 'https://www.codecademy.com', referer: 'https://www.codecademy.com/register' },
      json: { user: { email } }
    })
    if (status === 403) throw httpFailure('Codecademy', 403)
    const json = parseJson<{ errors?: { email?: string | string[] } }>(text, 'Codecademy')
    return { ...parseCodecademy(status, json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Any.do

export function parseAnydo(json: { user_exists?: boolean }): Parsed {
  if (typeof json.user_exists !== 'boolean') throw new ModuleError('Any.do : réponse inattendue', 'other')
  return { found: json.user_exists }
}

const anydo = accountCheck({
  id: 'email.anydo',
  service: 'Any.do',
  platform: 'anydo',
  description: {
    fr: "Vérifie si l'adresse a un compte Any.do (listes de tâches et agenda), via le contrôle d'adresse de la page de connexion.",
    en: 'Checks whether the address has an Any.do account (to-do lists and calendar), using the sign-in page address check.'
  },
  homepage: 'https://www.any.do',
  async check(email, ctx) {
    const { status, text } = await fetchBody(ctx, 'Any.do', 'https://sm-prod2.any.do/check_email', {
      method: 'POST',
      headers: { accept: 'application/json', 'x-platform': '3', origin: 'https://desktop.any.do', referer: 'https://desktop.any.do/' },
      json: { email }
    })
    if (status !== 200) throw httpFailure('Any.do', status)
    const json = parseJson<{ user_exists?: boolean }>(text, 'Any.do')
    return { ...parseAnydo(json), raw: { user_exists: json.user_exists } }
  }
})

// ---------------------------------------------------------------------------
// Plurk

export function parsePlurk(text: string): Parsed {
  const t = text.trim()
  if (t === 'True') return { found: true }
  if (t === 'False') return { found: false }
  throw new ModuleError(`Plurk : réponse inattendue (${t.slice(0, 40)})`, 'other')
}

const plurk = accountCheck({
  id: 'email.plurk',
  service: 'Plurk',
  platform: 'plurk',
  description: {
    fr: "Vérifie si l'adresse est déjà inscrite sur Plurk (réseau social de microblogage populaire à Taïwan).",
    en: 'Checks whether the address is already registered on Plurk (microblogging network popular in Taiwan).'
  },
  homepage: 'https://www.plurk.com',
  async check(email, ctx) {
    const { status, text } = await fetchBody(ctx, 'Plurk', 'https://www.plurk.com/Users/isEmailFound', {
      method: 'POST',
      headers: { ...FORM, origin: 'https://www.plurk.com' },
      body: form({ email })
    })
    if (status !== 200) throw httpFailure('Plurk', status)
    return { ...parsePlurk(text), raw: text.trim().slice(0, 40) }
  }
})

// ---------------------------------------------------------------------------
// Diigo

export function parseDiigo(text: string): Parsed {
  const t = text.trim()
  // 0 : adresse déjà prise, 1 : adresse libre.
  if (t === '0') return { found: true }
  if (t === '1') return { found: false }
  throw new ModuleError(`Diigo : réponse inattendue (${t.slice(0, 40)})`, 'other')
}

const diigo = accountCheck({
  id: 'email.diigo',
  service: 'Diigo',
  platform: 'diigo',
  description: {
    fr: "Vérifie si l'adresse est déjà inscrite sur Diigo (marque-pages et annotations partagés).",
    en: 'Checks whether the address is already registered on Diigo (shared bookmarks and annotations).'
  },
  homepage: 'https://www.diigo.com',
  async check(email, ctx) {
    const { status, text } = await fetchBody(ctx, 'Diigo', 'https://www.diigo.com/user_mana2/check_email', {
      query: { email },
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.diigo.com/sign-up?plan=free' }
    })
    if (status !== 200) throw httpFailure('Diigo', status)
    return { ...parseDiigo(text), raw: text.trim().slice(0, 40) }
  }
})

// ---------------------------------------------------------------------------
// Myspace

/** Jeton anti-CSRF du formulaire d'inscription, renvoyé dans l'en-tête `Hash`. */
export function myspaceCsrf(html: string): string | null {
  return html.match(/<input[^>]*name="csrf"[^>]*value="([^"]+)"/)?.[1] ?? null
}

export function parseMyspace(json: { validationResult?: string; message?: string }): Parsed {
  if (json.validationResult === 'FailedDuplicateEmail') return { found: true }
  if (json.validationResult === 'Success') return { found: false }
  if (/invalid/i.test(`${json.validationResult} ${json.message ?? ''}`))
    throw new ModuleError('Myspace : adresse refusée comme invalide', 'invalid_input')
  throw new ModuleError(`Myspace : réponse inattendue (${json.validationResult ?? '?'})`, 'other')
}

const myspace = accountCheck({
  id: 'email.myspace',
  service: 'Myspace',
  platform: 'myspace',
  description: {
    fr: "Vérifie si l'adresse a déjà servi à créer un compte Myspace (validation du formulaire d'inscription).",
    en: 'Checks whether the address was already used to create a Myspace account (sign-up form validation).'
  },
  homepage: 'https://myspace.com',
  async check(email, ctx) {
    const session = createSession(ctx)
    const page = await session.request('https://myspace.com/signup')
    if (!page.res.ok) throw httpFailure('Myspace', page.res.status)
    const csrf = myspaceCsrf(await page.res.text())
    if (!csrf) throw new ModuleError('Myspace : jeton du formulaire absent', 'other')
    const { res } = await session.request('https://myspace.com/ajax/account/validateemail', {
      method: 'POST',
      headers: { ...FORM, ...ENGLISH, hash: csrf, origin: 'https://myspace.com', referer: 'https://myspace.com/signup/email' },
      body: form({ email })
    })
    if (!res.ok) throw httpFailure('Myspace', res.status)
    const json = await readJson<{ validationResult?: string; message?: string }>(res, 'Myspace')
    return { ...parseMyspace(json), raw: { validationResult: json.validationResult } }
  }
})

// ---------------------------------------------------------------------------
// Insightly

export function parseInsightly(text: string): Parsed {
  const t = text.trim()
  if (t === 'true') return { found: false }
  const message = t.startsWith('{') ? (parseJson<{ Message?: string }>(t, 'Insightly').Message ?? '') : t
  if (/an account exists|déjà associée à un compte/i.test(message)) return { found: true }
  if (/valid email|adresse (e-?mail )?valide/i.test(message)) throw new ModuleError('Insightly : adresse refusée comme invalide', 'invalid_input')
  throw new ModuleError(`Insightly : réponse inattendue (${message.slice(0, 60)})`, 'other')
}

const insightly = accountCheck({
  id: 'email.insightly',
  service: 'Insightly',
  platform: 'insightly',
  description: {
    fr: "Vérifie si l'adresse a un compte Insightly (CRM professionnel), via le contrôle d'adresse du formulaire d'essai.",
    en: 'Checks whether the address has an Insightly account (business CRM), using the trial form address check.'
  },
  homepage: 'https://www.insightly.com',
  async check(email, ctx) {
    const { status, text } = await fetchBody(ctx, 'Insightly', 'https://accounts.insightly.com/signup/isemailvalid', {
      method: 'POST',
      headers: { ...FORM, ...ENGLISH, accept: 'application/json, text/javascript, */*; q=0.01', origin: 'https://accounts.insightly.com' },
      body: form({ emailaddress: email })
    })
    if (status !== 200) throw httpFailure('Insightly', status)
    return { ...parseInsightly(text), raw: text.trim().slice(0, 200) }
  }
})

// ---------------------------------------------------------------------------
// XVideos (à la demande : site pour adultes)

export function parseXvideos(json: { result?: boolean; code?: number; message?: string }): Parsed {
  if (json.result === true) return { found: false }
  const message = json.message ?? ''
  // Même code 1 pour une adresse prise et une adresse invalide : seul le message les distingue
  // (traduit, avec des entités HTML, selon la langue : « d&eacute;j&agrave; utilis&eacute; »).
  if (/already in use|d(?:é|&eacute;)j(?:à|&agrave;) utilis/i.test(message)) return { found: true }
  if (/invalid/i.test(message)) throw new ModuleError('XVideos : adresse refusée comme invalide', 'invalid_input')
  throw new ModuleError(`XVideos : réponse inattendue (${message.slice(0, 60) || json.code})`, 'other')
}

const xvideos = accountCheck({
  id: 'email.xvideos',
  service: 'XVideos',
  platform: 'xvideos',
  name: { fr: 'Compte XVideos (adulte)', en: 'XVideos account (adult)' },
  description: {
    fr: "Vérifie si l'adresse est déjà utilisée sur XVideos (site pour adultes ; une adresse exclue par son propriétaire est aussi signalée). Lancé uniquement sur demande.",
    en: 'Checks whether the address is already used on XVideos (adult website; an address excluded by its owner is reported too). Run on demand only.'
  },
  homepage: 'https://www.xvideos.com',
  ondemand: true,
  async check(email, ctx) {
    const { status, text } = await fetchBody(ctx, 'XVideos', 'https://www.xvideos.com/account/checkemail', {
      query: { email },
      headers: { ...ENGLISH, accept: 'application/json, text/javascript, */*; q=0.01', 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.xvideos.com/' }
    })
    if (status !== 200) throw httpFailure('XVideos', status)
    const json = parseJson<{ result?: boolean; code?: number; message?: string }>(text, 'XVideos')
    return { ...parseXvideos(json), raw: json }
  }
})

// ---------------------------------------------------------------------------
// Flickr

export function parseFlickr(json: { state_code?: string; stat?: string; code?: number; message?: string }): Parsed {
  // state_code 5 : adresse connue du service d'identité Flickr.
  if (json.state_code === '5') return { found: true }
  // Une adresse inconnue renvoie une erreur Cognito, comme d'autres incidents : rien ne permet de conclure à l'absence.
  if (json.stat === 'fail' && /cognito/i.test(json.message ?? '')) return { found: null }
  throw new ModuleError(`Flickr : réponse inattendue (${json.state_code ?? json.message ?? json.stat ?? '?'})`, 'other')
}

const flickr = accountCheck({
  id: 'email.flickr',
  service: 'Flickr',
  platform: 'flickr',
  description: {
    fr: "Vérifie si l'adresse est connue du service d'identité de Flickr. Seule la présence est concluante : une absence n'est jamais affirmée.",
    en: "Checks whether the address is known to Flickr's identity service. Only a match is conclusive: absence is never asserted."
  },
  homepage: 'https://www.flickr.com',
  async check(email, ctx) {
    const { text } = await fetchBody(ctx, 'Flickr', 'https://identity-api.flickr.com/migration', {
      query: { email },
      headers: { accept: 'application/json', origin: 'https://identity.flickr.com', referer: 'https://identity.flickr.com/login' }
    })
    const json = parseJson<{ state_code?: string; stat?: string; code?: number; message?: string }>(text, 'Flickr')
    return { ...parseFlickr(json), raw: json }
  }
})

export const modules = [firefox, rambler, codecademy, anydo, plurk, diigo, myspace, insightly, xvideos, flickr]
