// Moteur de recherche de pseudo au format de la base Maigret (https://github.com/soxoj/maigret, MIT).
// Lecture des entrées (fusion des moteurs de forum, gabarits d'URL `{urlMain}{urlSubpath}`,
// `urlProbe`, `getParams`), détection `status_code`, `message` (chaîne de présence et absence
// des chaînes d'absence) et `response_url`, erreurs propres au site (`errors`), `regexCheck`
// converti depuis Python, en-têtes, méthode et corps de requête.

import type { ModuleContext } from '@shared/modules'
import { readBytes, wafFromHeaders, type SiteResult, type SiteStatus } from './_sherlock'

/** Entrée de la base Maigret, telle qu'elle est écrite dans `data.json` (champs lus par MASINT). */
export interface MaigretEntry {
  url?: string
  urlMain?: string
  urlSubpath?: string
  /** URL interrogée à la place de l'URL affichée (API, page de recherche). */
  urlProbe?: string
  getParams?: Record<string, string | number>
  checkType?: string
  /** Orthographe de Maigret : chaînes dont l'une doit figurer sur la page d'un compte. */
  presenseStrs?: string[]
  absenceStrs?: string[]
  /** Sous-chaîne → erreur : la page ne permet pas de conclure (captcha, quota, connexion requise). */
  errors?: Record<string, string>
  regexCheck?: string
  headers?: Record<string, string>
  requestMethod?: string
  requestPayload?: Record<string, unknown>
  requestHeadOnly?: boolean
  disabled?: boolean
  /** Type d'identifiant : `username` par défaut ; les autres (gaia_id, steam_id...) sont ignorés. */
  type?: string
  /** Protections connues (empreinte TLS, défi JavaScript...) : site sauté. */
  protection?: string[]
  /** Jeton à obtenir avant la requête (Twitter, Vimeo...) : site sauté. */
  activation?: Record<string, unknown>
  /** Recherche approximative : un résultat peut viser un pseudo proche. */
  similarSearch?: boolean
  ignore403?: boolean
  /** `tor`, `i2p`, `dns` : hors du web public, site sauté. */
  protocol?: string
  tags?: string[]
  alexaRank?: number
  engine?: string
  /** Pseudo témoin public fourni par la base, qui doit être trouvé. */
  usernameClaimed?: string
}

export interface MaigretData {
  sites: Record<string, MaigretEntry>
  engines?: Record<string, { site?: MaigretEntry }>
}

export type CheckType = 'status_code' | 'message' | 'response_url'

/** Site prêt à interroger : entrée fusionnée avec son moteur. */
export interface MaigretSite extends MaigretEntry {
  name: string
  checkType: CheckType
}

/** Raisons pour lesquelles un site de la base n'est jamais interrogé. */
export type SkipReason = 'disabled' | 'type' | 'protection' | 'activation' | 'protocol' | 'engine' | 'url' | 'check_type'

/** Tags réservés au module « sites adultes », lancé uniquement sur demande. */
export const NSFW_TAGS = ['porn', 'nsfw', 'dating']

const CHECK_TYPES: CheckType[] = ['status_code', 'message', 'response_url']

/**
 * Fusionne une entrée avec son moteur, comme Maigret (`update_from_engine`) : les listes
 * s'ajoutent, les dictionnaires (`errors`, `headers`) sont complétés par le moteur, les autres
 * champs du moteur ne s'appliquent que si l'entrée ne les fixe pas. `checkType` vaut
 * `status_code` quand ni l'entrée ni le moteur ne le précisent.
 */
export function mergeEntry(name: string, entry: MaigretEntry, engines: MaigretData['engines'] = {}): MaigretSite {
  const out: Record<string, unknown> = { ...entry }
  const engine = entry.engine ? engines[entry.engine]?.site : undefined
  for (const [k, v] of Object.entries(engine ?? {})) {
    const own = out[k]
    if (Array.isArray(v)) out[k] = [...(Array.isArray(own) ? own : []), ...v]
    else if (v && typeof v === 'object') out[k] = { ...(own && typeof own === 'object' ? own : {}), ...v }
    else if (!(k in entry)) out[k] = v
  }
  return { ...(out as MaigretEntry), name, checkType: ((out.checkType as CheckType | undefined) ?? 'status_code') as CheckType }
}

