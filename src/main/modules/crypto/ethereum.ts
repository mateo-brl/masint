// Portefeuille Ethereum via l'API publique Blockscout (sans clé) : solde, nom ENS,
// étiquettes publiques, dernières transactions et contreparties.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { coin, compact, getJson, isoDate, num, tr, uniq } from '../misc/_util'
import { chainOf, explorerUrl, MAX_COUNTERPARTIES, MAX_TX, txUrl, walletAddress } from './_chain'

const BASE = 'https://eth.blockscout.com/api/v2'

interface BsTag {
  name?: string
  tagType?: string
}

export interface BsAddressRef {
  hash: string
  ens_domain_name?: string | null
  name?: string | null
  is_contract?: boolean
  metadata?: { tags?: BsTag[] } | null
}

export interface BsAddress extends BsAddressRef {
  coin_balance: string | null
  exchange_rate?: string | null
  is_scam?: boolean
  is_verified?: boolean
  public_tags?: Array<{ display_name?: string; label?: string }>
  creator_address_hash?: string | null
}

export interface BsCounters {
  transactions_count?: string
  token_transfers_count?: string
}

export interface BsTx {
  hash: string
  timestamp: string | null
  block_number: number | null
  value: string
  fee?: { value?: string } | null
  result?: string
  method?: string | null
  from: BsAddressRef
  to: BsAddressRef | null
  created_contract?: BsAddressRef | null
}

function tagNames(a: BsAddressRef & { public_tags?: BsAddress['public_tags'] }): string[] {
  const meta = (a.metadata?.tags ?? []).map((t) => t.name ?? '').filter(Boolean)
  const pub = (a.public_tags ?? []).map((t) => t.display_name ?? t.label ?? '').filter(Boolean)
  return uniq([...meta, ...pub])
}

export function parseBlockscout(
  ctx: Pick<ModuleContext, 'lang'>,
  address: string,
  info: BsAddress,
  counters: BsCounters | null,
  txs: BsTx[]
): ModuleOutput {
  const self = address.toLowerCase()
  const wei = info.coin_balance ?? '0'
  const rate = num(info.exchange_rate)
  const labels = tagNames(info)
  const txCount = num(counters?.transactions_count)
  const times = txs.map((t) => (t.timestamp ? Date.parse(t.timestamp) : NaN)).filter((t) => !Number.isNaN(t))

  const properties: ModuleOutput['properties'] = {
    chain: 'Ethereum',
    balance: coin(wei, 18, 'ETH'),
    balance_usd: rate !== null ? `${((Number(wei) / 1e18) * rate).toFixed(2)} USD` : null,
    tx_count: txCount,
    token_transfers: num(counters?.token_transfers_count),
    is_contract: !!info.is_contract,
    contract_name: info.is_contract ? (info.name ?? null) : null,
    ens: info.ens_domain_name ?? null,
    labels,
    scam: info.is_scam ? true : null,
    explorer_url: explorerUrl('ethereum', address)
  }
  if (times.length) properties.last_seen = isoDate(Math.max(...times))
  if (times.length && txCount !== null && txs.length >= txCount) properties.first_seen = isoDate(Math.min(...times))

  const entities: OutEntity[] = []
  if (info.ens_domain_name) {
    entities.push({ type: 'domain', label: info.ens_domain_name, data: { kind: 'ENS' }, linkLabel: 'ENS' })
  }
  const seen = new Set<string>()
  txs.slice(0, MAX_TX).forEach((tx, i) => {
    const outgoing = tx.from.hash.toLowerCase() === self
    const other = outgoing ? (tx.to ?? tx.created_contract ?? null) : tx.from
    const ref = `tx${i}`
    entities.push({
      ref,
      type: 'crypto_tx',
      label: tx.hash,
      platform: 'ethereum',
      data: {
        date: isoDate(tx.timestamp),
        amount: (outgoing ? '-' : '+') + coin(tx.value, 18, 'ETH'),
        fee: tx.fee?.value ? coin(tx.fee.value, 18, 'ETH') : null,
        block: tx.block_number,
        direction: outgoing ? 'out' : 'in',
        method: tx.method ?? null,
        status: tx.result ?? null,
        url: txUrl('ethereum', tx.hash)
      },
      linkLabel: outgoing ? tr(ctx, 'envoie', 'sends') : tr(ctx, 'reçoit', 'receives')
    })
    if (!other || other.hash.toLowerCase() === self || seen.has(other.hash.toLowerCase())) return
    if (seen.size >= MAX_COUNTERPARTIES) return
    seen.add(other.hash.toLowerCase())
    const names = tagNames(other)
    entities.push({
      type: 'crypto_wallet',
      label: other.hash,
      platform: 'ethereum',
      from: ref,
      data: {
        ens: other.ens_domain_name ?? null,
        labels: names,
        is_contract: other.is_contract ?? null,
        contract_name: other.is_contract ? (other.name ?? null) : null
      },
      linkLabel: outgoing ? tr(ctx, 'vers', 'to') : tr(ctx, 'depuis', 'from')
    })
  })

  return {
    properties: compact(properties!),
    entities,
    raw: { address: info, counters, txs: txs.slice(0, MAX_TX).map((t) => t.hash) }
  }
}

export default defineModule({
  id: 'crypto.ethereum',
  name: { fr: 'Portefeuille Ethereum (Blockscout)', en: 'Ethereum wallet (Blockscout)' },
  description: {
    fr: "Solde, valeur en dollars, nom ENS, étiquettes publiques (plateformes d'échange, arnaques connues), dernières transactions et contreparties d'une adresse Ethereum.",
    en: 'Balance, dollar value, ENS name, public labels (exchanges, known scams), latest transactions and counterparties of an Ethereum address.'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  homepage: 'https://eth.blockscout.com',
  timeoutMs: 90000,
  accepts: (input) => chainOf(input) === 'ethereum',
  async run(input, ctx) {
    const address = walletAddress(input)
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ModuleError('Adresse Ethereum invalide', 'invalid_input')
    const info = await getJson<BsAddress>(ctx, `${BASE}/addresses/${address}`, 'Blockscout', { timeoutMs: 45000 })
    // Adresse jamais vue sur la chaîne : rien à signaler.
    if (!info) return {}
    const [counters, txs] = await Promise.all([
      getJson<BsCounters>(ctx, `${BASE}/addresses/${address}/counters`, 'Blockscout', { timeoutMs: 45000 }).catch(() => null),
      getJson<{ items: BsTx[] }>(ctx, `${BASE}/addresses/${address}/transactions`, 'Blockscout', { timeoutMs: 45000 })
    ])
    return parseBlockscout(ctx, address, info, counters, txs?.items ?? [])
  }
})
