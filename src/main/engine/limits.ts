// Garde-fous d'exécution : nombre de modules lancés en même temps pour tout MASINT et
// requêtes simultanées vers un même hôte. Une attente s'interrompt dès que le signal
// d'annulation (tâche annulée, délai du module) se déclenche.

/** Libère la place obtenue. Sans effet au-delà du premier appel. */
export type Release = () => void

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

/**
 * Sémaphore à file d'attente (premier arrivé, premier servi). La capacité est relue à chaque
 * demande et à chaque libération : un changement de réglage s'applique sans redémarrer.
 */
export class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly capacity: () => number) {}

  /** Places occupées. */
  get running(): number {
    return this.active
  }

  /** Demandes en attente d'une place. */
  get waiting(): number {
    return this.waiters.length
  }

  get idle(): boolean {
    return this.active === 0 && this.waiters.length === 0
  }

  acquire(signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) return Promise.reject(abortError(signal))
    if (!this.waiters.length && this.active < this.max()) {
      this.active++
      return Promise.resolve(this.releaser())
    }
    return new Promise<Release>((resolve, reject) => {
      const onAbort = (): void => {
        const i = this.waiters.indexOf(grant)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(abortError(signal!))
      }
      const grant = (): void => {
        signal?.removeEventListener('abort', onAbort)
        this.active++
        resolve(this.releaser())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(grant)
    })
  }

  /** Donne les places libres aux demandes en attente (après une hausse de la capacité). */
  drain(): void {
    while (this.waiters.length && this.active < this.max()) this.waiters.shift()!()
  }

  private max(): number {
    const n = Math.floor(this.capacity())
    return Number.isFinite(n) && n >= 1 ? n : 1
  }

  private releaser(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.drain()
    }
  }
}

/**
 * Limite de requêtes simultanées par hôte, commune à tous les modules : cent nœuds enrichis
 * ensemble n'envoient pas cent requêtes à la fois au même service (réponses 429, sortie Tor
 * repérée). La place est gardée jusqu'à la réception des en-têtes de la réponse.
 */
export class HostLimiter {
  private readonly hosts = new Map<string, Semaphore>()

  constructor(
    private readonly perHost: number,
    /** Hôtes qui supportent davantage (résolveurs DNS-over-HTTPS). */
    private readonly overrides: Record<string, number> = {}
  ) {}

  limitFor(host: string): number {
    return this.overrides[host] ?? this.perHost
  }

  /** Requêtes en cours vers cet hôte. */
  running(host: string): number {
    return this.hosts.get(host.toLowerCase())?.running ?? 0
  }

  async acquire(host: string, signal?: AbortSignal): Promise<Release> {
    const key = host.toLowerCase()
    let sem = this.hosts.get(key)
    if (!sem) {
      const limit = this.limitFor(key)
      sem = new Semaphore(() => limit)
      this.hosts.set(key, sem)
    }
    const s = sem
    const forget = (): void => {
      if (s.idle && this.hosts.get(key) === s) this.hosts.delete(key)
    }
    let release: Release
    try {
      release = await s.acquire(signal)
    } catch (e) {
      forget()
      throw e
    }
    return () => {
      release()
      forget()
    }
  }
}