/** Pourquoi un site fusionné ne sera pas interrogé (null : il le sera). */
export function skipReason(site: MaigretSite, entry: MaigretEntry, engines: MaigretData['engines'] = {}): SkipReason | null {
  if (site.disabled) return 'disabled'
  if ((site.type ?? 'username') !== 'username') return 'type'
  if (site.protection?.length) return 'protection'
  if (site.activation && Object.keys(site.activation).length) return 'activation'
  if (site.protocol && !/^https?$/i.test(site.protocol)) return 'protocol'
  if (entry.engine && !engines[entry.engine]) return 'engine'
  if (!CHECK_TYPES.includes(site.checkType)) return 'check_type'
  const url = typeof site.url === 'string' ? site.url : ''
  if (!url.includes('{username}') || !/^(https?:\/\/|\{urlMain\})/.test(url)) return 'url'
  if (!/^https?:\/\//.test(url) && !/^https?:\/\//.test(site.urlMain ?? '')) return 'url'
  return null
}

export const isNsfw = (site: Pick<MaigretEntry, 'tags'>): boolean => !!site.tags?.some((t) => NSFW_TAGS.includes(t))

// Gabarits ---------------------------------------------------------------------

/**
 * Équivalent de `str.format` de Python : `{nom}` est remplacé, `{{` et `}}` deviennent des
 * accolades. Renvoie null si le gabarit cite un champ inconnu (Python lèverait une erreur).
 */
export function pyFormat(template: string, vars: Record<string, string>): string | null {
  let unknown = false
  const out = template.replace(/\{\{|\}\}|\{([A-Za-z_]\w*)\}/g, (m, key: string | undefined) => {
    if (m === '{{') return '{'
    if (m === '}}') return '}'
    if (key !== undefined && Object.prototype.hasOwnProperty.call(vars, key)) return vars[key]
    unknown = true
    return m
  })
  return unknown ? null : out
}

/**
 * Encodage du pseudo dans une URL, comme `urllib.parse.quote` de Python (lettres, chiffres et
 * `_.-~` gardés), à une différence près : `/` est aussi encodé, pour qu'un pseudo ne puisse pas
 * viser un autre chemin du site.
 */
export function quoteUsername(username: string): string {
  return encodeURIComponent(username).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

const vars = (site: MaigretSite, username: string): Record<string, string> => ({
  urlMain: site.urlMain ?? '',
  urlSubpath: site.urlSubpath ?? '',
  username: quoteUsername(username)
})

/** URL publique du profil (doubles barres obliques réduites, comme Maigret). Null si le gabarit est invalide. */
export function profileUrl(site: MaigretSite, username: string): string | null {
  const url = typeof site.url === 'string' ? pyFormat(site.url, vars(site, username)) : null
  return url ? url.replace(/(?<!:)\/{2,}/g, '/') : null
}

/** URL interrogée : `urlProbe` si présente, sinon l'URL du profil ; `getParams` ajoutés. */
export function probeUrl(site: MaigretSite, username: string): string | null {
  let url = site.urlProbe ? pyFormat(site.urlProbe, vars(site, username)) : profileUrl(site, username)
  if (!url) return null
  for (const [k, v] of Object.entries(site.getParams ?? {})) {
    url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
  }
  return url
}

/**
 * Corps de requête : les valeurs texte de premier niveau sont des gabarits (`{username}`).
 * Le pseudo est échappé comme dans une chaîne JSON quand il est inséré dans un texte plus long
 * (requête GraphQL) : un guillemet ne peut pas sortir de la chaîne.
 */
export function formatPayload(payload: Record<string, unknown>, username: string): Record<string, unknown> | null {
  const escaped = JSON.stringify(username).slice(1, -1)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v !== 'string') {
      out[k] = v
      continue
    }
    const formatted = pyFormat(v, { username: v.trim() === '{username}' ? username : escaped })
    if (formatted === null) return null
    out[k] = formatted
  }
  return out
}

// regexCheck -------------------------------------------------------------------

/** Longueur maximale d'un pseudo soumis à une expression de la base (protection contre les ReDoS). */
export const MAX_REGEX_INPUT = 64
/** Longueur maximale d'une expression acceptée. */
const MAX_REGEX_SOURCE = 300

