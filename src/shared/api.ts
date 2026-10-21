// Contrat IPC entre l'interface et le processus principal.
// Chaque entrée de `ApiMap` correspond à un canal `ipcMain.handle`.

import type {
  Attachment,
  EdgeInput,
  GraphChange,
  GraphEdge,
  GraphNode,
  Investigation,
  InvestigationBundle,
  JobProgress,
  ModuleInfo,
  ModuleRun,
  NodeInput,
  ProxyTestResult,
  RosoStatus,
  SecretStatus,
  Settings,
  UpdateStatus
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
  'graph:upsertNodes': (investigationId: string, nodes: NodeInput[]) => GraphNode[]
  'graph:deleteNodes': (investigationId: string, ids: string[]) => void
  'graph:upsertEdges': (investigationId: string, edges: EdgeInput[]) => GraphEdge[]
  'graph:deleteEdges': (investigationId: string, ids: string[]) => void
  /** Fusionne plusieurs nœuds dans le premier (liens et propriétés repris). */
  'graph:mergeNodes': (investigationId: string, targetId: string, otherIds: string[]) => GraphChange

  // Pièces jointes (servies par le protocole `masint-file://att/<id>`)
  'attachments:add': (investigationId: string, file: { name: string; mime: string; base64: string }) => Attachment
  'attachments:pick': (investigationId: string) => Attachment[]
  'attachments:get': (id: string) => Attachment | null
  'attachments:readBase64': (id: string) => string | null
  /** Métadonnées EXIF d'une image jointe (GPS, appareil, date). */
  'attachments:exif': (id: string) => Record<string, unknown> | null

  // Modules
  'modules:list': () => ModuleInfo[]
  'modules:enrich': (investigationId: string, nodeId: string, moduleIds?: string[]) => { jobId: string }
  'modules:cancel': (jobId: string) => void
  'modules:runs': (investigationId: string, nodeId?: string) => ModuleRun[]
  'modules:jobs': () => JobProgress[]
  /** Modules lancés par « Enrichir » pour ce nœud, et modules applicables à sa valeur. */
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
  /** Vérifie la clé roso.info et lit les crédits restants, sans en consommer. */
  'roso:status': () => RosoStatus

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
  'app:openExternal': (url: string) => void
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
  'update:status': UpdateStatus
  /** Une archive `.masint` ouverte depuis l'explorateur a été importée. */
  'app:openInvestigation': { id: string }
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
