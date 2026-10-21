// Soldes d'une adresse 0x sur les principales chaînes compatibles EVM, via les nœuds
// RPC publics de PublicNode (sans clé). Le nonce donne le nombre de transactions émises.

import { defineModule, ModuleError, type ModuleOutput } from '@shared/modules'
import { formatUnits, serviceError } from '../misc/_util'
import { EVM_CHAINS, chainOf, walletAddress } from './_chain'

export const EVM_RPC: Array<{ chain: string; name: string; symbol: string; rpc: string }> = [
  { chain: 'ethereum', name: 'Ethereum', symbol: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com' },
  { chain: 'bnb', name: 'BNB Chain', symbol: 'BNB', rpc: 'https://bsc-rpc.publicnode.com' },
  { chain: 'polygon', name: 'Polygon', symbol: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { chain: 'avalanche', name: 'Avalanche C-Chain', symbol: 'AVAX', rpc: 'https://avalanche-c-chain-rpc.publicnode.com' },
  { chain: 'arbitrum', name: 'Arbitrum One', symbol: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { chain: 'base_chain', name: 'Base', symbol: 'ETH', rpc: 'https://base-rpc.publicnode.com' },
  { chain: 'optimism', name: 'Optimism', symbol: 'ETH', rpc: 'https://optimism-rpc.publicnode.com' }
]

export interface RpcReply {
  id: number
  result?: string
  error?: { message: string }
}

export interface ChainBalance {
  chain: string
  name: string
  balance: string
  nonce: number
}

/** Réponse groupée `eth_getBalance` (id 1) + `eth_getTransactionCount` (id 2). */
export function parseRpcPair(replies: RpcReply[], symbol: string): { balance: string; nonce: number; wei: bigint } | null {
  const bal = replies.find((r) => r.id === 1)?.result
  const nonce = replies.find((r) => r.id === 2)?.result
  if (!bal || !nonce) return null
  const wei = BigInt(bal)
  return { balance: `${formatUnits(wei, 18)} ${symbol}`, nonce: Number(BigInt(nonce)), wei }
}

export function summarize(list: ChainBalance[]): ModuleOutput['properties'] {
  const active = list.filter((b) => b.nonce > 0 || !/^0 /.test(b.balance))
  const balances: Record<string, string> = {}
  for (const b of list) balances[b.name] = `${b.balance} (${b.nonce} tx)`
  return {
    evm_balances: balances,
    evm_active_chains: active.map((b) => b.name),
    evm_sent_tx: list.reduce((s, b) => s + b.nonce, 0)
  }
}

export default defineModule({
  id: 'crypto.evm_balances',
  name: { fr: 'Soldes multi-chaînes EVM', en: 'EVM multi-chain balances' },
  description: {
    fr: "Solde natif et nombre de transactions émises d'une adresse 0x sur Ethereum, BNB Chain, Polygon, Avalanche, Arbitrum, Base et Optimism (nœuds publics PublicNode).",
    en: 'Native balance and sent transaction count of a 0x address on Ethereum, BNB Chain, Polygon, Avalanche, Arbitrum, Base and Optimism (PublicNode public RPC).'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  homepage: 'https://www.publicnode.com',
  accepts: (input) => /^0x[0-9a-fA-F]{40}$/.test(walletAddress(input)) && EVM_CHAINS.includes(chainOf(input) ?? ''),
  async run(input, ctx) {
    const address = walletAddress(input)
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ModuleError('Adresse EVM invalide', 'invalid_input')
    const body = [
      { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] },
      { jsonrpc: '2.0', id: 2, method: 'eth_getTransactionCount', params: [address, 'latest'] }
    ]
    const results = await Promise.all(
      EVM_RPC.map(async (c) => {
        try {
          const replies = await ctx.fetchJson<RpcReply[]>(c.rpc, { method: 'POST', json: body, timeoutMs: 15000 })
          const pair = Array.isArray(replies) ? parseRpcPair(replies, c.symbol) : null
          return pair ? { chain: c.chain, name: c.name, balance: pair.balance, nonce: pair.nonce } : null
        } catch (e) {
          ctx.log(`${c.name} : ${e instanceof Error ? e.message : String(e)}`)
          return null
        }
      })
    )
    const ok = results.filter((r): r is ChainBalance => !!r)
    if (!ok.length) throw serviceError(new Error('aucun nœud RPC n’a répondu'), 'PublicNode')
    return { properties: summarize(ok), raw: ok }
  }
})