/**
 * Quantificateur appliqué à un groupe qui contient lui-même un quantificateur (`(a+)+`,
 * `(-\w+)*`) : forme typique des retours arrière exponentiels. L'expression est alors écartée.
 */
export function hasNestedQuantifier(src: string): boolean {
  // Pour chaque groupe ouvert : contient-il un quantificateur ?
  const stack: boolean[] = []
  // Le dernier élément lu est un groupe qui contenait un quantificateur.
  let quantifiedGroup = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') {
      i++
      quantifiedGroup = false
      continue
    }
    if (c === '[') {
      i++
      if (src[i] === '^') i++
      if (src[i] === ']') i++
      while (i < src.length && src[i] !== ']') {
        if (src[i] === '\\') i++
        i++
      }
      quantifiedGroup = false
      continue
    }
    if (c === '(') {
      stack.push(false)
      quantifiedGroup = false
      // Préfixe du groupe : (?: (?= (?! (?<= (?<! (?<nom> (?P<nom> (?P=nom)
      if (src[i + 1] === '?') {
        i++
        if (src[i + 1] === 'P') i++
        const next = src[i + 1]
        if (next === '<' && src[i + 2] !== '=' && src[i + 2] !== '!') i = Math.max(i, src.indexOf('>', i))
        else if (next === '<') i += 2
        else if (next === ':' || next === '=' || next === '!') i++
      }
      continue
    }
    if (c === ')') {
      const inner = stack.pop() ?? false
      if (inner && stack.length) stack[stack.length - 1] = true
      quantifiedGroup = inner
      continue
    }
    const brace = c === '{' ? /^\{(\d*)(,?)(\d*)\}/.exec(src.slice(i)) : null
    if (c === '*' || c === '+' || c === '?' || brace) {
      // Répétition : `*`, `+`, ou `{n,m}` qui autorise plus d'une occurrence.
      const max = brace ? (brace[2] ? brace[3] : brace[1]) : ''
      const repeats = c === '*' || c === '+' || (!!brace && (max === '' || Number(max) > 1))
      if (repeats && quantifiedGroup) return true
      if (stack.length) stack[stack.length - 1] = true
      if (brace) i += brace[0].length - 1
      // `+?`, `*?` : quantificateur paresseux, pas un second quantificateur.
      if (src[i + 1] === '?') i++
      quantifiedGroup = false
      continue
    }
    quantifiedGroup = false
  }
  return false
}

const regexCache = new Map<string, RegExp | null>()

/**
 * Convertit une expression Python en RegExp JavaScript : groupes nommés `(?P<n>...)` et
 * `(?P=n)`, ancres `\A` et `\Z`, drapeaux en tête (`(?i)`), `{,n}`. Les constructions sans
 * équivalent (groupes atomiques, quantificateurs possessifs, mode verbeux) et les expressions à
 * risque de ReDoS donnent null : le contrôle est alors sauté.
 */
export function convertPythonRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!
  const result = ((): RegExp | null => {
    if (typeof pattern !== 'string' || !pattern || pattern.length > MAX_REGEX_SOURCE) return null
    let src = pattern
    let flags = ''
    const lead = /^\(\?([aiLmsux]+)\)/.exec(src)
    if (lead) {
      if (/[xL]/.test(lead[1])) return null
      if (lead[1].includes('i')) flags += 'i'
      if (lead[1].includes('m')) flags += 'm'
      if (lead[1].includes('s')) flags += 's'
      src = src.slice(lead[0].length)
    }
    // Groupes atomiques, quantificateurs possessifs, \G, drapeaux en cours d'expression.
    if (/\(\?>|[*+?}]\+|\\G|\(\?[aiLmsux]+\)/.test(src)) return null
    src = src
      .replace(/\(\?P<([A-Za-z_]\w*)>/g, '(?<$1>')
      .replace(/\(\?P=([A-Za-z_]\w*)\)/g, '\\k<$1>')
      .replace(/\\A/g, '^')
      .replace(/\\Z/g, '$')
      .replace(/\{,(\d+)\}/g, '{0,$1}')
    if (hasNestedQuantifier(src)) return null
    for (const f of [`${flags}u`, flags]) {
      try {
        return new RegExp(src, f)
      } catch {
        /* syntaxe refusée avec ce drapeau : essai suivant */
      }
    }
    return null
  })()
  regexCache.set(pattern, result)
  return result
}

