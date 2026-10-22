// Regroupement d'adresses Bitcoin par WalletExplorer : identifiant du portefeuille (adresses
// dépensées ensemble, donc détenues par la même entité) et nom du service quand il est connu
// (plateforme d'échange, place de marché). API publique sans clé.

import { defineModule, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { compact, getJson, tr } from '../misc/_util'
import { chainOf, walletAddress } from './_chain'

export interface WeLookup {
  found?: boolean
  label?: string
  wallet_id?: string
  updated_to_block?: number
}

/**
 * Nom du service sans les suffixes de WalletExplorer (`Huobi.com-2`, `BTC-e.com-old`,
 * `Bitstamp.net-output`) : plusieurs portefeuilles d'un même service donnent la même organisation.
 */
export function serviceName(label: string): string {
  return label.replace(/-(old\d*|output|fee|cold|hot|\d+)$/i, '').trim()
}

export function weOutput(ctx: Pick<ModuleContext, 'lang'>, r: WeLookup): ModuleOutput {
  if (!r.found || !r.wallet_id) return {}
  const label = r.label?.trim() || null
  const properties = compact({
    wallet_id: r.wallet_id,
    wallet_label: label,
    walletexplorer_url: `https://www.walletexplorer.com/wallet/${encodeURIComponent(label ?? r.wallet_id)}`
  })
  const entities: ModuleOutput['entities'] = label
    ? [
        {
          type: 'organization',
          label: serviceName(label),
          data: { kind: tr(ctx, 'service crypto', 'crypto service') },
          linkLabel: tr(ctx, 'portefeuille de (WalletExplorer)', 'wallet of (WalletExplorer)')
        }
      ]
    : []
  return { properties, entities, raw: r }
}

export default defineModule({
  id: 'crypto.walletexplorer',
  name: { fr: 'Regroupement d’adresses Bitcoin (WalletExplorer)', en: 'Bitcoin address clustering (WalletExplorer)' },
  description: {
    fr: 'Identifie le portefeuille auquel appartient une adresse Bitcoin (adresses dépensées ensemble) et le service connu qui le détient, plateforme d’échange ou place de marché, relié comme organisation.',
    en: 'Identifies the wallet a Bitcoin address belongs to (addresses spent together) and the known service holding it, exchange or marketplace, linked as an organization.'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  homepage: 'https://www.walletexplorer.com',
  accepts: (input) => chainOf(input) === 'bitcoin',
  async run(input, ctx) {
    const r = await getJson<WeLookup>(ctx, 'https://www.walletexplorer.com/api/1/address-lookup', 'WalletExplorer', {
      // `caller` : identification demandée par WalletExplorer pour l'usage de son API.
      query: { address: walletAddress(input), caller: 'masint' },
      timeoutMs: 30000
    })
    return r ? weOutput(ctx, r) : {}
  }
})
