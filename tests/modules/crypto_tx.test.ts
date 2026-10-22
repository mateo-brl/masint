import { describe, expect, it } from 'vitest'
import { detectEntity } from '@shared/detect'
import { base58check, p2pkScriptAddress, ripemd160 } from '../../src/main/modules/crypto/_btc'
import { chainOf } from '../../src/main/modules/crypto/_chain'
import { addressType } from '../../src/main/modules/crypto/info'
import ton, { tonOutput } from '../../src/main/modules/crypto/ton'
import transaction, { MAX_SIDE, parseBlockscoutTx, parseEsploraTx, parseTronscanTx, txChain, txOutput } from '../../src/main/modules/crypto/transaction'
import walletexplorer, { serviceName, weOutput } from '../../src/main/modules/crypto/walletexplorer'
import { fakeContext, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, runModule } from '../helpers/context'

const fr = { lang: 'fr' as const }
const GENESIS_TX = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'
const GENESIS_ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const TON_FOUNDATION = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N'

describe('crypto : outils Bitcoin', () => {
  it('RIPEMD-160 (vecteurs de référence) et Base58Check', () => {
    expect(ripemd160(Buffer.from('')).toString('hex')).toBe('9c1185a5c5e9fc54612808977ee8f548b2258d31')
    expect(ripemd160(Buffer.from('abc')).toString('hex')).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc')
    expect(ripemd160(Buffer.from('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toString('hex')).toBe(
      '9b752e45573d4b39f4dbd3323cab82bf63326bfb'
    )
    expect(base58check(Buffer.alloc(21))).toBe('1111111111111111111114oLvT2')
  })

  it('adresse de la sortie P2PK du bloc de genèse', () => {
    const t = fixtureJson<{ vout: Array<{ scriptpubkey: string }> }>('crypto/mempool_tx_genesis.json')
    expect(p2pkScriptAddress(t.vout[0].scriptpubkey)).toBe(GENESIS_ADDRESS)
    expect(p2pkScriptAddress('0014abcdef')).toBeNull()
  })
})

describe('crypto.transaction', () => {
  it('reconnaît la chaîne d’après la plateforme ou le format', () => {
    expect(txChain({ label: GENESIS_TX, platform: null })).toBe('utxo_or_tron')
    expect(txChain({ label: GENESIS_TX, platform: 'bitcoin' })).toBe('bitcoin')
    expect(txChain({ label: GENESIS_TX, platform: 'tether' })).toBe('tron')
    expect(txChain({ label: `0x${'a'.repeat(64)}`, platform: null })).toBe('ethereum')
    expect(txChain({ label: `0x${'a'.repeat(64)}`, platform: 'polygon' })).toBeNull()
    expect(txChain({ label: GENESIS_TX, platform: 'solana' })).toBeNull()
    expect(txChain({ label: 'pas-un-hash', platform: null })).toBeNull()
  })

  it('Bitcoin : transaction de genèse (coinbase, sortie P2PK)', () => {
    const s = parseEsploraTx('bitcoin', fixtureJson('crypto/mempool_tx_genesis.json'))
    const out = txOutput(fr, s, null)
    expect(out.properties).toMatchObject({ chain: 'Bitcoin', date: '2009-01-03T18:15:05.000Z', block: 0, amount: '50 BTC', fee: '0 BTC', coinbase: true, input_count: 1, output_count: 1, confirmed: true })
    expect(out.properties?.explorer_url).toBe(`https://mempool.space/tx/${GENESIS_TX}`)
    expect(out.entities).toEqual([{ type: 'crypto_wallet', label: GENESIS_ADDRESS, platform: 'bitcoin', data: undefined, linkLabel: 'sortie (50 BTC)' }])
  })

  it('Bitcoin : entrées regroupées par adresse, 10 sorties au plus, le reste en propriété', () => {
    const s = parseEsploraTx('bitcoin', fixtureJson('crypto/mempool_tx_batch.json'))
    expect(s.inputCount).toBe(21)
    expect(s.inputs).toHaveLength(1)
    const out = txOutput(fr, s, null)
    const wallets = out.entities!.filter((e) => e.type === 'crypto_wallet')
    expect(wallets.filter((w) => w.linkLabel?.startsWith('entrée'))).toHaveLength(1)
    expect(wallets.filter((w) => w.linkLabel?.startsWith('sortie'))).toHaveLength(MAX_SIDE)
    expect(out.properties?.output_addresses_count).toBe(s.outputs.length)
    expect(out.properties?.input_addresses).toBeUndefined()
    expect(out.properties?.fee).toBe('0.00001125 BTC')
  })

  it('Ethereum : première transaction et transfert USDT', () => {
    const first = txOutput(fr, parseBlockscoutTx(fixtureJson('crypto/blockscout_tx_first.json')), null)
    expect(first.properties).toMatchObject({ chain: 'Ethereum', block: 46147, amount: '0.000000000000031337 ETH', fee: '1.05 ETH', status: 'success' })
    expect(first.entities?.[0]).toMatchObject({ label: '0xA1E4380A3B1f749673E270229993eE55F35663b4', platform: 'ethereum', data: { ens: 'thanateros.eth', labels: ['Genesis Address'] } })
    const usdt = parseBlockscoutTx(fixtureJson('crypto/blockscout_tx_usdt.json'))
    const out = txOutput(fr, usdt, null)
    expect(out.properties?.amount).toBe('20 USDT')
    expect(out.properties?.token_transfers).toEqual(['20 USDT : 0x1111111111111111111111111111111111111111 → 0x2222222222222222222222222222222222222222'])
    expect(out.entities?.find((e) => e.label === '0x2222222222222222222222222222222222222222')?.linkLabel).toBe('sortie (20 USDT)')
    expect(out.entities?.find((e) => e.label === '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789')?.data).toMatchObject({ is_contract: true, contract_name: 'EntryPoint' })
  })

  it('TRON : transfert USDT TRC20 et étiquette publique', () => {
    const s = parseTronscanTx(fixtureJson('crypto/tronscan_tx_usdt.json'))!
    const out = txOutput(fr, s, null)
    expect(out.properties).toMatchObject({ chain: 'TRON', amount: '30 USDT', status: 'SUCCESS', fee: '0 TRX' })
    expect(out.entities?.find((e) => e.label === 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G')).toMatchObject({ data: { label: 'Binance-Hot 4' }, linkLabel: 'entrée (30 USDT)' })
    expect(out.entities?.find((e) => e.label === 'TAnonymizedRecipient11111111111111')?.linkLabel).toBe('sortie (30 USDT)')
    expect(parseTronscanTx({})).toBeNull()
  })

  it('module : 64 hex sans plateforme, Bitcoin puis TRON', async () => {
    const ctx = fakeContext({
      routes: {
        'https://mempool.space/api/tx/': { status: 404, body: 'Transaction not found' },
        'https://apilist.tronscanapi.com/api/transaction-info': fixtureJson('crypto/tronscan_tx_usdt.json')
      }
    })
    const out = await runModule(transaction, entity('crypto_tx', '3c9105b5eda9fbeae5d5f52b00fe2e7d539c7e542f3608b2e62b589b25524e20'), ctx)
    expect(out.properties?.chain).toBe('TRON')
    expect(ctx.requests).toHaveLength(2)
    const none = fakeContext({ routes: { 'https://mempool.space/api/tx/': { status: 404, body: 'x' }, 'https://apilist.tronscanapi.com/': {} } })
    expect(await runModule(transaction, entity('crypto_tx', '1'.repeat(64)), none)).toEqual({})
  })

  it('module : genèse par mempool.space', async () => {
    const ctx = fakeContext({ routes: { [`https://mempool.space/api/tx/${GENESIS_TX}`]: fixtureJson('crypto/mempool_tx_genesis.json') } })
    const out = await runModule(transaction, entity('crypto_tx', GENESIS_TX, { platform: 'bitcoin' }), ctx)
    expect(out.entities?.[0].label).toBe(GENESIS_ADDRESS)
  })
})

describe('crypto.walletexplorer', () => {
  it('service connu → organisation', () => {
    expect(serviceName('Huobi.com-2')).toBe('Huobi.com')
    expect(serviceName('BTC-e.com-old')).toBe('BTC-e.com')
    const out = weOutput(fr, fixtureJson('crypto/walletexplorer_binance.json'))
    expect(out.properties).toEqual({ wallet_id: '00000b55c1bcbc1f', wallet_label: 'Binance.com', walletexplorer_url: 'https://www.walletexplorer.com/wallet/Binance.com' })
    expect(out.entities).toEqual([{ type: 'organization', label: 'Binance.com', data: { kind: 'service crypto' }, linkLabel: 'portefeuille de (WalletExplorer)' }])
  })

  it('portefeuille sans nom : identifiant seulement', async () => {
    const ctx = fakeContext({ routes: { 'https://www.walletexplorer.com/api/1/address-lookup': { found: true, wallet_id: '9155adea5d855091', updated_to_block: 972522 } } })
    const out = await runModule(walletexplorer, entity('crypto_wallet', GENESIS_ADDRESS), ctx)
    expect(out.properties).toMatchObject({ wallet_id: '9155adea5d855091' })
    expect(out.entities).toEqual([])
    expect(ctx.requests[0]).toContain('caller=masint')
    expect(walletexplorer.accepts!(entity('crypto_wallet', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'))).toBe(false)
    expect(weOutput(fr, { found: false })).toEqual({})
  })
})

describe('crypto.ton', () => {
  it('détection : formes conviviale et brute', () => {
    expect(detectEntity(TON_FOUNDATION)).toMatchObject({ type: 'crypto_wallet', platform: 'ton' })
    const raw = `0:${'83DFD552E63729B472FCBCC8C45EBCC6691702558B68EC7527E1BA403A0F31A8'}`
    expect(detectEntity(raw)).toMatchObject({ type: 'crypto_wallet', platform: 'ton' })
    expect(addressType('ton', raw)).toBe('Raw')
    expect(addressType('ton', TON_FOUNDATION)).toBe('Bounceable')
    expect(chainOf(entity('crypto_wallet', TON_FOUNDATION))).toBe('ton')
  })

  it('solde, état et dernière transaction', () => {
    const info = fixtureJson<{ result: object }>('crypto/toncenter_info.json').result
    const txs = fixtureJson<{ result: Array<{ utime: number }> }>('crypto/toncenter_transactions.json').result
    const out = tonOutput(fr, TON_FOUNDATION, info, txs[0])
    expect(out.properties).toMatchObject({ chain: 'Toncoin', balance: '1592542.221079555 TON', account_state: 'actif', explorer_url: `https://tonviewer.com/${TON_FOUNDATION}` })
    expect(out.properties?.last_seen).toMatch(/^2026-/)
    expect(tonOutput(fr, TON_FOUNDATION, { balance: '0', state: 'uninitialized', last_transaction_id: { lt: '0' } }, null)).toEqual({})
  })

  it('module : deux appels espacés, adresse invalide refusée', async () => {
    const ctx = fakeContext({
      routes: {
        'https://toncenter.com/api/v2/getAddressInformation': fixtureJson('crypto/toncenter_info.json'),
        'https://toncenter.com/api/v2/getTransactions': fixtureJson('crypto/toncenter_transactions.json')
      }
    })
    const out = await runModule(ton, entity('crypto_wallet', TON_FOUNDATION), ctx)
    expect(out.properties?.account_state).toBe('actif')
    expect(ctx.requests).toHaveLength(2)
    const bad = fakeContext({ routes: { 'https://toncenter.com/': { status: 422, body: { ok: false, error: 'Failed to parse ton_addr', code: 422 } } } })
    await expect(runModule(ton, entity('crypto_wallet', 'EQ' + 'A'.repeat(46)), bad)).rejects.toThrow(/Adresse TON invalide/)
  })
})

describe.skipIf(!LIVE)('crypto : transactions et regroupement (live)', () => {
  it('transaction de genèse Bitcoin (mempool.space)', async () => {
    const out = await runModule(transaction, entity('crypto_tx', GENESIS_TX))
    expect(out.properties).toMatchObject({ chain: 'Bitcoin', block: 0, coinbase: true })
    expect(out.entities?.[0].label).toBe(GENESIS_ADDRESS)
  })

  it('transaction Ethereum (Blockscout) et TRON (Tronscan)', async () => {
    const eth = await runModule(transaction, entity('crypto_tx', '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060'))
    expect(eth.properties).toMatchObject({ chain: 'Ethereum', block: 46147 })
    const trx = await runModule(transaction, entity('crypto_tx', '3c9105b5eda9fbeae5d5f52b00fe2e7d539c7e542f3608b2e62b589b25524e20', { platform: 'tron' }))
    expect(trx.properties).toMatchObject({ chain: 'TRON', amount: '30 USDT' })
  })

  it('WalletExplorer : adresse de genèse et adresse Binance', async () => {
    expect((await runModule(walletexplorer, entity('crypto_wallet', GENESIS_ADDRESS))).properties?.wallet_id).toMatch(/^[0-9a-f]{16}$/)
    const binance = await runModule(walletexplorer, entity('crypto_wallet', '1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s'))
    expect(binance.entities?.[0]).toMatchObject({ type: 'organization', label: 'Binance.com' })
  })

  it('TON Foundation (toncenter)', async () => {
    const out = await runModule(ton, entity('crypto_wallet', TON_FOUNDATION))
    expect(out.properties).toMatchObject({ chain: 'Toncoin', account_state: 'actif' })
  })
})