/**
 * Le pseudo respecte-t-il le format imposé par le site (`re.search`, non ancré) ? Une expression
 * non convertible n'empêche pas la recherche ; un pseudo trop long pour être testé sans risque est
 * refusé.
 */
export function isLegalFor(site: Pick<MaigretEntry, 'regexCheck'>, username: string): boolean {
  if (!site.regexCheck) return true
  const re = convertPythonRegex(site.regexCheck)
  if (!re) return true
  if (username.length > MAX_REGEX_INPUT) return false
  return re.test(username)
}

// Détection --------------------------------------------------------------------

/**
 * Pages de protection et d'erreur génériques reconnues par Maigret (`errors.py`) et par
 * Sherlock : la réponse ne permet pas de conclure.
 */
export const COMMON_ERRORS: Record<string, string> = {
  '<title>Attention Required! | Cloudflare</title>': 'Cloudflare (captcha)',
  '<title>Just a moment': 'Cloudflare (défi)',
  'Please stand by, while we are checking your browser': 'Cloudflare',
  '<span data-translate="checking_browser">Checking your browser before accessing</span>': 'Cloudflare',
  'This website is using a security service to protect itself from online attacks.': 'Cloudflare',
  '<span id="challenge-error-text">': 'Cloudflare (défi)',
  '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page': 'Cloudflare (défi)',
  '<title>Доступ ограничен</title>': 'censure (Rostelecom)',
  'Доступ к информационному ресурсу ограничен на основании Федерального закона': 'censure',
  "document.getElementById('validate_form_submit').disabled=true": 'captcha (Mail.ru)',
  'Verifying your browser, please wait...<br>DDoS Protection by</font> Blazingfast.io': 'Blazingfast',
  'Incapsula incident ID': 'Incapsula',
  '<title>Client Challenge</title>': 'défi anti-robot',
  '<title>DDoS-Guard</title>': 'DDoS-Guard',
  'Сайт заблокирован хостинг-провайдером': 'site bloqué par l’hébergeur',
  'Generated by cloudfront (CloudFront)': 'CloudFront',
  SlardarWAF: 'pare-feu applicatif',
  '/.within.website/x/': 'Anubis (preuve de travail)',
  'window.POW_CHALLENGE_DATA': 'preuve de travail',
  '<title>Vercel Security Checkpoint</title>': 'Vercel',
  'unusual traffic from your computer network': 'captcha (Google)',
  'id="gs_captcha_f"': 'captcha (Google)',
  'google.com/recaptcha/challengepage/': 'reCAPTCHA',
  'AwsWafIntegration.forceRefreshToken': 'AWS WAF',
  '{return l.onPageView}}),Object.defineProperty(r,"perimeterxIdentifiers",{enumerable:': 'PerimeterX'
}

export interface Verdict {
  status: SiteStatus
  error?: string
}

/**
 * Décision à partir de la réponse, selon les règles de Maigret (`process_site_result`,
 * `detect_error_page`) :
 * 1. défi anti-robot signalé par les en-têtes, erreurs propres au site, pages de protection
 *    génériques, puis statuts 401, 403 (sauf `ignore403`), 429, 999 et 5xx : pas de conclusion ;
 * 2. `message` : compte si une chaîne de présence figure sur la page (aucune chaîne : toujours
 *    vrai) et aucune chaîne d'absence ; `status_code` : compte si 2xx ; `response_url`
 *    (redirections non suivies) : compte si 2xx et présence.
 * Écart volontaire, comme pour Sherlock : une page `message` en 4xx qui ressemble à un compte
 * est une erreur, pas un compte.
 */
