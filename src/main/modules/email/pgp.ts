// Clés PGP publiées pour une adresse : keys.openpgp.org (adresses vérifiées par
// le serveur) et keyserver.ubuntu.com (dépôt libre, donc à vérifier). Empreintes,
// dates de création, nom des identités et autres adresses de la même clé.

import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, httpFailure, requireEmail } from './_lib'
import { describeKey, oldestKeyDate, parseArmoredKeys, parseHkpIndex, type PgpKey } from './_pgp'

/** Au-delà, l'adresse est probablement « empoisonnée » : n'importe qui peut y attacher des clés. */
export const MAX_KEYS = 10

export interface PgpSource {
  /** keys.openpgp.org ne publie une adresse qu'après l'avoir vérifiée par email. */
  verified: boolean
  host: string
  keys: PgpKey[]
  /** Nombre de clés annoncé par le serveur (peut dépasser la liste lue). */
  count: number
}

/** Propriétés et entités à partir des clés trouvées sur chaque serveur. */
export function buildPgpOutput(
  email: string,
  sources: PgpSource[],
  lang: 'fr' | 'en'
): { properties: Record<string, PropValue>; entities: OutEntity[] } {
  const fr = lang === 'fr'
  const kept: Array<{ key: PgpKey; source: PgpSource }> = []
  let flooded = 0
  for (const s of sources) {
    // Garde-fou : une adresse rattachée à des dizaines de clés sur un serveur ouvert a été
    // inondée de fausses clés. On ne garde que leur nombre, sans empreinte ni entité.
    if (!s.verified && s.count > MAX_KEYS) {
      flooded = Math.max(flooded, s.count)
      continue
    }
    for (const key of s.keys) if (!kept.some((k) => k.key.fingerprint === key.fingerprint)) kept.push({ key, source: s })
  }
  const keys = kept.map((k) => k.key)
  const names = new Set<string>()
  const others = new Map<string, { verified: boolean; host: string; fingerprint: string }>()
  for (const { key, source } of kept) {
    for (const uid of key.uids) {
      if (uid.name && uid.name.toLowerCase() !== uid.email) names.add(uid.name)
      if (!uid.email || uid.email === email) continue
      const prev = others.get(uid.email)
      // Une adresse vérifiée par keys.openpgp.org l'emporte sur la même adresse non vérifiée.
      if (!prev || (!prev.verified && source.verified)) others.set(uid.email, { verified: source.verified, host: source.host, fingerprint: key.fingerprint })
    }
  }
  const entities: OutEntity[] = [...others].map(([address, o]) => ({
    type: 'email',
    label: address,
    data: { pgp_fingerprint: o.fingerprint },
    linkLabel: fr ? 'même clé PGP' : 'same PGP key',
    // Adresse vérifiée par le serveur de clés : même identité ; sinon, n'importe qui a pu l'ajouter.
    strength: o.verified ? 'same' : 'weak',
    ...(o.verified
      ? {}
      : {
          review: true,
          reviewReason: fr
            ? `autre adresse d'une clé déposée sur ${o.host}, serveur où n'importe qui peut publier une clé`
            : `other address of a key uploaded to ${o.host}, where anyone can publish a key`
        })
  }))
  const properties = compact({
    pgp_keys_count: flooded ? Math.max(flooded, keys.length) : keys.length || undefined,
    pgp_key_flooding: flooded ? true : undefined,
    pgp_fingerprints: keys.map((k) => k.fingerprint),
    pgp_keys: keys.map((k) => `${describeKey(k, lang)} · ${kept.find((x) => x.key === k)!.source.host}`),
    pgp_key_created_at: oldestKeyDate(keys),
    pgp_uid_names: [...names],
    pgp_verified: kept.some((k) => k.source.verified) || undefined
  })
  return { properties, entities }
}

/** keys.openpgp.org : clé armurée (404 si aucune clé ou adresse non vérifiée). */
async function fromOpenpgp(ctx: ModuleContext, email: string): Promise<PgpSource> {
  const res = await ctx.fetch(`https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(email)}`, {
    headers: { accept: 'application/pgp-keys' }
  })
  const host = 'keys.openpgp.org'
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined)
    return { verified: true, host, keys: [], count: 0 }
  }
  if (!res.ok) throw httpFailure(host, res.status)
  const keys = parseArmoredKeys(await res.text())
  return { verified: true, host, keys, count: keys.length }
}

/** keyserver.ubuntu.com : index HKP au format machine. */
async function fromUbuntu(ctx: ModuleContext, email: string): Promise<PgpSource> {
  const host = 'keyserver.ubuntu.com'
  const res = await ctx.fetch('https://keyserver.ubuntu.com/pks/lookup', { query: { op: 'index', search: email, options: 'mr' } })
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined)
    return { verified: false, host, keys: [], count: 0 }
  }
  if (!res.ok) throw httpFailure(host, res.status)
  const index = parseHkpIndex(await res.text())
  if (!index) throw new ModuleError(`${host} : réponse illisible`, 'other')
  // L'index cherche aussi dans les noms : on ne garde que les clés qui portent l'adresse exacte.
  const keys = index.keys.filter((k) => !k.uids.length || k.uids.some((u) => u.email === email))
  return { verified: false, host, keys, count: index.count }
}

export default defineModule({
  id: 'email.pgp',
  name: { fr: 'Clés PGP publiques', en: 'Public PGP keys' },
  description: {
    fr: "Cherche les clés PGP publiées pour l'adresse sur keys.openpgp.org (adresses vérifiées) et keyserver.ubuntu.com : empreintes, dates de création, nom de l'identité et autres adresses de la même clé (à vérifier quand elles viennent d'un serveur ouvert). Une adresse inondée de fausses clés n'est signalée que par leur nombre.",
    en: 'Looks up PGP keys published for the address on keys.openpgp.org (verified addresses) and keyserver.ubuntu.com: fingerprints, creation dates, identity name and other addresses on the same key (to review when they come from an open server). An address flooded with fake keys is only reported by their count.'
  },
  category: 'email',
  inputTypes: ['email'],
  homepage: 'https://keys.openpgp.org/about',
  async run(input, ctx) {
    const email = requireEmail(input)
    const results = await Promise.allSettled([fromOpenpgp(ctx, email), fromUbuntu(ctx, email)])
    const sources = results.filter((r): r is PromiseFulfilledResult<PgpSource> => r.status === 'fulfilled').map((r) => r.value)
    if (!sources.length) {
      const reason = (results[0] as PromiseRejectedResult).reason
      throw reason instanceof Error ? reason : new ModuleError(String(reason))
    }
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [i === 0 ? 'keys.openpgp.org' : 'keyserver.ubuntu.com'] : []))
    if (failed.length) ctx.log(`serveur injoignable : ${failed.join(', ')}`)
    const { properties, entities } = buildPgpOutput(email, sources, ctx.lang)
    const raw = { sources: sources.map((s) => ({ host: s.host, count: s.count, keys: s.keys.slice(0, MAX_KEYS) })), failed }
    if (!Object.keys(properties).length) return { raw }
    return { properties: { ...properties, ...(failed.length ? { pgp_unreachable: failed } : {}) }, entities, raw }
  }
})
