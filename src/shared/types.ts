// Types partagés entre le processus principal, le preload et l'interface.

export type Lang = 'fr' | 'en'
export type I18nText = { fr: string; en: string }

/** Nature d'un élément posé sur le canevas. */
export type NodeKind = 'entity' | 'text' | 'image' | 'drawing' | 'map'

/** Valeur d'une propriété d'entité. Les listes servent pour les champs multiples. */
export type PropValue = string | number | boolean | null | string[] | number[][] | Record<string, unknown>

export interface Investigation {
  id: string
  name: string
  description: string
  color: string
  createdAt: number
  updatedAt: number
  /** Note libre de l'enquête (Markdown). */
  notes: string
  viewport: { x: number; y: number; zoom: number } | null
  nodeCount?: number
  edgeCount?: number
}

export interface NodeStyle {
  /** Couleur d'accent (bordure, icône). */
  color?: string
  /** Couleur de fond de la carte. */
  bg?: string
  /** Icône forcée (nom lucide ou `brand:<platform>`). */
  icon?: string
  size?: 'sm' | 'md' | 'lg'
  /** Pour les textes et dessins. */
  fontSize?: number
  strokeWidth?: number
  hideSubtitle?: boolean
  /** Descendance repliée dans ce nœud (clic droit, « Réduire »). */
  collapsed?: boolean
}

export interface GraphNode {
  id: string
  investigationId: string
  kind: NodeKind
  /** Identifiant du type d'entité (`phone`, `email`...) ou du type d'annotation. */
  type: string
  label: string
  /** Plateforme associée (`facebook`, `orange`...) pour les comptes, opérateurs, etc. */
  platform: string | null
  /** Propriétés de l'entité. Conventions : `lat`/`lon` pour la carte, clés de date pour la frise. */
  data: Record<string, PropValue>
  notes: string
  /** Pièce jointe servant d'image (avatar, photo). */
  imageId: string | null
  x: number
  y: number
  width: number | null
  height: number | null
  style: NodeStyle
  /** `manual` ou identifiant du module qui a créé le nœud. */
  source: string
  createdAt: number
  updatedAt: number
}

export interface EdgeStyle {
  color?: string
  dashed?: boolean
  animated?: boolean
  width?: number
}

export interface GraphEdge {
  id: string
  investigationId: string
  source: string
  target: string
  label: string
  data: Record<string, PropValue>
  style: EdgeStyle
  /** `manual` ou identifiant du module. */
  sourceModule: string
  createdAt: number
  updatedAt: number
}

export interface Attachment {
  id: string
  investigationId: string
  name: string
  mime: string
  size: number
  sha256: string
  /** URL d'origine si l'image a été téléchargée par un module. */
  origin: string | null
  createdAt: number
}

