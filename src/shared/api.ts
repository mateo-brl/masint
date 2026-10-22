// Contrat IPC entre l'interface et le processus principal.
// Chaque entrée de `ApiMap` correspond à un canal `ipcMain.handle`.

import type {
  AssistResult,
  Attachment,
  EdgeInput,
  GraphChange,
  GraphEdge,
  Investigation,
  InvestigationBundle,
  JobProgress,
  ModuleInfo,
  ModuleRun,
  ModuleRunStats,
  NodeInput,
  Provenance,
  ProxyTestResult,
  PropValue,
  RosoStatus,
  SavedNode,
  SecretStatus,
  SitesStatus,
  SitesTier,
  SitesUpdateResult,
  Suggestion,
  Settings,
  UpdateStatus,
  UpsertOptions
} from './types'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface ApiMap {
  // Enquêtes
  'investigations:list': () => Investigation[]
  'investigations:create': (input: { name: string; description?: string; color?: string }) => Investigation
  'investigations:update': (
    id: string,
    patch: Partial<Pick<Investigation, 'name' | 'description' | 'color' | 'notes' | 'viewport'>>
  ) => Investigation
  'investigations:delete': (id: string) => void
  'investigations:open': (id: string) => InvestigationBundle
  'investigations:duplicate': (id: string) => Investigation
  /** Exporte l'enquête dans une archive `.masint`. Renvoie le chemin choisi ou `null`. */
  'investigations:exportArchive': (id: string) => string | null
  /** Importe une archive `.masint` choisie par l'utilisateur. */
  'investigations:importArchive': () => Investigation | null

  // Graphe
  /**
   * Crée ou modifie des nœuds. Avec `updateOnly`, les patchs vers un nœud absent sont ignorés.
   * `duplicateOf` signale une entité de même valeur déjà présente.
   */
  'graph:upsertNodes': (investigationId: string, nodes: NodeInput[], opts?: UpsertOptions) => SavedNode[]
  'graph:deleteNodes': (investigationId: string, ids: string[]) => void
  'graph:upsertEdges': (investigationId: string, edges: EdgeInput[], opts?: UpsertOptions) => GraphEdge[]
  'graph:deleteEdges': (investigationId: string, ids: string[]) => void
  /** Fusionne plusieurs nœuds dans le premier (liens, propriétés et observations repris). */
  'graph:mergeNodes': (investigationId: string, targetId: string, otherIds: string[]) => GraphChange
  /** Observations d'un nœud ou d'un lien (modules, dates, pages sources) et chemin du nœud. */
  'graph:provenance': (investigationId: string, target: { nodeId?: string; edgeId?: string }) => Provenance

  // Pièces jointes (servies par le protocole `masint-file://att/<id>`)
  'attachments:add': (investigationId: string, file: { name: string; mime: string; base64: string }) => Attachment
  'attachments:pick': (investigationId: string) => Attachment[]
  /** Images du presse-papiers : image copiée (navigateur, capture) ou fichiers image copiés dans l'explorateur. */
  'attachments:paste': (investigationId: string) => Attachment[]
  'attachments:get': (id: string) => Attachment | null
  'attachments:readBase64': (id: string) => string | null
  /** Métadonnées EXIF d'une image jointe (GPS, appareil, date). */
  'attachments:exif': (id: string) => Record<string, unknown> | null

  // Modules
  'modules:list': () => ModuleInfo[]
  /**
   * Enrichit un nœud. `chain` : `true` pour « Enrichir en chaîne », `false` pour ne jamais
   * enchaîner (enrichissement en masse) ; absent, l'enchaînement suit les réglages.
   */
  'modules:enrich': (investigationId: string, nodeId: string, moduleIds?: string[], opts?: { chain?: boolean }) => { jobId: string }
  'modules:cancel': (jobId: string) => void
  'modules:runs': (investigationId: string, nodeId?: string) => ModuleRun[]
  /** Statistiques d'exécution par module, sans limite de nombre (rapport). */
  'modules:runStats': (investigationId: string) => ModuleRunStats[]
  'modules:jobs': () => JobProgress[]
  /** Modules lancés par « Enrichir » pour ce nœud, et modules applicables à sa valeur. */
  /** Résultats à vérifier d'une enquête, ou d'un nœud. */
  'suggestions:list': (investigationId: string, nodeId?: string) => Suggestion[]
  /** Valider, écarter ou rouvrir un résultat à vérifier (voir Engine.resolveSuggestion). */
  'suggestions:resolve': (
    id: string,
    action: 'accept' | 'reject' | 'checked' | 'reopen',
    found?: { type: string; label: string; platform?: string | null; data?: Record<string, PropValue> }
  ) => void
  /** Lance une recherche manuelle dans le navigateur intégré et renvoie les résultats qui contiennent la valeur. */
  'assist:run': (suggestionId: string) => AssistResult
  'modules:applicable': (nodeId: string) => { auto: string[]; accepted: string[] }
  'modules:setEnabled': (moduleId: string, enabled: boolean) => void
  /** Données brutes archivées d'une exécution (réponse du service). */
  'modules:runRaw': (runId: string) => unknown

  // Paramètres et coffre à clés
  'settings:get': () => Settings
  'settings:set': (patch: Partial<Settings>) => Settings
  'secrets:list': () => SecretStatus[]
  'secrets:set': (id: string, value: string) => void
  'secrets:delete': (id: string) => void
  /** Protection effective des clés : trousseau du système ou stockage faiblement chiffré. */
  'secrets:security': () => { encrypted: boolean; backend: string }
  'proxy:test': () => ProxyTestResult
  /** Nouvel identifiant SOCKS pour Tor : les requêtes suivantes passent par de nouveaux circuits. */
  'proxy:newTorIdentity': () => Settings
  /** Vérifie la clé roso.info et lit les crédits restants, sans en consommer. */
  'roso:status': () => RosoStatus

  // Sites de recherche de pseudo
  /** Base des sites (origine, date) et santé des sites sur la sortie réseau courante. */
  'sites:status': () => SitesStatus
  /** Télécharge la dernière base Maigret (empreinte SHA-256 et schéma vérifiés). */
  'sites:updateDb': () => SitesUpdateResult
  /** Contrôle témoin des sites d'un palier ; l'avancement arrive par l'évènement `sites:progress`. */
  'sites:check': (tier: SitesTier) => SitesStatus
  'sites:cancelCheck': () => void

  // Exports
  /** Imprime un document HTML en PDF et l'enregistre. */
  'export:pdf': (html: string, defaultName: string) => string | null
  /** Enregistre un fichier texte ou binaire (base64) via une boîte de dialogue. */
  'export:save': (
    defaultName: string,
    filters: FileFilter[],
    content: string,
    encoding: 'utf8' | 'base64'
  ) => string | null

  // Application
  'app:info': () => { version: string; platform: string; dataPath: string }
  /** Navigateur personnel de l'enquêteur : documentation, GitHub, pages d'inscription aux clés. */
  'app:openExternal': (url: string) => void
  /** Lien d'enquête : navigateur d'enquête ou navigateur personnel, selon `linkOpening`. */
  'app:openLink': (url: string) => void
  /**
   * Fenêtre visible du navigateur d'enquête : partition, proxy (ou Tor) et durcissement de la
   * recherche assistée.
   */
  'browser:open': (url: string) => void
  'app:showInFolder': (path: string) => void
  /** Enquêtes importées depuis l'explorateur et pas encore ouvertes. */
  'app:takePendingOpen': () => string[]
  'update:check': () => UpdateStatus
  'update:install': () => void
}

export type ApiChannel = keyof ApiMap

export interface EventMap {
  'graph:changed': GraphChange
  'job:progress': JobProgress
  'suggestions:changed': { investigationId: string; nodeId: string }
  'update:status': UpdateStatus
  /** Une archive `.masint` ouverte depuis l'explorateur a été importée. */
  'app:openInvestigation': { id: string }
  /** Avancement du contrôle témoin des sites de pseudo. */
  'sites:progress': { done: number; total: number; detail?: string }
}

export type EventChannel = keyof EventMap

/** API exposée par le preload sur `window.masint`. */
export interface MasintBridge {
  invoke<C extends ApiChannel>(channel: C, ...args: Parameters<ApiMap[C]>): Promise<ReturnType<ApiMap[C]>>
  on<E extends EventChannel>(event: E, listener: (payload: EventMap[E]) => void): () => void
  /** Chemin local d'un fichier glissé depuis l'explorateur. */
  pathForFile(file: File): string
}

export const ATTACHMENT_PROTOCOL = 'masint-file'
export const attachmentUrl = (id: string): string => `${ATTACHMENT_PROTOCOL}://att/${id}`
