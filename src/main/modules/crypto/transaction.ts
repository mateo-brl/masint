// Transaction crypto via des explorateurs publics sans clé : Bitcoin (mempool.space), Litecoin
// (litecoinspace.org), Ethereum (Blockscout) et TRON (Tronscan). La chaîne est celle du nœud,
// sinon déduite du format : `0x` + 64 hex pour Ethereum, 64 hex pour Bitcoin puis TRON.
// Résultat : date, bloc, montant et frais en propriétés, adresses d'entrée et de sortie en
// portefeuilles (10 au plus de chaque côté), transferts de jetons (USDT...).

import { defineModule, ModuleError, type InputEntity, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { getPlatform } from '@shared/platforms'
import type { PropValue } from '@shared/types'
import { cappedList } from '../domain/_util'
import { coin, compact, formatUnits, isoDate, serviceError, tr, uniq } from '../misc/_util'
import { p2pkScriptAddress } from './_btc'
import { txUrl } from './_chain'

/** Adresses reliées au graphe de chaque côté de la transaction. */
export const MAX_SIDE = 10

type TxChain = 'bitcoin' | 'litecoin' | 'ethereum' | 'tron'

/** Une adresse d'un côté de la transaction, avec ce qu'elle y a envoyé ou reçu. */
export interface TxParty {
  address: string
  amounts: string[]
  data?: Record<string, PropValue>
}

/** Transaction lue, quelle que soit la chaîne. */
export interface TxSummary {
  chain: TxChain
  txid: string
  /** Horodatage du bloc en millisecondes, `null` si non confirmée. */
  time: number | null
  block: number | null
  amount: string | null
  fee: string | null
  confirmed: boolean
  status?: string | null
  method?: string | null
  coinbase?: boolean
  inputCount: number
  outputCount: number
  inputs: TxParty[]
  outputs: TxParty[]
  tokenTransfers: string[]
}

/** Chaîne d'une transaction : plateforme du nœud, sinon format de l'identifiant. */
export function txChain(input: Pick<InputEntity, 'label' | 'platform'>): TxChain | 'utxo_or_tron' | null {
  const id = input.label.trim()
  const p = input.platform
  if (/^0x[0-9a-fA-F]{64}$/.test(id)) return !p || p === 'ethereum' || p === 'tether' ? 'ethereum' : null
  if (!/^[0-9a-fA-F]{64}$/.test(id)) return null
  if (p === 'bitcoin' || p === 'litecoin' || p === 'tron') return p
  if (p === 'tether') return 'tron'
  return p ? null : 'utxo_or_tron'
}

/** Regroupe les montants par adresse, dans l'ordre d'apparition. */
function parties(list: Array<{ address: string | null; amount: string | null; data?: Record<string, PropValue> }>): TxParty[] {
  const map = new Map<string, TxParty>()
  for (const { address, amount, data } of list) {
    if (!address) continue
    const key = address.toLowerCase()
    const p = map.get(key) ?? { address, amounts: [], data }
    if (amount) p.amounts.push(amount)
    map.set(key, p)
  }
  return [...map.values()]
}

// ---------------------------------------------------------------------------
// Bitcoin, Litecoin : API Esplora

export interface EsploraTxFull {
  txid: string
  fee?: number
  vin: Array<{ is_coinbase?: boolean; prevout: { scriptpubkey?: string; scriptpubkey_address?: string; value: number } | null }>
  vout: Array<{ scriptpubkey?: string; scriptpubkey_address?: string; value: number }>
  status: { confirmed: boolean; block_height?: number; block_time?: number }
}

/** Somme de plusieurs montants d'une même adresse, en unités entières. */
function sumUnits(values: number[]): number {
  return values.reduce((s, v) => s + v, 0)
}

export function parseEsploraTx(chain: 'bitcoin' | 'litecoin', t: EsploraTxFull): TxSummary {
  const symbol = chain === 'bitcoin' ? 'BTC' : 'LTC'
  // Sortie P2PK (premiers blocs) : adresse P2PKH équivalente, comme sur les explorateurs.
  const addr = (o: { scriptpubkey?: string; scriptpubkey_address?: string } | null): string | null =>
    o?.scriptpubkey_address ?? (o?.scriptpubkey && chain === 'bitcoin' ? p2pkScriptAddress(o.scriptpubkey) : null)
  const group = (ios: Array<{ address: string | null; value: number }>): TxParty[] => {
    const by = new Map<string, number[]>()
    for (const io of ios) if (io.address) by.set(io.address, [...(by.get(io.address) ?? []), io.value])
    return parties([...by].map(([address, values]) => ({ address, amount: coin(sumUnits(values), 8, symbol) })))
  }
  const outTotal = sumUnits(t.vout.map((o) => o.value))
  return {
    chain,
    txid: t.txid,
    time: t.status.block_time ? t.status.block_time * 1000 : null,
    block: t.status.block_height ?? null,
    amount: coin(outTotal, 8, symbol),
    fee: t.fee !== undefined ? coin(t.fee, 8, symbol) : null,
    confirmed: t.status.confirmed,
    coinbase: t.vin.some((v) => v.is_coinbase) || undefined,
    inputCount: t.vin.length,
    outputCount: t.vout.length,
    inputs: group(t.vin.map((v) => ({ address: addr(v.prevout), value: v.prevout?.value ?? 0 }))),
    outputs: group(t.vout.map((o) => ({ address: addr(o), value: o.value }))),
    tokenTransfers: []
  }
}

// ---------------------------------------------------------------------------
// Ethereum : Blockscout

interface BsRef {
  hash: string
  ens_domain_name?: string | null
  name?: string | null
  is_contract?: boolean
  metadata?: { tags?: Array<{ name?: string }> } | null
  public_tags?: Array<{ display_name?: string; label?: string }>
}

export interface BsTxFull {
  hash: string
  timestamp: string | null
  block_number: number | null
  value: string
  fee?: { value?: string } | null
  result?: string
  status?: string | null
  method?: string | null
  from: BsRef
  to: BsRef | null
  created_contract?: BsRef | null
  token_transfers?: Array<{
    from: BsRef
    to: BsRef
    token?: { symbol?: string | null; decimals?: string | null; type?: string }
    total?: { value?: string; decimals?: string | null } | null
  }> | null
}

function bsData(r: BsRef): Record<string, PropValue> {
  const labels = uniq([...(r.metadata?.tags ?? []).map((t) => t.name ?? ''), ...(r.public_tags ?? []).map((t) => t.display_name ?? t.label ?? '')].filter(Boolean))
  return compact({ ens: r.ens_domain_name ?? null, labels, is_contract: r.is_contract ? true : null, contract_name: r.is_contract ? (r.name ?? null) : null })
}

export function parseBlockscoutTx(t: BsTxFull): TxSummary {
  const value = t.value && t.value !== '0' ? coin(t.value, 18, 'ETH') : null
  const to = t.to ?? t.created_contract ?? null
  const transfers = (t.token_transfers ?? []).filter((x) => x.total?.value !== undefined)
  const tokenAmount = (x: (typeof transfers)[number]): string => {
    const decimals = Number(x.total?.decimals ?? x.token?.decimals ?? 0)
    return `${formatUnits(x.total!.value!, Number.isFinite(decimals) ? decimals : 0)} ${x.token?.symbol ?? '?'}`
  }
  const inputs = parties([
    { address: t.from.hash, amount: value, data: bsData(t.from) },
    ...transfers.map((x) => ({ address: x.from.hash, amount: tokenAmount(x), data: bsData(x.from) }))
  ])
  const outputs = parties([
    ...(to ? [{ address: to.hash, amount: value, data: bsData(to) }] : []),
    ...transfers.map((x) => ({ address: x.to.hash, amount: tokenAmount(x), data: bsData(x.to) }))
  ])
  return {
    chain: 'ethereum',
    txid: t.hash,
    time: t.timestamp ? Date.parse(t.timestamp) : null,
    block: t.block_number,
    amount: value ?? (transfers.length === 1 ? tokenAmount(transfers[0]) : coin(t.value || '0', 18, 'ETH')),
    fee: t.fee?.value ? coin(t.fee.value, 18, 'ETH') : null,
    confirmed: t.block_number !== null,
    status: t.result ?? t.status ?? null,
    method: t.method ?? null,
    inputCount: inputs.length,
    outputCount: outputs.length,
    inputs,
    outputs,
    tokenTransfers: transfers.map((x) => `${tokenAmount(x)} : ${x.from.hash} → ${x.to.hash}`)
  }
}

// ---------------------------------------------------------------------------
// TRON : Tronscan

export interface TronscanTx {
  hash?: string
  block?: number
  timestamp?: number
  ownerAddress?: string
  toAddress?: string
  contractType?: number
  confirmed?: boolean
  contractRet?: string
  cost?: { fee?: number; energy_fee?: number; net_fee?: number } | null
  contractData?: { amount?: number; owner_address?: string; to_address?: string } | null
  trc20TransferInfo?: Array<{ from_address: string; to_address: string; amount_str: string; decimals: number; symbol: string }> | null
  addressTag?: Record<string, string> | null
  contract_map?: Record<string, boolean> | null
}

export function parseTronscanTx(t: TronscanTx): TxSummary | null {
  if (!t.hash) return null
  const tag = (a: string): Record<string, PropValue> => compact({ label: t.addressTag?.[a] ?? null, is_contract: t.contract_map?.[a] ? true : null })
  // Transfert de TRX (type 1) : montant en sun (millionièmes de TRX).
  const trx = t.contractType === 1 && t.contractData?.amount !== undefined ? coin(t.contractData.amount, 6, 'TRX') : null
  const transfers = t.trc20TransferInfo ?? []
  const tokenAmount = (x: (typeof transfers)[number]): string => `${formatUnits(x.amount_str, x.decimals)} ${x.symbol}`
  const owner = t.ownerAddress ?? t.contractData?.owner_address ?? null
  const to = t.toAddress ?? t.contractData?.to_address ?? null
  const inputs = parties([
    { address: owner, amount: trx, data: owner ? tag(owner) : undefined },
    ...transfers.map((x) => ({ address: x.from_address, amount: tokenAmount(x), data: tag(x.from_address) }))
  ])
  const outputs = parties([
    { address: to, amount: trx, data: to ? tag(to) : undefined },
    ...transfers.map((x) => ({ address: x.to_address, amount: tokenAmount(x), data: tag(x.to_address) }))
  ])
  const fee = (t.cost?.fee ?? 0) + (t.cost?.energy_fee ?? 0) + (t.cost?.net_fee ?? 0)
  return {
    chain: 'tron',
    txid: t.hash,
    time: t.timestamp ?? null,
    block: t.block ?? null,
    amount: trx ?? (transfers.length === 1 ? tokenAmount(transfers[0]) : null),
    fee: t.cost ? coin(fee, 6, 'TRX') : null,
    confirmed: !!t.confirmed,
    status: t.contractRet ?? null,
    inputCount: inputs.length,
    outputCount: outputs.length,
    inputs,
    outputs,
    tokenTransfers: transfers.map((x) => `${tokenAmount(x)} : ${x.from_address} → ${x.to_address}`)
  }
}

// ---------------------------------------------------------------------------
// Sortie commune

export function txOutput(ctx: Pick<ModuleContext, 'lang'>, s: TxSummary, raw: unknown): ModuleOutput {
  const properties: Record<string, PropValue | undefined> = {
    chain: getPlatform(s.chain)?.name ?? s.chain,
    date: isoDate(s.time),
    block: s.block,
    amount: s.amount,
    fee: s.fee,
    confirmed: s.confirmed,
    status: s.status ?? null,
    method: s.method ?? null,
    coinbase: s.coinbase ?? null,
    input_count: s.inputCount,
    output_count: s.outputCount,
    explorer_url: txUrl(s.chain, s.txid),
    ...cappedList('token_transfers', s.tokenTransfers, 20)
  }
  // Au-delà du plafond, les adresses restent lisibles dans la fiche.
  if (s.inputs.length > MAX_SIDE) Object.assign(properties, cappedList('input_addresses', s.inputs.map((p) => p.address)))
  if (s.outputs.length > MAX_SIDE) Object.assign(properties, cappedList('output_addresses', s.outputs.map((p) => p.address)))

  const entities: OutEntity[] = []
  const side = (list: TxParty[], fr: string, en: string): void => {
    for (const p of list.slice(0, MAX_SIDE)) {
      const amount = p.amounts.join(', ')
      entities.push({
        type: 'crypto_wallet',
        label: p.address,
        platform: s.chain,
        data: p.data && Object.keys(p.data).length ? p.data : undefined,
        linkLabel: amount ? tr(ctx, `${fr} (${amount})`, `${en} (${amount})`) : tr(ctx, fr, en)
      })
    }
  }
  side(s.inputs, 'entrée', 'input')
  side(s.outputs, 'sortie', 'output')
  return { properties: compact(properties) as Record<string, PropValue>, entities, raw }
}

// ---------------------------------------------------------------------------

const ESPLORA: Record<'bitcoin' | 'litecoin', { base: string; service: string }> = {
  bitcoin: { base: 'https://mempool.space/api', service: 'mempool.space' },
  litecoin: { base: 'https://litecoinspace.org/api', service: 'litecoinspace.org' }
}

/** GET JSON : `null` pour une transaction inconnue (404, 400), `ModuleError` sinon. */
async function lookup<T>(ctx: ModuleContext, url: string, service: string, init: Parameters<ModuleContext['fetchJson']>[1] = {}): Promise<T | null> {
  try {
    return await ctx.fetchJson<T>(url, { timeoutMs: 30000, ...init })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 404 || status === 400 || status === 422) return null
    throw serviceError(e, service)
  }
}

