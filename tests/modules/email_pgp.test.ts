// Clés PGP publiques d'une adresse : lecture des index HKP et des clés armurées, garde-fou
// contre les adresses inondées de fausses clés.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dearmor, parseArmoredKeys, parseHkpIndex, readPackets, splitUid } from '../../src/main/modules/email/_pgp'
import pgp, { buildPgpOutput, MAX_KEYS, type PgpSource } from '../../src/main/modules/email/pgp'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext } from './social_helpers'

const text = (name: string): string => readFileSync(resolve(__dirname, '../fixtures/email', name), 'utf8')

describe('lecture des clés OpenPGP', () => {
  it('sépare nom, commentaire et adresse d’une identité', () => {
    expect(splitUid('Debian Security Team <security@debian.org>')).toEqual({ raw: 'Debian Security Team <security@debian.org>', name: 'Debian Security Team', email: 'security@debian.org' })
    expect(splitUid('Exemple (travail) <A@Example.com>')).toMatchObject({ name: 'Exemple', email: 'a@example.com' })
    expect(splitUid('jean@example.com')).toEqual({ raw: 'jean@example.com', email: 'jean@example.com' })
  })

  it('index HKP de keyserver.ubuntu.com (clé sans identité listée comprise)', () => {
    const idx = parseHkpIndex(text('pgp_ubuntu_debian.txt'))!
    expect(idx.count).toBe(2)
    expect(idx.keys[0]).toMatchObject({ fingerprint: '0D59D2B15144766A14D241C66BAF400B05C3E651', algorithm: 'RSA 4096', createdAt: '2015-01-18' })
    expect(idx.keys[0].uids.map((u) => u.email)).toEqual(['security@debian.org', 'team@security.debian.org'])
    expect(idx.keys[1].uids).toEqual([])
    expect(parseHkpIndex('<html>erreur</html>')).toBeNull()
  })

  it('index HKP avec identités encodées (%20, %3C)', () => {
    const idx = parseHkpIndex('info:1:1\npub:835B4E04F6F7421104C4751A3EF9EF996604DE41:1:3072:1668524410::\nuid:Tor%20Security%20Contact%20%3Csecurity@torproject.org%3E:1737054510::\n')!
    expect(idx.keys[0].uids[0]).toMatchObject({ name: 'Tor Security Contact', email: 'security@torproject.org' })
  })

  it('clé armurée de keys.openpgp.org : empreinte calculée, date, identité', () => {
    const buf = dearmor(text('pgp_kop_torproject.asc'))!
    expect(readPackets(buf).map((p) => p.tag)).toContain(6)
    const [key] = parseArmoredKeys(text('pgp_kop_torproject.asc'))
    // Empreinte confirmée par `gpg --show-keys`.
    expect(key).toMatchObject({ fingerprint: '835B4E04F6F7421104C4751A3EF9EF996604DE41', algorithm: 'RSA 3072', createdAt: '2022-11-15' })
    expect(key.uids.map((u) => u.email)).toEqual(['security@torproject.org'])
    expect(key.revoked).toBeUndefined()
  })

  it('clé fictive à deux identités (EdDSA)', () => {
    const [key] = parseArmoredKeys(text('pgp_kop_multi.asc'))
    expect(key).toMatchObject({ algorithm: 'EdDSA', createdAt: '2021-03-14' })
    expect(key.fingerprint).toMatch(/^[0-9A-F]{40}$/)
    expect(key.uids.map((u) => u.email)).toEqual(['alice@example.com', 'alice.travail@example.org'])
    expect(parseArmoredKeys('pas une clé')).toEqual([])
  })
})

