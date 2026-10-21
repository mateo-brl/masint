// roso.info : scan d'une adresse crypto ou d'un hash de transaction (page /crypto/ :
// catalogue /api/gateway/crypto/meta, puis POST /api/gateway/crypto/<module>).

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { detectCryptoChain } from '@shared/detect'
import { isFatal, pool, redact, ROSO_COMMON, RosoClient, toRosoError, type Json } from './_client'
import {
  accountEntities,
  addGeneric,
  asArr,
  asObj,
  dropEmpty,
  intelxEntities,
  isDomain,
  isObj,
  isoDate,
  pick,
  pickNum,
  siteName,
  stealerEntities,
  str
} from './_parse'
import { CRYPTO_FALLBACK_MODULES } from './_sites'

const PAGE = '/crypto/'
const POOL = 12
/** Modules qui décrivent l'adresse elle-même (solde, transactions) plutôt qu'un profil. */
const CHAIN_MODULES = new Set(['ethereum', 'ethtx', 'blockscout', 'ethplorer', 'tokens', 'portfolio', 'bitcoin', 'solana', 'debank', 'zerion'])

export function cryptoModules(meta: Json): string[] {
  if (asArr(meta.enrichmentModules).length) return asArr(meta.enrichmentModules).map(str).filter(Boolean)
  const mods = asArr(meta.modules)
  if (mods.length && typeof mods[0] === 'string') return mods.map(str).filter(Boolean)
  if (mods.length && isObj(mods[0])) return mods.map((m) => pick(asObj(m), 'id')).filter(Boolean)
  if (isObj(meta.moduleMeta)) return Object.keys(meta.moduleMeta)
  return []
}

function chainProps(p: Json): Record<string, PropValue | undefined> {
  return {
    balance: pick(p, 'balance', 'balanceFormatted', 'balance_eth', 'balanceBtc', 'totalBalance') || undefined,
    tx_count: pickNum(p, 'txCount', 'tx_count', 'transactionCount', 'transactions', 'n_tx'),
    received: pick(p, 'totalReceived', 'received', 'total_received') || undefined,
    sent: pick(p, 'totalSent', 'sent', 'total_sent') || undefined,
    first_seen: isoDate(p.firstSeen ?? p.first_seen ?? p.firstTx),
    last_seen: isoDate(p.lastSeen ?? p.last_seen ?? p.lastTx)
  }
}

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.crypto',
  name: { fr: 'roso.info : crypto', en: 'roso.info: crypto' },
  description: {
    fr: "Scan roso.info d'une adresse crypto (~140 modules : explorateurs, NFT, ENS, étiquettes, IntelX, Hudson Rock). Consomme des crédits roso.info.",
    en: 'roso.info crypto address scan (~140 modules: explorers, NFT, ENS, labels, IntelX, Hudson Rock). Consumes roso.info credits.'
  },
  inputTypes: ['crypto_wallet', 'crypto_tx'],
  timeoutMs: 600_000,
  async run(input, ctx) {
    const address = input.label.trim()
    if (!address || /\s/.test(address)) throw new ModuleError('Adresse invalide', 'invalid_input')
    const c = new RosoClient(ctx, 'crypto')
    await c.checkMaintenance('crypto')

    const meta = await c.get('/api/gateway/crypto/meta', { retries: 1, throwOnError: false, page: PAGE })
    if (meta.status === 401 || meta.status === 403) throw toRosoError(meta.status, meta.data, 'crypto', ctx.lang)
    const listed = meta.ok ? cryptoModules(meta.data) : []
    const modules = listed.length ? listed : CRYPTO_FALLBACK_MODULES

    const found: Array<{ mod: string; profile: Json }> = []
    const errors: Record<string, string> = {}
    let notFound = 0
    await pool(modules, POOL, ctx.signal, async (mod) => {
      try {
        const r = await c.post(`/api/gateway/crypto/${encodeURIComponent(mod)}`, { address, api_key: c.key }, { timeoutMs: 30000, retries: 1, throwOnError: false, page: PAGE })
        if (r.status === 401) throw toRosoError(401, r.data, 'crypto', ctx.lang)
        const d = r.data
        if (!r.ok) return void (errors[mod] = str(d.error) || `HTTP ${r.status}`)
        if (d.success === true && d.exists === true) found.push({ mod, profile: asObj(d.profile) })
        else if (d.success === false && d.error && d.error !== 'invalid_address' && /unavailable|error/.test(str(d.error))) errors[mod] = str(d.error)
        else notFound++
      } catch (e) {
        if (isFatal(e)) throw e
        errors[mod] = e instanceof Error ? e.message : String(e)
      }
    })

    const entities: OutEntity[] = []
    const props: Record<string, PropValue | undefined> = {}
    const labels: string[] = []
    for (const { mod, profile: p } of found) {
      if (mod === 'intelx') {
        entities.push(...intelxEntities(p.records, '$input', ctx.lang))
        continue
      }
      if (mod === 'hudsonrock') {
        entities.push(...stealerEntities(p.stealers, { refPrefix: 'hr', lang: ctx.lang }))
        continue
      }
      if (mod === 'labels' || mod === 'arkham') {
        labels.push(...asArr(p.labels ?? p.tags).map((x) => (isObj(x) ? pick(x, 'label', 'name', 'tag') : str(x))).filter(Boolean))
        const entity = pick(p, 'entity', 'entityName', 'owner', 'name')
        if (entity) entities.push({ type: 'organization', label: entity, data: dropEmpty({ kind: pick(p, 'entityType', 'type') || undefined }), linkLabel: ctx.lang === 'fr' ? 'propriétaire (étiquette)' : 'owner (label)' })
        continue
      }
      if (CHAIN_MODULES.has(mod)) {
        for (const [k, v] of Object.entries(chainProps(p))) if (v !== undefined && props[k] === undefined) props[k] = v
        continue
      }
      if (mod === 'ens') {
        const ens = pick(p, 'ens', 'name', 'ensName')
        if (ens && isDomain(ens)) entities.push({ type: 'domain', label: ens.toLowerCase(), data: { kind: 'ENS' }, linkLabel: 'ENS' })
        continue
      }
      const ref = `acc_${mod}`
      const out = accountEntities({ ...p, displayName: pick(p, 'displayName', 'ens', 'name') }, { site: mod, query: address, ref, lang: ctx.lang })
      addGeneric(out, p, ref, address, ctx.lang)
      entities.push(...out)
    }

    return {
      properties: dropEmpty({
        chain: input.platform ?? detectCryptoChain(address) ?? undefined,
        ...props,
        roso_labels: labels.length ? Array.from(new Set(labels)) : undefined,
        roso_found_count: found.length,
        roso_modules_checked: modules.length,
        roso_errors: Object.keys(errors).length,
        roso_found_on: found.map((f) => siteName(f.mod))
      }),
      entities,
      raw: redact({ meta: meta.data, modules: modules.length, found: Object.fromEntries(found.map((f) => [f.mod, f.profile])), notFound, errors }, c.key)
    }
  }
})
