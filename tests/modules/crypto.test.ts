import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chainOf, detectChain, utxoOutput } from '../../src/main/modules/crypto/_chain'
import ethereum, { parseBlockscout } from '../../src/main/modules/crypto/ethereum'
import evmBalances, { parseRpcPair, summarize } from '../../src/main/modules/crypto/evmBalances'
import info, { addressType } from '../../src/main/modules/crypto/info'
import ofac, { parseSdn, sanctionOutput } from '../../src/main/modules/crypto/ofac'
import solana, { parseSolana } from '../../src/main/modules/crypto/solana'
import tron, { parseTron } from '../../src/main/modules/crypto/tron'
import { modules as utxoModules, parseBlockcypher, parseEsplora, parseHaskoin } from '../../src/main/modules/crypto/utxo'
import { entity, LIVE, runModule } from '../helpers/context'

const fixture = (name: string): string => readFileSync(join(__dirname, '../fixtures/crypto', name), 'utf8')
const json = <T = any>(name: string): T => JSON.parse(fixture(name)) as T
const fr = { lang: 'fr' as const }
const byId = (id: string) => utxoModules.find((m) => m.id === id)!

describe('crypto : détection de la chaîne', () => {
  it('reconnaît les formats courants', () => {
    expect(detectChain('bc1qvfj0wzl2tl9df6ra2027ux9earhjrpg5eef00n')).toBe('bitcoin')
    expect(detectChain('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe('ethereum')
    expect(detectChain('TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G')).toBe('tron')
    expect(detectChain('LQTpS3VaYTjCr4s9Y1t5zbeY26zevf7Fb3')).toBe('litecoin')
    expect(detectChain('DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L')).toBe('dogecoin')
    expect(detectChain('XpESxaUmonkq8RaLLp46Brx2K39ggQe226')).toBe('dash')
    expect(detectChain('bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')).toBe('bitcoincash')
    expect(detectChain('qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')).toBe('bitcoincash')
    expect(detectChain('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe('solana')
  })

  it('privilégie la plateforme du nœud, sauf jeton ou plateforme d’échange', () => {
    const evm = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    expect(chainOf(entity('crypto_wallet', evm, { platform: 'polygon' }))).toBe('polygon')
    expect(chainOf(entity('crypto_wallet', 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G', { platform: 'tether' }))).toBe('tron')
    expect(chainOf(entity('crypto_wallet', evm, { platform: 'binance' }))).toBe('ethereum')
    expect(byId('crypto.bitcoin').accepts!(entity('crypto_wallet', 'bc1qvfj0wzl2tl9df6ra2027ux9earhjrpg5eef00n'))).toBe(true)
    expect(byId('crypto.bitcoin').accepts!(entity('crypto_wallet', evm))).toBe(false)
    expect(evmBalances.accepts!(entity('crypto_wallet', evm, { platform: 'bnb' }))).toBe(true)
  })

  it('analyse le format de l’adresse hors ligne', async () => {
    expect(addressType('bitcoin', 'bc1qvfj0wzl2tl9df6ra2027ux9earhjrpg5eef00n')).toBe('P2WPKH (SegWit v0)')
    expect(addressType('bitcoin', '3M7CGBPUJwXXSroWuZ6H5jiprdKCyf7V5M')).toContain('P2SH')
    const out = await runModule(info, entity('crypto_wallet', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'))
    expect(out.properties?.chain).toBe('Ethereum')
    expect(out.properties?.explorer_url).toBe('https://etherscan.io/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
  })
})

describe('crypto : chaînes à UTXO', () => {
  it('Esplora : petite adresse entièrement lue', () => {
    const f = json('mempool_small.json')
    const parsed = parseEsplora(f.address, f.txs)
    const out = utxoOutput(fr, { chain: 'bitcoin', symbol: 'BTC', decimals: 8 }, f.address.address, parsed.summary, parsed.txs, null)
    expect(out.properties).toMatchObject({ balance: '0 BTC', received: '0.00011906 BTC', sent: '0.00011906 BTC', tx_count: 2 })
    expect(out.properties?.first_seen).toMatch(/^20\d\d-/)
    expect(out.properties?.last_seen).toMatch(/^20\d\d-/)
    const txs = out.entities!.filter((e) => e.type === 'crypto_tx')
    expect(txs).toHaveLength(2)
    expect(txs[0].data?.direction).toBe('out')
    expect(txs[0].data?.amount).toBe('-0.00011906 BTC')
    expect(txs[1].data?.direction).toBe('in')
    const wallets = out.entities!.filter((e) => e.type === 'crypto_wallet')
    expect(wallets.map((w) => w.label)).toContain('bc1qcdqquff73tpcxrzvn88cf3k4a3tra6suadqjt3')
    expect(wallets.every((w) => w.label !== f.address.address && w.platform === 'bitcoin')).toBe(true)
  })

  it('Esplora : pas de première activité si l’historique est partiel', () => {
    const f = json('mempool_busy.json')
    const parsed = parseEsplora(f.address, f.txs)
    const out = utxoOutput(fr, { chain: 'bitcoin', symbol: 'BTC', decimals: 8 }, f.address.address, parsed.summary, parsed.txs, null)
    expect(out.properties?.tx_count).toBe(189)
    expect(out.properties?.first_seen).toBeUndefined()
    expect(out.properties?.balance).toBe('69370.1846185 BTC')
  })

  it('BlockCypher : Dogecoin', () => {
    const d = json('blockcypher_doge.json')
    const parsed = parseBlockcypher(d)
    const out = utxoOutput(fr, { chain: 'dogecoin', symbol: 'DOGE', decimals: 8 }, d.address, parsed.summary, parsed.txs, null)
    expect(out.properties?.balance).toBe('62222.06467666 DOGE')
    expect(out.properties?.tx_count).toBe(1485)
    const tx = out.entities!.find((e) => e.type === 'crypto_tx')!
    expect(tx.data?.direction).toBe('in')
    expect(tx.data?.amount).toBe('+0.95347802 DOGE')
    expect(out.entities!.some((e) => e.label === 'DSP4tRb1gSftwfTXu9t2CKbeymGMnPVY3T')).toBe(true)
  })

  it('Haskoin : Bitcoin Cash, saisie sans préfixe', () => {
    const d = json('haskoin_bch.json')
    const parsed = parseHaskoin(d.balance, d.txs)
    const input = 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'
    const out = utxoOutput(fr, { chain: 'bitcoincash', symbol: 'BCH', decimals: 8 }, input, parsed.summary, parsed.txs, null)
    expect(out.properties?.balance).toBe('55.93767221 BCH')
    expect(out.properties?.sent).toBe('0 BCH')
    const txs = out.entities!.filter((e) => e.type === 'crypto_tx')
    expect(txs.every((t) => t.data?.direction === 'in')).toBe(true)
    expect(out.entities!.some((e) => e.label === 'bitcoincash:qplwfa57v5y4wya6750u25l29fmkm3v94g6zwperhv')).toBe(true)
    expect(out.entities!.some((e) => e.label.endsWith(input))).toBe(false)
  })
})

describe('crypto : comptes', () => {
  it('Blockscout : solde, ENS et transactions', () => {
    const f = json('blockscout_vitalik.json')
    const out = parseBlockscout(fr, f.address.hash, f.address, f.counters, f.txs)
    expect(out.properties?.balance).toBe('5.773252986299759339 ETH')
    expect(out.properties?.ens).toBe('vitalik.eth')
    expect(out.properties?.tx_count).toBe(78413)
    expect(out.properties?.first_seen).toBeUndefined()
    expect(out.entities?.find((e) => e.type === 'domain')?.label).toBe('vitalik.eth')
    const txs = out.entities!.filter((e) => e.type === 'crypto_tx')
    expect(txs.map((t) => t.data?.direction)).toEqual(['in', 'in', 'out'])
    expect(out.entities!.some((e) => e.label === '0xB0bAc44173a65f79932F6D550Df605Eb235C628E')).toBe(true)
  })

  it('RPC EVM : solde et nonce', () => {
    const pair = parseRpcPair(json('publicnode_bsc.json'), 'BNB')!
    expect(pair.balance).toMatch(/^0\.\d+ BNB$/)
    expect(pair.nonce).toBe(14)
    const props = summarize([
      { chain: 'bnb', name: 'BNB Chain', balance: pair.balance, nonce: pair.nonce },
      { chain: 'polygon', name: 'Polygon', balance: '0 POL', nonce: 0 }
    ])
    expect(props?.evm_active_chains).toEqual(['BNB Chain'])
    expect(props?.evm_sent_tx).toBe(14)
  })

  it('Tronscan : solde, USDT, étiquette et transferts', () => {
    const f = json('tron_binance.json')
    const out = parseTron(fr, f.account.address, f.account, f.grid, f.transfers)
    expect(out.properties?.label).toBe('Binance-Hot 4')
    expect(out.properties?.balance).toBe('2032549.34702 TRX')
    expect(out.properties?.balance_usdt).toBe('35963433.454235 USDT')
    expect(out.properties?.first_seen).toBe('2021-09-14T11:03:45.000Z')
    const txs = out.entities!.filter((e) => e.type === 'crypto_tx')
    expect(txs).toHaveLength(4)
    expect(txs[0].data?.amount).toMatch(/^-[\d.]+ USDT$/)
    expect(out.entities!.filter((e) => e.type === 'crypto_wallet')).toHaveLength(4)
  })

  it('Solana : solde et signatures', () => {
    const f = json('solana.json')
    const out = parseSolana(fr, '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', f.balance.result.value, f.signatures.result)
    expect(out.properties?.balance).toBe('11175975.3445 SOL')
    expect(out.properties?.tx_count).toBe(5)
    expect(out.entities).toHaveLength(5)
    expect(out.entities![0].data?.url).toMatch(/^https:\/\/solscan\.io\/tx\//)
  })
})

describe('crypto : sanctions OFAC', () => {
  const index = parseSdn(fixture('ofac_sdn_sample.csv'), fixture('ofac_sdn_comments_sample.csv'))

  it('indexe les adresses de la liste SDN, y compris la suite dans sdn_comments', () => {
    const mesri = index.get('0x252a8bd2319d8a555b872990601221b3a2053bce')!
    expect(mesri.name).toBe('MESRI, Behzad')
    expect(mesri.kind).toBe('individual')
    expect(index.get('12ankp2idkuhede2yfpdd4dfgenrutkupl')?.currency).toBe('XBT')
    // Adresse coupée entre sdn.csv et sdn_comments.csv.
    expect(index.get('1b64qrxfaa35mvkf7sdjuguyap5izqt7qi')?.name).toBe('SUEX OTC, S.R.O.')
    expect(index.get('3f6bbvs1krsc1qr8fsbtdfyqyvkmm3qvmr')?.name).toBe('BLENDER.IO')
  })

  it('produit le drapeau et l’entité sanctionnée', () => {
    const hit = sanctionOutput(fr, index.get('0x252a8bd2319d8a555b872990601221b3a2053bce'))
    expect(hit.properties?.sanctioned).toBe(true)
    expect(hit.entities?.[0]).toMatchObject({ type: 'person', label: 'MESRI, Behzad' })
    const blender = sanctionOutput(fr, index.get('3f6bbvs1krsc1qr8fsbtdfyqyvkmm3qvmr'))
    expect(blender.entities?.[0].type).toBe('organization')
    expect(sanctionOutput(fr, undefined).properties?.sanctioned).toBe(false)
  })
})

describe.skipIf(!LIVE)('crypto : services réels', () => {
  it('mempool.space', async () => {
    const out = await runModule(byId('crypto.bitcoin'), entity('crypto_wallet', 'bc1qvfj0wzl2tl9df6ra2027ux9earhjrpg5eef00n'))
    expect(out.properties?.tx_count).toBeGreaterThanOrEqual(2)
  })

  it('litecoinspace.org', async () => {
    const out = await runModule(byId('crypto.litecoin'), entity('crypto_wallet', 'LQTpS3VaYTjCr4s9Y1t5zbeY26zevf7Fb3'))
    expect(String(out.properties?.balance)).toMatch(/LTC$/)
  })

  it('BlockCypher (Dash)', async () => {
    const out = await runModule(byId('crypto.dash'), entity('crypto_wallet', 'XpESxaUmonkq8RaLLp46Brx2K39ggQe226'))
    expect(String(out.properties?.balance)).toMatch(/DASH$/)
  })

  it('Haskoin (Bitcoin Cash)', async () => {
    const out = await runModule(byId('crypto.bitcoincash'), entity('crypto_wallet', 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'))
    expect(String(out.properties?.balance)).toMatch(/BCH$/)
  })

  it('Blockscout', async () => {
    const out = await runModule(ethereum, entity('crypto_wallet', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'))
    expect(out.properties?.ens).toBe('vitalik.eth')
  }, 120000)

  it('PublicNode multi-chaînes', async () => {
    const out = await runModule(evmBalances, entity('crypto_wallet', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'))
    expect((out.properties?.evm_active_chains as string[]).length).toBeGreaterThan(2)
  })

  it('Tronscan', async () => {
    const out = await runModule(tron, entity('crypto_wallet', 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G'))
    expect(out.properties?.label).toMatch(/Binance/)
  })

  it('Solana RPC', async () => {
    const out = await runModule(solana, entity('crypto_wallet', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'))
    expect(String(out.properties?.balance)).toMatch(/SOL$/)
  })

  it('OFAC SDN', async () => {
    const out = await runModule(ofac, entity('crypto_wallet', '0x098B716B8Aaf21512996dC57EB0615e2383E2f96'))
    expect(out.properties?.sanctioned).toBe(true)
    expect(out.properties?.sanctioned_entity).toBe('LAZARUS GROUP')
  }, 120000)
})
