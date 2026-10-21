import { describe, expect, it } from 'vitest'
import { parseOtx, type OtxGeneral, type OtxPassiveDns } from '../../src/main/modules/domain/otx'
import { parseAbuseIpDb } from '../../src/main/modules/ip/abuseipdb'
import asnInfo from '../../src/main/modules/ip/asnInfo'
import cidrInfo, { cidrFacts, compressIPv6 } from '../../src/main/modules/ip/cidrInfo'
import geo, { buildGeoOutput, fromIpApi, fromIpWhoIs, type IpApi, type IpWhoIs } from '../../src/main/modules/ip/geo'
import greynoise, { parseGreyNoise, type GreyNoiseCommunity } from '../../src/main/modules/ip/greynoise'
import internetdb, { cpeToTechnology, parseInternetDb, type InternetDb } from '../../src/main/modules/ip/internetdb'
import reverseDns, { arpaName, expandIPv6 } from '../../src/main/modules/ip/reverseDns'
import reverseIp, { parseReverseIp } from '../../src/main/modules/ip/reverseIp'
import ripestat from '../../src/main/modules/ip/ripestat'
import { modules as shodanModules, parseShodanHost } from '../../src/main/modules/ip/shodan'
import tor, { buildTorOutput, matchRelays, type OnionooRelay } from '../../src/main/modules/ip/tor'
import { parseVtIp } from '../../src/main/modules/ip/virustotal'
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
  it('lit ipwho.is et ip-api.com', () => {
    const g = fromIpWhoIs(fixtureJson<IpWhoIs>('ip/ipwhois_8.8.8.8.json'))
    const flags = fixtureJson<IpApi>('ip/ipapi_8.8.8.8.json')
    const out = buildGeoOutput(g, flags, 'fr')
    expect(out.properties).toMatchObject({ country: 'United States', asn: 'AS15169', isp: 'Google LLC', is_hosting: true, reverse: 'dns.google' })
    expect(typeof out.properties?.lat).toBe('number')
    expect(types(out, 'asn')).toEqual(['AS15169'])
    expect(fromIpApi(flags, '8.8.8.8')?.asn).toBe(15169)
  })

  it('se replie sur ip-api.com et ignore les plages réservées', async () => {
    const ctx = fakeContext({
      routes: { 'https://ipwho.is/': { status: 500, body: 'oops' }, 'http://ip-api.com/json/8.8.8.8': fixtureJson('ip/ipapi_8.8.8.8.json') }
    })
    const out = await geo.run(entity('ip', '8.8.8.8'), ctx)
    expect(out.properties?.geo_source).toBe('ip-api.com')
    const priv = fakeContext({ routes: { 'https://ipwho.is/': { ip: '192.168.1.1', success: false, message: 'Reserved range' } } })
    expect(await geo.run(entity('ip', '192.168.1.1'), priv)).toEqual({})
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
  it('liste les domaines hébergés', () => {
    const out = parseReverseIp(fixture('ip/hackertarget_reverseip.txt'), 'fr')
    expect(types(out, 'domain')).toContain('000.webteknik.fr')
    expect(parseReverseIp('error invalid host', 'fr')).toEqual({})
    expect(() => parseReverseIp('API count exceeded - Increase Quota with Membership', 'fr')).toThrow(/quota/)
  })

  it('exécute le module', async () => {
    const ctx = fakeContext({ routes: { 'https://api.hackertarget.com/reverseiplookup/': fixture('ip/hackertarget_reverseip.txt') } })
    const out = await reverseIp.run(entity('ip', '213.186.33.16'), ctx)
    expect(Number(out.properties?.hosted_domains_count)).toBeGreaterThan(5)
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
    const ctx = fakeContext({ routes: { 'https://api.greynoise.io/': { status: 404, body: { ip: '8.8.8.8', noise: false, riot: false } } } })
    expect(await greynoise.run(entity('ip', '8.8.8.8'), ctx)).toEqual({})
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

describe.skipIf(!LIVE)('IP en direct', () => {
  const ctx = makeContext()

  it('ip.geo', async () => {
    const out = await runModule(geo, entity('ip', '8.8.8.8'), ctx)
    expect(out.properties?.asn).toBe('AS15169')
  })

  it('ip.reverse_dns', async () => {
    const out = await runModule(reverseDns, entity('ip', '8.8.8.8'), ctx)
    expect(out.properties?.reverse).toBe('dns.google')
  })

  it('ip.internetdb', async () => {
    const out = await runModule(internetdb, entity('ip', '1.1.1.1'), ctx)
    expect((out.properties?.ports as string[]).length).toBeGreaterThan(0)
  })

  it('ip.ripestat', async () => {
    const out = await runModule(ripestat, entity('ip', '51.38.0.1'), ctx)
    expect(out.properties?.asn).toBe('AS16276')
  })

  it('asn.info', async () => {
    const out = await runModule(asnInfo, entity('asn', 'AS13335'), ctx)
    expect(out.entities?.[0].platform).toBe('cloudflare')
  })

  it('cidr.info', async () => {
    const out = await runModule(cidrInfo, entity('cidr', '193.70.0.0/17'), ctx)
    expect(out.properties?.asn).toBe('AS16276')
  })

  it('ip.tor', async () => {
    const out = await runModule(tor, entity('ip', '185.220.101.1'), ctx)
    expect(out.properties?.tor_relay).toBe(true)
  })

  it('ip.reverse_ip', async () => {
    const out = await runModule(reverseIp, entity('ip', '213.186.33.16'), ctx)
    expect(Number(out.properties?.hosted_domains_count)).toBeGreaterThan(0)
  })

  it('ip.greynoise', async () => {
    const out = await runModule(greynoise, entity('ip', '185.220.101.1'), ctx)
    expect(out.properties?.greynoise_noise).toBe(true)
  })
})
