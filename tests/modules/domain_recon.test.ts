// domain.m365, domain.pdns (Mnemonic), domain.pgp et le repli « hostname » d'OTX, sur des
// réponses réelles enregistrées en octobre 2026 (mozilla.org, wikimedia.org, cnil.fr).

import { describe, expect, it } from 'vitest'
import { ModuleError, type ModuleOutput, type OsintModule } from '@shared/modules'
import m365, {
  federationProvider,
  federationRequest,
  meaningfulBrand,
  parseFederationDomains,
  parseM365,
  tenantId,
  type OpenIdConfig,
  type UserRealm
} from '../../src/main/modules/domain/m365'
import { modules as otxModules, parseOtx, type OtxGeneral, type OtxPassiveDns } from '../../src/main/modules/domain/otx'
import pdns, { parseDomainPdns, parseIpPdns, type MnemonicResponse } from '../../src/main/modules/domain/pdns'
import pgp, { domainAddresses, parseMachineReadable, parseUid } from '../../src/main/modules/domain/pgp'
import { fakeContext, fixture, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

type Out = { entities?: Array<{ type: string; label: string; linkLabel?: string }> }
const labels = (out: Out, type: string): string[] => (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

describe('domain.m365', () => {
  it('lit l’identifiant de tenant, la fédération et les domaines du tenant', () => {
    expect(tenantId(fixtureJson<OpenIdConfig>('domain/m365_openid_mozilla.json'))).toBe('c0dc8bb0-b616-427e-8217-9513964a145b')
    expect(tenantId({ token_endpoint: 'https://login.microsoftonline.com/F47551BD-24AF-4B1E-9C28-AF616350E082/oauth2/token' })).toBe(
      'f47551bd-24af-4b1e-9c28-af616350e082'
    )
    expect(parseFederationDomains(fixture('domain/m365_federation_mozilla.xml')).sort()).toEqual([
      'getpocket.com',
      'mozilla.com',
      'mozilla.onmicrosoft.com',
      'mozilla.org',
      'mozilla.vc',
      'mozillafoundation.org'
    ])
    expect(parseFederationDomains(fixture('domain/m365_federation_error.xml'))).toEqual([])
    expect(federationProvider('https://wikimedia.okta.com/app/office365/x/sso/wsfed/passive')).toEqual({ host: 'wikimedia.okta.com', provider: 'Okta' })
    expect(federationProvider('https://sts.exemple.fr/adfs/ls/?client-request-id=1')).toEqual({ host: 'sts.exemple.fr', provider: 'AD FS' })
    expect(federationRequest('mozilla.org')).toContain('<Domain>mozilla.org</Domain>')
  })

  it('ne garde la marque que si elle apprend quelque chose', () => {
    expect(meaningfulBrand('Wikimedia Foundation', 'wikimedia.org')).toBe(true)
    expect(meaningfulBrand('cnil.fr', 'cnil.fr')).toBe(false)
    expect(meaningfulBrand('mozilla', 'mozilla.org')).toBe(false)
    expect(meaningfulBrand('', 'exemple.fr')).toBe(false)
  })

  it('mozilla.org : quatre domaines du même tenant, onmicrosoft en propriété', async () => {
    const ctx = fakeContext({
      routes: {
        'https://login.microsoftonline.com/getuserrealm.srf': fixtureJson('domain/m365_realm_mozilla.json'),
        'https://login.microsoftonline.com/mozilla.org/.well-known/openid-configuration': fixtureJson('domain/m365_openid_mozilla.json'),
        'https://autodiscover-s.outlook.com/autodiscover/autodiscover.svc': fixture('domain/m365_federation_mozilla.xml')
      }
    })
    const out = await m365.run(entity('domain', 'mozilla.org'), ctx)
    expect(ctx.requests[0]).toContain('login=x%40mozilla.org')
    expect(labels(out, 'domain').sort()).toEqual(['getpocket.com', 'mozilla.com', 'mozilla.vc', 'mozillafoundation.org'])
    expect(out.entities?.[0].linkLabel).toBe('même tenant Microsoft 365')
    // « mozilla » n'est que le nom du domaine : pas de nœud organisation.
    expect(labels(out, 'organization')).toEqual([])
    expect(out.properties).toMatchObject({
      m365_tenant: 'managed',
      m365_tenant_id: 'c0dc8bb0-b616-427e-8217-9513964a145b',
      m365_tenant_region: 'Amérique du Nord (NA)',
      m365_brand: 'mozilla',
      m365_onmicrosoft: ['mozilla.onmicrosoft.com'],
      m365_tenant_domains_count: 4
    })
  })

  it('wikimedia.org : fédéré chez Okta, marque « Wikimedia Foundation »', () => {
    const out = parseM365(
      'wikimedia.org',
      fixtureJson<UserRealm>('domain/m365_realm_wikimedia.json'),
      fixtureJson<OpenIdConfig>('domain/m365_openid_wikimedia.json'),
      parseFederationDomains(fixture('domain/m365_federation_wikimedia.xml')),
      'fr'
    )
    expect(out.entities).toEqual([{ type: 'organization', label: 'Wikimedia Foundation', linkLabel: 'marque du tenant' }])
    expect(out.properties).toMatchObject({
      m365_tenant: 'federated',
      identity_provider: 'wikimedia.okta.com',
      m365_federation_provider: 'Okta',
      m365_onmicrosoft: ['wikimedia.mail.onmicrosoft.com', 'wikimedia.onmicrosoft.com']
    })
  })

  it('plafonne les domaines du tenant à 25 entités, le reste en propriété', () => {
    const domains = Array.from({ length: 40 }, (_, i) => `filiale${i}.exemple.com`)
    const out = parseM365('exemple.com', { NameSpaceType: 'Managed', FederationBrandName: 'Exemple' }, null, domains, 'fr')
    expect(labels(out, 'domain')).toHaveLength(25)
    expect(out.properties?.m365_tenant_domains_count).toBe(40)
  })

  it('domaine sans tenant : résultat vide, sans autre requête', async () => {
    const ctx = fakeContext({ routes: { 'https://login.microsoftonline.com/getuserrealm.srf': fixtureJson('domain/m365_realm_unknown.json') } })
    expect(await m365.run(entity('domain', 'nx-masint-test-domain.org'), ctx)).toEqual({})
    expect(ctx.requests).toHaveLength(1)
  })
})

describe('domain.pdns (Mnemonic)', () => {
  it('cnil.fr : six anciennes adresses A, avec leurs dates', () => {
    const out = parseDomainPdns('cnil.fr', fixtureJson<MnemonicResponse>('domain/mnemonic_pdns_cnil.json'), 'fr')
    expect(labels(out, 'ip')).toEqual(['46.18.194.45', '46.18.194.71', '46.18.194.181', '213.162.53.41', '213.162.57.44', '94.247.233.54'])
    const old = out.entities?.find((e) => e.label === '213.162.57.44')
    expect(old).toMatchObject({ linkLabel: 'a résolu vers', data: { first_seen: '2014-01-16T04:22:42.000Z', last_seen: '2016-02-15T12:45:36.000Z' } })
    expect(out.properties?.pdns_first_seen).toBe('2013-07-23T00:01:39.000Z')
    expect(out.properties?.pdns_ips_count).toBe(6)
  })

  it('mozilla.org : IP de CDN en propriété, CNAME entrants à part', () => {
    const res = fixtureJson<MnemonicResponse>('domain/mnemonic_pdns_mozilla.json')
    // Adresse CloudFront fictive ajoutée : infrastructure partagée.
    res.data!.push({ query: 'mozilla.org', answer: '13.32.0.10', rrtype: 'a', firstSeenTimestamp: 1500000000000, lastSeenTimestamp: 1510000000000 })
    const out = parseDomainPdns('mozilla.org', res, 'fr')
    expect(labels(out, 'ip')).not.toContain('13.32.0.10')
    expect(out.properties?.pdns_shared_ips).toEqual(['13.32.0.10 (Amazon CloudFront (CDN))'])
    expect(labels(out, 'ip')).toContain('2620:101:8008:5::2:1')
    expect(out.properties?.pdns_cnamed_by).toEqual(['a.nooralens.ml (2023-06-12 → 2023-06-12)'])
    expect(labels(out, 'domain')).toEqual([])
  })

  it('IP : noms qui y ont pointé, sauf adresse mutualisée', () => {
    const res = fixtureJson<MnemonicResponse>('domain/mnemonic_pdns_46.18.194.45.json')
    const out = parseIpPdns('46.18.194.45', res, 'fr')
    expect(labels(out, 'domain')).toEqual(['cnil.fr', 'www.cnil.fr', 'linc.cnil.fr', 'preprod2.strasbourg.eu'])
    expect(out.entities?.[0].linkLabel).toBe('historique DNS')
    // Plus de 50 noms : hébergement mutualisé, tout reste en propriété.
    const crowded = { ...res, count: 120 }
    const shared = parseIpPdns('46.18.194.45', crowded, 'fr')
    expect(shared.entities).toEqual([])
    expect(shared.properties?.shared_infrastructure).toBe('adresse mutualisée (plus de 50 noms)')
    // IP de CDN connue.
    expect(parseIpPdns('104.16.1.1', { data: [{ query: 'exemple.fr', answer: '104.16.1.1', rrtype: 'a' }] }, 'fr').entities).toEqual([])
  })

  it('exécute le module pour un domaine et une IP', async () => {
    const ctx = fakeContext({
      routes: {
        'https://api.mnemonic.no/pdns/v3/cnil.fr': fixtureJson('domain/mnemonic_pdns_cnil.json'),
        'https://api.mnemonic.no/pdns/v3/46.18.194.45': fixtureJson('domain/mnemonic_pdns_46.18.194.45.json')
      }
    })
    expect(labels(await pdns.run(entity('domain', 'www.cnil.fr'), ctx), 'ip')).toHaveLength(6)
    expect(ctx.requests[0]).toBe('https://api.mnemonic.no/pdns/v3/cnil.fr?limit=100')
    expect(labels(await pdns.run(entity('ip', '46.18.194.45'), ctx), 'domain')).toContain('cnil.fr')
    expect(await pdns.run(entity('domain', 'inconnu.exemple'), ctx)).toEqual({})
  })

  it('quota dépassé : erreur explicite', async () => {
    const ctx = fakeContext({ routes: { 'https://api.mnemonic.no/': { status: 429, body: '{}' } } })
    await expect(pdns.run(entity('domain', 'cnil.fr'), ctx)).rejects.toMatchObject({ code: 'rate_limited' })
  })
})

describe('domain.pgp', () => {
  it('lit le format « machine readable » et les uid encodés', () => {
    expect(parseUid('Mozilla Client Release (Release Signing Key) <cltbld@mozilla.org>')).toEqual({ name: 'Mozilla Client Release', email: 'cltbld@mozilla.org' })
    expect(parseUid('security@exemple.org')).toEqual({ name: null, email: 'security@exemple.org' })
    const keys = parseMachineReadable(fixture('domain/keyserver_index_mozilla.txt'))
    expect(keys).toHaveLength(6)
    expect(keys[0]).toMatchObject({ fingerprint: 'ADEFB2E2457DB7371A03134BA7CD99DA64E9DED7', created: '2024-11-05T04:38:03.000Z', revoked: false })
    expect(keys[3].revoked).toBe(true)
    expect(keys[4].uids[0].name).toBe('Équipe Exemple')
  })

  it('ne garde que le domaine et ses sous-domaines, une entrée par adresse', () => {
    const keys = parseMachineReadable(fixture('domain/keyserver_index_mozilla.txt'))
    const addresses = domainAddresses('mozilla.org', keys)
    expect(addresses.map((a) => a.email)).toEqual(['security@mozilla.org', 'webmaster@lists.mozilla.org', 'releases@mozilla.org', 'cltbld@mozilla.org'])
    // La clé valide de 2024 l'emporte sur l'ancienne clé révoquée.
    expect(addresses[0]).toMatchObject({ name: 'Mozilla Security', revoked: false, created: '2024-11-05T04:38:03.000Z' })
  })

  it('propose les adresses à vérifier, avec la date de la clé', async () => {
    const ctx = fakeContext({ routes: { 'https://keyserver.ubuntu.com/pks/lookup': fixture('domain/keyserver_index_mozilla.txt') } })
    const out = await pgp.run(entity('domain', 'mozilla.org'), ctx)
    expect(ctx.requests[0]).toContain('search=mozilla.org&op=index&options=mr')
    const releases = out.entities?.find((e) => e.label === 'releases@mozilla.org')
    expect(releases).toMatchObject({
      type: 'email',
      review: true,
      reviewReason: 'clé PGP publiée en 2005, adresse peut-être inactive',
      data: { display_name: 'Mozilla Software Releases', pgp_key_created_at: '2005-09-29T18:39:21.000Z' }
    })
    expect(out.properties?.pgp_emails_count).toBe(4)
    expect(labels(out, 'person')).toEqual([])
  })

  it('aucune clé : le serveur répond 404, résultat vide', async () => {
    const ctx = fakeContext({ routes: { 'https://keyserver.ubuntu.com/': { status: 404, body: 'Not Found' } } })
    expect(await pgp.run(entity('domain', 'nx-masint-test-domain.org'), ctx)).toEqual({})
  })
})

describe('domain.otx : repli et sous-domaines', () => {
  const otxDomain = otxModules.find((m) => m.id === 'domain.otx')!
  const pdnsCnil = fixtureJson<OtxPassiveDns>('domain/otx_hostname_pdns_cnil.json')

  it('se rabat sur la section « hostname » quand « domain » répond 429 en anonyme', async () => {
    const ctx = fakeContext({
      routes: {
        'https://otx.alienvault.com/api/v1/indicators/domain/cnil.fr/general': { pulse_info: { count: 0, pulses: [] } },
        'https://otx.alienvault.com/api/v1/indicators/domain/cnil.fr/passive_dns': { status: 429, body: '{"detail": "Anonymous access to this endpoint is limited."}' },
        'https://otx.alienvault.com/api/v1/indicators/hostname/cnil.fr/passive_dns': pdnsCnil
      }
    })
    const out = await otxDomain.run(entity('domain', 'cnil.fr'), ctx)
    expect(ctx.requests).toContain('https://otx.alienvault.com/api/v1/indicators/hostname/cnil.fr/passive_dns')
    // Les noms d'hôtes ne sont plus jetés : sous-domaines en propriété.
    expect(out.properties?.otx_subdomains).toEqual(expect.arrayContaining(['agenda.pro.cnil.fr', 'piwik.cnil.fr', 'www.cnil.fr']))
    expect(out.properties?.otx_subdomains).not.toContain('cnil.fr')
    // IP d'un sous-domaine (piwik.cnil.fr) : dans la liste, pas en entité du domaine.
    expect(out.properties?.otx_resolved_ips).toContain('46.18.194.132')
    expect(labels(out, 'ip')).not.toContain('46.18.194.132')
  })

  it('garde la mention de liste blanche et signale la section en échec', () => {
    const general = fixtureJson<OtxGeneral>('domain/otx_general_example.json')
    const out = parseOtx('8.8.8.8', 'ip', { ...general, pulse_info: { count: 0, pulses: [] } }, null, 'fr', {}, ['passive_dns : délai dépassé'])
    expect(out.properties?.otx_whitelisted).toBe(true)
    expect(out.properties?.otx_errors).toEqual(['passive_dns : délai dépassé'])
  })
})

/** Tests en direct : un service limité ou injoignable depuis ce réseau n'est pas une régression. */
async function live(m: OsintModule, type: string, value: string, t: { skip: () => void }): Promise<ModuleOutput> {
  try {
    return await runModule(m, entity(type, value), makeContext())
  } catch (e) {
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || /fetch failed/i.test(String(e))) t.skip()
    throw e
  }
}

describe.skipIf(!LIVE)('reconnaissance de domaine en direct', () => {
  it('domain.m365 : mozilla.org', async (t) => {
    const out = await live(m365, 'domain', 'mozilla.org', t)
    expect(labels(out, 'domain')).toEqual(expect.arrayContaining(['mozilla.com', 'getpocket.com']))
    expect(out.properties?.m365_tenant_id).toMatch(/^[0-9a-f-]{36}$/)
  }, 60000)

  it('domain.m365 : wikimedia.org fédéré chez Okta', async (t) => {
    const out = await live(m365, 'domain', 'wikimedia.org', t)
    expect(out.properties?.m365_federation_provider).toBe('Okta')
    expect(labels(out, 'organization')).toEqual(['Wikimedia Foundation'])
  }, 60000)

  it('domain.pdns : cnil.fr', async (t) => {
    const out = await live(pdns, 'domain', 'cnil.fr', t)
    expect(labels(out, 'ip')).toContain('213.162.57.44')
  }, 60000)

  it('domain.pgp : wikimedia.org', async (t) => {
    const out = await live(pgp, 'domain', 'wikimedia.org', t)
    expect(Number(out.properties?.pgp_emails_count)).toBeGreaterThan(10)
    expect(out.entities?.every((e) => e.review && e.type === 'email')).toBe(true)
  }, 60000)

  it('domain.otx : cnil.fr (repli « hostname »)', async (t) => {
    const out = await live(otxModules[0], 'domain', 'cnil.fr', t)
    expect(Number(out.properties?.otx_subdomains_count)).toBeGreaterThan(5)
  }, 60000)
})
