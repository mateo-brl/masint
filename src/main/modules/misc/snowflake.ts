// Date de création cachée dans un identifiant numérique (« snowflake ») : les 42 bits de poids
// fort d'un identifiant Discord ou X (Twitter) sont un horodatage en millisecondes depuis
// l'époque du service. Hors ligne.

import { defineModule, type InputEntity } from '@shared/modules'

/** Époque des identifiants Discord : 2015-01-01T00:00:00Z. */
export const DISCORD_EPOCH = 1420070400000n
/** Époque des identifiants X (Twitter) : 2010-11-04T01:42:54.657Z. */
export const X_EPOCH = 1288834974657n

/**
 * Plus grand identifiant séquentiel d'avant les snowflakes : les comptes X créés avant le
 * passage aux identifiants 64 bits ont un numéro sur 32 bits, qui n'encode aucune date.
 */
const X_SEQUENTIAL_MAX = 2n ** 32n

/** Date ISO encodée dans un snowflake, ou `null` si l'identifiant n'en est pas un. */
export function snowflakeTime(id: string, epoch: bigint, now = Date.now()): string | null {
  if (!/^\d{1,20}$/.test(id)) return null
  const n = BigInt(id)
  if (n >= 2n ** 64n) return null
  if (epoch === X_EPOCH && n <= X_SEQUENTIAL_MAX) return null
  if (epoch === DISCORD_EPOCH && id.length < 15) return null
  const ms = Number((n >> 22n) + epoch)
  // Une date dans le futur trahit un nombre qui n'est pas un snowflake.
  if (ms > now + 86_400_000) return null
  return new Date(ms).toISOString()
}

const SERVICES: Record<string, bigint> = { discord: DISCORD_EPOCH, x: X_EPOCH }

/** Identifiant numérique porté par le nœud : `user_id`, `guild_id`, ou le pseudo s'il est numérique. */
export function snowflakeOf(input: InputEntity): { id: string; epoch: bigint } | null {
  const epoch = input.platform ? SERVICES[input.platform] : undefined
  if (!epoch) return null
  const candidates = [input.data.user_id, input.data.guild_id, input.platform === 'discord' ? input.label : undefined]
  for (const c of candidates) {
    const id = typeof c === 'number' ? String(c) : typeof c === 'string' ? c.trim() : ''
    if (id && snowflakeTime(id, epoch)) return { id, epoch }
  }
  return null
}

export default defineModule({
  id: 'misc.snowflake',
  name: { fr: "Date cachée dans l'identifiant", en: 'Date hidden in the ID' },
  description: {
    fr: "Déduit la date de création d'un compte ou d'un serveur Discord, ou d'un compte X (Twitter), de son identifiant numérique (snowflake), quand la fiche n'en a pas encore. Hors ligne.",
    en: 'Derives the creation date of a Discord account or server, or of an X (Twitter) account, from its numeric ID (snowflake), when the record does not have one yet. Offline.'
  },
  category: 'misc',
  inputTypes: ['account', 'group'],
  accepts: (input) => !input.data.created_at && snowflakeOf(input) !== null,
  // L'identifiant arrive souvent avec un autre module (scan, profil) : relancé en fin de tâche.
  followUp: true,
  async run(input) {
    const s = snowflakeOf(input)
    if (!s) return {}
    const createdAt = snowflakeTime(s.id, s.epoch)
    return createdAt ? { properties: { created_at: createdAt }, raw: { id: s.id, epoch: Number(s.epoch) } } : {}
  }
})
