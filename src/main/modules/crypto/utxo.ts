// Portefeuilles des chaînes à UTXO : Bitcoin et Litecoin (API Esplora de mempool.space
// et litecoinspace.org), Dogecoin et Dash (BlockCypher), Bitcoin Cash (Haskoin).

import { defineModule, ModuleError, type InputEntity, type ModuleContext, type OsintModule } from '@shared/modules'
import { getJson, serviceError } from '../misc/_util'
import { chainOf, MAX_TX, utxoOutput, walletAddress, type UtxoChainInfo, type UtxoSummary, type UtxoTx } from './_chain'

// ---------------------------------------------------------------------------
// Esplora (mempool.space, litecoinspace.org)

interface EsploraStats {
  funded_txo_sum: number
  spent_txo_sum: number
  tx_count: number
}

export interface EsploraAddress {
  address: string
  chain_stats: EsploraStats
  mempool_stats: EsploraStats
}

export interface EsploraTx {
  txid: string
  fee?: number
  vin: Array<{ is_coinbase?: boolean; prevout: { scriptpubkey_address?: string; value: number } | null }>
  vout: Array<{ scriptpubkey_address?: string; value: number }>
  status: { confirmed: boolean; block_height?: number; block_time?: number }
}

export function parseEsplora(addr: EsploraAddress, txs: EsploraTx[]): { summary: UtxoSummary; txs: UtxoTx[] } {
  const c = addr.chain_stats
  const m = addr.mempool_stats
  const received = c.funded_txo_sum + m.funded_txo_sum
  const sent = c.spent_txo_sum + m.spent_txo_sum
  return {
    summary: { address: addr.address, balance: received - sent, received, sent, txCount: c.tx_count + m.tx_count },
    txs: txs.map((t) => ({
      txid: t.txid,
      time: t.status.block_time ?? null,
      block: t.status.block_height ?? null,
      fee: t.fee ?? null,
      inputs: t.vin.map((v) => ({ address: v.prevout?.scriptpubkey_address ?? null, value: v.prevout?.value ?? 0 })),
      outputs: t.vout.map((v) => ({ address: v.scriptpubkey_address ?? null, value: v.value }))
    }))
  }
}

function esploraModule(o: { id: string; chain: string; symbol: string; base: string; service: string; homepage: string }): OsintModule {
  const info: UtxoChainInfo = { chain: o.chain, symbol: o.symbol, decimals: 8 }
  const name = o.chain === 'bitcoin' ? 'Bitcoin' : 'Litecoin'
  return defineModule({
    id: o.id,
    name: { fr: `Portefeuille ${name} (${o.service})`, en: `${name} wallet (${o.service})` },
    description: {
      fr: `Solde, total reçu et envoyé, nombre de transactions, dernières transactions et adresses contreparties d'une adresse ${name}.`,
      en: `Balance, total received and sent, transaction count, latest transactions and counterparty addresses of a ${name} address.`
    },
    category: 'crypto',
    inputTypes: ['crypto_wallet'],
    homepage: o.homepage,
    accepts: (input) => chainOf(input) === o.chain,
    async run(input, ctx) {
      const address = walletAddress(input)
      let addr: EsploraAddress
      try {
        addr = await ctx.fetchJson<EsploraAddress>(`${o.base}/address/${encodeURIComponent(address)}`)
      } catch (e) {
        const status = (e as { status?: number }).status
        if (status === 400) throw new ModuleError(`Adresse ${name} invalide`, 'invalid_input')
        throw serviceError(e, o.service)
      }
      const list = (await getJson<EsploraTx[]>(ctx, `${o.base}/address/${encodeURIComponent(address)}/txs`, o.service)) ?? []
      const parsed = parseEsplora(addr, list)
      return utxoOutput(ctx, info, address, parsed.summary, parsed.txs, { address: addr, txs: list.slice(0, MAX_TX).map((t) => t.txid) })
    }
  })
}

// ---------------------------------------------------------------------------
// BlockCypher (Dogecoin, Dash)

export interface BlockcypherFull {
  address: string
  total_received: number
  total_sent: number
  final_balance: number
  final_n_tx: number
  txs?: Array<{
    hash: string
    block_height: number
    confirmed?: string
    fees?: number
    inputs: Array<{ addresses?: string[] | null; output_value?: number }>
    outputs: Array<{ addresses?: string[] | null; value: number }>
  }>
}

export function parseBlockcypher(d: BlockcypherFull): { summary: UtxoSummary; txs: UtxoTx[] } {
  return {
    summary: {
      address: d.address,
      balance: d.final_balance,
      received: d.total_received,
      sent: d.total_sent,
      txCount: d.final_n_tx
    },
    txs: (d.txs ?? []).map((t) => ({
      txid: t.hash,
      time: t.confirmed ? Math.floor(Date.parse(t.confirmed) / 1000) : null,
      block: t.block_height > 0 ? t.block_height : null,
      fee: t.fees ?? null,
      inputs: t.inputs.map((i) => ({ address: i.addresses?.[0] ?? null, value: i.output_value ?? 0 })),
      outputs: t.outputs.map((v) => ({ address: v.addresses?.[0] ?? null, value: v.value }))
    }))
  }
}

