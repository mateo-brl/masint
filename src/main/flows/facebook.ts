// Recherche assistée scriptée : page « Retrouvez votre compte » de Facebook. MASINT saisit le
// numéro ou l'email, valide la recherche, puis lit la page de résultats : comptes candidats
// (nom affiché, photo) ou, quand un seul compte correspond, la page des options de
// récupération et ses contacts masqués (« Envoyer le code par SMS +33 ••• •• •• 03 »).
//
// Méthode silencieuse : le parcours ne clique jamais sur « Continuer », « Envoyer », « Send »
// ni « Submit ». La recherche est lancée par la touche Entrée dans le champ ; la seule action de
// clic de tout le parcours est le bouton « Rechercher » du formulaire d'identification, en
// secours si Entrée n'a pas suffi, et seulement sur ce formulaire (voir `facebookSubmitScript`).
// Aucun code n'est envoyé, la personne recherchée n'est pas prévenue.
//
// Les scripts de page et la lecture des résultats sont purs, testés sur des pages simulées ; le
// déroulé (`runFacebookIdentify`) ne dépend que d'une interface de page, simulée dans les tests.

import { isDefaultAvatar } from '@shared/avatars'
import { normalizePhone } from '@shared/detect'
import type { OutManualCheck } from '@shared/modules'
import type { AssistExtracted } from '@shared/types'
import { parseHint } from '../modules/hints/_mask'
import { maskMatches } from '../modules/roso/_parse'

export const FACEBOOK_IDENTIFY_URL = 'https://www.facebook.com/login/identify/?ctx=recover'

/**
 * Facebook « Retrouvez votre compte » : recherche assistée scriptée (numéro ou email). MASINT lit
 * les comptes candidats et les contacts de récupération masqués, sans demander d'envoi de code.
 */
export function facebookIdentifyCheck(lang: 'fr' | 'en' = 'fr'): OutManualCheck {
  return {
    label: lang === 'fr' ? 'Facebook : retrouver le compte' : 'Facebook: find the account',
    url: FACEBOOK_IDENTIFY_URL,
    hint:
      lang === 'fr'
        ? 'MASINT saisit la valeur sur la page de récupération de Facebook et lit le nom, la photo et les contacts de récupération masqués. Il ne clique jamais sur Continuer : aucun code n’est envoyé.'
        : 'MASINT types the value on the Facebook recovery page and reads the name, picture and masked recovery contacts. It never clicks Continue: no code is sent.',
    flow: 'facebook_identify'
  }
}

