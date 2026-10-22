import { buildUserAgent } from '@shared/network'
import type { SecretStatus, Settings } from '@shared/types'
import type { Repo } from './db/repo'

/**
 * En-tête navigateur par défaut : Chrome sur le vrai système, avec la version de Chromium
 * d'Electron, pour rester cohérent avec ce que le navigateur intégré expose
 * (`navigator.platform`, `navigator.userAgentData`).
 */
export const DEFAULT_USER_AGENT = buildUserAgent(process.platform, process.versions.chrome)

/** Ancien en-tête par défaut (Chrome 141 sous Windows), remplacé par l'en-tête automatique. */
const LEGACY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

/** En-tête enregistré qui signifie « automatique » : vide, ancien défaut ou défaut actuel. */
const isAutoUserAgent = (ua: string | undefined): boolean => !ua?.trim() || ua === LEGACY_USER_AGENT || ua === DEFAULT_USER_AGENT

export const DEFAULT_SETTINGS: Settings = {
  lang: 'fr',
  theme: 'dark',
  proxy: { mode: 'none', url: '', torPort: 9050, perModule: {} },
  userAgent: DEFAULT_USER_AGENT,
  concurrency: 8,
  globalConcurrency: 12,
  timeoutMs: 20000,
  disabledModules: [],
  autoEnrich: false,
  chainDepth: 0,
  passiveMode: true,
  linkOpening: 'auto',
  torSalt: '',
  autoUpdate: true,
  edgeStyle: 'bezier',
  edgeLabels: 'auto',
  showMinimap: true
}

/** Chiffrement des secrets. En production : `safeStorage` d'Electron (DPAPI, trousseau GNOME/KWallet). */
export interface Cipher {
  available(): boolean
  /** Sous Linux : trousseau utilisé (`basic_text` = aucun trousseau, chiffrement faible). */
  backend?(): string
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export const PLAIN_CIPHER: Cipher = {
  available: () => false,
  encrypt: (s) => Buffer.from(s, 'utf8'),
  decrypt: (b) => b.toString('utf8')
}

export class SettingsService {
  private cache: Settings | null = null
  private secretCache = new Map<string, string>()

  constructor(
    private readonly repo: Repo,
    private readonly cipher: Cipher = PLAIN_CIPHER
  ) {}

  get(): Settings {
    if (!this.cache) {
      const stored = this.repo.getSetting<Partial<Settings>>('settings', {})
      this.cache = {
        ...DEFAULT_SETTINGS,
        ...stored,
        proxy: { ...DEFAULT_SETTINGS.proxy, ...(stored.proxy ?? {}) }
      }
      if (isAutoUserAgent(this.cache.userAgent)) this.cache.userAgent = DEFAULT_USER_AGENT
    }
    return this.cache
  }

  set(patch: Partial<Settings>): Settings {
    const current = this.get()
    const next: Settings = {
      ...current,
      ...patch,
      proxy: patch.proxy ? { ...current.proxy, ...patch.proxy } : current.proxy
    }
    next.concurrency = Math.min(32, Math.max(1, Math.round(next.concurrency)))
    next.globalConcurrency = Math.min(64, Math.max(1, Math.round(next.globalConcurrency) || DEFAULT_SETTINGS.globalConcurrency))
    next.timeoutMs = Math.min(120000, Math.max(3000, Math.round(next.timeoutMs)))
    next.chainDepth = Math.min(3, Math.max(0, Math.round(Number(next.chainDepth) || 0)))
    if (!['auto', 'internal', 'external'].includes(next.linkOpening)) next.linkOpening = 'auto'
    // En-tête automatique enregistré vide : il suit les mises à jour d'Electron.
    const auto = isAutoUserAgent(next.userAgent)
    next.userAgent = auto ? DEFAULT_USER_AGENT : next.userAgent.trim()
    this.repo.setSetting('settings', { ...next, userAgent: auto ? '' : next.userAgent })
    this.cache = next
    return next
  }

  // Coffre à clés -------------------------------------------------------------

  getSecret(id: string): string | undefined {
    if (this.secretCache.has(id)) return this.secretCache.get(id)
    const row = this.repo.getSecret(id)
    if (!row) return undefined
    try {
      const value = row.encrypted ? this.cipher.decrypt(row.value) : row.value.toString('utf8')
      this.secretCache.set(id, value)
      return value
    } catch {
      return undefined
    }
  }

  setSecret(id: string, value: string): void {
    const trimmed = value.trim()
    if (!trimmed) return this.deleteSecret(id)
    const encrypted = this.cipher.available()
    this.repo.setSecret(id, encrypted ? this.cipher.encrypt(trimmed) : Buffer.from(trimmed, 'utf8'), encrypted)
    this.secretCache.set(id, trimmed)
  }

  deleteSecret(id: string): void {
    this.repo.deleteSecret(id)
    this.secretCache.delete(id)
  }

  /** Les secrets sont-ils protégés par le trousseau du système ? */
  security(): { encrypted: boolean; backend: string } {
    const available = this.cipher.available()
    const backend = available ? (this.cipher.backend?.() ?? 'system') : 'none'
    return { encrypted: available && backend !== 'basic_text', backend }
  }

  listSecrets(knownIds: string[]): SecretStatus[] {
    const stored = new Set(this.repo.listSecretIds())
    const ids = Array.from(new Set([...knownIds, ...stored]))
    return ids.map((id) => ({ id, set: stored.has(id) }))
  }
}