function blockcypherModule(o: { id: string; chain: string; coin: string; symbol: string; name: string }): OsintModule {
  const info: UtxoChainInfo = { chain: o.chain, symbol: o.symbol, decimals: 8 }
  return defineModule({
    id: o.id,
    name: { fr: `Portefeuille ${o.name} (BlockCypher)`, en: `${o.name} wallet (BlockCypher)` },
    description: {
      fr: `Solde, total reçu et envoyé, nombre de transactions et dernières transactions d'une adresse ${o.name}. Sans clé : environ 100 requêtes par heure.`,
      en: `Balance, total received and sent, transaction count and latest transactions of a ${o.name} address. Without a token: about 100 requests per hour.`
    },
    category: 'crypto',
    inputTypes: ['crypto_wallet'],
    keys: [{ id: 'blockcypher', label: 'BlockCypher token', url: 'https://accounts.blockcypher.com/', optional: true }],
    homepage: 'https://www.blockcypher.com',
    accepts: (input) => chainOf(input) === o.chain,
    async run(input, ctx) {
      const address = walletAddress(input)
      const token = ctx.key('blockcypher')
      let d: BlockcypherFull
      try {
        d = await ctx.fetchJson<BlockcypherFull>(
          `https://api.blockcypher.com/v1/${o.coin}/main/addrs/${encodeURIComponent(address)}/full`,
          { query: { limit: MAX_TX, txlimit: 20, token } }
        )
      } catch (e) {
        const status = (e as { status?: number }).status
        if (status === 400 || status === 404) throw new ModuleError(`Adresse ${o.name} invalide`, 'invalid_input')
        throw serviceError(e, 'BlockCypher', !!token)
      }
      const parsed = parseBlockcypher(d)
      const { txs, ...rest } = d
      return utxoOutput(ctx, info, address, parsed.summary, parsed.txs, { ...rest, txs: (txs ?? []).map((t) => t.hash) })
    }
  })
}

// ---------------------------------------------------------------------------
// Haskoin (Bitcoin Cash)

export interface HaskoinBalance {
  address: string
  confirmed: number
  unconfirmed: number
  received: number
  txs: number
}

export interface HaskoinTx {
  txid: string
  time: number
  fee: number
  block: { height?: number; mempool?: number }
  inputs: Array<{ address?: string | null; value: number }>
  outputs: Array<{ address?: string | null; value: number }>
}

export function parseHaskoin(b: HaskoinBalance, txs: HaskoinTx[]): { summary: UtxoSummary; txs: UtxoTx[] } {
  const balance = b.confirmed + b.unconfirmed
  return {
    summary: { address: b.address, balance, received: b.received, sent: b.received - balance, txCount: b.txs },
    txs: txs.map((t) => ({
      txid: t.txid,
      time: t.block.height !== undefined ? t.time : null,
      block: t.block.height ?? null,
      fee: t.fee,
      inputs: t.inputs.map((i) => ({ address: i.address ?? null, value: i.value })),
      outputs: t.outputs.map((v) => ({ address: v.address ?? null, value: v.value }))
    }))
  }
}

const bitcoinCash = defineModule({
  id: 'crypto.bitcoincash',
  name: { fr: 'Portefeuille Bitcoin Cash (Haskoin)', en: 'Bitcoin Cash wallet (Haskoin)' },
  description: {
    fr: "Solde, total reçu et envoyé, nombre de transactions, dernières transactions et contreparties d'une adresse Bitcoin Cash (format cashaddr ou ancien format).",
    en: 'Balance, total received and sent, transaction count, latest transactions and counterparties of a Bitcoin Cash address (cashaddr or legacy format).'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  homepage: 'https://api.haskoin.com',
  accepts: (input) => chainOf(input) === 'bitcoincash',
  async run(input: InputEntity, ctx: ModuleContext) {
    const address = walletAddress(input)
    const base = `https://api.haskoin.com/bch/address/${encodeURIComponent(address)}`
    let balance: HaskoinBalance
    try {
      balance = await ctx.fetchJson<HaskoinBalance>(`${base}/balance`)
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 400 || status === 404) throw new ModuleError('Adresse Bitcoin Cash invalide', 'invalid_input')
      throw serviceError(e, 'Haskoin')
    }
    const txs = (await getJson<HaskoinTx[]>(ctx, `${base}/transactions/full`, 'Haskoin', { query: { limit: MAX_TX } })) ?? []
    const parsed = parseHaskoin(balance, txs)
    const info: UtxoChainInfo = { chain: 'bitcoincash', symbol: 'BCH', decimals: 8 }
    return utxoOutput(ctx, info, address, parsed.summary, parsed.txs, { balance, txs: txs.map((t) => t.txid) })
  }
})

export const modules: OsintModule[] = [
  esploraModule({
    id: 'crypto.bitcoin',
    chain: 'bitcoin',
    symbol: 'BTC',
    base: 'https://mempool.space/api',
    service: 'mempool.space',
    homepage: 'https://mempool.space'
  }),
  esploraModule({
    id: 'crypto.litecoin',
    chain: 'litecoin',
    symbol: 'LTC',
    base: 'https://litecoinspace.org/api',
    service: 'litecoinspace.org',
    homepage: 'https://litecoinspace.org'
  }),
  blockcypherModule({ id: 'crypto.dogecoin', chain: 'dogecoin', coin: 'doge', symbol: 'DOGE', name: 'Dogecoin' }),
  blockcypherModule({ id: 'crypto.dash', chain: 'dash', coin: 'dash', symbol: 'DASH', name: 'Dash' }),
  bitcoinCash
]