async function esplora(ctx: ModuleContext, chain: 'bitcoin' | 'litecoin', txid: string): Promise<TxSummary | null> {
  const { base, service } = ESPLORA[chain]
  const t = await lookup<EsploraTxFull>(ctx, `${base}/tx/${txid}`, service)
  return t ? parseEsploraTx(chain, t) : null
}

async function tronscan(ctx: ModuleContext, txid: string): Promise<TxSummary | null> {
  const t = await lookup<TronscanTx>(ctx, 'https://apilist.tronscanapi.com/api/transaction-info', 'Tronscan', { query: { hash: txid } })
  return t ? parseTronscanTx(t) : null
}

export default defineModule({
  id: 'crypto.transaction',
  name: { fr: 'Transaction crypto (explorateurs publics)', en: 'Crypto transaction (public explorers)' },
  description: {
    fr: 'Lit une transaction Bitcoin, Litecoin, Ethereum ou TRON sur un explorateur public gratuit (mempool.space, Blockscout, Tronscan) : date, bloc, montant, frais, transferts de jetons (USDT...) et adresses d’entrée et de sortie, 10 au plus de chaque côté.',
    en: 'Reads a Bitcoin, Litecoin, Ethereum or TRON transaction on a free public explorer (mempool.space, Blockscout, Tronscan): date, block, amount, fee, token transfers (USDT...) and input and output addresses, up to 10 on each side.'
  },
  category: 'crypto',
  inputTypes: ['crypto_tx'],
  homepage: 'https://mempool.space/docs/api/rest',
  accepts: (input) => txChain(input) !== null,
  async run(input, ctx) {
    const chain = txChain(input)
    const txid = input.label.trim()
    if (!chain) throw new ModuleError('Identifiant de transaction non reconnu', 'invalid_input')
    let summary: TxSummary | null = null
    let raw: unknown = null
    if (chain === 'ethereum') {
      const t = await lookup<BsTxFull>(ctx, `https://eth.blockscout.com/api/v2/transactions/${txid}`, 'Blockscout', { timeoutMs: 45000 })
      summary = t ? parseBlockscoutTx(t) : null
      raw = t && { hash: t.hash, block: t.block_number, from: t.from.hash, to: t.to?.hash, value: t.value, transfers: t.token_transfers?.length ?? 0 }
    } else if (chain === 'tron') {
      summary = await tronscan(ctx, txid.toLowerCase())
    } else if (chain === 'utxo_or_tron') {
      // 64 caractères hexadécimaux sans plateforme : Bitcoin d'abord, TRON ensuite.
      summary = (await esplora(ctx, 'bitcoin', txid.toLowerCase())) ?? (await tronscan(ctx, txid.toLowerCase()))
    } else {
      summary = await esplora(ctx, chain, txid.toLowerCase())
    }
    if (!summary) return {}
    return txOutput(ctx, summary, raw ?? { chain: summary.chain, txid: summary.txid, inputs: summary.inputs.length, outputs: summary.outputs.length })
  }
})
