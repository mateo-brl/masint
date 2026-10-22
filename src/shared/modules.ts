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
  /** URL d'origine de cette image quand elle a été téléchargée par un module. */
  imageOrigin?: string | null
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
  /**
   * Résultat non vérifié (pseudo généré, homonyme possible, correspondance approximative).
   * Il n'entre pas dans le graphe : il attend dans « À vérifier » que l'enquêteur le valide.
   * Une entité qui existe déjà dans l'enquête est reliée directement.
   */
  review?: boolean
  /** Pourquoi le résultat est à vérifier, affiché à l'enquêteur (« homonyme possible »...). */
  reviewReason?: string
}

/**
 * Recherche que MASINT ne peut pas faire seul (service sans API, compte requis, captcha).
 * Proposée dans « À vérifier » avec un bouton d'ouverture, jamais ajoutée au graphe.
 */
export interface OutManualCheck {
  /** Service ou moteur (« Truecaller », « Pages Blanches »). */
  label: string
  url: string
  /** Ce qu'il faut regarder sur la page, si utile. */
  hint?: string
}

export interface OutLink {
  from: string
  to: string
  label?: string
}

export interface ModuleOutput {
  entities?: OutEntity[]
  links?: OutLink[]
  /** Recherches à faire à la main, proposées dans « À vérifier ». */
  manual?: OutManualCheck[]
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
  attachment(id: string): Promise<{ mime: string; name: string; data: Buffer; origin: string | null } | null>
  signal: AbortSignal
  userAgent: string
  lang: 'fr' | 'en'
  log(message: string): void
  /**
   * Avancement interne d'un module long (« 23 / 57 plateformes · WhatsApp »), affiché dans la
   * pastille de progression. Appels fréquents sans risque : l'envoi est espacé par le moteur.
   */
  progress(done: number, total: number, detail?: string): void
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
