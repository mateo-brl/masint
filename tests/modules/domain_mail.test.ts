// domain.dns : DMARC, SPF en profondeur, BIMI, MTA-STS, TLS-RPT et DKIM, sur des
// enregistrements réels de mozilla.org, wikipedia.org et cnil.fr (octobre 2026).

import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import {
  analyzeSpf,
  dkimProviders,
  expandSpf,
  isDkimRecord,
  parseBimi,
  parseSpf,
  reportRecipients,
  reportUris,
  SPF_MAX_LOOKUPS
} from '../../src/main/modules/domain/_mail'
import { registrableDomain } from '../../src/main/modules/domain/_util'
import dnsModule, { buildDnsOutput } from '../../src/main/modules/domain/dnsRecords'
import { fakeContext, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

type Out = { entities?: Array<{ type: string; label: string; linkLabel?: string }> }
const labels = (out: Out, type: string): string[] => (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)
const linkOf = (out: Out, type: string, label: string): string[] =>
  (out.entities ?? []).filter((e) => e.type === type && e.label === label).map((e) => e.linkLabel ?? '')

const dns = (name: string): Record<string, string[]> => fixtureJson<Record<string, string[]>>(`domain/dns_mail_${name}.json`)

describe('domaine enregistrable', () => {
  it('retire les sous-domaines en gardant les suffixes à deux niveaux', () => {
    expect(registrableDomain('_spf.mozilla.com')).toBe('mozilla.com')
    expect(registrableDomain('_netblocks3.mozilla.com')).toBe('mozilla.com')
    expect(registrableDomain('mail.exemple.co.uk')).toBe('exemple.co.uk')
    expect(registrableDomain('www.cnil.gouv.fr')).toBe('cnil.gouv.fr')
    expect(registrableDomain('a.b.exemple.com.au')).toBe('exemple.com.au')
    expect(registrableDomain('projet.github.io')).toBe('projet.github.io')
    expect(registrableDomain('cnil.fr')).toBe('cnil.fr')
  })
})

describe('SPF en profondeur', () => {
  it('lit include, redirect et blocs IP, sans les termes en échec', () => {
    expect(parseSpf('v=spf1 include:_spf.Example.com ip4:192.0.2.1 -ip4:192.0.2.9 ip6:2001:db8::/32 redirect=_spf.example.net ~all')).toEqual({
      includes: ['_spf.example.com'],
      redirect: '_spf.example.net',
      ranges: ['192.0.2.1', '2001:db8::/32']
    })
  })

  it('suit les include non fournisseurs, au plus 10 résolutions', async () => {
    const records = dns('mozilla')
    const asked: string[] = []
    const resolve = async (name: string): Promise<string[]> => {
      asked.push(name)
      return records[`${name}|TXT`] ?? []
    }
    const expanded = await expandSpf(records['mozilla.org|TXT'].find((t) => t.startsWith('v=spf1'))!, resolve)
    // Ni la macro Valimail, ni _spf.google.com (fournisseurs connus) ne sont résolus.
    expect(asked.sort()).toEqual(['_netblocks.mozilla.com', '_netblocks3.mozilla.com', '_spf.mozilla.com', 'spf.fundraiseup.com'])
    expect(expanded['_spf.mozilla.com']).toMatch(/^v=spf1 include:_netblocks/)

    // Chaîne sans fin : la limite de la RFC 7208 s'applique.
    let n = 0
    const loop = async (): Promise<string[]> => [`v=spf1 include:l${++n}.exemple.org ~all`]
    await expandSpf('v=spf1 include:l0.exemple.org ~all', loop)
    expect(n).toBe(SPF_MAX_LOOKUPS)
  })

  it('mozilla.org : domaines tiers, fournisseurs et adresses isolées', async () => {
    const records = dns('mozilla')
    const spf = records['mozilla.org|TXT'].find((t) => t.startsWith('v=spf1'))!
    const expanded = await expandSpf(spf, async (name) => records[`${name}|TXT`] ?? [])
    const a = analyzeSpf('mozilla.org', spf, expanded)
    expect(a.senders).toEqual(expect.arrayContaining(['Valimail', 'Google Workspace']))
    expect(a.domains.sort()).toEqual(['fundraiseup.com', 'mozilla.com'])
    expect(a.ranges).toContain('63.245.208.0/20')
    expect(a.hosts).toContain('203.192.141.162')
    expect(a.hosts).toContain('146.82.185.165')
    expect(a.hosts).not.toContain('63.245.208.0')
  })
})

describe('rapports DMARC et TLS-RPT', () => {
  it('lit rua et ruf (plusieurs adresses, taille maximale)', () => {
    const rec = 'v=DMARC1; p=reject; rua=mailto:dmarc_agg@vali.email,mailto:dmarc@mozilla.com!10m; ruf=mailto:forensic@exemple.org'
    expect(reportUris(rec, 'rua')).toEqual(['dmarc_agg@vali.email', 'dmarc@mozilla.com'])
    expect(reportUris(rec, 'ruf')).toEqual(['forensic@exemple.org'])
    expect(reportUris('v=TLSRPTv1;rua=mailto:sts-reports@google.com,https://tlsrpt.exemple.net/v1', 'rua')).toEqual([
      'sts-reports@google.com',
      'https://tlsrpt.exemple.net/v1'
    ])
  })

  it('distingue prestataire connu, domaine tiers et la cible elle-même', () => {
    expect(reportRecipients('mozilla.org', ['dmarc_agg@vali.email', 'dmarc@mozilla.com'])).toEqual({ providers: ['Valimail'], domains: ['mozilla.com'] })
    expect(reportRecipients('wikipedia.org', ['dmarc-rua@wikimedia.org'])).toEqual({ providers: [], domains: ['wikimedia.org'] })
    expect(reportRecipients('exemple.fr', ['dmarc@reports.exemple.fr', 'x@ag.dmarcian.com', 'y@rua.easydmarc.us'])).toEqual({
      providers: ['dmarcian', 'EasyDMARC'],
      domains: []
    })
  })
})

describe('BIMI et DKIM', () => {
  it('extrait le logo et le certificat BIMI', () => {
    const rec = dns('mozilla')['default._bimi.mozilla.org|TXT'][0]
    expect(parseBimi(rec).logo).toBe('https://amplify.valimail.com/bimi/mozilla/-OHlHGABH88-mozilla_logo.svg')
    expect(parseBimi(rec).certificate).toMatch(/\.pem$/)
    expect(parseBimi('v=spf1 -all')).toEqual({ logo: null, certificate: null })
  })

  it('reconnaît une clé DKIM et les sélecteurs propres à un service', () => {
    expect(isDkimRecord(dns('mozilla')['google._domainkey.mozilla.org|TXT'][0])).toBe(true)
    expect(isDkimRecord('v=spf1 include:_spf.google.com ~all')).toBe(false)
    expect(dkimProviders(['selector1', 'selector2', 'google', 'k1', 's1'])).toEqual(['Microsoft 365', 'Google Workspace', 'Mailchimp'])
  })
})

describe('domain.dns : pivots messagerie', () => {
  it('mozilla.org (DoH simulé) : DMARC, SPF, BIMI, DKIM', async () => {
    const out = await dnsModule.run(entity('domain', 'mozilla.org'), fakeContext({ dns: dns('mozilla') }))
    // DMARC : Valimail (prestataire) et mozilla.com (domaine tiers) reçoivent les rapports.
    expect(linkOf(out, 'technology', 'Valimail')).toEqual(expect.arrayContaining(['reçoit les rapports DMARC']))
    expect(linkOf(out, 'domain', 'mozilla.com')).toEqual(expect.arrayContaining(['reçoit les rapports DMARC', 'autorisé à envoyer (SPF)']))
    expect(linkOf(out, 'domain', 'fundraiseup.com')).toEqual(['autorisé à envoyer (SPF)'])
    expect(out.properties?.dmarc_rua).toEqual(['dmarc_agg@vali.email', 'dmarc@mozilla.com'])
    // SPF : include suivis, plages en propriété, adresses isolées en entités (10 au plus).
    expect(out.properties?.spf_includes).toEqual(expect.arrayContaining(['_spf.mozilla.com', '_netblocks.mozilla.com', 'spf.fundraiseup.com']))
    expect(out.properties?.spf_ip_ranges).toEqual(expect.arrayContaining(['63.245.208.0/20', '2620:101:8000::/40', '203.192.141.162/32']))
    const spfIps = (out.entities ?? []).filter((e) => e.type === 'ip' && e.linkLabel === 'autorisée à envoyer (SPF)').map((e) => e.label)
    expect(spfIps).toHaveLength(10)
    expect(spfIps).toContain('203.192.141.162')
    expect(spfIps).not.toContain('63.245.208.0')
    // BIMI, DKIM et messagerie.
    expect(out.properties?.bimi_logo).toMatch(/^https:\/\/amplify\.valimail\.com\/bimi\//)
    expect(out.properties?.dkim_selectors).toEqual(['google'])
    expect(out.properties?.mail_providers).toEqual(['Google Workspace'])
    expect(labels(out, 'technology')).toEqual(expect.arrayContaining(['Google Workspace', 'Valimail']))
  })

  it('wikipedia.org : rapports DMARC et SPF chez wikimedia.org', async () => {
    const out = await dnsModule.run(entity('domain', 'wikipedia.org'), fakeContext({ dns: dns('wikipedia') }))
    expect(linkOf(out, 'domain', 'wikimedia.org')).toEqual(['autorisé à envoyer (SPF)', 'reçoit les rapports DMARC'])
    expect(out.properties?.spf_ip_ranges).toEqual(['208.80.152.0/22', '2620:0:860::/56', '2620:0:861::/56'])
    // Seulement des blocs : aucune adresse isolée.
    expect((out.entities ?? []).some((e) => e.linkLabel === 'autorisée à envoyer (SPF)')).toBe(false)
  })

  it('cnil.fr : les 22 adresses ip4 du SPF, 10 en entités', async () => {
    const out = await dnsModule.run(entity('domain', 'cnil.fr'), fakeContext({ dns: dns('cnil') }))
    expect(out.properties?.spf_ip_ranges_count).toBe(22)
    const spfIps = (out.entities ?? []).filter((e) => e.linkLabel === 'autorisée à envoyer (SPF)').map((e) => e.label)
    expect(spfIps).toHaveLength(10)
    expect(spfIps[0]).toBe('185.24.184.82')
    expect(out.properties?.dmarc_policy).toBe('quarantine')
    expect(out.properties?.dmarc_rua).toBeUndefined()
  })

  it('MTA-STS, TLS-RPT et sélecteurs Microsoft 365 derrière une passerelle', () => {
    const out = buildDnsOutput(
      'exemple.fr',
      {
        MX: ['10 mx1.exemple-fr.pphosted.com'],
        TXT: ['v=spf1 include:spf.protection.outlook.com -all'],
        MTA_STS: ['v=STSv1; id=20261001T000000;'],
        TLSRPT: ['v=TLSRPTv1; rua=mailto:tls@rua.uriports.com,mailto:tls-reports@groupe-exemple.com'],
        DKIM: { selector1: 'v=DKIM1; k=rsa; p=MIIB', k1: 'k=rsa; p=MIGf' }
      },
      'fr'
    )
    expect(out.properties?.mta_sts).toBe('v=STSv1; id=20261001T000000;')
    expect(out.properties?.tls_rpt_rua).toEqual(['tls@rua.uriports.com', 'tls-reports@groupe-exemple.com'])
    expect(linkOf(out, 'technology', 'URIports')).toEqual(['reçoit les rapports TLS-RPT'])
    expect(linkOf(out, 'domain', 'groupe-exemple.com')).toEqual(['reçoit les rapports TLS-RPT'])
    // Microsoft 365 est déjà autorisé par SPF ; Mailchimp n'est vu que par DKIM.
    expect(linkOf(out, 'technology', 'Microsoft 365')).toEqual(['autorisé par SPF'])
    expect(linkOf(out, 'technology', 'Mailchimp')).toEqual(['signature DKIM'])
    expect(out.properties?.dkim_selectors).toEqual(['selector1', 'k1'])
  })

  it('ignore un joker TXT qui répondrait pour tous les sélecteurs DKIM', async () => {
    const records: Record<string, string[]> = { 'exemple.fr|A': ['192.0.2.1'] }
    for (const s of ['selector1', 'selector2', 'google', 'k1', 's1', 's2', 'default', 'dkim', 'mail', 'mxvault', 'mandrill', 'smtp'])
      records[`${s}._domainkey.exemple.fr|TXT`] = ['v=DKIM1; p=JOKER']
    const out = await dnsModule.run(entity('domain', 'exemple.fr'), fakeContext({ dns: records }))
    expect(out.properties?.dkim_selectors).toBeUndefined()
  })
})

describe.skipIf(!LIVE)('domain.dns en direct', () => {
  const run = async (domain: string, t: { skip: () => void }) => {
    try {
      return await runModule(dnsModule, entity('domain', domain), makeContext())
    } catch (e) {
      if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || /fetch failed/i.test(String(e))) t.skip()
      throw e
    }
  }

  it('mozilla.org : Valimail, mozilla.com, logo BIMI', async (t) => {
    const out = await run('mozilla.org', t)
    expect(labels(out, 'technology')).toContain('Valimail')
    expect(labels(out, 'domain')).toContain('mozilla.com')
    expect(out.properties?.bimi_logo).toMatch(/^https:\/\//)
  }, 60000)

  it('wikipedia.org : wikimedia.org reçoit les rapports DMARC', async (t) => {
    const out = await run('wikipedia.org', t)
    expect(linkOf(out, 'domain', 'wikimedia.org')).toContain('reçoit les rapports DMARC')
  }, 60000)

  it('cnil.fr : adresses ip4 du SPF', async (t) => {
    const out = await run('cnil.fr', t)
    expect(Number(out.properties?.spf_ip_ranges_count)).toBeGreaterThan(10)
  }, 60000)
})
