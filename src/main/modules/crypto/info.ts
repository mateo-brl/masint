// Analyse locale d'une adresse crypto : blockchain, format d'adresse et lien vers l'explorateur.

import { defineModule } from '@shared/modules'
import { getPlatform } from '@shared/platforms'
import type { PropValue } from '@shared/types'
import { EVM_CHAINS, chainOf, explorerUrl, walletAddress } from './_chain'

export function addressType(chain: string, a: string): string | null {
  switch (chain) {
    case 'bitcoin':
      if (/^1/.test(a)) return 'P2PKH (legacy)'
      if (/^3/.test(a)) return 'P2SH (multisig / nested SegWit)'
      if (/^bc1q/.test(a)) return a.length === 42 ? 'P2WPKH (SegWit v0)' : 'P2WSH (SegWit v0 script)'
      if (/^bc1p/.test(a)) return 'P2TR (Taproot)'
      return null
    case 'litecoin':
      if (/^L/.test(a)) return 'P2PKH (legacy)'
      if (/^M/.test(a)) return 'P2SH'
      if (/^ltc1/.test(a)) return 'SegWit (bech32)'
      return null
    case 'bitcoincash':
      return /^(bitcoincash:)?q/.test(a) ? 'CashAddr P2PKH' : /^(bitcoincash:)?p/.test(a) ? 'CashAddr P2SH' : 'Legacy'
    case 'monero':
      return a.startsWith('8') ? 'Subaddress' : 'Standard'
    case 'ton':
      return a.startsWith('UQ') ? 'Non-bounceable' : 'Bounceable'
    default:
      return EVM_CHAINS.includes(chain) ? (/[A-F]/.test(a) && /[a-f]/.test(a) ? 'EVM (EIP-55 checksum)' : 'EVM') : null
  }
}

export default defineModule({
  id: 'crypto.info',
  name: { fr: "Analyse de l'adresse crypto", en: 'Crypto address analysis' },
  description: {
    fr: "Identifie la blockchain et le format de l'adresse (legacy, SegWit, Taproot...) et ajoute le lien vers l'explorateur public. Hors ligne.",
    en: 'Identifies the blockchain and address format (legacy, SegWit, Taproot...) and adds the public explorer link. Offline.'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  async run(input) {
    const address = walletAddress(input)
    const chain = chainOf(input)
    if (!chain) return {}
    const properties: Record<string, PropValue> = {
      chain: getPlatform(chain)?.name ?? chain,
      address_type: addressType(chain, address),
      explorer_url: explorerUrl(chain, address)
    }
    if (EVM_CHAINS.includes(chain)) properties.evm_compatible = true
    return { properties }
  }
})