export interface InvestigationBundle {
  investigation: Investigation
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type NodeInput = Partial<Omit<GraphNode, 'investigationId' | 'createdAt' | 'updatedAt'>> & {
  id?: string
}
export type EdgeInput = Partial<Omit<GraphEdge, 'investigationId' | 'createdAt' | 'updatedAt'>> & {
  source: string
  target: string
}

// ---------------------------------------------------------------------------
// Modules d'enrichissement

export type ModuleCategory =
  | 'phone'
  | 'email'
  | 'username'
  | 'person'
  | 'domain'
  | 'ip'
  | 'web'
  | 'crypto'
  | 'finance'
  | 'company'
  | 'location'
  | 'image'
  | 'messaging'
  | 'social'
  | 'forensic'
  | 'misc'
  | 'roso'

export interface KeyRequirement {
  /** Identifiant de la clé dans le coffre, partagé entre modules d'un même service. */
  id: string
  label: string
  /** Page où obtenir la clé. */
  url?: string
  /** Le module fonctionne sans, avec des résultats réduits. */
  optional?: boolean
}

export interface ModuleInfo {
  id: string
  name: I18nText
  description: I18nText
  category: ModuleCategory
  inputTypes: string[]
  keys: KeyRequirement[]
  /** Ne s'exécute que sur demande explicite (services à crédits). */
  ondemand: boolean
  /** Peut alerter la cible ou laisser une trace chez elle. */
  noisy: boolean
  experimental: boolean
  enabled: boolean
  /** Toutes les clés obligatoires sont présentes. */
  configured: boolean
  /** Lien vers le service interrogé. */
  homepage?: string
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'

export interface ModuleRun {
  id: string
  investigationId: string
  nodeId: string
  moduleId: string
  jobId: string
  status: RunStatus
  /** Pour les modules de vérification de compte : le compte existe-t-il ? */
  found: boolean | null
  resultCount: number
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

export interface JobProgress {
  jobId: string
  investigationId: string
  nodeId: string
  nodeLabel: string
  total: number
  done: number
  results: number
  errors: number
  /** Modules en cours d'exécution. */
  running: string[]
  /** Avancement interne des modules en cours qui le signalent (roso.info, pseudos...). */
  steps?: Record<string, { done: number; total: number; detail?: string }>
  /** Résultats mis de côté dans « À vérifier » pendant cette tâche. */
  review?: number
  finished: boolean
  cancelled: boolean
}

/** Résultat d'une recherche assistée (navigateur intégré). */
export interface AssistResult {
  status: 'ok' | 'cancelled' | 'timeout' | 'error'
  url: string
  title: string
  matches: Array<{ title: string; url: string; snippet: string }>
  error?: string
}

/** Résultat en attente de validation par l'enquêteur (voir `OutEntity.review`, `OutManualCheck`). */
export interface Suggestion {
  id: string
  investigationId: string
  /** Nœud enrichi dont vient la suggestion. */
  nodeId: string
  moduleId: string
  /** `entity` : entité à ajouter au graphe ; `manual` : recherche à faire à la main. */
  kind: 'entity' | 'manual'
  type: string
  label: string
  platform: string | null
  data: Record<string, PropValue>
  linkLabel: string
  /** Page à ouvrir (recherche manuelle) ou page source du résultat. */
  url: string | null
  reason: string
  /** `checked` : recherche manuelle faite, rien trouvé. */
  status: 'pending' | 'accepted' | 'rejected' | 'checked'
  createdAt: number
  updatedAt: number
}

export interface GraphChange {
  investigationId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  deletedNodeIds?: string[]
  deletedEdgeIds?: string[]
}

// ---------------------------------------------------------------------------
// Paramètres

export type ProxyMode = 'none' | 'http' | 'socks5' | 'tor'
export type ModuleRoute = 'default' | 'direct' | 'proxy'

export interface ProxySettings {
  mode: ProxyMode
  /** `http://user:pass@host:port` ou `socks5://host:port`. */
  url: string
  /** Port SOCKS de Tor (9050 pour le service, 9150 pour Tor Browser). */
  torPort: number
  /** Routage par module : `direct` ignore le proxy, `proxy` le force. */
  perModule: Record<string, ModuleRoute>
}

export interface Settings {
  lang: Lang
  theme: 'dark' | 'light'
  proxy: ProxySettings
  userAgent: string
  /** Modules exécutés en parallèle pour un même nœud. */
  concurrency: number
  timeoutMs: number
  disabledModules: string[]
  /** Lancer automatiquement les modules applicables à la création d'un nœud. */
  autoEnrich: boolean
  autoUpdate: boolean
  edgeStyle: 'bezier' | 'smoothstep' | 'straight'
  /** `auto` : libellés masqués autour des nœuds très reliés, sauf pour la sélection. */
  edgeLabels: 'auto' | 'always'
  showMinimap: boolean
}

export interface SecretStatus {
  id: string
  set: boolean
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'
  version?: string
  progress?: number
  error?: string
}

/** État d'une clé roso.info (`/api/auth/status`, sans crédit). */
export interface RosoStatus {
  ok: boolean
  credits?: number
  bonusCredits?: number
  dailyUsed?: number
  creditsPerDay?: number
  tier?: string
  /** Le niveau de la clé impose un captcha que MASINT ne peut pas résoudre. */
  captcha?: boolean
  error?: string
}

export interface ProxyTestResult {
  ok: boolean
  ip?: string
  country?: string
  isTor?: boolean
  error?: string
}
