// Sites de recherche de pseudo, côté application : mise à jour à la demande de la base Maigret,
// contrôle témoin lancé depuis les paramètres et résumé de l'état des sites. Les requêtes passent
// par le contexte des modules de pseudo : même proxy, même Tor, même routage par module.

import type { SitesStatus, SitesTier, SitesUpdateResult } from '@shared/types'
import { createFetch, egressKey } from './engine/http'
import { getModule } from './engine/registry'
import type { Engine } from './engine/runner'
import type { SettingsService } from './settings'
import { tierSites, tierSkipped } from './modules/username/_catalog'
import { DEFAULT_EGRESS, healthStore, healthy, selfCheck } from './modules/username/_health'
import { dbInfo, updateDb } from './modules/username/_siteDb'

/** Module dont le contrôle reprend la route réseau, par palier. */
const MODULE_OF: Record<SitesTier, string> = { essential: 'username.sites', extended: 'username.sites_extended' }

export class SitesService {
  private running: { controller: AbortController; promise: Promise<SitesStatus> } | null = null

  constructor(
    private readonly settings: SettingsService,
    private readonly engine: Engine,
    private readonly onProgress: (p: { done: number; total: number; detail?: string }) => void
  ) {}

  private egress(tier: SitesTier): string {
    const s = this.settings.get()
    return egressKey(s.proxy, s.proxy.perModule[MODULE_OF[tier]] ?? 'default')
  }

  status(): SitesStatus {
    const egress = this.egress('essential')
    const health = healthStore().get(egress)
    const tiers = (['essential', 'extended'] as const).map((tier) => {
      const all = tierSites(tier)
      const { failed } = healthy(all, this.egress(tier))
      return { tier, total: all.length, active: all.length - failed.length, failed: failed.length, skipped: tierSkipped(tier).length }
    })
    return { db: dbInfo(), egress, checkedAt: health.checkedAt ?? null, last: health.last ?? null, tiers, checking: !!this.running }
  }

  /** Télécharge la dernière base Maigret par la route réseau du module de pseudo. */
  async updateDb(): Promise<SitesUpdateResult> {
    const fetchFn = createFetch({ settings: this.settings.get(), moduleId: MODULE_OF.essential })
    try {
      const out = await updateDb(fetchFn)
      return { ok: true, status: out.status }
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      const fr = this.settings.get().lang === 'fr'
      const msg = timeout ? (fr ? 'délai dépassé' : 'timed out') : e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  }

  /** Contrôle témoin d'un palier ; un seul contrôle à la fois. */
  check(tier: SitesTier): Promise<SitesStatus> {
    if (this.running) return this.running.promise
    const controller = new AbortController()
    const id = MODULE_OF[tier]
    // Avancement envoyé à l'interface au plus toutes les 250 ms (plusieurs milliers de sites).
    let last = 0
    const progress = (done: number, total: number, detail?: string): void => {
      const now = Date.now()
      if (now - last < 250 && done < total) return
      last = now
      this.onProgress({ done, total, detail })
    }
    const ctx = this.engine.createContext(getModule(id) ?? { id }, controller.signal, [], progress)
    const promise = selfCheck(tierSites(tier), ctx, { concurrency: 16, timeoutMs: 12000 })
      .then((results) => {
        // Contrôle interrompu : les verdicts déjà rendus restent valables.
        healthStore().record(ctx.egress ?? DEFAULT_EGRESS, results)
        this.running = null
        return this.status()
      })
      .finally(() => {
        this.running = null
      })
    this.running = { controller, promise }
    return promise
  }

  cancel(): void {
    this.running?.controller.abort()
  }
}
