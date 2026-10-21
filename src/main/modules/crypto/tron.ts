// Portefeuille TRON : solde TRX et USDT, étiquette publique (Tronscan), dernière activité
// et derniers transferts de jetons TRC20 (TronGrid). APIs publiques sans clé.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { coin, formatUnits, getJson, isoDate, serviceError, tr } from '../misc/_util'
import { chainOf, explorerUrl, MAX_COUNTERPARTIES, MAX_TX, txUrl, walletAddress } from './_chain'

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

export interface TronscanAccount {
  address?: string
  balance?: number
  totalTransactionCount?: number
  transactions_in?: number
  transactions_out?: number
  date_created?: number
  addressTag?: string
  name?: string
  trc20token_balances?: Array<{ tokenId: string; tokenAbbr: string; balance: string; tokenDecimal: number }>
}

export interface TrongridAccount {
  data?: Array<{ create_time?: number; latest_opration_time?: number; balance?: number }>
}

export interface Trc20Transfer {
  transaction_id: string
  block_timestamp: number
  from: string
  to: string
  type: string
  value: string
  token_info: { symbol: string; decimals: number; address: string }
}

export function parseTron(
  ctx: Pick<ModuleContext, 'lang'>,
  address: string,
  acc: TronscanAccount,
  grid: TrongridAccount | null,
  transfers: Trc20Transfer[]
): ModuleOutput {
  const g = grid?.data?.[0]
  const tokens = acc.trc20token_balances ?? []
  const usdt = tokens.find((t) => t.tokenId === USDT)
  const other = tokens
    .filter((t) => t.tokenId !== USDT && t.balance !== '0')
    .slice(0, 10)
    .map((t) => `${formatUnits(t.balance, t.tokenDecimal)} ${t.tokenAbbr}`)
  const lastTransfer = transfers[0]?.block_timestamp
  const properties: ModuleOutput['properties'] = {
    chain: 'TRON',
    balance: coin(acc.balance ?? g?.balance ?? 0, 6, 'TRX'),
    balance_usdt: usdt ? `${formatUnits(usdt.balance, usdt.tokenDecimal)} USDT` : '0 USDT',
    tokens: other,
    tx_count: acc.totalTransactionCount ?? null,
    tx_in: acc.transactions_in ?? null,
    tx_out: acc.transactions_out ?? null,
    label: acc.addressTag || acc.name || null,
    first_seen: isoDate(acc.date_created ?? g?.create_time),
    last_seen: isoDate(g?.latest_opration_time ?? lastTransfer),
    explorer_url: explorerUrl('tron', address)
  }

  const entities: OutEntity[] = []
  const seen = new Set<string>()
  transfers.slice(0, MAX_TX).forEach((t, i) => {
    const outgoing = t.from === address
    const ref = `tx${i}`
    const amount = `${formatUnits(t.value, t.token_info.decimals)} ${t.token_info.symbol}`
    entities.push({
      ref,
      type: 'crypto_tx',
      label: t.transaction_id,
      platform: 'tron',
      data: {
        date: isoDate(t.block_timestamp),
        amount: (outgoing ? '-' : '+') + amount,
        token: t.token_info.symbol,
        direction: outgoing ? 'out' : 'in',
        url: txUrl('tron', t.transaction_id)
      },
      linkLabel: outgoing ? tr(ctx, 'envoie', 'sends') : tr(ctx, 'reçoit', 'receives')
    })
    const cp = outgoing ? t.to : t.from
    if (!cp || cp === address || seen.has(cp) || seen.size >= MAX_COUNTERPARTIES) return
    seen.add(cp)
    entities.push({
      type: 'crypto_wallet',
      label: cp,
      platform: 'tron',
      from: ref,
      linkLabel: outgoing ? tr(ctx, 'vers', 'to') : tr(ctx, 'depuis', 'from')
    })
  })

  return {
    properties,
    entities,
    raw: {
      account: { ...pick(acc as Record<string, unknown>), tokens: tokens.slice(0, 20) },
      transfers: transfers.slice(0, MAX_TX)
    }
  }
}

function pick(a: Record<string, unknown>): Record<string, unknown> {
  const keys = ['address', 'balance', 'totalTransactionCount', 'transactions_in', 'transactions_out', 'date_created', 'addressTag', 'name']
  return Object.fromEntries(keys.filter((k) => k in a).map((k) => [k, a[k]]))
}

export default defineModule({
  id: 'crypto.tron',
  name: { fr: 'Portefeuille TRON (Tronscan)', en: 'TRON wallet (Tronscan)' },
  description: {
    fr: "Solde TRX et USDT, autres jetons, étiquette publique (plateforme d'échange...), dates de création et de dernière activité, derniers transferts TRC20 et contreparties.",
    en: 'TRX and USDT balance, other tokens, public label (exchange...), creation and last activity dates, latest TRC20 transfers and counterparties.'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  homepage: 'https://tronscan.org',
  accepts: (input) => chainOf(input) === 'tron',
  async run(input, ctx) {
    const address = walletAddress(input)
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new ModuleError('Adresse TRON invalide', 'invalid_input')
    const [acc, grid, transfers] = await Promise.all([
      ctx.fetchJson<TronscanAccount>('https://apilist.tronscanapi.com/api/account', { query: { address } }).catch((e) => {
        throw serviceError(e, 'Tronscan')
      }),
      getJson<TrongridAccount>(ctx, `https://api.trongrid.io/v1/accounts/${address}`, 'TronGrid').catch(() => null),
      getJson<{ data?: Trc20Transfer[] }>(ctx, `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`, 'TronGrid', {
        query: { limit: 20, only_confirmed: 'true' }
      }).catch(() => null)
    ])
    // Compte jamais activé : aucune donnée.
    if (!acc.address && !grid?.data?.length && !transfers?.data?.length) return {}
    return parseTron(ctx, address, acc, grid, transfers?.data ?? [])
  }
})
