// Portefeuille TON (Toncoin, très utilisé sur Telegram) via l'API publique de toncenter : solde,
// état du compte (actif, non initialisé, gelé) et date de la dernière transaction. Sans clé,
// toncenter limite à une requête par seconde : les deux appels sont espacés.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { coin, compact, isoDate, serviceError, tr } from '../misc/_util'
import { chainOf, explorerUrl, walletAddress } from './_chain'

const API = 'https://toncenter.com/api/v2'

export interface TonAccount {
  balance?: string | number
  state?: string
  last_transaction_id?: { lt?: string; hash?: string }
}

export interface TonTx {
  utime?: number
}

const STATE: Record<string, { fr: string; en: string }> = {
  active: { fr: 'actif', en: 'active' },
  uninitialized: { fr: 'non initialisé', en: 'uninitialized' },
  frozen: { fr: 'gelé', en: 'frozen' },
  nonexist: { fr: 'inexistant', en: 'non-existent' }
}

export function tonOutput(ctx: Pick<ModuleContext, 'lang'>, address: string, acc: TonAccount, last: TonTx | null): ModuleOutput {
  const balance = String(acc.balance ?? '0')
  const lt = acc.last_transaction_id?.lt ?? '0'
  // Adresse jamais utilisée : rien à signaler.
  if (balance === '0' && lt === '0' && !last?.utime) return {}
  const state = acc.state ? (STATE[acc.state]?.[ctx.lang] ?? acc.state) : null
  return {
    properties: compact({
      chain: 'Toncoin',
      balance: coin(balance, 9, 'TON'),
      account_state: state,
      last_seen: last?.utime ? isoDate(last.utime) : null,
      explorer_url: explorerUrl('ton', address)
    }),
    raw: { account: { balance, state: acc.state, last_transaction_id: acc.last_transaction_id }, last_utime: last?.utime ?? null }
  }
}

interface TonResponse<T> {
  ok: boolean
  result?: T
  error?: string
}

async function call<T>(ctx: ModuleContext, method: string, query: Record<string, string | number>): Promise<T> {
  let res: TonResponse<T>
  try {
    res = await ctx.fetchJson<TonResponse<T>>(`${API}/${method}`, { query, timeoutMs: 30000 })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 416 || status === 422) throw new ModuleError(tr(ctx, 'Adresse TON invalide', 'Invalid TON address'), 'invalid_input')
    throw serviceError(e, 'toncenter')
  }
  if (!res.ok || res.result === undefined) throw new ModuleError(`toncenter : ${res.error ?? 'réponse inattendue'}`, 'other')
  return res.result
}

/** Pause qui s'interrompt quand l'utilisateur annule. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

export default defineModule({
  id: 'crypto.ton',
  name: { fr: 'Portefeuille TON (toncenter)', en: 'TON wallet (toncenter)' },
  description: {
    fr: 'Solde, état du compte (actif, non initialisé, gelé) et date de la dernière transaction d’une adresse TON (Toncoin), la blockchain liée à Telegram.',
    en: 'Balance, account state (active, uninitialized, frozen) and last transaction date of a TON (Toncoin) address, the blockchain tied to Telegram.'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  homepage: 'https://toncenter.com/api/v2/',
  accepts: (input) => chainOf(input) === 'ton',
  async run(input, ctx) {
    const address = walletAddress(input)
    const acc = await call<TonAccount>(ctx, 'getAddressInformation', { address })
    let last: TonTx | null = null
    if ((acc.last_transaction_id?.lt ?? '0') !== '0') {
      await pause(1100, ctx.signal)
      last = await call<TonTx[]>(ctx, 'getTransactions', { address, limit: 1 })
        .then((list) => list[0] ?? null)
        .catch(() => null)
    }
    return tonOutput(ctx, address, acc, last)
  }
})
