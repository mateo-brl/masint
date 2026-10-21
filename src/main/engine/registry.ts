// Découverte automatique des modules : tout fichier de `src/main/modules/**`
// qui exporte par défaut un module (ou un tableau `modules`) est enregistré.
// Les fichiers et dossiers préfixés par `_` sont des utilitaires, ignorés.

import type { OsintModule } from '@shared/modules'
import type { ModuleInfo } from '@shared/types'
import type { SettingsService } from '../settings'

type ModuleFile = { default?: OsintModule | OsintModule[]; modules?: OsintModule[] }

const files = import.meta.glob<ModuleFile>(['../modules/**/*.ts', '!../modules/**/_*.ts', '!../modules/**/_*/**'], {
  eager: true
})

const isModule = (m: unknown): m is OsintModule =>
  !!m && typeof m === 'object' && typeof (m as OsintModule).id === 'string' && typeof (m as OsintModule).run === 'function'

function collect(): OsintModule[] {
  const out = new Map<string, OsintModule>()
  for (const [path, file] of Object.entries(files)) {
    const candidates = [
      ...(Array.isArray(file.default) ? file.default : [file.default]),
      ...(Array.isArray(file.modules) ? file.modules : [])
    ]
    for (const m of candidates) {
      if (!isModule(m)) continue
      if (out.has(m.id)) console.warn(`[modules] identifiant en double : ${m.id} (${path})`)
      out.set(m.id, m)
    }
  }
  return Array.from(out.values()).sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id))
}

let cache: OsintModule[] | null = null

export function allModules(): OsintModule[] {
  if (!cache) cache = collect()
  return cache
}

export function getModule(id: string): OsintModule | undefined {
  return allModules().find((m) => m.id === id)
}

export function isConfigured(m: OsintModule, settings: SettingsService): boolean {
  return (m.keys ?? []).every((k) => k.optional || !!settings.getSecret(k.id))
}

export function moduleInfo(m: OsintModule, settings: SettingsService): ModuleInfo {
  const disabled = settings.get().disabledModules.includes(m.id)
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    inputTypes: m.inputTypes,
    keys: m.keys ?? [],
    ondemand: !!m.ondemand,
    noisy: !!m.noisy,
    experimental: !!m.experimental,
    enabled: !disabled,
    configured: isConfigured(m, settings),
    homepage: m.homepage
  }
}

/** Identifiants de toutes les clés déclarées par les modules (pour l'écran du coffre). */
export function knownKeyIds(): string[] {
  return Array.from(new Set(allModules().flatMap((m) => (m.keys ?? []).map((k) => k.id))))
}
