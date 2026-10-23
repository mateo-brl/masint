// État de santé des sites de recherche de pseudo. Un contrôle témoin interroge chaque site avec
// son pseudo témoin public (fourni par la base, qui doit être trouvé) et avec un pseudo aléatoire
// (qui ne doit pas l'être). Un site en faux positif ou qui ne trouve plus son témoin est noté
// « en échec » pendant 7 jours et sauté par les recherches. L'état dépend de la sortie réseau
// (direct, Tor, proxy) : un site bloqué en direct peut fonctionner via Tor.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModuleContext } from '@shared/modules'
import type { SiteStatus } from './_sherlock'
import type { SiteDef } from './_catalog'
import { userDir } from './_siteDb'

/** Durée pendant laquelle un site en échec est sauté. */
export const HEALTH_TTL_MS = 7 * 24 * 3600 * 1000
const HEALTH_FILE = 'sites-health.json'

/** Sortie réseau par défaut quand le contexte ne la précise pas (tests). */
export const DEFAULT_EGRESS = 'direct'

export type Verdict = 'ok' | 'false_positive' | 'missed' | 'inconclusive' | 'untestable'

export interface FailedSite {
  /** Date du constat (ms). */
  at: number
  reason: 'false_positive' | 'missed'
}

export interface EgressHealth {
  /** Date du dernier contrôle (ms). */
  checkedAt?: number
  /** Bilan du dernier contrôle. */
  last?: { tested: number; ok: number; false_positive: number; missed: number; inconclusive: number; untestable: number }
  failed: Record<string, FailedSite>
}

interface HealthFile {
  version: 1
  egress: Record<string, EgressHealth>
}

/**
 * Cache de santé, enregistré dans le dossier utilisateur (`sites-health.json`) ou gardé en
 * mémoire quand aucun dossier n'est configuré (tests).
 */
export class HealthStore {
  private data: HealthFile = { version: 1, egress: {} }

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as HealthFile
        if (parsed?.version === 1 && parsed.egress && typeof parsed.egress === 'object') this.data = parsed
      } catch {
        /* cache illisible : on repart de zéro */
      }
    }
  }

  private save(): void {
    if (!this.file) return
    try {
      mkdirSync(join(this.file, '..'), { recursive: true })
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data))
      renameSync(`${this.file}.tmp`, this.file)
    } catch {
      /* écriture impossible : l'état reste valable pour cette session */
    }
  }

  get(egress: string): EgressHealth {
    return this.data.egress[egress] ?? { failed: {} }
  }

  /** Sites en échec non expirés pour cette sortie réseau. */
  failedIds(egress: string, now = Date.now()): Set<string> {
    const out = new Set<string>()
    for (const [id, f] of Object.entries(this.get(egress).failed)) if (now - f.at < HEALTH_TTL_MS) out.add(id)
    return out
  }

  /**
   * Enregistre un contrôle : les sites en faux positif ou qui ne trouvent plus leur témoin passent
   * en échec, ceux qui répondent correctement en sortent. Un résultat non concluant (blocage,
   * délai) ne change rien.
   */
  record(egress: string, results: Array<{ id: string; verdict: Verdict }>, now = Date.now()): EgressHealth {
    const current = this.get(egress)
    const failed: Record<string, FailedSite> = {}
    for (const [id, f] of Object.entries(current.failed)) if (now - f.at < HEALTH_TTL_MS) failed[id] = f
    const last = { tested: results.length, ok: 0, false_positive: 0, missed: 0, inconclusive: 0, untestable: 0 }
    for (const r of results) {
      last[r.verdict]++
      if (r.verdict === 'ok') delete failed[r.id]
      else if (r.verdict === 'false_positive' || r.verdict === 'missed') failed[r.id] = { at: now, reason: r.verdict }
    }
    const next: EgressHealth = { checkedAt: now, last, failed }
    this.data.egress[egress] = next
    this.save()
    return next
  }

  /** Met des sites en échec en dehors d'un contrôle complet (faux positifs vus pendant une recherche). */
  markFailed(egress: string, ids: string[], reason: FailedSite['reason'], now = Date.now()): void {
    if (!ids.length) return
    const current = this.get(egress)
    const failed = { ...current.failed }
    for (const id of ids) failed[id] = { at: now, reason }
    this.data.egress[egress] = { ...current, failed }
    this.save()
  }
}

let store: { dir: string | undefined; store: HealthStore } | null = null

/** Cache de santé du dossier utilisateur configuré. */
export function healthStore(): HealthStore {
  const dir = userDir()
  if (!store || store.dir !== dir) store = { dir, store: new HealthStore(dir ? join(dir, HEALTH_FILE) : null) }
  return store.store
}

