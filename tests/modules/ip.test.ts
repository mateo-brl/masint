import { describe, expect, it, type TestContext } from 'vitest'
import { ModuleError } from '@shared/modules'
import { parseOtx, type OtxGeneral, type OtxPassiveDns } from '../../src/main/modules/domain/otx'
import { parseAbuseIpDb } from '../../src/main/modules/ip/abuseipdb'
import asnInfo from '../../src/main/modules/ip/asnInfo'
import cidrInfo, { cidrFacts, compressIPv6 } from '../../src/main/modules/ip/cidrInfo'
import geo, { buildGeoOutput, fromIpInfo, fromIpWhoIs, type IpInfo, type IpWhoIs } from '../../src/main/modules/ip/geo'
import greynoise, { parseGreyNoise, type GreyNoiseCommunity } from '../../src/main/modules/ip/greynoise'
import internetdb, { cpeToTechnology, parseInternetDb, type InternetDb } from '../../src/main/modules/ip/internetdb'
import reverseDns, { arpaName, buildPtrOutput, expandIPv6 } from '../../src/main/modules/ip/reverseDns'
import reverseIp, { parseReverseIp, parseThc, type ThcLookup } from '../../src/main/modules/ip/reverseIp'
import { cymruName, parseCymruOrigin } from '../../src/main/modules/ip/_cymru'
import ripestat, { parseWhois } from '../../src/main/modules/ip/ripestat'
import { modules as shodanModules, parseShodanHost } from '../../src/main/modules/ip/shodan'
import tor, { buildTorOutput, matchRelays, type OnionooRelay } from '../../src/main/modules/ip/tor'
import { parseVtIp } from '../../src/main/modules/ip/virustotal'
import type { Whois } from '../../src/main/modules/ip/_ripestat'
import { fakeContext, fixture, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const types = (out: { entities?: Array<{ type: string; label: string }> }, type: string): string[] =>
  (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

const ripeRoutes = (ip: string): Record<string, object> => ({
  'https://stat.ripe.net/data/prefix-overview/': fixtureJson(`ip/ripestat_prefix_${ip}.json`),
  'https://stat.ripe.net/data/rir-stats-country/': fixtureJson(`ip/ripestat_country_${ip}.json`),
  'https://stat.ripe.net/data/abuse-contact-finder/': fixtureJson(`ip/ripestat_abuse_${ip}.json`)
})

describe('ip.geo', () => {
  it('lit ipwho.is et ipinfo.io', () => {
    const out = buildGeoOutput(fromIpWhoIs(fixtureJson<IpWhoIs>('ip/ipwhois_8.8.8.8.json')), 'fr')
    expect(out.properties).toMatchObject({ country: 'États-Unis', country_code: 'US', asn: 'AS15169', isp: 'Google LLC', geo_source: 'ipwho.is' })
    expect(typeof out.properties?.lat).toBe('number')
    expect(types(out, 'asn')).toEqual(['AS15169'])
    const info = fromIpInfo(fixtureJson<IpInfo>('ip/ipinfo_8.8.8.8.json'), '8.8.8.8')
    expect(info).toMatchObject({ asn: 15169, org: 'Google LLC', country_code: 'US', reverse: 'dns.google', anycast: true, source: 'ipinfo.io' })
    expect(info?.lat).toBeCloseTo(38.0088, 3)
    expect(fromIpInfo({ ip: '10.0.0.1', bogon: true }, '10.0.0.1')).toBeNull()
  })

  it('se replie sur ipinfo.io en HTTPS, sans jamais appeler ip-api.com', async () => {
    const ctx = fakeContext({
      routes: { 'https://ipwho.is/': { status: 500, body: 'oops' }, 'https://ipinfo.io/8.8.8.8/json': fixtureJson('ip/ipinfo_8.8.8.8.json') }
    })
    const out = await geo.run(entity('ip', '8.8.8.8'), ctx)
    expect(out.properties).toMatchObject({ geo_source: 'ipinfo.io', country: 'États-Unis', reverse: 'dns.google', anycast: true, asn: 'AS15169' })
    expect(ctx.requests.every((u) => u.startsWith('https://'))).toBe(true)
    expect(ctx.requests.some((u) => u.includes('ip-api.com'))).toBe(false)
    // Quota mensuel d'ipwho.is (« success: false ») : même repli.
    const quota = fakeContext({
      routes: { 'https://ipwho.is/': { success: false, message: 'You have reached the monthly limit' }, 'https://ipinfo.io/': fixtureJson('ip/ipinfo_8.8.8.8.json') }
    })
    expect((await geo.run(entity('ip', '8.8.8.8'), quota)).properties?.geo_source).toBe('ipinfo.io')
  })

  it('ignore les plages réservées', async () => {
    const priv = fakeContext({ routes: { 'https://ipwho.is/': { ip: '192.168.1.1', success: false, message: 'Reserved range' } } })
    expect(await geo.run(entity('ip', '192.168.1.1'), priv)).toEqual({})
    const bogon = fakeContext({ routes: { 'https://ipwho.is/': { status: 503, body: 'down' }, 'https://ipinfo.io/': { ip: '10.1.2.3', bogon: true } } })
    expect(await geo.run(entity('ip', '10.1.2.3'), bogon)).toEqual({})
  })
})

describe('ip.reverse_dns', () => {
  it('construit les noms arpa', () => {
    expect(arpaName('8.8.4.4')).toBe('4.4.8.8.in-addr.arpa')
    expect(expandIPv6('2001:db8::1')).toBe('2001:0db8:0000:0000:0000:0000:0000:0001')
    expect(arpaName('2001:db8::1')).toBe('1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa')
    expect(arpaName('nope')).toBeNull()
  })

  it('confirme le PTR par résolution directe', async () => {
    const ctx = fakeContext({ dns: { '8.8.8.8.in-addr.arpa|PTR': ['dns.google'], 'dns.google|A': ['8.8.8.8', '8.8.4.4'] } })
    const out = await reverseDns.run(entity('ip', '8.8.8.8'), ctx)
    expect(out.properties).toMatchObject({ reverse: 'dns.google', reverse_confirmed: true })
    expect(types(out, 'domain')).toEqual(['dns.google'])
  })

  it('garde en propriété le nom générique d’une machine d’hébergeur', () => {
    const out = buildPtrOutput(['reverse-proxy-ip-1.infomaniak.ch.', 'ec2-3-5-140-2.eu-west-3.compute.amazonaws.com', 'www.exemple.fr'], {}, 'fr')
    expect(out.properties?.reverse).toBe('reverse-proxy-ip-1.infomaniak.ch')
    expect(types(out, 'domain')).toEqual(['www.exemple.fr'])
  })
})

describe('ip.internetdb', () => {
  it('extrait ports, CVE, CPE et noms d’hôtes', () => {
    const out = parseInternetDb(fixtureJson<InternetDb>('ip/internetdb_scanme.json'), 'fr')
    expect(out.properties?.ports).toEqual(['22', '80', '123', '31337'])
    expect(types(out, 'domain')).toEqual(['scanme.nmap.org'])
    expect(types(out, 'cve').length).toBe(20)
    expect(types(out, 'technology')).toEqual(expect.arrayContaining(['Apache HTTP Server', 'OpenBSD OpenSSH']))
    expect(cpeToTechnology('cpe:/a:apache:http_server:2.4.7')).toEqual({ name: 'Apache HTTP Server', version: '2.4.7', kind: 'Software' })
  })

  it('ne relie pas les noms des machines d’un hébergeur connu', () => {
    const out = parseInternetDb({ ip: '185.125.25.1', hostnames: ['reverse-proxy-ip-1.infomaniak.ch', 'haproxy-site-infomaniak.infomaniak.ch', 'exemple.fr'] }, 'fr')
    expect(types(out, 'domain')).toEqual(['exemple.fr'])
    expect(out.properties?.hostnames).toHaveLength(3)
  })

  it('ne relie pas les clients d’un DNS public', () => {
    const out = parseInternetDb({ ip: '1.1.1.1', hostnames: ['one.one.one.one', 'client-sans-lien.example'] }, 'fr')
    expect(types(out, 'domain')).toEqual([])
    expect(out.properties?.hostnames).toHaveLength(2)
  })

  it('renvoie un résultat vide pour une IP inconnue (404)', async () => {
    const ctx = fakeContext({ routes: { 'https://internetdb.shodan.io/': { status: 404, body: { detail: 'No information available' } } } })
    expect(await internetdb.run(entity('ip', '192.0.2.55'), ctx)).toEqual({})
  })
})

describe('ip.ripestat', () => {
  it('donne ASN, préfixe, contact abus et hébergeur', async () => {
    const out = await ripestat.run(entity('ip', '8.8.8.8'), fakeContext({ routes: ripeRoutes('8.8.8.8') }))
    expect(out.properties).toMatchObject({ asn: 'AS15169', prefix: '8.8.8.0/24' })
    expect(out.properties?.abuse_email).toMatch(/@google\.com$/)
    expect(types(out, 'asn')).toEqual(['AS15169'])
    expect(types(out, 'cidr')).toEqual(['8.8.8.0/24'])
    expect(out.entities?.find((e) => e.type === 'hosting')?.platform).toBe('gcp')
  })

  it('lit la fiche WHOIS du bloc (RIPE et ARIN)', () => {
    const dinum = parseWhois(fixtureJson<{ data: Whois }>('ip/ripestat_whois_185.24.184.86.json').data)
    expect(dinum).toMatchObject({ range: '185.24.184.0/24', netname: 'RIE_184_24', mntBy: ['DISIC-RIE-MNT', 'RIE-RDNS-MNT'], country: 'FR', orgHandle: null })
    const google = parseWhois(fixtureJson<{ data: Whois }>('ip/ripestat_whois_8.8.8.8.json').data)
    expect(google).toMatchObject({ range: '8.8.8.0/24', netname: 'GOGL', orgName: 'Google LLC', country: 'US', created: '2023-12-28' })
    expect(parseWhois(null)).toBeNull()
  })

  it('lit l’origine Team Cymru et garde le préfixe le plus précis', () => {
    expect(cymruName('185.24.184.86')).toBe('86.184.24.185.origin.asn.cymru.com')
    expect(cymruName('2001:4860:4860::8888')).toBe('8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.origin6.asn.cymru.com')
    const o = parseCymruOrigin(['60855 | 185.24.184.0/23 | FR | ripencc | 2013-04-23', '60855 | 185.24.184.0/24 | FR | ripencc | 2013-04-23'])
    expect(o).toEqual({ asn: 60855, prefix: '185.24.184.0/24', country: 'FR', registry: 'ripencc', allocated: '2013-04-23' })
    expect(parseCymruOrigin(['nope'])).toBeNull()
  })

  it('185.24.184.86 : nom du réseau, mainteneur, RPKI et date d’allocation', async () => {
    const ctx = fakeContext({
      routes: {
        'https://stat.ripe.net/data/prefix-overview/': fixtureJson('ip/ripestat_prefix_185.24.184.86.json'),
        'https://stat.ripe.net/data/whois/': fixtureJson('ip/ripestat_whois_185.24.184.86.json'),
        'https://stat.ripe.net/data/rpki-validation/': fixtureJson('ip/ripestat_rpki_60855.json')
      },
      dns: { '86.184.24.185.origin.asn.cymru.com|TXT': ['60855 | 185.24.184.0/23 | FR | ripencc | 2013-04-23', '60855 | 185.24.184.0/24 | FR | ripencc | 2013-04-23'] }
    })
    const out = await ripestat.run(entity('ip', '185.24.184.86'), ctx)
    expect(out.properties).toMatchObject({
      asn: 'AS60855',
      netname: 'RIE_184_24',
      netblock: '185.24.184.0/24',
      mnt_by: ['DISIC-RIE-MNT', 'RIE-RDNS-MNT'],
      netblock_country: 'France',
      allocation_date: '2013-04-23',
      rpki_status: 'valid'
    })
    expect(ctx.requests.find((u) => u.includes('rpki-validation'))).toContain('resource=AS60855')
    expect(ctx.requests.find((u) => u.includes('rpki-validation'))).toContain('prefix=185.24.184.0%2F24')
    // Pas d'organisation déclarée dans le bloc : aucune entité organisation.
    expect(types(out, 'organization')).toEqual([])
  })

  it('un titulaire qui n’est pas un hébergeur devient une organisation (AFNIC)', async () => {
    const ctx = fakeContext({
      routes: {
        'https://stat.ripe.net/data/prefix-overview/': fixtureJson('ip/ripestat_prefix_192.134.5.37.json'),
        'https://stat.ripe.net/data/whois/': fixtureJson('ip/ripestat_whois_192.134.5.37.json'),
        'https://stat.ripe.net/data/rpki-validation/': fixtureJson('ip/ripestat_rpki_2485.json'),
        'https://rest.db.ripe.net/ripe/organisation/ORG-AFpl1-RIPE.json': fixtureJson('ip/ripe_org_afnic.json')
      }
    })
    const out = await ripestat.run(entity('ip', '192.134.5.37'), ctx)
    const holder = 'AFNIC (Association Francaise pour le Nommage Internet en Cooperation)'
    expect(types(out, 'organization')).toEqual([holder])
    // Même nom que le détenteur de l'AS : pas de second nœud « hébergeur » en double.
    expect(types(out, 'hosting')).toEqual([])
    expect(out.properties).toMatchObject({ netname: 'NIC-FR-SITES-SQY-TH3', netblock_org: holder, mnt_by: ['FR-NIC-MNT'], rpki_status: 'unknown' })
  })

  it('un hébergeur connu reste un hébergeur (ARIN, Google)', async () => {
    const ctx = fakeContext({ routes: { ...ripeRoutes('8.8.8.8'), 'https://stat.ripe.net/data/whois/': fixtureJson('ip/ripestat_whois_8.8.8.8.json') } })
    const out = await ripestat.run(entity('ip', '8.8.8.8'), ctx)
    expect(types(out, 'organization')).toEqual([])
    expect(out.properties).toMatchObject({ netname: 'GOGL', netblock_org: 'Google LLC' })
  })
})

describe('asn.info', () => {
  it('liste les préfixes annoncés et reconnaît OVH', async () => {
    const ctx = fakeContext({
      routes: {
        'https://stat.ripe.net/data/as-overview/': fixtureJson('ip/ripestat_as_16276.json'),
        'https://stat.ripe.net/data/announced-prefixes/': fixtureJson('ip/ripestat_announced_16276.json'),
        'https://stat.ripe.net/data/rir-stats-country/': fixtureJson('ip/ripestat_country_16276.json'),
        'https://stat.ripe.net/data/abuse-contact-finder/': fixtureJson('ip/ripestat_abuse_16276.json')
      }
    })
    const out = await asnInfo.run(entity('asn', 'AS16276'), ctx)
    expect(out.properties).toMatchObject({ name: 'OVH SAS', country: 'France', abuse_email: 'abuse@ovh.net' })
    expect(out.entities?.[0]).toMatchObject({ type: 'hosting', platform: 'ovh' })
    expect(types(out, 'cidr').length).toBe(30)
    expect(Number(out.properties?.ipv4_addresses)).toBeGreaterThan(0)
  })
})

describe('cidr.info', () => {
  it('calcule l’étendue sans énumérer', () => {
    expect(cidrFacts('193.70.12.34/17')).toMatchObject({ prefix: '193.70.0.0/17', first: '193.70.0.0', last: '193.70.127.255', size: '32768' })
    expect(cidrFacts('2001:db8:abcd::/48')).toMatchObject({ first: '2001:db8:abcd::', last: '2001:db8:abcd:ffff:ffff:ffff:ffff:ffff', size: String(2n ** 80n) })
    expect(compressIPv6(['2001', 'db8', '0', '0', '1', '0', '0', '1'])).toBe('2001:db8::1:0:0:1')
    expect(cidrFacts('1.2.3.4/40')).toBeNull()
  })

  it('ajoute ASN et géolocalisation dominante', async () => {
    const ctx = fakeContext({
      routes: {
        'https://stat.ripe.net/data/prefix-overview/': fixtureJson('ip/ripestat_prefix_193.70.0.0_17.json'),
        'https://stat.ripe.net/data/maxmind-geo-lite/': fixtureJson('ip/ripestat_geolite_193.70.0.0_17.json'),
        'https://stat.ripe.net/data/abuse-contact-finder/': fixtureJson('ip/ripestat_abuse_16276.json')
      }
    })
    const out = await cidrInfo.run(entity('cidr', '193.70.0.0/17'), ctx)
    expect(out.properties).toMatchObject({ asn: 'AS16276', country: 'France', size: 32768 })
    expect(typeof out.properties?.lat).toBe('number')
    expect(out.entities?.find((e) => e.type === 'hosting')?.platform).toBe('ovh')
  })
})

describe('ip.tor', () => {
  it('ne garde que les relais de l’IP exacte (Onionoo cherche par préfixe)', () => {
    const relays = fixtureJson<{ relays: OnionooRelay[] }>('ip/onionoo_185.220.101.1.json').relays
    const matched = matchRelays('185.220.101.1', relays)
    expect(matched.length).toBe(2)
    const out = buildTorOutput('185.220.101.1', matched, null, 'fr')
    expect(out.properties).toMatchObject({ tor_relay: true, tor_exit: true })
    expect(buildTorOutput('8.8.8.8', [], false, 'fr')).toEqual({})
  })

  it('se replie sur la liste officielle des sorties', async () => {
    const ctx = fakeContext({
      routes: { 'https://onionoo.torproject.org/': { status: 503, body: 'down' }, 'https://check.torproject.org/torbulkexitlist': '1.2.3.4\n185.220.101.1\n' }
    })
    const out = await tor.run(entity('ip', '185.220.101.1'), ctx)
    expect(out.properties).toMatchObject({ tor_exit: true, tor_source: 'check.torproject.org' })
  })
})

describe('ip.reverse_ip', () => {
  it('liste les domaines hébergés (HackerTarget)', () => {
    const out = parseReverseIp(fixture('ip/hackertarget_reverseip.txt'), 'fr')
    expect(types(out, 'domain')).toContain('000.webteknik.fr')
    expect(out.properties?.hosted_domains_source).toBe('HackerTarget')
    expect(parseReverseIp('error invalid host', 'fr')).toEqual({})
    expect(() => parseReverseIp('API count exceeded - Increase Quota with Membership', 'fr')).toThrow(/quota/)
  })

  it('lit ip.thc.org : domaines sans doublons et total', () => {
    // 52 enregistrements pour 22 domaines : un enregistrement par extension vue.
    const cnil = parseThc(fixtureJson<ThcLookup>('ip/thc_lookup_185.24.184.86.json'))
    expect(cnil.domains).toHaveLength(22)
    expect(cnil.total).toBe(22)
    expect(cnil.domains.every((d) => d.endsWith('cnil.fr'))).toBe(true)
    // Plusieurs pages : le total vient de `matching_records`.
    expect(parseThc(fixtureJson<ThcLookup>('ip/thc_lookup_mutualise.json'))).toMatchObject({ total: 4321 })
    expect(parseThc({ matching_records: 0, count_unavailable: true, domains: [], next_page_state: '' })).toEqual({ domains: [], total: 0 })
  })

  it('interroge ip.thc.org d’abord, sans consommer le quota HackerTarget', async () => {
    const ctx = fakeContext({ routes: { 'https://ip.thc.org/api/v1/lookup': fixtureJson('ip/thc_lookup_185.24.184.86.json') } })
    const out = await reverseIp.run(entity('ip', '185.24.184.86'), ctx)
    expect(types(out, 'domain')).toHaveLength(10)
    expect(out.entities?.some((e) => e.review)).toBe(false)
    expect(out.properties).toMatchObject({ hosted_domains_count: 22, hosted_domains_source: 'ip.thc.org' })
    expect(ctx.requests.some((u) => u.includes('hackertarget'))).toBe(false)
  })

  it('hébergement mutualisé d’après le total de ip.thc.org : voisins à vérifier', async () => {
    const ctx = fakeContext({ routes: { 'https://ip.thc.org/api/v1/lookup': fixtureJson('ip/thc_lookup_mutualise.json') } })
    const out = await reverseIp.run(entity('ip', '203.0.113.10'), ctx)
    expect(out.properties).toMatchObject({ hosted_domains_count: 4321, shared_infrastructure: 'hébergement mutualisé (4321 domaines)' })
    expect(out.entities).toHaveLength(10)
    expect(out.entities?.every((e) => e.review && /mutualisé/.test(e.reviewReason ?? ''))).toBe(true)
  })

  it('se replie sur HackerTarget si ip.thc.org ne répond pas', async () => {
    const ctx = fakeContext({
      routes: {
        'https://ip.thc.org/': { status: 429, body: 'Too Many Requests' },
        'https://api.hackertarget.com/reverseiplookup/': fixture('ip/hackertarget_reverseip.txt')
      }
    })
    const out = await reverseIp.run(entity('ip', '213.186.33.16'), ctx)
    expect(Number(out.properties?.hosted_domains_count)).toBeGreaterThan(5)
    expect(out.properties?.hosted_domains_source).toBe('HackerTarget')
    // 404 de ip.thc.org : aucun domaine connu, pas de repli.
    const none = fakeContext({ routes: { 'https://ip.thc.org/': { status: 404, body: 'none' } } })
    expect(await reverseIp.run(entity('ip', '203.0.113.11'), none)).toEqual({})
    expect(none.requests.some((u) => u.includes('hackertarget'))).toBe(false)
  })
})

describe('ip.otx', () => {
  it('résume pulses et DNS passif', () => {
    const out = parseOtx(
      '213.186.33.16',
      'ip',
      fixtureJson<OtxGeneral>('ip/otx_general_185.220.101.1.json'),
      fixtureJson<OtxPassiveDns>('ip/otx_pdns_213.186.33.16.json'),
      'fr'
    )
    expect(Number(out.properties?.otx_pulses)).toBeGreaterThan(0)
    expect(types(out, 'domain')).toContain('wiame-vrd.fr')
    expect(out.entities?.[0].data?.last_seen).toMatch(/^\d{4}-/)
  })
})

describe('ip.greynoise', () => {
  it('lit la réponse community', async () => {
    const out = parseGreyNoise(fixtureJson<GreyNoiseCommunity>('ip/greynoise_185.220.101.1.json'))
    expect(out.properties).toMatchObject({ greynoise_noise: true, greynoise_classification: 'malicious' })
    // 404 « non observée » : on le dit, sans affirmer que l'IP est hors RIOT (non renseigné sans clé).
    const ctx = fakeContext({ routes: { 'https://api.greynoise.io/': { status: 404, body: { ip: '8.8.8.8', noise: false, riot: false } } } })
    expect((await greynoise.run(entity('ip', '8.8.8.8'), ctx)).properties).toEqual({ greynoise_noise: false, greynoise_link: 'https://viz.greynoise.io/ip/8.8.8.8' })
  })
})

describe('services à clé (formats documentés)', () => {
  it('Shodan host', () => {
    const out = parseShodanHost(
      {
        ip_str: '1.2.3.4',
        ports: [22, 443],
        hostnames: ['host.example.com'],
        org: 'Example',
        vulns: ['CVE-2023-1234'],
        data: [
          { port: 443, transport: 'tcp', product: 'nginx', version: '1.18.0', _shodan: { module: 'https' }, http: { title: 'Hello' }, vulns: { 'CVE-2023-1234': { cvss: 9.8, summary: 'RCE' } } },
          { port: 22, transport: 'tcp', product: 'OpenSSH', data: 'SSH-2.0-OpenSSH_8.2' }
        ]
      },
      'fr'
    )
    expect(types(out, 'service')).toEqual(['1.2.3.4:22/OpenSSH', '1.2.3.4:443/https'])
    expect(out.entities?.find((e) => e.type === 'cve')?.data).toMatchObject({ cvss: 9.8 })
    expect(shodanModules.map((m) => m.id)).toEqual(['ip.shodan', 'domain.shodan'])
  })

  it('AbuseIPDB et VirusTotal', () => {
    const a = parseAbuseIpDb(
      { ipAddress: '1.2.3.4', abuseConfidenceScore: 87, totalReports: 12, reports: [{ categories: [14, 18], comment: 'SSH brute force' }], isTor: false },
      'fr'
    )
    expect(a.properties).toMatchObject({ abuse_score: 87, abuse_reports: 12, abuse_categories: ['Port Scan', 'Brute-Force'] })
    const v = parseVtIp('1.2.3.4', { asn: 16276, as_owner: 'OVH SAS', last_analysis_stats: { malicious: 1 } }, 'fr')
    expect(types(v, 'asn')).toEqual(['AS16276'])
    expect(v.properties?.vt_malicious).toBe(1)
  })
})

/**
 * Test en direct : un quota atteint, un service en panne ou un réseau injoignable (proxy du bac à
 * sable) n'est pas une régression du module, le test est sauté.
 */
async function live(t: TestContext, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const unreachable = e instanceof Error && /fetch failed|injoignable|ECONNRESET|ETIMEDOUT|aborted|timeout/i.test(e.message)
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || unreachable) t.skip()
    else throw e
  }
}

