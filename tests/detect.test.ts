import { describe, expect, it } from 'vitest'
import { detectEntity, isValidIban, normalizePhone } from '@shared/detect'

describe('detectEntity', () => {
  it.each([
    ['john.doe@gmail.com', 'email'],
    ['+33612345678', 'phone'],
    ['06 12 34 56 78', 'phone'],
    ['8.8.8.8', 'ip'],
    ['2001:4860:4860::8888', 'ip'],
    ['example.com', 'domain'],
    ['https://example.com/page?x=1', 'url'],
    ['Jean Dupont', 'person'],
    ['john_doe', 'username'],
    ['FR7630006000011234567890189', 'iban'],
    ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'crypto_wallet'],
    ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'crypto_wallet'],
    ['AS15169', 'asn'],
    ['CVE-2024-3400', 'cve'],
    ['48.8566, 2.3522', 'coordinates'],
    ['d41d8cd98f00b204e9800998ecf8427e', 'hash']
  ])('%s → %s', (input, type) => {
    expect(detectEntity(input)?.type).toBe(type)
  })

  it('normalise les numéros français', () => {
    expect(normalizePhone('06 12 34 56 78')).toBe('+33612345678')
    expect(normalizePhone('0033612345678')).toBe('+33612345678')
  })

  it('valide les IBAN', () => {
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 189')).toBe(true)
    expect(isValidIban('FR7630006000011234567890188')).toBe(false)
  })
})

describe('detectCryptoChain', () => {
  it('reconnaît Dash et Bitcoin Cash avant Solana', async () => {
    const { detectCryptoChain } = await import('@shared/detect')
    expect(detectCryptoChain('XpESxaUmonkq8RaLLp46Brx2K39ggQe226')).toBe('dash')
    expect(detectCryptoChain('qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')).toBe('bitcoincash')
    expect(detectCryptoChain('bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')).toBe('bitcoincash')
    expect(detectCryptoChain('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV')).toBe('solana')
  })
})
