// Historique des pseudos d'un compte (X via memory.lol, Bluesky via plc.directory,
// noms Steam) : périodes d'utilisation et entités « ancien pseudo » à vérifier.

import type { OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import type { Lang } from './_lib'

export interface NameSpan {
  name: string
  /** Premier jour où le pseudo est observé ou adopté (AAAA-MM-JJ). */
  from?: string
  /** Dernier jour d'utilisation connu ; absent pour le pseudo en cours. */
  until?: string
}

/** « jack (2011-09-28 / 2026-07-15) » : période lisible pour la fiche. */
export function spanText(s: NameSpan): string {
  const period = [s.from ?? '?', s.until ?? '…'].join(' / ')
  return s.from || s.until ? `${s.name} (${period})` : s.name
}

/**
 * Entités `username` à vérifier pour les autres pseudos d'un même compte. Le pseudo courant
 * (`current`) est exclu ; un pseudo vu plus tard que lui est présenté comme « plus récent ».
 */
export function previousNameEntities(
  spans: NameSpan[],
  opts: {
    current?: string
    service: string
    source: string
    lang: Lang
    /** Compte concerné, quand un même pseudo a servi à plusieurs comptes. */
    account?: string
    /** Libellé de l'entité (par défaut le pseudo tel quel). */
    label?: (s: NameSpan) => string
    /** Propriétés supplémentaires de l'entité. */
    data?: (s: NameSpan) => Record<string, PropValue>
  }
): OutEntity[] {
  const fr = opts.lang === 'fr'
  const current = opts.current?.toLowerCase()
  const currentSpan = spans.find((s) => s.name.toLowerCase() === current)
  const seen = new Set<string>()
  const out: OutEntity[] = []
  for (const s of spans) {
    const key = s.name.toLowerCase()
    if (key === current || seen.has(key) || !s.name.trim()) continue
    seen.add(key)
    const newer = !!currentSpan?.until && !!s.until && s.until > currentSpan.until
    const of = opts.account ? (fr ? ` du compte ${opts.account}` : ` of account ${opts.account}`) : ''
    const reason = newer
      ? fr
        ? `pseudo ${opts.service} plus récent${of} (${opts.source}), vu jusqu'au ${s.until}`
        : `more recent ${opts.service} username${of} (${opts.source}), seen until ${s.until}`
      : s.until
        ? fr
          ? `ancien pseudo ${opts.service}${of} (${opts.source}), utilisé jusqu'au ${s.until}`
          : `former ${opts.service} username${of} (${opts.source}), used until ${s.until}`
        : fr
          ? `ancien pseudo ${opts.service}${of} (${opts.source})`
          : `former ${opts.service} username${of} (${opts.source})`
    out.push({
      type: 'username',
      label: opts.label ? opts.label(s) : s.name,
      data: { first_seen: s.from ?? null, last_seen: s.until ?? null, source: opts.source, ...opts.data?.(s) },
      linkLabel: newer ? (fr ? 'pseudo plus récent' : 'more recent username') : fr ? 'ancien pseudo' : 'previous username',
      // Ancien pseudo du même compte (même identifiant) : même identité, mais à confirmer.
      strength: 'same',
      review: true,
      reviewReason: reason
    })
  }
  return out
}
