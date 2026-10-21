// SDK des modules d'enrichissement. Un module reçoit une entité et renvoie de
// nouvelles entités, des liens et des propriétés à fusionner dans l'entité d'origine.
// Les modules s'exécutent dans le processus principal : ils ont accès au réseau
// (via ctx.fetch, qui respecte le proxy / Tor) mais pas à l'interface.

import type { I18nText, KeyRequirement, ModuleCategory, PropValue } from './types'

export interface InputEntity {
  id: string
  type: string
  label: string
  platform: string | null
  data: Record<string, PropValue>
  /** Pièce jointe servant d'image (photo importée, avatar). */
  imageId: string | null
}

export interface OutEntity {
  /** Référence locale permettant de lier des entités créées par le même module. */
  ref?: string
  type: string
  label: string
  platform?: string
  data?: Record<string, PropValue>
  /** URL d'une image (avatar, photo) : téléchargée via le proxy et jointe au nœud. */
  image?: string
  /** Parent du lien : `$input` (défaut) ou la `ref` d'une autre entité du résultat. */
  from?: string
  /** Libellé du lien créé depuis le parent. */
  linkLabel?: string
}

export interface OutLink {
  from: string
  to: string
  label?: string
}

export interface ModuleOutput {
  entities?: OutEntity[]
  links?: OutLink[]
  /** Propriétés fusionnées dans l'entité d'entrée. */
  properties?: Record<string, PropValue>
  /**
   * Pour les vérifications de compte : `true` si un compte existe, `false` sinon.
   * Laisser `undefined` quand la question ne se pose pas.
   */
  found?: boolean
  /** Réponse brute archivée pour consultation (tronquée si volumineuse). */
  raw?: unknown
}

export interface FetchOptions extends RequestInit {
  /** Délai maximal en millisecondes (défaut : réglage global). */
  timeoutMs?: number
  /** Corps JSON : sérialisé et envoyé avec `Content-Type: application/json`. */
  json?: unknown
  /** Paramètres ajoutés à l'URL. */
  query?: Record<string, string | number | undefined>
}

export interface HttpError extends Error {
  status: number
  body: string
}

export interface ModuleContext {
  /** fetch qui passe par le proxy / Tor configuré, avec User-Agent et délai. */
  fetch(url: string, init?: FetchOptions): Promise<Response>
  /** GET/POST JSON. Lève une erreur `HttpError` si le statut n'est pas 2xx. */
  fetchJson<T = unknown>(url: string, init?: FetchOptions): Promise<T>
  fetchText(url: string, init?: FetchOptions): Promise<string>
  /** Résolution DNS via DNS-over-HTTPS (passe par le proxy, pas de fuite DNS locale). */
  resolveDns(name: string, type: 'A' | 'AAAA' | 'MX' | 'NS' | 'TXT' | 'CNAME' | 'SOA' | 'PTR' | 'CAA' | 'SRV'): Promise<string[]>
  /** Clé API stockée dans le coffre. */
  key(id: string): string | undefined
  /** Contenu d'une pièce jointe de l'enquête (photo à analyser...). */
  attachment(id: string): Promise<{ mime: string; name: string; data: Buffer } | null>
  signal: AbortSignal
  userAgent: string
  lang: 'fr' | 'en'
  log(message: string): void
}

export interface OsintModule {
  id: string
  name: I18nText
  description: I18nText
  category: ModuleCategory
  /** Types d'entités acceptés en entrée. */
  inputTypes: string[]
  keys?: KeyRequirement[]
  /** Uniquement sur demande explicite (services payants à crédits). */
  ondemand?: boolean
  /** Peut alerter la cible (demande de réinitialisation, notification...). */
  noisy?: boolean
  experimental?: boolean
  homepage?: string
  timeoutMs?: number
  /** Filtre supplémentaire sur l'entité (ex. plateforme précise). */
  accepts?(input: InputEntity): boolean
  run(input: InputEntity, ctx: ModuleContext): Promise<ModuleOutput>
}

export function defineModule(m: OsintModule): OsintModule {
  return m
}

/** Erreur à lever quand le service répond mais refuse (quota, captcha...). */
export class ModuleError extends Error {
  constructor(
    message: string,
    readonly code: 'rate_limited' | 'auth' | 'blocked' | 'unavailable' | 'invalid_input' | 'other' = 'other'
  ) {
    super(message)
    this.name = 'ModuleError'
  }
}