/** Retire les sites en échec pour cette sortie réseau. */
export function healthy(sites: SiteDef[], egress: string, now = Date.now()): { sites: SiteDef[]; failed: SiteDef[] } {
  const failedIds = healthStore().failedIds(egress, now)
  const ok: SiteDef[] = []
  const failed: SiteDef[] = []
  for (const s of sites) (failedIds.has(s.id) ? failed : ok).push(s)
  return { sites: ok, failed }
}

// Contrôle témoin ----------------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const pick = (chars: string, n: number): string => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

/**
 * Pseudo aléatoire, qui ne doit exister nulle part, compatible avec le format imposé par le site
 * (lettres seules, lettres et chiffres, chiffres seuls, ou court). Null si aucun ne convient.
 */
export function randomUsernameFor(site: Pick<SiteDef, 'isLegal'>): string | null {
  const candidates = [
    `zq${pick(LETTERS, 9)}x`,
    `q${pick(`${LETTERS}0123456789`, 10)}`,
    `${1 + Math.floor(Math.random() * 9)}${pick('0123456789', 11)}`,
    `zq${pick(LETTERS, 4)}`,
    `Zq${pick(LETTERS, 9)}X`
  ]
  return candidates.find((c) => site.isLegal(c)) ?? null
}

/** Verdict du contrôle à partir des deux réponses (témoin, pseudo aléatoire). */
export function verdictOf(claimed: SiteStatus | null, random: SiteStatus | null): Verdict {
  if (random === 'claimed') return 'false_positive'
  if (claimed === null || random === null) return 'untestable'
  if (claimed === 'available' && random === 'available') return 'missed'
  if (claimed === 'claimed' && random === 'available') return 'ok'
  return 'inconclusive'
}

export interface SelfCheckResult {
  id: string
  name: string
  verdict: Verdict
  claimed: SiteStatus | null
  random: SiteStatus | null
  detail?: string
}

/**
 * Contrôle témoin d'une liste de sites : deux requêtes par site (témoin, pseudo aléatoire),
 * concurrence limitée, avancement signalé à `ctx.progress`.
 */
export async function selfCheck(
  sites: SiteDef[],
  ctx: ModuleContext,
  opts: { concurrency?: number; timeoutMs?: number } = {}
): Promise<SelfCheckResult[]> {
  const queue = [...sites]
  const results: SelfCheckResult[] = []
  const fr = ctx.lang === 'fr'
  let failures = 0
  ctx.progress(0, sites.length, fr ? 'contrôle des sites' : 'checking sites')
  const worker = async (): Promise<void> => {
    while (queue.length && !ctx.signal.aborted) {
      const def = queue.shift()!
      const witness = def.claimed && def.isLegal(def.claimed) ? def.claimed : null
      const random = randomUsernameFor(def)
      const [c, r] = await Promise.all([
        witness ? def.check(witness, ctx, opts.timeoutMs) : Promise.resolve(null),
        random ? def.check(random, ctx, opts.timeoutMs) : Promise.resolve(null)
      ])
      const verdict = verdictOf(c?.status ?? null, r?.status ?? null)
      if (verdict === 'false_positive' || verdict === 'missed') failures++
      const detail = [c?.error ?? (c?.httpStatus ? `HTTP ${c.httpStatus}` : ''), r?.error ?? (r?.httpStatus ? `HTTP ${r.httpStatus}` : '')].filter(Boolean).join(' / ')
      results.push({ id: def.id, name: def.name, verdict, claimed: c?.status ?? null, random: r?.status ?? null, ...(detail ? { detail } : {}) })
      ctx.progress(results.length, sites.length, [fr ? `${failures} en échec` : `${failures} failing`, def.name].join(' · '))
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 16, sites.length) }, worker))
  return results.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Contre-vérification des sites qui ont trouvé le pseudo : chacun est réinterrogé avec un pseudo
 * aléatoire. S'il le « trouve » aussi, sa réponse ne distingue rien (page de blocage ou de
 * contrôle d'âge servie pour toute adresse, page d'erreur en HTTP 200) : c'est un faux positif.
 * Renvoie les identifiants de ces sites.
 */
export async function counterCheck(
  found: Array<{ def: SiteDef }>,
  ctx: ModuleContext,
  opts: { concurrency?: number; timeoutMs?: number } = {}
): Promise<Set<string>> {
  const queue = [...found]
  const fakes = new Set<string>()
  let done = 0
  const label = ctx.lang === 'fr' ? 'contre-vérification' : 'cross-check'
  const worker = async (): Promise<void> => {
    while (queue.length && !ctx.signal.aborted) {
      const { def } = queue.shift()!
      const random = randomUsernameFor(def)
      if (random) {
        const r = await def.check(random, ctx, opts.timeoutMs)
        if (r.status === 'claimed') fakes.add(def.id)
      }
      ctx.progress(++done, found.length, `${label} · ${def.name}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 16, found.length) }, worker))
  return fakes
}