describe('email.pgp', () => {
  const ubuntu = (body: string): PgpSource => {
    const idx = parseHkpIndex(body)!
    return { verified: false, host: 'keyserver.ubuntu.com', keys: idx.keys, count: idx.count }
  }

  it('autres adresses d’une clé déposée sur un serveur ouvert : à vérifier', () => {
    const out = buildPgpOutput('security@debian.org', [{ verified: true, host: 'keys.openpgp.org', keys: [], count: 0 }, ubuntu(text('pgp_ubuntu_debian.txt'))], 'fr')
    expect(out.properties).toMatchObject({
      pgp_keys_count: 2,
      pgp_fingerprints: ['0D59D2B15144766A14D241C66BAF400B05C3E651', 'BACB4B5C30AC38F319EE961E2702CAEB90F8EEC5'],
      pgp_key_created_at: '2012-09-12',
      pgp_uid_names: ['Debian Security Team']
    })
    expect(out.properties.pgp_verified).toBeUndefined()
    expect(out.entities).toEqual([
      expect.objectContaining({ type: 'email', label: 'team@security.debian.org', linkLabel: 'même clé PGP', review: true, reviewReason: expect.stringMatching(/keyserver\.ubuntu\.com/) })
    ])
  })

  it('autres adresses vérifiées par keys.openpgp.org : directement dans le graphe', () => {
    const keys = parseArmoredKeys(text('pgp_kop_multi.asc'))
    const out = buildPgpOutput('alice@example.com', [{ verified: true, host: 'keys.openpgp.org', keys, count: 1 }], 'fr')
    expect(out.properties).toMatchObject({ pgp_verified: true, pgp_keys_count: 1, pgp_key_created_at: '2021-03-14', pgp_uid_names: ['Exemple Fictif'] })
    expect(out.entities).toHaveLength(1)
    expect(out.entities[0]).toMatchObject({ label: 'alice.travail@example.org', data: { pgp_fingerprint: keys[0].fingerprint } })
    expect(out.entities[0].review).toBeUndefined()
  })

  it(`garde-fou : plus de ${MAX_KEYS} clés sur un serveur ouvert, seulement leur nombre`, () => {
    const out = buildPgpOutput('victime@example.com', [ubuntu(text('pgp_ubuntu_flood.txt'))], 'fr')
    expect(out.properties).toEqual({ pgp_keys_count: 12, pgp_key_flooding: true })
    expect(out.entities).toEqual([])
  })

  it('module : deux serveurs interrogés, un serveur en panne n’empêche pas le résultat', async () => {
    const ctx = fakeContext([
      [/keys\.openpgp\.org\/vks\/v1\/by-email\/alice%40example\.com/, { body: text('pgp_kop_multi.asc') }],
      [/keyserver\.ubuntu\.com/, { status: 502, body: 'Bad Gateway' }]
    ])
    const out = await runModule(pgp, entity('email', 'alice@example.com'), ctx)
    expect(out.properties).toMatchObject({ pgp_verified: true, pgp_unreachable: ['keyserver.ubuntu.com'] })
    expect(out.entities?.map((e) => e.label)).toEqual(['alice.travail@example.org'])
  })

  it('module : aucune clé', async () => {
    const ctx = fakeContext([
      [/keys\.openpgp\.org/, { status: 404, body: 'No key found for email address' }],
      [/keyserver\.ubuntu\.com/, { status: 404, body: 'No results found' }]
    ])
    const out = await runModule(pgp, entity('email', 'jean@example.com'), ctx)
    expect(out.properties).toBeUndefined()
    expect(out.entities).toBeUndefined()
  })
})

describe.skipIf(!LIVE)('email.pgp (live)', () => {
  const ctx = makeContext()
  it('security@debian.org : 2 clés et team@security.debian.org', async () => {
    const out = await runModule(pgp, entity('email', 'security@debian.org'), ctx)
    expect(out.properties?.pgp_keys_count).toBe(2)
    expect(out.entities?.map((e) => e.label)).toContain('team@security.debian.org')
  })
  it('security@torproject.org : clé vérifiée par keys.openpgp.org', async () => {
    const out = await runModule(pgp, entity('email', 'security@torproject.org'), ctx)
    expect(out.properties).toMatchObject({ pgp_verified: true })
    expect(out.properties?.pgp_fingerprints).toContain('835B4E04F6F7421104C4751A3EF9EF996604DE41')
  })
  it('adresse inondée : seulement le nombre de clés', async () => {
    const out = await runModule(pgp, entity('email', 'torvalds@linux-foundation.org'), ctx)
    expect(out.properties?.pgp_key_flooding).toBe(true)
    expect(Number(out.properties?.pgp_keys_count)).toBeGreaterThan(MAX_KEYS)
    expect(out.entities ?? []).toEqual([])
  })
})