/** Valeur saisie : numéro au format international, email en minuscules ; `null` sinon. */
export function facebookValue(type: string, label: string): string | null {
  if (type === 'phone') return normalizePhone(label)
  if (type === 'email') {
    const e = label.trim().toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) ? e : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Scripts de page

/** Fonctions communes : champ d'identification, visibilité, texte d'un élément. */
const HELPERS = `
  const visible = (el) => !!el && (el.offsetParent !== null || (typeof el.getClientRects === 'function' && el.getClientRects().length > 0))
  const txt = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim()
  const identifyInput = () =>
    document.querySelector('#identify_email') ||
    document.querySelector('input[name=email]') ||
    [...document.querySelectorAll('form input')].find((i) => /^(text|email|tel|search)?$/i.test(i.getAttribute('type') || '') && visible(i)) ||
    null
  const onOptions = () => !!document.querySelector('input[type=radio], [role=radio]')
  const onIdentify = () => /^\\/login\\/identify/.test(location.pathname)
`

/**
 * Prépare la saisie : vide le champ d'identification et lui donne le focus. Ne fait rien hors du
 * formulaire d'identification (page des options de récupération comprise). Aucun clic.
 */
export const FACEBOOK_FILL = `(() => {${HELPERS}
  if (onOptions()) return { ok: false, reason: 'options' }
  if (!onIdentify()) return { ok: false, reason: 'page' }
  const input = identifyInput()
  if (!input) return { ok: false, reason: 'no_input' }
  // Valeur vidée par le mutateur natif : React voit le changement.
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  if (desc && desc.set) desc.set.call(input, '')
  else input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
  return { ok: document.activeElement === input, reason: '' }
})()`

/** La valeur tapée est bien dans le champ d'identification, qui a le focus. */
export function facebookTypedScript(value: string): string {
  return `(() => {${HELPERS}
  const input = identifyInput()
  return !!input && document.activeElement === input && (input.value || '').trim() === ${JSON.stringify(value)}
})()`
}

/**
 * Seule action de clic du parcours, en secours si la touche Entrée n'a pas lancé la recherche :
 * le bouton « Rechercher » (« Search ») du formulaire d'identification. Jamais un bouton
 * « Continuer », « Envoyer », « Send » ou « Submit », même sur la nouvelle page dont le bouton de
 * recherche s'appelle « Continuer » (la touche Entrée y suffit). Refusé hors de ce formulaire,
 * sur la page des options de récupération, et si le champ ne contient pas la valeur cherchée.
 */
export function facebookSubmitScript(value: string): string {
  return `(() => {${HELPERS}
  if (onOptions()) return { clicked: false, reason: 'options' }
  if (!onIdentify()) return { clicked: false, reason: 'page' }
  const input = identifyInput()
  if (!input || (input.value || '').trim() !== ${JSON.stringify(value)}) return { clicked: false, reason: 'no_input' }
  const label = (b) => String(b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase()
  const SEARCH = /^(rechercher|search|buscar|cerca|suchen)$/
  let button = document.querySelector('#did_submit')
  if (!button && input.form) button = input.form.querySelector('button[type=submit], input[type=submit]')
  if (!button) {
    const list = [...document.querySelectorAll('button, [role=button], input[type=submit]')].filter((b) => SEARCH.test(label(b)) && visible(b))
    if (list.length === 1) button = list[0]
  }
  if (!button || !SEARCH.test(label(button))) return { clicked: false, reason: 'no_button' }
  button.click()
  return { clicked: true, reason: label(button) }
})()`
}

/**
 * Lecture de la page, sans aucun clic : candidats (nom, photo), libellés des options de
 * récupération, lignes qui contiennent un contact masqué, message « aucun compte ».
 */
export const FACEBOOK_READ = `(() => {${HELPERS}
  const body = (document.body && (document.body.innerText || document.body.textContent)) || ''
  const out = { url: location.href, path: location.pathname, title: document.title, state: 'unknown', candidates: [], options: [], masked: [], message: '', login: false }
  const seen = new Set()
  const add = (name, photo) => {
    name = (name || '').replace(/\\s+/g, ' ').trim()
    if (!name || name.length > 120 || seen.has(name)) return
    seen.add(name)
    out.candidates.push({ name, photo: photo || '' })
  }
  // Candidats de la nouvelle page : photo annoncée « Photo de profil, Nom ».
  const PHOTO = /^(?:photo de profil|photo du profil|profile picture|profile photo|foto del perfil|foto de perfil|foto del profilo|immagine del profilo|profilbild)\\s*,\\s*(.+)$/i
  for (const el of document.querySelectorAll('[role=img][aria-label], img[alt]')) {
    const m = String(el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().match(PHOTO)
    if (!m) continue
    const img = el.tagName === 'IMG' ? el : el.querySelector('image, img')
    add(m[1], img ? img.getAttribute('xlink:href') || img.getAttribute('href') || img.getAttribute('src') : '')
  }
  // Ancienne page : ligne de résultat avec « C'est mon compte » ou « This is my account ».
  if (!out.candidates.length) {
    const MINE = /^(c[’']est mon compte|this is my account|c[’']est moi|this is me|it[’']s me)$/i
    for (const b of document.querySelectorAll('a, button, [role=button]')) {
      if (!MINE.test(txt(b))) continue
      const row = b.closest('tr, li, [role=row], [role=listitem]') || b.parentElement
      if (!row) continue
      const lines = String(row.innerText || row.textContent || '').split('\\n').map((l) => l.trim()).filter((l) => l && !MINE.test(l))
      const img = row.querySelector('img')
      add(lines[0], img ? img.getAttribute('src') : '')
    }
  }
  // Options de récupération : libellés des boutons radio, lus sans jamais les cocher.
  for (const r of document.querySelectorAll('input[type=radio], [role=radio]')) {
    let label = ''
    const id = r.getAttribute('id')
    if (id) {
      for (const l of document.querySelectorAll('label[for]')) if (l.getAttribute('for') === id) label = txt(l)
    }
    if (!label) label = txt(r.closest('label'))
    if (!label) label = String(r.getAttribute('aria-label') || '').trim()
    if (!label) label = txt(r.parentElement && (r.parentElement.parentElement || r.parentElement))
    if (label) out.options.push(label.slice(0, 300))
  }
  // Page des options de l'ancienne interface : nom et photo du compte, à côté des options.
  const radio = document.querySelector('input[type=radio], [role=radio]')
  if (radio && !out.candidates.length) {
    const box = radio.closest('form') || document.querySelector('[role=main]') || document.body
    for (const img of box.querySelectorAll('img')) {
      const src = img.getAttribute('src') || ''
      const holder = img.parentElement
      if (!/^https:\\/\\//i.test(src) || !holder || holder.closest('label')) continue
      const lines = String(holder.innerText || '').split('\\n').map((l) => l.trim()).filter((l) => l && !/^(utilisateur facebook|facebook user)$/i.test(l))
      if (lines[0] && !/[@\\d]/.test(lines[0])) {
        add(lines[0], src)
        break
      }
    }
  }
  // Lignes qui contiennent un contact masqué (adresse ou numéro), quelle que soit la mise en page.
  for (const line of body.split('\\n')) {
    const l = line.trim()
    if (l && l.length <= 200 && /[*•●∗]/.test(l) && /[@\\d]/.test(l)) out.masked.push(l)
    if (out.masked.length >= 20) break
  }
  out.login = [...document.querySelectorAll('input[type=password]')].some(visible)
  const NONE = /(aucun compte trouv[ée]|aucun r[ée]sultat|no account found|no search results|did not return any results|didn[’']t return any results|ne correspond [àa] aucun compte|ning[úu]n resultado|nessun risultato|kein konto gefunden)[^\\n]*/i
  const none = body.match(NONE)
  if (out.options.length) out.state = 'options'
  else if (none) {
    out.state = 'none'
    out.message = none[0].trim().slice(0, 200)
  } else if (out.candidates.length) out.state = 'candidates'
  else if (/^\\/recover\\//.test(location.pathname) && out.masked.length) out.state = 'options'
  else if (onIdentify() && identifyInput()) out.state = 'form'
  return out
})()`

/** Lecture brute de la page (voir `FACEBOOK_READ`). */
export interface FacebookRead {
  url: string
  path: string
  title: string
  state: 'candidates' | 'options' | 'none' | 'form' | 'unknown'
  candidates: Array<{ name: string; photo: string }>
  options: string[]
  masked: string[]
  message: string
  login: boolean
}

// ---------------------------------------------------------------------------
// Lecture des résultats

const EMAIL_TOKEN = /[^\s@:,;()<>"'«»]*@[^\s@:,;()<>"'«»]+/g
const PHONE_RUN = /\+?[\d*•●∗xX#][\d*•●∗xX#\s.\-()]{3,}[\d*•●∗xX#]/g
const MASK_CHAR = /[*•●∗]/

/** Emails et téléphones masqués cités dans des libellés (« Envoyer le code par SMS +33 ••• •• •• 03 »). */
export function maskedContacts(texts: string[]): { emails: string[]; phones: string[] } {
  const emails = new Set<string>()
  const phones = new Set<string>()
  for (const text of texts) {
    for (const m of text.match(EMAIL_TOKEN) ?? []) {
      const v = m.replace(/[.,;:]+$/, '')
      if (MASK_CHAR.test(v) && parseHint(v)?.kind === 'email') emails.add(v)
    }
    for (const m of text.replace(EMAIL_TOKEN, ' ').match(PHONE_RUN) ?? []) {
      const v = m.trim()
      if (MASK_CHAR.test(v) && /\d/.test(v) && parseHint(v)?.kind === 'phone') phones.add(v)
    }
  }
  return { emails: [...emails], phones: [...phones] }
}

const MASKED_NAME = /\.{2,}|…|[*•●∗]/
const digits = (s: string): string => s.replace(/\D+/g, '')

/** Nom qui n'en est pas un : la valeur cherchée elle-même, un numéro ou une adresse. */
function notAName(name: string, searched: string): boolean {
  if (name.toLowerCase() === searched.toLowerCase()) return true
  if (name.includes('@')) return true
  const d = digits(name)
  return d.length >= 6 && (d === digits(searched) || d.length >= name.replace(/[\s+().-]/g, '').length - 1)
}

/**
 * Résultat lu sur la page, pour « À vérifier » : noms complets et noms masqués des candidats,
 * photos (hors silhouettes par défaut), contacts de récupération masqués. Les contacts masqués
 * compatibles avec la valeur cherchée (le numéro lui-même, masqué) sont écartés.
 */
export function facebookExtract(read: FacebookRead | null, searched: string): AssistExtracted {
  const empty: AssistExtracted = { state: 'unknown', names: [], maskedNames: [], usernames: [], maskedEmails: [], maskedPhones: [], photos: [] }
  if (!read) return empty
  const names: string[] = []
  const maskedNames: string[] = []
  const photos: string[] = []
  const photoOf: Record<string, string> = {}
  for (const c of read.candidates) {
    if (notAName(c.name, searched)) continue
    if (MASKED_NAME.test(c.name)) maskedNames.push(c.name)
    else names.push(c.name)
    if (c.photo && /^https:\/\//i.test(c.photo) && !isDefaultAvatar(c.photo)) {
      photos.push(c.photo)
      photoOf[c.name] = c.photo
    }
  }
  const contacts = maskedContacts([...read.options, ...read.masked])
  const notSelf = (mask: string): boolean => !maskMatches(mask, searched)
  const state: AssistExtracted['state'] = read.state === 'form' ? 'unknown' : read.state
  return {
    state,
    names: [...new Set(names)],
    maskedNames: [...new Set(maskedNames)],
    usernames: [],
    maskedEmails: contacts.emails.filter(notSelf),
    maskedPhones: contacts.phones.filter(notSelf),
    photos: [...new Set(photos)],
    ...(Object.keys(photoOf).length ? { photoOf } : {})
  }
}

// ---------------------------------------------------------------------------
// Déroulé

/** Page de la fenêtre d'assistance, réduite à ce dont le parcours a besoin (simulée en test). */
export interface FlowPage {
  /** Exécute un script dans la page ; `null` si la page change pendant l'exécution. */
  run<T>(script: string): Promise<T | null>
  /** Frappe du texte dans le champ qui a le focus. */
  type(text: string): Promise<void>
  /** Touche Entrée dans le champ qui a le focus. */
  enter(): Promise<void>
  /** Affiche la fenêtre pour que l'enquêteur résolve une vérification. */
  show(reason: string): void
  closed(): boolean
  sleep(ms: number): Promise<void>
}

/** Inspection sans clic : vérification anti-robot à résoudre par l'enquêteur. */
export type Inspect = (page: FlowPage) => Promise<{ captcha: boolean } | null>

export interface FlowOutcome {
  status: 'ok' | 'cancelled' | 'timeout' | 'error'
  read: FacebookRead | null
  error?: string
  /** Bouton de recherche cliqué en secours (la touche Entrée n'avait pas suffi). */
  clicked?: boolean
}

export const FLOW_TIMING = {
  /** Attente des résultats sans action de l'enquêteur. */
  loadMs: 45_000,
  /** Attente quand la fenêtre s'est affichée pour une vérification. */
  actionMs: 4 * 60_000,
  /** Délai avant le clic de secours sur le bouton de recherche. */
  submitFallbackMs: 6_000,
  pollMs: 700,
  settleMs: 1_000
}

/**
 * Déroulé sur la page d'identification déjà chargée (bandeau de cookies refusé) : saisie, Entrée,
 * attente de la page de résultats, lecture. Le seul clic possible est `facebookSubmitScript`.
 */
export async function runFacebookIdentify(page: FlowPage, value: string, inspect: Inspect): Promise<FlowOutcome> {
  const fill = await page.run<{ ok: boolean; reason: string }>(FACEBOOK_FILL)
  if (page.closed()) return { status: 'cancelled', read: null }
  if (!fill?.ok) return { status: 'error', read: await page.run<FacebookRead>(FACEBOOK_READ), error: `facebook_form:${fill?.reason ?? 'none'}` }
  await page.type(value)
  if (!(await page.run<boolean>(facebookTypedScript(value)))) return { status: 'error', read: await page.run<FacebookRead>(FACEBOOK_READ), error: 'facebook_typing' }
  await page.enter()

  const start = Date.now()
  let asked = false
  let clicked = false
  let tried = false
  let last: FacebookRead | null = null
  while (!page.closed()) {
    if (Date.now() - start > (asked ? FLOW_TIMING.actionMs : FLOW_TIMING.loadMs)) return { status: 'timeout', read: last, clicked }
    const state = await inspect(page)
    if (state?.captcha && !asked) {
      page.show('facebook_check')
      asked = true
    }
    const read = await page.run<FacebookRead>(FACEBOOK_READ)
    if (read) last = read
    if (read && (read.state === 'candidates' || read.state === 'options' || read.state === 'none')) {
      // Laisse le temps aux photos et aux libellés de s'afficher, puis relit.
      await page.sleep(FLOW_TIMING.settleMs)
      return { status: 'ok', read: (await page.run<FacebookRead>(FACEBOOK_READ)) ?? read, clicked }
    }
    // Page de connexion : Facebook ne montre pas de résultat sans compte, rien à lire.
    if (read?.login && !asked) return { status: 'ok', read, clicked }
    // Une seule tentative de clic de secours, sur le formulaire d'identification seulement.
    if (!tried && !asked && read?.state === 'form' && Date.now() - start > FLOW_TIMING.submitFallbackMs) {
      tried = true
      const r = await page.run<{ clicked: boolean }>(facebookSubmitScript(value))
      clicked = !!r?.clicked
    }
    await page.sleep(FLOW_TIMING.pollMs)
  }
  return { status: 'cancelled', read: last, clicked }
}