describe.skipIf(!LIVE)('IP en direct', () => {
  const ctx = makeContext()

  it('ip.geo', (t) =>
    live(t, async () => {
      const out = await runModule(geo, entity('ip', '8.8.8.8'), ctx)
      expect(out.properties?.asn).toBe('AS15169')
    }))

  it('ip.reverse_dns', (t) =>
    live(t, async () => {
      const out = await runModule(reverseDns, entity('ip', '8.8.8.8'), ctx)
      expect(out.properties?.reverse).toBe('dns.google')
    }))

  it('ip.internetdb', (t) =>
    live(t, async () => {
      const out = await runModule(internetdb, entity('ip', '1.1.1.1'), ctx)
      expect((out.properties?.ports as string[]).length).toBeGreaterThan(0)
    }))

  it('ip.ripestat', (t) =>
    live(t, async () => {
      const out = await runModule(ripestat, entity('ip', '51.38.0.1'), ctx)
      expect(out.properties?.asn).toBe('AS16276')
      expect(out.properties?.netname).toBeTruthy()
    }))

  it('ip.ripestat : WHOIS, RPKI et allocation de 185.24.184.86', (t) =>
    live(t, async () => {
      const out = await runModule(ripestat, entity('ip', '185.24.184.86'), ctx)
      expect(out.properties).toMatchObject({ netname: 'RIE_184_24', allocation_date: '2013-04-23' })
      expect(out.properties?.mnt_by).toContain('DISIC-RIE-MNT')
      expect(out.properties?.rpki_status).toBeTruthy()
    }), 60000)

  it('asn.info', (t) =>
    live(t, async () => {
      const out = await runModule(asnInfo, entity('asn', 'AS13335'), ctx)
      expect(out.entities?.[0].platform).toBe('cloudflare')
    }))

  it('cidr.info', (t) =>
    live(t, async () => {
      const out = await runModule(cidrInfo, entity('cidr', '193.70.0.0/17'), ctx)
      expect(out.properties?.asn).toBe('AS16276')
    }))

  it('ip.tor', (t) =>
    live(t, async () => {
      const out = await runModule(tor, entity('ip', '185.220.101.1'), ctx)
      expect(out.properties?.tor_relay).toBe(true)
    }))

  it('ip.reverse_ip (ip.thc.org)', (t) =>
    live(t, async () => {
      const out = await runModule(reverseIp, entity('ip', '185.24.184.86'), ctx)
      expect(Number(out.properties?.hosted_domains_count)).toBeGreaterThanOrEqual(10)
      expect(types(out, 'domain').every((d) => d.endsWith('cnil.fr'))).toBe(true)
    }))

  it('ip.reverse_ip (mutualisé)', (t) =>
    live(t, async () => {
      const out = await runModule(reverseIp, entity('ip', '213.186.33.16'), ctx)
      expect(Number(out.properties?.hosted_domains_count)).toBeGreaterThan(100)
    }))

  it('ip.greynoise', (t) =>
    live(t, async () => {
      const out = await runModule(greynoise, entity('ip', '185.220.101.1'), ctx)
      expect(out.properties?.greynoise_noise).toBe(true)
    }))
})
