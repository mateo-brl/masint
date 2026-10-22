import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import { detectDnsProvider, detectHosting } from '../../src/main/modules/domain/_hosting'
import { analyzeMail, dmarcPolicy } from '../../src/main/modules/domain/_mail'
import { normalizeDomain, normalizeHost } from '../../src/main/modules/domain/_util'
import { certificateHash, modules as certModules, parseCertSpotterCerts } from '../../src/main/modules/domain/certificates'
import dnsModule, { buildDnsOutput, soaEmail, type DnsRecords } from '../../src/main/modules/domain/dnsRecords'
import hostingModule, { buildHostingOutput } from '../../src/main/modules/domain/hosting'
import hudsonRock, { parseHudsonRockDomain, type HudsonRockDomain } from '../../src/main/modules/domain/hudsonRock'
import { modules as otxModules } from '../../src/main/modules/domain/otx'
import rdapModule, { contactHolder, parseRdap, parseVcard, type RdapDomain, type RdapEntity } from '../../src/main/modules/domain/rdap'
import { isCompanyName, isMaskedValue, looksLikePerson, MASKED_WHOIS_VALUES, sameCompany, visibleName } from '../../src/main/modules/domain/_whois'
import { parseSecurityTrails } from '../../src/main/modules/domain/securitytrails'
import subdomains, { parseCertSpotter, parseCrtSh, parseHackerTarget } from '../../src/main/modules/domain/subdomains'
import typosquat, { generateCandidates, splitDomain } from '../../src/main/modules/domain/typosquat'
import urlscan, { parseUrlscan, type UrlscanResult } from '../../src/main/modules/domain/urlscan'
import { modules as vtModules, parseVtDomain, vtUrlId } from '../../src/main/modules/domain/virustotal'
import wayback, { buildWaybackOutput, parseCdx, summarizeSparkline, waybackDate } from '../../src/main/modules/domain/wayback'
import { fakeContext, fixture, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const types = (out: { entities?: Array<{ type: string; label: string }> }, type: string): string[] =>
  (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

describe('utilitaires domaine', () => {
  it('normalise les saisies', () => {
    expect(normalizeDomain('https://www.Example.com/path?x=1')).toBe('example.com')
    expect(normalizeHost('http://user@sub.example.com:8080/')).toBe('sub.example.com')
    expect(normalizeHost('2001:db8::1')).toBe('2001:db8::1')
    expect(normalizeHost('[2001:db8::1]:443')).toBe('2001:db8::1')
  })

  it('reconnaît hébergeurs et fournisseurs DNS', () => {
    expect(detectHosting({ asn: 16276, org: 'OVH SAS' })?.platform).toBe('ovh')
    expect(detectHosting({ asn: 54113, org: 'FASTLY', ips: ['185.199.108.153'] })?.platform).toBe('githubpages')
    expect(detectHosting({ hosts: ['example.netlify.app'], asn: 16509 })?.platform).toBe('netlify')
    expect(detectHosting({ org: 'CLOUDFLARENET - Cloudflare, Inc.' })?.platform).toBe('cloudflare')
    expect(detectHosting({ org: 'Some Small ISP' })).toEqual({ name: 'Some Small ISP', via: 'name' })
    expect(detectDnsProvider(['dns10.ovh.net', 'ns10.ovh.net'])?.platform).toBe('ovh')
    expect(detectDnsProvider(['ada.ns.cloudflare.com'])?.name).toBe('Cloudflare')
  })
})

describe('domain.dns', () => {
  const rec = fixtureJson<DnsRecords>('domain/dns_github.json')

  it('analyse les enregistrements réels de github.com', () => {
    const out = buildDnsOutput('github.com', rec, 'fr')
    // A, puis les adresses isolées du SPF (le bloc 192.30.252.0/22 reste en propriété).
    expect(types(out, 'ip')).toEqual([...rec.A!, '62.253.227.114', '166.78.69.169', '166.78.69.170', '166.78.71.131'])
    expect(out.properties?.spf_ip_ranges).toContain('192.30.252.0/22')
    // Rapports DMARC adressés à github.com lui-même : aucun nœud de plus.
    expect(out.properties?.dmarc_rua).toEqual(['dmarc@github.com'])
    // MX Microsoft 365 et NS NS1 / Route 53 : infrastructure partagée, gardée en propriétés.
    expect(types(out, 'domain')).toEqual([])
    expect(out.properties?.mx).toContain('github-com.mail.protection.outlook.com')
    expect(out.properties?.nameservers).toContain('dns1.p08.nsone.net')
    expect(types(out, 'website')).toEqual(['https://github.com'])
    const tech = types(out, 'technology')
    expect(tech).toContain('Microsoft 365')
    expect(tech).toEqual(expect.arrayContaining(['SendGrid', 'Salesforce', 'Mailchimp', 'Zendesk', 'Marketo']))
    expect(out.properties?.dmarc_policy).toBe('quarantine')
    expect(out.properties?.mail_providers).toEqual(['Microsoft 365'])
    expect((out.properties?.txt_verifications as string[]).some((v) => v.startsWith('Google Search Console:'))).toBe(true)
    expect(out.properties?.dns_provider).toBe('Amazon Route 53')
  })

  it('renvoie un résultat vide pour un domaine sans enregistrement', () => {
    expect(buildDnsOutput('nx.example', {}, 'fr')).toEqual({})
  })

  it('exécute le module via DoH simulé', async () => {
    const dns: Record<string, string[]> = {}
    for (const [type, values] of Object.entries(rec)) dns[type === 'DMARC' ? '_dmarc.github.com|TXT' : `github.com|${type}`] = values as string[]
    const out = await dnsModule.run(entity('domain', 'github.com'), fakeContext({ dns }))
    expect(out.properties?.spf).toMatch(/^v=spf1/)
  })

  it('garde en entités les MX et NS propres au domaine et les NS Cloudflare', () => {
    const out = buildDnsOutput(
      'exemple.fr',
      {
        MX: ['10 mx1.exemple.fr', '20 mta-gw.infomaniak.ch'],
        NS: ['ns11.infomaniak.ch', 'ns1.exemple-dns.fr', 'hera.ns.cloudflare.com']
      },
      'fr'
    )
    expect(types(out, 'domain')).toEqual(['mx1.exemple.fr', 'ns1.exemple-dns.fr', 'hera.ns.cloudflare.com'])
    expect(types(out, 'technology')).toEqual(['Infomaniak Mail'])
    expect(out.properties?.nameservers).toEqual(['ns11.infomaniak.ch', 'ns1.exemple-dns.fr', 'hera.ns.cloudflare.com'])
  })

  it('extrait l’email du SOA et la politique DMARC', () => {
    expect(soaEmail('ns-1707.awsdns-21.co.uk. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400')).toBe('awsdns-hostmaster@amazon.com')
    expect(soaEmail('ns1.example. john\\.doe.example.com. 1 2 3 4 5')).toBe('john.doe@example.com')
    expect(dmarcPolicy('v=DMARC1; p=reject; rua=mailto:x@y.z')).toBe('reject')
    expect(analyzeMail(['10 aspmx.l.google.com'], ['v=spf1 include:_spf.google.com ~all']).mailProviders).toEqual(['Google Workspace'])
  })
})

describe('domain.whois (RDAP)', () => {
  it('lit le registre AFNIC (contacts publics)', () => {
    const out = parseRdap('lemonde.fr', fixtureJson<RdapDomain>('domain/rdap_lemonde.json'), null, 'fr')
    expect(out.properties?.registrar).toBe('NAMESHIELD')
    expect(out.properties?.created_at).toBe('2005-08-02T14:16:36.000Z')
    expect(out.properties?.expires_at).toMatch(/^20\d\d-/)
    expect(types(out, 'organization')).toEqual(expect.arrayContaining(['NAMESHIELD', 'SOCIETE EDITRICE DU MONDE']))
    expect(types(out, 'email')).toContain('domain_names@lemonde.fr')
    expect(types(out, 'phone')).toContain('+33157282224')
    const addr = out.entities?.find((e) => e.type === 'address' && e.label.includes('Pierre Mendes'))
    expect(addr?.data?.city).toBe('PARIS')
  })

  it('ignore les contacts masqués et suit le RDAP du registrar', async () => {
    const ctx = fakeContext({
      routes: {
        'https://rdap.org/domain/github.com': fixtureJson('domain/rdap_github_registry.json'),
        'https://rdap.markmonitor.com/rdap/domain/GITHUB.COM': fixtureJson('domain/rdap_github_registrar.json')
      }
    })
    const out = await rdapModule.run(entity('domain', 'github.com'), ctx)
    expect(ctx.requests).toHaveLength(2)
    expect(out.properties?.registrar).toMatch(/markmonitor/i)
    expect(out.properties?.registrar_abuse_email).toBe('abusecomplaints@markmonitor.com')
    expect(out.properties?.created_at).toBe('2007-10-09T18:20:50.000Z')
    expect((out.properties?.nameservers as string[]).length).toBe(8)
    expect(types(out, 'person')).toEqual([])
    expect(out.entities?.some((e) => /redacted/i.test(e.label))).toBe(false)
  })

  it('remonte au domaine enregistré pour un sous-domaine', async () => {
    const ctx = fakeContext({ routes: { 'https://rdap.org/domain/lemonde.fr': fixtureJson('domain/rdap_lemonde.json') } })
    const out = await rdapModule.run(entity('domain', 'www.mail.lemonde.fr'), ctx)
    expect(ctx.requests[0]).toContain('mail.lemonde.fr')
    expect(out.properties?.registered_domain).toBe('lemonde.fr')
  })

  it('renvoie un résultat vide pour un domaine inconnu', async () => {
    expect(await rdapModule.run(entity('domain', 'nx-domain-test.com'), fakeContext({}))).toEqual({})
  })
})

describe('contacts WHOIS masqués ou génériques', () => {
  it.each(MASKED_WHOIS_VALUES.map((v) => [v]))('« %s » est masqué, quelle que soit la casse', (v) => {
    expect(isMaskedValue(v)).toBe(true)
    expect(isMaskedValue(v.toUpperCase())).toBe(true)
    expect(isMaskedValue(v.replace(/\b\w/g, (c) => c.toUpperCase()))).toBe(true)
  })

  it('reconnaît les formes rencontrées chez les registres et registrars', () => {
    for (const v of [
      '***',
      'J*** D***',
      'xxx',
      '',
      'n/a',
      'REDACTED FOR PRIVACY',
      'Redacted Registrant',
      'Data Protected',
      'Privacy service provided by Withheld for Privacy ehf',
      'Not Disclosed',
      'NON COMMUNIQUÉ',
      'GDPR Masked',
      'Statutory Masking Enabled',
      'Ano Nymous',
      'Anonymous',
      'Contact Privacy Inc. Customer 0123456789',
      'Whois Privacy Protection Service, Inc.',
      'Domains By Proxy, LLC',
      'Please query the RDDS service of the Registrar of Record'
    ])
      expect(isMaskedValue(v), v).toBe(true)
    for (const v of ['Infomaniak Network SA', 'SOCIETE EDITRICE DU MONDE', 'Privacy International', 'Camille Exemple', 'lemonde.fr'])
      expect(isMaskedValue(v), v).toBe(false)
    // Intitulés de fonction : pas un nom de titulaire.
    expect(visibleName('Domain Administrator')).toBeNull()
    expect(visibleName('TECHNICAL department')).toBeNull()
    expect(visibleName('Hostmaster')).toBeNull()
    expect(visibleName('NAMESHIELD')).toBe('NAMESHIELD')
  })

  it('distingue sociétés et personnes', () => {
    for (const v of ['Infomaniak Network SA', 'OVH SAS', 'Gandi S.A.S.', 'Exemple Sàrl', 'MarkMonitor Inc.', 'Example Widgets L.L.C.', 'Hetzner Online GmbH', 'Association des Amis du Rail', 'Mairie de Lyon'])
      expect(isCompanyName(v), v).toBe(true)
    for (const v of ['Camille Exemple', 'Jean de La Fontaine', 'Alex Martin']) {
      expect(isCompanyName(v), v).toBe(false)
      expect(looksLikePerson(v), v).toBe(true)
    }
    expect(looksLikePerson('NAMESHIELD')).toBe(false)
    expect(looksLikePerson('Customer 12345')).toBe(false)
    expect(sameCompany('Infomaniak Network SA', 'Infomaniak')).toBe(true)
    expect(sameCompany('OVH sas', 'OVHcloud')).toBe(false)
    expect(sameCompany('GANDI SAS', 'Gandi')).toBe(true)
    expect(sameCompany('Amazon Registrar, Inc.', 'Amazon Web Services')).toBe(true)
    expect(sameCompany('Camille Exemple', 'Exemple SA')).toBe(false)
    expect(sameCompany('NAMESHIELD', 'SOCIETE EDITRICE DU MONDE')).toBe(false)
  })

  it('choisit le titulaire réel d’une vCard', () => {
    const card = (props: Array<[string, unknown]>, remarks: RdapEntity['remarks'] = []): RdapEntity => ({
      roles: ['registrant'],
      vcardArray: ['vcard', props.map(([k, v]) => [k, {}, 'text', v] as [string, Record<string, unknown>, string, unknown])],
      remarks
    })
    // Raison sociale dans `fn` sans organisation : une organisation, pas une personne.
    expect(contactHolder(parseVcard(card([['fn', 'Infomaniak Network SA']])))).toEqual({ type: 'organization', label: 'Infomaniak Network SA' })
    // Champs inversés (AFNIC) : la personne devient le contact nommé de la société.
    expect(contactHolder(parseVcard(card([['fn', 'Exemple Conseil SAS'], ['org', 'Camille Exemple']])))).toEqual({
      type: 'organization',
      label: 'Exemple Conseil SAS',
      contactName: 'Camille Exemple'
    })
    expect(contactHolder(parseVcard(card([['fn', 'Domain Administrator'], ['org', 'Example Widgets LLC']])))).toEqual({
      type: 'organization',
      label: 'Example Widgets LLC',
      contactName: undefined
    })
    expect(contactHolder(parseVcard(card([['fn', 'Camille Exemple']])))).toEqual({ type: 'person', label: 'Camille Exemple' })
    expect(contactHolder(parseVcard(card([['fn', 'Ano Nymous']])))).toBeNull()
    expect(contactHolder(parseVcard(card([['fn', '***'], ['org', 'REDACTED FOR PRIVACY']])))).toBeNull()
    // Publication restreinte (AFNIC) : le nom affiché n'est pas celui du titulaire.
    const restricted = [{ type: 'contact restricted publication', description: ['YES'] }]
    expect(contactHolder(parseVcard(card([['fn', 'Camille Exemple']], restricted)))).toBeNull()
  })
})

describe('domain.whois : seules les entités du titulaire entrent dans le graphe', () => {
  it('titulaire masqué chez Infomaniak (.fr) : un seul nœud, le registrar, avec ses contacts', () => {
    const out = parseRdap('exemple-masque.fr', fixtureJson<RdapDomain>('domain/rdap_afnic_masked.json'), null, 'fr')
    expect(out.entities).toHaveLength(1)
    const reg = out.entities![0]
    expect(reg).toMatchObject({ type: 'hosting', platform: 'infomaniak', label: 'Infomaniak', linkLabel: 'registrar (et DNS)' })
    expect(reg.data).toMatchObject({
      kind: 'Registrar',
      legal_name: 'Infomaniak Network SA',
      website: 'https://www.infomaniak.com',
      abuse_email: 'abuse@infomaniak.com',
      emails: ['abuse@infomaniak.ch'],
      phones: ['+41228203544']
    })
    // Le fax et les valeurs « *** » ou « Ano Nymous » ne deviennent rien.
    expect(JSON.stringify(out.entities)).not.toMatch(/\*\*\*|Ano Nymous|228203546/)
    expect(out.properties?.whois_contacts).toEqual(['contact technique: Infomaniak Network SA (registrar)', 'titulaire, contact administratif: masqué'])
    expect(out.properties?.registrar).toBe('Infomaniak Network SA')
  })

  it('contact sans nom portant l’email et le téléphone du registrar : rangé chez le registrar', () => {
    const rdap = fixtureJson<RdapDomain>('domain/rdap_afnic_masked.json')
    const tech = rdap.entities!.find((e) => e.roles?.includes('technical'))!
    tech.vcardArray![1] = tech.vcardArray![1].filter(([k]) => k !== 'fn')
    tech.remarks = []
    const out = parseRdap('exemple-masque.fr', rdap, null, 'fr')
    expect(out.entities?.map((e) => e.type)).toEqual(['hosting'])
    expect(out.entities?.[0].data).toMatchObject({ emails: ['abuse@infomaniak.ch'], phones: ['+41228203544'] })
  })

  it('même nœud que celui de l’hébergeur (clé de dédoublonnage identique)', () => {
    const whois = parseRdap('exemple-masque.fr', fixtureJson<RdapDomain>('domain/rdap_afnic_masked.json'), null, 'fr').entities![0]
    const host = buildHostingOutput({ ips: ['185.125.25.1'], cnames: [], nameservers: ['ns11.infomaniak.ch'], asn: 29222, asnHolder: 'INFOMANIAK-AS' }, 'fr').entities![0]
    expect([whois.type, whois.platform, whois.label]).toEqual([host.type, host.platform, host.label])
  })

  it('infomaniak.com (registre Verisign, registrar Infomaniak) : titulaire masqué', async () => {
    const ctx = fakeContext({
      routes: {
        'https://rdap.org/domain/infomaniak.com': fixtureJson('domain/rdap_infomaniak_registry.json'),
        'https://rdap.infomaniak.com/domain/INFOMANIAK.COM': fixtureJson('domain/rdap_infomaniak_registrar.json')
      }
    })
    const out = await rdapModule.run(entity('domain', 'infomaniak.com'), ctx)
    expect(out.entities?.map((e) => [e.type, e.label])).toEqual([['hosting', 'Infomaniak']])
    // Le registre écrit `0041...` : le préfixe international devient `+`.
    expect(out.entities?.[0].data).toMatchObject({
      registrar_iana_id: '3240',
      abuse_email: 'abuse@infomaniak.com',
      abuse_phone: '+41228203541',
      phones: ['+41228203544']
    })
    expect(out.properties?.registrar_abuse_email).toBe('abuse@infomaniak.com')
  })

  it('titulaire public : société, contact nommé, email et adresse ; contact technique d’un hébergeur rangé chez lui', () => {
    const vc = (roles: string[], props: Array<[string, unknown]>): RdapEntity => ({
      roles,
      vcardArray: ['vcard', props.map(([k, v]) => [k, {}, k === 'tel' ? 'uri' : 'text', v] as [string, Record<string, unknown>, string, unknown])]
    })
    const registry: RdapDomain = {
      ldhName: 'exemple-conseil.com',
      nameservers: [{ ldhName: 'ns1.exemple-conseil.com' }],
      entities: [
        vc(['registrar'], [['fn', 'Example Registrar Inc.'], ['email', 'abuse@example-registrar.net']]),
        vc(['registrant'], [['fn', 'Camille Exemple'], ['org', 'Exemple Conseil SAS'], ['email', 'domaines@exemple-conseil.com'], ['adr', ['', '', '1 rue de l’Exemple', 'Lyon', '', '69001', 'FR']]]),
        vc(['administrative'], [['fn', 'Exemple Conseil SAS'], ['email', 'domaines@exemple-conseil.com']]),
        vc(['technical'], [['fn', 'OVH SAS'], ['email', 'tech@ovh.net'], ['tel', 'tel:+33.000000000']]),
        vc(['billing'], [['fn', 'Example Registrar Inc.'], ['email', 'billing@example-registrar.net']])
      ]
    }
    const out = parseRdap('exemple-conseil.com', registry, null, 'fr')
    const byType = (t: string): string[] => types(out, t)
    expect(byType('organization')).toEqual(['Example Registrar Inc.', 'Exemple Conseil SAS'])
    expect(byType('person')).toEqual([])
    expect(byType('email')).toEqual(['domaines@exemple-conseil.com'])
    expect(byType('address')).toHaveLength(1)
    const holder = out.entities?.find((e) => e.label === 'Exemple Conseil SAS')
    expect(holder).toMatchObject({ linkLabel: 'titulaire, contact administratif', data: { contact_name: 'Camille Exemple', country: 'France' } })
    // Contact technique tenu par OVH : nœud hébergeur (dédoublonné avec domain.hosting), coordonnées en propriétés.
    const ovh = out.entities?.find((e) => e.type === 'hosting')
    expect(ovh).toMatchObject({ platform: 'ovh', label: 'OVHcloud', linkLabel: 'contact technique', data: { legal_name: 'OVH SAS', emails: ['tech@ovh.net'] } })
    // Contact facturation tenu par le registrar : rangé dans sa fiche.
    expect(out.entities?.[0].data?.emails).toEqual(['billing@example-registrar.net'])
    expect(byType('phone')).toEqual([])
  })
})

describe('domain.subdomains', () => {
  it('parse Cert Spotter et HackerTarget', () => {
    const names = parseCertSpotter('lemonde.fr', fixtureJson('domain/certspotter_subdomains_lemonde.json'))
    expect(names).toContain('boutique.lemonde.fr')
    expect(names.every((n) => n.endsWith('.lemonde.fr') && !n.includes('*'))).toBe(true)
    const ht = parseHackerTarget('lemonde.fr', fixture('domain/hackertarget_hostsearch_lemonde.txt'))
    expect(ht.names).toContain('80ans.lemonde.fr')
    expect(ht.ips['80ans.lemonde.fr']).toBe('35.210.52.235')
    expect(parseHackerTarget('x.fr', 'error invalid host').names).toEqual([])
  })

  it('parse le JSON crt.sh (format documenté)', () => {
    const rows = [
      { common_name: 'example.com', name_value: 'example.com\n*.example.com\nwww.example.com' },
      { common_name: 'api.example.com', name_value: 'api.example.com\nmail.other.org' }
    ]
    expect(parseCrtSh('example.com', rows)).toEqual(['api.example.com', 'www.example.com'])
  })

  it('garde les autres sources quand crt.sh renvoie 502 (une seule nouvelle tentative)', async () => {
    const names = parseCertSpotter('lemonde.fr', fixtureJson('domain/certspotter_subdomains_lemonde.json'))
    const ctx = fakeContext({
      routes: {
        'https://crt.sh/': { status: 502, body: 'Bad Gateway' },
        'https://api.certspotter.com/v1/issuances': fixtureJson('domain/certspotter_subdomains_lemonde.json')
      },
      // Les quatre premiers noms résolvent encore ; les autres sont morts.
      dns: Object.fromEntries(names.slice(0, 4).map((n) => [`${n}|A`, ['192.0.2.10']]))
    })
    const out = await subdomains.run(entity('domain', 'lemonde.fr'), ctx)
    expect(ctx.requests.filter((r) => r.startsWith('https://crt.sh/'))).toHaveLength(2)
    expect(out.properties?.subdomain_sources).toEqual([`Cert Spotter : ${names.length}`])
    expect(out.properties?.subdomain_sources_failed).toContain('crt.sh : indisponible (HTTP 502)')
    expect(types(out, 'domain')).toEqual(names.slice(0, 4))
    expect(out.properties?.subdomains_unresolved_count).toBe(names.length - 4)
  }, 20000)
})

describe('domain.wayback', () => {
  it('lit les formats CDX et sparkline', () => {
    const rows = [
      ['timestamp', 'original', 'statuscode'],
      ['19970126045828', 'http://www.archive.org:80/', '200']
    ]
    expect(parseCdx(rows)).toEqual([{ timestamp: '19970126045828', original: 'http://www.archive.org:80/', status: '200' }])
    expect(waybackDate('19970126045828')).toBe('1997-01-26T04:58:28.000Z')
    const s = summarizeSparkline({ years: { '2001': [1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0], '2002': Array(12).fill(0) }, first_ts: '20010101000000', last_ts: '20010301000000' })
    expect(s.captures).toBe(3)
    expect(s.years).toEqual(['2001'])
  })

  it('se replie sur l’API « available » d’archive.org', async () => {
    const ctx = fakeContext({ routes: { 'https://archive.org/wayback/available': fixtureJson('domain/wayback_available_lemonde.json') } })
    const out = await wayback.run(entity('domain', 'lemonde.fr'), ctx)
    expect(out.properties?.wayback_last_seen).toBe('2026-10-20T09:23:30.000Z')
    expect(out.properties?.wayback_first_url).toBe('https://web.archive.org/web/20261020092330/https://www.lemonde.fr/')
  })

  it('range les archives en propriétés du domaine, sans nœud web.archive.org', () => {
    const out = buildWaybackOutput('example.org', {
      first: { timestamp: '20020120142510', original: 'http://example.org:80/' },
      last: { timestamp: '20261001000000', original: 'https://example.org/' },
      captures: 1234,
      years: ['2002', '2026']
    })
    expect(out.entities).toBeUndefined()
    expect(out.properties).toEqual({
      wayback_first_seen: '2002-01-20T14:25:10.000Z',
      wayback_first_url: 'https://web.archive.org/web/20020120142510/http://example.org:80/',
      wayback_last_seen: '2026-10-01T00:00:00.000Z',
      wayback_last_url: 'https://web.archive.org/web/20261001000000/https://example.org/',
      wayback_captures: 1234,
      wayback_years: ['2002', '2026'],
      wayback_url: 'https://web.archive.org/web/*/example.org*'
    })
  })
})

describe('domain.hosting', () => {
  it('déduit l’hébergeur et le DNS', () => {
    const out = buildHostingOutput(
      { ips: ['140.82.121.4'], cnames: [], nameservers: ['ns-421.awsdns-52.com'], asn: 36459, asnHolder: 'GITHUB - GitHub, Inc.', country: 'US' },
      'fr'
    )
    expect(out.entities?.map((e) => e.platform)).toEqual(['github_hosting', 'aws'])
    // Nœud de la société (même libellé que pour un site hébergé chez AWS), service dans la fiche du domaine.
    expect(out.entities?.[1].label).toBe('Amazon Web Services')
    expect(out.properties?.dns_provider).toBe('Amazon Route 53')
    expect(out.properties?.hosting_network).toBe('GitHub, Inc.')
  })

  it('interroge RIPEstat pour l’IP du site', async () => {
    const ctx = fakeContext({
      dns: { 'dns.google|A': ['8.8.8.8'], 'dns.google|NS': ['ns1.zdns.google'] },
      routes: {
        'https://stat.ripe.net/data/prefix-overview/': fixtureJson('ip/ripestat_prefix_8.8.8.8.json'),
        'https://stat.ripe.net/data/rir-stats-country/': fixtureJson('ip/ripestat_country_8.8.8.8.json'),
        'https://stat.ripe.net/data/abuse-contact-finder/': fixtureJson('ip/ripestat_abuse_8.8.8.8.json')
      }
    })
    const out = await hostingModule.run(entity('domain', 'dns.google'), ctx)
    expect(out.entities?.[0]).toMatchObject({ type: 'hosting', platform: 'gcp' })
    expect(out.properties?.hosting_asn).toBe('AS15169')
  })
})

describe('domain.hudsonrock', () => {
  it('résume les infections infostealer', () => {
    const out = parseHudsonRockDomain('tesla.com', fixtureJson<HudsonRockDomain>('domain/hudsonrock_tesla.json'), 'fr')
    expect(out.properties?.infostealer_employees).toBeGreaterThan(0)
    expect(out.properties?.infostealer_last_user_at).toMatch(/^\d{4}-/)
    expect(out.entities?.[0].type).toBe('breach')
    expect(parseHudsonRockDomain('x.fr', { total: 0 }, 'fr')).toEqual({})
  })
})

describe('domain.typosquat', () => {
  it('génère des variantes plausibles', () => {
    expect(splitDomain('example.co.uk')).toEqual({ name: 'example', tld: 'co.uk' })
    const c = generateCandidates('google.com').map((x) => x.domain)
    expect(c).toEqual(expect.arrayContaining(['gogle.com', 'gooogle.com', 'g0ogle.com', 'google.fr', 'goolge.com']))
    expect(c).not.toContain('google.com')
  })

  it('ne garde que les variantes enregistrées', async () => {
    const ctx = fakeContext({ dns: { 'gogle.com|NS': ['ns1.example.net'], 'gogle.com|A': ['1.2.3.4'] } })
    const out = await typosquat.run(entity('domain', 'google.com'), ctx)
    expect(types(out, 'domain')).toEqual(['gogle.com'])
  })
})

describe('domain.certificates', () => {
  it('liste les certificats valides du nom', () => {
    const out = parseCertSpotterCerts('lemonde.fr', fixtureJson('domain/certspotter_exact_lemonde.json'), 'fr')
    const cert = out.entities?.[0]
    expect(cert?.type).toBe('certificate')
    expect(cert?.data?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(cert?.data?.not_after).toMatch(/^\d{4}-/)
    expect(certificateHash('x', { sha256: String(cert?.data?.sha256) })).toBe(cert?.data?.sha256)
  })

  it('ne garde que le dernier renouvellement d’un même certificat', () => {
    const cert = (id: string, date: string, names: string[], issuer = "Let's Encrypt") => ({
      id,
      cert_sha256: id.repeat(64).slice(0, 64),
      dns_names: names,
      issuer: { friendly_name: issuer },
      not_before: date,
      not_after: '2027-01-01T00:00:00Z'
    })
    const out = parseCertSpotterCerts(
      'exemple.fr',
      [
        cert('a', '2026-05-01T00:00:00Z', ['exemple.fr', 'www.exemple.fr']),
        cert('b', '2026-07-01T00:00:00Z', ['www.exemple.fr', 'exemple.fr']),
        cert('c', '2026-09-01T00:00:00Z', ['exemple.fr', 'www.exemple.fr']),
        cert('d', '2026-08-01T00:00:00Z', ['*.exemple.fr', 'exemple.fr'], 'Sectigo')
      ],
      'fr'
    )
    expect(out.entities?.map((e) => e.data?.sha256)).toEqual(['c'.repeat(64), 'd'.repeat(64)])
    expect(out.properties?.tls_certificates).toBe(4)
  })

  it('se contente des noms connus si crt.sh échoue', async () => {
    const lookup = certModules.find((m) => m.id === 'certificate.crtsh')!
    const ctx = fakeContext({ routes: { 'https://crt.sh/': { status: 502, body: 'Bad Gateway' } } })
    const input = entity('certificate', 'lemonde.fr (Let’s Encrypt)', { data: { sha256: 'a'.repeat(64), dns_names: ['lemonde.fr', '*.lemonde.fr'] } })
    expect(types(await lookup.run(input, ctx), 'domain')).toEqual(['lemonde.fr'])
  })
})

describe('domain.urlscan', () => {
  it('extrait capture, IP et domaines qui redirigent vers la cible', () => {
    const data = fixtureJson<{ results: UrlscanResult[]; total: number }>('domain/urlscan_lemonde.json')
    const out = parseUrlscan('lemonde.fr', data.results, data.total, 'fr')
    const shot = out.entities?.find((e) => e.type === 'url')
    expect(shot?.image).toMatch(/^https:\/\/urlscan\.io\/screenshots\//)
    expect(types(out, 'ip').length).toBeGreaterThan(0)
    expect(types(out, 'domain')).toContain('peage-reglement-idf.com')
    expect(out.properties?.urlscan_scans).toBe(data.total)
  })
})

describe('services à clé (formats documentés)', () => {
  it('VirusTotal', () => {
    const out = parseVtDomain('example.com', {
      last_analysis_stats: { malicious: 2, suspicious: 0, harmless: 60, undetected: 20 },
      last_analysis_results: { Fortinet: { category: 'malicious', result: 'phishing', engine_name: 'Fortinet' } },
      categories: { Forcepoint: 'phishing' },
      creation_date: 1700000000,
      last_dns_records: [{ type: 'A', value: '93.184.216.34' }]
    })
    expect(out.properties?.vt_malicious).toBe(2)
    expect(out.properties?.vt_detections).toEqual(['Fortinet: phishing'])
    expect(out.properties?.created_at).toBe('2023-11-14T22:13:20.000Z')
    expect(types(out, 'ip')).toEqual(['93.184.216.34'])
    expect(vtUrlId('http://example.com/')).toBe('aHR0cDovL2V4YW1wbGUuY29tLw')
    expect(vtModules.every((m) => m.keys?.[0].id === 'virustotal')).toBe(true)
  })

  it('SecurityTrails', () => {
    const out = parseSecurityTrails(
      'example.com',
      { current_dns: { a: { first_seen: '2020-01-01', values: [{ ip: '1.1.1.1', ip_organization: 'Cloudflare' }] } } },
      { subdomains: ['www', 'mail'], subdomain_count: 2 },
      { records: [{ first_seen: '2015-01-01', last_seen: '2019-12-31', organizations: ['OVH SAS'], values: [{ ip: '5.39.1.1' }] }] },
      'fr'
    )
    expect(types(out, 'ip')).toEqual(['1.1.1.1', '5.39.1.1'])
    expect(types(out, 'domain')).toEqual(['www.example.com', 'mail.example.com'])
    expect(out.properties?.st_past_ips).toEqual(['5.39.1.1'])
  })
})

describe.skipIf(!LIVE)('domaine en direct', () => {
  const ctx = makeContext()
  // Service limité ou injoignable depuis ce réseau (quota, proxy) : test ignoré, pas une régression.
  const liveRun = async (m: Parameters<typeof runModule>[0], value: string, t: { skip: () => void }) => {
    try {
      return await runModule(m, entity('domain', value), ctx)
    } catch (e) {
      if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || /fetch failed/i.test(String(e))) t.skip()
      throw e
    }
  }

  it('domain.dns', async (t) => {
    const out = await liveRun(dnsModule, 'github.com', t)
    expect(out.properties?.mail_providers).toContain('Microsoft 365')
  })

  it('domain.whois', async () => {
    const out = await runModule(rdapModule, entity('domain', 'lemonde.fr'), ctx)
    expect(out.properties?.registrar).toBeTruthy()
  })

  it('domain.whois : registrar Infomaniak, titulaire masqué, un seul nœud', async () => {
    const out = await runModule(rdapModule, entity('domain', 'infomaniak.com'), ctx)
    expect(out.entities?.map((e) => [e.type, e.platform, e.label])).toEqual([['hosting', 'infomaniak', 'Infomaniak']])
  })

  it('domain.subdomains', async (t) => {
    const out = await liveRun(subdomains, 'lemonde.fr', t)
    expect(Number(out.properties?.subdomain_count)).toBeGreaterThan(5)
  }, 200000)

  it('domain.hosting', async () => {
    const out = await runModule(hostingModule, entity('domain', 'ovhcloud.com'), ctx)
    expect(out.entities?.length).toBeGreaterThan(0)
  })

  it('domain.hudsonrock', async () => {
    const out = await runModule(hudsonRock, entity('domain', 'tesla.com'), ctx)
    expect(Number(out.properties?.infostealer_total)).toBeGreaterThan(0)
  })

  it('domain.certificates', async () => {
    const out = await runModule(certModules[0], entity('domain', 'lemonde.fr'), ctx)
    expect(out.entities?.[0]?.type).toBe('certificate')
  })

  it('domain.urlscan', async () => {
    const out = await runModule(urlscan, entity('domain', 'lemonde.fr'), ctx)
    expect(Number(out.properties?.urlscan_scans)).toBeGreaterThan(0)
  })

  it('domain.otx', async (t) => {
    const out = await liveRun(otxModules[0], 'lemonde.fr', t)
    expect(out).toBeTruthy()
  }, 60000)

  it('domain.wayback', async (t) => {
    try {
      const out = await runModule(wayback, entity('domain', 'lemonde.fr'), ctx)
      expect(out.properties?.wayback_last_seen).toBeTruthy()
    } catch (e) {
      // web.archive.org est parfois injoignable ou limité depuis certains réseaux (bac à sable, Tor).
      if (e instanceof ModuleError && (e.code === 'unavailable' || e.code === 'rate_limited')) t.skip()
      else throw e
    }
  }, 90000)

  it('domain.typosquat', async (t) => {
    const out = await liveRun(typosquat, 'paypal.com', t)
    expect(Number(out.properties?.typosquat_checked)).toBeGreaterThan(50)
  }, 120000)
})
