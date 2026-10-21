// Outils communs aux modules crypto : détection de la chaîne, liens d'explorateur
// et mise en forme des transactions des chaînes à UTXO (Bitcoin et dérivés).

import { detectCryptoChain } from '@shared/detect'
import type { InputEntity, ModuleContext, ModuleOutput, OutEntity } from '@shared/modules'
import { getPlatform } from '@shared/platforms'
import { coin, isoDate, tr } from '../misc/_util'

/** Chaînes compatibles EVM (même format d'adresse 0x...). */
export const EVM_CHAINS = ['ethereum', 'bnb', 'polygon', 'avalanche', 'arbitrum', 'base_chain']

/** Nombre maximal de transactions et de contreparties ajoutées au graphe. */
export const MAX_TX = 10
export const MAX_COUNTERPARTIES = 15

const TX_EXPLORER: Record<string, string> = {
  bitcoin: 'https://mempool.space/tx/{t}',
  litecoin: 'https://litecoinspace.org/tx/{t}',
  dogecoin: 'https://blockchair.com/dogecoin/transaction/{t}',
  dash: 'https://blockchair.com/dash/transaction/{t}',
  bitcoincash: 'https://blockchair.com/bitcoin-cash/transaction/{t}',
  ethereum: 'https://etherscan.io/tx/{t}',
  tron: 'https://tronscan.org/#/transaction/{t}',
  solana: 'https://solscan.io/tx/{t}'
}

export function walletAddress(input: InputEntity): string {
  return input.label.trim()
}

/** Chaîne déduite d'une adresse seule. Complète `detectCryptoChain` (Bitcoin Cash, Dash). */
export function detectChain(address: string): string | null {
  const a = address.trim()
  if (/^(bitcoincash:)?[qp][02-9ac-hj-np-z]{41}$/.test(a)) return 'bitcoincash'
  if (/^X[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return 'dash'
  return detectCryptoChain(a)
}

/** Chaîne d'un portefeuille : sa plateforme si c'est une blockchain, sinon déduite de l'adresse. */
export function chainOf(input: InputEntity): string | null {
  const p = getPlatform(input.platform)
  if (p?.category === 'crypto' && p.explorer && p.id !== 'tether') return p.id
  return detectChain(walletAddress(input))
}

export function explorerUrl(chain: string, address: string): string | null {
  const tpl = getPlatform(chain)?.explorer
  return tpl ? tpl.replace('{a}', address) : null
}

export function txUrl(chain: string, txid: string): string | null {
  const tpl = TX_EXPLORER[chain]
  return tpl ? tpl.replace('{t}', txid) : null
}

// ---------------------------------------------------------------------------
// Chaînes à UTXO

export interface UtxoIo {
  address: string | null
  value: number
}

export interface UtxoTx {
  txid: string
  /** Horodatage du bloc en secondes (null si non confirmée). */
  time: number | null
  block: number | null
  fee: number | null
  inputs: UtxoIo[]
  outputs: UtxoIo[]
}

export interface UtxoSummary {
  /** Adresse telle que renvoyée par le service (forme canonique). */
  address: string
  balance: number
  received: number
  sent: number
  txCount: number
}

export interface UtxoChainInfo {
  chain: string
  symbol: string
  decimals: number
}

const bare = (a: string | null): string => (a ?? '').replace(/^bitcoincash:/, '').toLowerCase()

/** Résultat commun : propriétés du portefeuille, dernières transactions et contreparties. */
export function utxoOutput(
  ctx: Pick<ModuleContext, 'lang'>,
  info: UtxoChainInfo,
  input: string,
  summary: UtxoSummary,
  txs: UtxoTx[],
  raw: unknown
): ModuleOutput {
  const self = new Set([bare(input), bare(summary.address)])
  const fmt = (v: number): string => coin(v, info.decimals, info.symbol)
  const times = txs.map((t) => t.time).filter((t): t is number => !!t)
  const properties: ModuleOutput['properties'] = {
    chain: getPlatform(info.chain)?.name ?? info.chain,
    balance: fmt(summary.balance),
    received: fmt(summary.received),
    sent: fmt(summary.sent),
    tx_count: summary.txCount,
    explorer_url: explorerUrl(info.chain, input)
  }
  if (times.length) properties.last_seen = isoDate(Math.max(...times))
  // La première activité n'est fiable que si toutes les transactions ont été lues.
  if (times.length && txs.length >= summary.txCount) properties.first_seen = isoDate(Math.min(...times))

  const entities: OutEntity[] = []
  const seen = new Set<string>()
  let counterparties = 0
  txs.slice(0, MAX_TX).forEach((tx, i) => {
    const mine = (io: UtxoIo): boolean => self.has(bare(io.address))
    const delta =
      tx.outputs.filter(mine).reduce((s, o) => s + o.value, 0) - tx.inputs.filter(mine).reduce((s, o) => s + o.value, 0)
    const incoming = delta >= 0
    const ref = `tx${i}`
    entities.push({
      ref,
      type: 'crypto_tx',
      label: tx.txid,
      platform: info.chain,
      data: {
        date: isoDate(tx.time),
        amount: (incoming ? '+' : '') + fmt(delta),
        fee: tx.fee !== null ? fmt(tx.fee) : null,
        block: tx.block,
        direction: incoming ? 'in' : 'out',
        url: txUrl(info.chain, tx.txid)
      },
      linkLabel: incoming ? tr(ctx, 'reçoit', 'receives') : tr(ctx, 'envoie', 'sends')
    })
    const others = (incoming ? tx.inputs : tx.outputs).filter((io) => io.address && !mine(io))
    let perTx = 0
    for (const io of others) {
      if (counterparties >= MAX_COUNTERPARTIES || perTx >= 3) break
      const addr = io.address!
      if (seen.has(addr)) continue
      seen.add(addr)
      counterparties++
      perTx++
      entities.push({
        type: 'crypto_wallet',
        label: addr,
        platform: info.chain,
        from: ref,
        linkLabel: incoming ? tr(ctx, 'depuis', 'from') : tr(ctx, 'vers', 'to')
      })
    }
  })

  return { properties, entities, raw }
}
