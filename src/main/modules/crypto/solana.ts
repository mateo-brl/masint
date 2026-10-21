// Portefeuille Solana via le RPC public : solde SOL et dernières signatures de transactions.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { coin, isoDate, serviceError, tr } from '../misc/_util'
import { chainOf, explorerUrl, MAX_TX, txUrl, walletAddress } from './_chain'

const RPCS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']
const SIG_LIMIT = 1000

interface RpcResponse<T> {
  result?: T
  error?: { code: number; message: string }
}

export interface SolSignature {
  signature: string
  blockTime: number | null
  slot: number
  err: unknown
  memo: string | null
}

export function parseSolana(
  ctx: Pick<ModuleContext, 'lang'>,
  address: string,
  lamports: number,
  sigs: SolSignature[]
): ModuleOutput {
  const times = sigs.map((s) => s.blockTime).filter((t): t is number => !!t)
  const properties: ModuleOutput['properties'] = {
    chain: 'Solana',
    balance: coin(lamports, 9, 'SOL'),
    tx_count: sigs.length >= SIG_LIMIT ? `${SIG_LIMIT}+` : sigs.length,
    last_seen: times.length ? isoDate(Math.max(...times)) : null,
    first_seen: times.length && sigs.length < SIG_LIMIT ? isoDate(Math.min(...times)) : null,
    explorer_url: explorerUrl('solana', address)
  }
  const entities: OutEntity[] = sigs.slice(0, MAX_TX).map((s) => ({
    type: 'crypto_tx',
    label: s.signature,
    platform: 'solana',
    data: {
      date: isoDate(s.blockTime),
      block: s.slot,
      status: s.err ? 'failed' : 'ok',
      memo: s.memo,
      url: txUrl('solana', s.signature)
    },
    linkLabel: tr(ctx, 'transaction', 'transaction')
  }))
  return { properties, entities, raw: { lamports, signatures: sigs.slice(0, MAX_TX) } }
}

async function rpc<T>(ctx: ModuleContext, method: string, params: unknown[]): Promise<T> {
  let last: unknown
  for (const url of RPCS) {
    try {
      const res = await ctx.fetchJson<RpcResponse<T>>(url, {
        method: 'POST',
        json: { jsonrpc: '2.0', id: 1, method, params },
        timeoutMs: 20000
      })
      if (res.error) {
        if (res.error.code === -32602) throw new ModuleError('Adresse Solana invalide', 'invalid_input')
        throw new Error(res.error.message)
      }
      return res.result as T
    } catch (e) {
      if (e instanceof ModuleError) throw e
      last = e
    }
  }
  throw serviceError(last, 'Solana RPC')
}

export default defineModule({
  id: 'crypto.solana',
  name: { fr: 'Portefeuille Solana (RPC public)', en: 'Solana wallet (public RPC)' },
  description: {
    fr: "Solde SOL, nombre de transactions (jusqu'à 1000), première et dernière activité et dernières signatures d'une adresse Solana.",
    en: 'SOL balance, transaction count (up to 1000), first and last activity and latest signatures of a Solana address.'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  homepage: 'https://solana.com/docs/rpc',
  accepts: (input) => chainOf(input) === 'solana',
  async run(input, ctx) {
    const address = walletAddress(input)
    const balance = await rpc<{ value: number }>(ctx, 'getBalance', [address])
    const sigs = await rpc<SolSignature[]>(ctx, 'getSignaturesForAddress', [address, { limit: SIG_LIMIT }])
    if (!balance.value && !sigs.length) return {}
    return parseSolana(ctx, address, balance.value, sigs)
  }
})
