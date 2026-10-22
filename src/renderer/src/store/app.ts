import { create } from 'zustand'
import type { Investigation, JobProgress, ModuleInfo, SecretStatus, Settings, UpdateStatus } from '@shared/types'
import { api, onEvent } from '../lib/api'
import { loadPref, savePref } from '../lib/prefs'
import { setLanguage } from '../lib/i18n'
import { useFilters } from './filters'
import { useGraph } from './graph'

export type View = 'graph' | 'map' | 'timeline' | 'modules' | 'notes' | 'table'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
  /** Boutons du message (« Aller au nœud », « Fusionner »...). */
  actions?: ToastAction[]
}

/** Fichier ou texte à ouvrir dans la fenêtre d'import (nouvelle enquête depuis un fichier). */
export interface ImportSeed {
  name: string
  text: string
}

interface AppState {
  ready: boolean
  settings: Settings | null
  modules: ModuleInfo[]
  secrets: SecretStatus[]
  jobs: Record<string, JobProgress>
  investigations: Investigation[]
  /** Enquête ouverte, `null` sur l'accueil. */
  currentId: string | null
  view: View
  catalogOpen: boolean
  settingsOpen: boolean
  settingsTab: string
  reportOpen: boolean
  /** Fenêtre d'import en masse ouverte, avec son contenu de départ éventuel. */
  importOpen: boolean
  importSeed: ImportSeed | null
  update: UpdateStatus
  toasts: Toast[]
  /** Palette de commandes (Ctrl+K). */
  paletteOpen: boolean
  /** Panneaux du canevas : filtres et calques, analyse du graphe. */
  filtersOpen: boolean
  analysisOpen: boolean

  init(): Promise<void>
  refreshInvestigations(): Promise<void>
  refreshModules(): Promise<void>
  refreshSecrets(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  openInvestigation(id: string): Promise<void>
  goHome(): void
  setView(view: View): void
  toggleCatalog(open?: boolean): void
  openSettings(tab?: string): void
  closeSettings(): void
  setReportOpen(open: boolean): void
  setImportOpen(open: boolean, seed?: ImportSeed | null): void
  toast(kind: Toast['kind'], text: string, actions?: ToastAction[]): void
  dismissToast(id: number): void
  setPaletteOpen(open: boolean): void
  togglePanel(panel: 'filtersOpen' | 'analysisOpen', open?: boolean): void
}

let toastSeq = 0

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  modules: [],
  secrets: [],
  jobs: {},
  investigations: [],
  currentId: null,
  view: 'graph',
  catalogOpen: loadPref('catalogOpen', true),
  settingsOpen: false,
  settingsTab: 'general',
  reportOpen: false,
  importOpen: false,
  importSeed: null,
  update: { state: 'idle' },
  toasts: [],
  paletteOpen: false,
  filtersOpen: false,
  analysisOpen: false,

  async init() {
    const [settings, modules, jobs, investigations, secrets] = await Promise.all([
      api('settings:get'),
      api('modules:list'),
      api('modules:jobs'),
      api('investigations:list'),
      api('secrets:list')
    ])
    setLanguage(settings.lang)
    document.documentElement.dataset.theme = settings.theme
    set({
      settings,
      modules,
      investigations,
      secrets,
      jobs: Object.fromEntries(jobs.map((j) => [j.jobId, j])),
      ready: true
    })
    // La pastille de fin reste visible quelques secondes. Un événement arrivé en retard
    // pour une tâche déjà terminée est ignoré, sinon la pastille reviendrait sans fin.
    const finishedAt = new Map<string, number>()
    onEvent('job:progress', (p) => {
      if (finishedAt.has(p.jobId)) return
      if (p.finished) finishedAt.set(p.jobId, Date.now())
      set({ jobs: { ...get().jobs, [p.jobId]: p } })
    })
    setInterval(() => {
      const now = Date.now()
      const stale = Object.keys(get().jobs).filter((id) => now - (finishedAt.get(id) ?? now) >= 4000)
      if (!stale.length) return
      const next = { ...get().jobs }
      for (const id of stale) delete next[id]
      set({ jobs: next })
    }, 1000)
    onEvent('graph:changed', (change) => useGraph.getState().applyChange(change))
    onEvent('suggestions:changed', (e) => {
      if (e.investigationId === useGraph.getState().investigation?.id) void useGraph.getState().refreshSuggestions()
    })
    onEvent('update:status', (update) => set({ update }))
    // L'événement signale une enquête en attente ; on la récupère aussi au démarrage
    // au cas où l'import a eu lieu avant que l'interface n'écoute.
    const openPending = async (): Promise<void> => {
      const ids = await api('app:takePendingOpen')
      if (ids.length) {
        await get().refreshInvestigations()
        await get().openInvestigation(ids[ids.length - 1])
      }
    }
    onEvent('app:openInvestigation', () => void openPending())
    void openPending()
  },

  async refreshInvestigations() {
    set({ investigations: await api('investigations:list') })
  },

  async refreshModules() {
    set({ modules: await api('modules:list') })
  },

  async refreshSecrets() {
    set({ secrets: await api('secrets:list') })
  },

  async updateSettings(patch) {
    const settings = await api('settings:set', patch)
    if (patch.lang) setLanguage(patch.lang)
    if (patch.theme) document.documentElement.dataset.theme = patch.theme
    set({ settings })
    if (patch.disabledModules) await get().refreshModules()
  },

  async openInvestigation(id) {
    await useGraph.getState().load(id)
    // Filtre et calques de l'enquête prêts avant le premier affichage du canevas.
    useFilters.getState().load(id)
    set({ currentId: id, view: 'graph' })
  },

  goHome() {
    useGraph.getState().close()
    set({ currentId: null })
    void get().refreshInvestigations()
  },

  setView(view) {
    set({ view })
  },

  toggleCatalog(open) {
    const catalogOpen = open ?? !get().catalogOpen
    savePref('catalogOpen', catalogOpen)
    set({ catalogOpen })
  },

  openSettings(tab = 'general') {
    set({ settingsOpen: true, settingsTab: tab })
  },

  closeSettings() {
    set({ settingsOpen: false })
    void get().refreshModules()
    void get().refreshSecrets()
  },

  setReportOpen(open) {
    set({ reportOpen: open })
  },

  setImportOpen(open, seed = null) {
    set({ importOpen: open, importSeed: open ? seed : null })
  },

  toast(kind, text, actions) {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, kind, text, ...(actions?.length ? { actions } : {}) }] })
    // Un message avec des boutons reste plus longtemps : le temps de lire et de choisir.
    setTimeout(() => get().dismissToast(id), actions?.length ? 10000 : kind === 'error' ? 7000 : 3500)
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open })
  },

  togglePanel(panel, open) {
    set({ [panel]: open ?? !get()[panel] } as Pick<AppState, typeof panel>)
  }
}))
