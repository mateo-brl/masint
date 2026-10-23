// Contrat IPC entre l'interface et le processus principal.
// Chaque entrée de `ApiMap` correspond à un canal `ipcMain.handle`.

import type {
  ActivityAction,
  ActivityCheck,
  ActivityEntry,
  ActivityPage,
  AssistResult,
  Attachment,
  Capture,
  CrossRef,
  EdgeInput,
  ExportMeta,
  GlobalSearchHit,
  GraphChange,
  GraphEdge,
  Investigation,
  InvestigationBundle,
  JobProgress,
  LinkContext,
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

  // Recherche globale et corrélation (vides quand les enquêtes sont cloisonnées)
  /** Recherche plein texte dans toutes les enquêtes : libellés, propriétés, notes. */
  'search:global': (query: string, limit?: number) => GlobalSearchHit[]
  /** Pour chaque nœud donné, les autres enquêtes où la même entité apparaît (clé canonique). */
  'nodes:crossRefs': (nodeIds: string[]) => Record<string, CrossRef[]>

  // Pièces jointes (servies par le protocole `masint-file://att/<id>`)
  'attachments:add': (investigationId: string, file: { name: string; mime: string; base64: string }) => Attachment
  'attachments:pick': (investigationId: string) => Attachment[]
  /** Images du presse-papiers : image copiée (navigateur, capture) ou fichiers image copiés dans l'explorateur. */
  'attachments:paste': (investigationId: string) => Attachment[]
  'attachments:get': (id: string) => Attachment | null
  'attachments:readBase64': (id: string) => string | null
  /** Métadonnées EXIF d'une image jointe (GPS, appareil, date). */
  'attachments:exif': (id: string) => Record<string, unknown> | null
  /** Enregistre une pièce jointe sur le disque (boîte de dialogue). Renvoie le chemin ou `null`. */
  'attachments:save': (id: string) => string | null

  // Preuves (captures de pages)
  /** Captures d'une enquête (ou d'un nœud), dont le nœud existe encore. */
  'captures:list': (investigationId: string, nodeId?: string) => Capture[]
  /** Ouvre la page d'un nœud `url` ou `account` dans une fenêtre cachée du navigateur d'enquête et la capture. */
  'captures:capture': (investigationId: string, nodeId: string) => Capture

  // Journal d'activité
  /** Page du journal, de la plus récente à la plus ancienne, filtrée par action. */
  'activity:list': (investigationId: string, opts?: { offset?: number; limit?: number; actions?: ActivityAction[] }) => ActivityPage
  /** Recalcule la chaîne d'empreintes et indique la première entrée altérée. */
  'activity:verify': (investigationId: string) => ActivityCheck
  /** Actions significatives (rapport), dans l'ordre chronologique, avec la vérification de la chaîne. */
  'activity:report': (investigationId: string) => { entries: ActivityEntry[]; total: number; check: ActivityCheck }

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
  /** Résultat de recherche assistée ajouté au graphe : masqué de la liste enregistrée. */
  'assist:markAdded': (suggestionId: string, url: string) => void
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
  /** Imprime un document HTML en PDF et l'enregistre (`meta` : export inscrit au journal de l'enquête). */
  'export:pdf': (html: string, defaultName: string, meta?: ExportMeta) => string | null
  /** Enregistre un fichier texte ou binaire (base64) via une boîte de dialogue. */
  'export:save': (
    defaultName: string,
    filters: FileFilter[],
    content: string,
    encoding: 'utf8' | 'base64',
    meta?: ExportMeta
  ) => string | null

  // Application
  /** `user` : nom de session du système (enquêteur par défaut du journal). */
  'app:info': () => { version: string; platform: string; dataPath: string; user: string }
  /** Navigateur personnel de l'enquêteur : documentation, GitHub, pages d'inscription aux clés. */
  'app:openExternal': (url: string) => void
  /**
   * Lien d'enquête : navigateur d'enquête ou navigateur personnel, selon `linkOpening`. Avec
   * `ctx`, la barre du navigateur d'enquête propose « Capturer la page », rattachée à ce nœud.
   */
  'app:openLink': (url: string, ctx?: LinkContext) => void
  /**
   * Fenêtre visible du navigateur d'enquête : partition, proxy (ou Tor) et durcissement de la
   * recherche assistée. Avec `ctx`, la capture de la page est proposée.
   */
  'browser:open': (url: string, ctx?: LinkContext) => void
  'app:showInFolder': (path: string) => void
  /** Enquêtes importées depuis l'explorateur et pas encore ouvertes. */
  'app:takePendingOpen': () => string[]
  'update:check': () => UpdateStatus
  /** État courant (une version peut avoir été téléchargée avant l'ouverture de l'interface). */
  'update:get': () => UpdateStatus
  'update:install': () => void
}

export type ApiChannel = keyof ApiMap

export interface EventMap {
  'graph:changed': GraphChange
  'job:progress': JobProgress
  'suggestions:changed': { investigationId: string; nodeId: string }
  /** Nouvelle capture (preuve) dans une enquête. */
  'captures:changed': { investigationId: string; nodeId: string | null }
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