export function evaluateMaigret(site: MaigretSite, res: { status: number; text: string; headers?: Headers }, username = ''): Verdict {
  if (wafFromHeaders(res.headers)) return { status: 'waf', error: 'défi anti-robot' }
  const text = res.text ?? ''
  if (text) {
    for (const [flag, msg] of Object.entries(site.errors ?? {})) if (flag && text.includes(flag)) return { status: 'error', error: msg }
    for (const [flag, msg] of Object.entries(COMMON_ERRORS)) if (text.includes(flag)) return { status: 'waf', error: msg }
  }
  const s = res.status
  if (s === 403 && !site.ignore403) return { status: 'error', error: 'HTTP 403' }
  if (s === 401 || s === 429 || s === 999 || s >= 500) return { status: 'error', error: `HTTP ${s}` }

  const presence = site.presenseStrs ?? []
  let present = false
  if (text) {
    if (!presence.length) {
      // Pseudo non ASCII absent de la page : page générique, pas un profil (Maigret #2633).
      present = !/[^\x00-\x7f]/.test(username) || text.includes(username)
    } else present = presence.some((p) => p && text.includes(p))
  }
  switch (site.checkType) {
    case 'message': {
      const absent = (site.absenceStrs ?? []).some((a) => a && text.includes(a))
      if (absent || !present) return { status: 'available' }
      return s >= 400 && !(s === 403 && site.ignore403) ? { status: 'error', error: `HTTP ${s}` } : { status: 'claimed' }
    }
    case 'status_code':
      return { status: s >= 200 && s < 300 ? 'claimed' : 'available' }
    case 'response_url':
      return { status: s >= 200 && s < 300 && present ? 'claimed' : 'available' }
    default:
      return { status: 'error', error: 'type de détection inconnu' }
  }
}

/** Corps maximal lu par requête. */
const MAX_BODY = 2 * 1024 * 1024

/**
 * Décode le corps selon le jeu de caractères annoncé (en-tête `Content-Type`, sinon balise
 * `<meta charset>` du début de la page), comme Maigret : de nombreux sites russes servent
 * encore du windows-1251, et leurs messages d'absence seraient illisibles en UTF-8.
 */
export function decodeBody(buf: Buffer, contentType: string | null | undefined): string {
  const fromHeader = /charset=["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1]
  const fromMeta = fromHeader ? undefined : /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(buf.subarray(0, 2048).toString('latin1'))?.[1]
  const label = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase()
  if (label === 'utf-8' || label === 'utf8') return buf.toString('utf8')
  try {
    return new TextDecoder(label).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

/** Interroge un site pour un pseudo. Ne lève jamais : les erreurs sont rapportées dans le résultat. */
export async function checkMaigretSite(site: MaigretSite, username: string, ctx: ModuleContext, timeoutMs = 12000): Promise<SiteResult> {
  const url = profileUrl(site, username)
  const probe = probeUrl(site, username)
  if (!url || !probe) return { site: site.name, url: url ?? site.urlMain ?? '', status: 'error', error: 'gabarit d’URL invalide' }
  if (!isLegalFor(site, username)) return { site: site.name, url, status: 'illegal' }
  const method = (site.requestMethod ?? (site.checkType === 'status_code' && site.requestHeadOnly ? 'HEAD' : 'GET')).toUpperCase()
  const headers: Record<string, string> = { accept: '*/*', 'accept-language': 'en-US,en;q=0.9' }
  for (const [k, v] of Object.entries(site.headers ?? {})) if (typeof v === 'string') headers[k.toLowerCase()] = v
  let body: { json?: unknown; body?: string } = {}
  if (method === 'POST' && site.requestPayload && Object.keys(site.requestPayload).length) {
    const payload = formatPayload(site.requestPayload, username)
    if (!payload) return { site: site.name, url, status: 'error', error: 'corps de requête invalide' }
    body =
      headers['content-type'] === 'application/x-www-form-urlencoded'
        ? { body: new URLSearchParams(Object.entries(payload).map(([k, v]): [string, string] => [k, String(v)])).toString() }
        : { json: payload }
  }
  try {
    const res = await ctx.fetch(probe, {
      method,
      headers,
      redirect: site.checkType === 'response_url' ? 'manual' : 'follow',
      timeoutMs,
      ...body
    })
    const waf = wafFromHeaders(res.headers)
    if (method === 'HEAD' || waf) await res.body?.cancel().catch(() => undefined)
    const text = method === 'HEAD' || waf ? '' : decodeBody(await readBytes(res, MAX_BODY), res.headers.get('content-type'))
    const verdict = evaluateMaigret(site, { status: res.status, text, headers: res.headers }, username)
    return { site: site.name, url, status: verdict.status, httpStatus: res.status, ...(verdict.error ? { error: verdict.error } : {}) }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } }
    const detail = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : (err.cause?.code ?? err.cause?.message ?? err.message)
    return { site: site.name, url, status: 'error', error: String(detail).slice(0, 200) }
  }
}
