// Défauts de données relevés par les testeurs : null MX, bruit des listes passives,
// homonymes, noms de pays, formatage d'adresse, clés de propriétés, GreyNoise,
// Hudson Rock, blocages anti-robot et Eventbrite.

import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import { inCidr, sharedInfrastructure } from '../../src/main/modules/domain/_hosting'
import { parseMx, parseMxRecord } from '../../src/main/modules/domain/_mail'
import { cappedList, countryCodeFromName, localizeCountry } from '../../src/main/modules/domain/_util'
import dnsModule, { buildDnsOutput, type DnsRecords } from '../../src/main/modules/domain/dnsRecords'
import hudsonRock, { hudsonRockDomainError } from '../../src/main/modules/domain/hudsonRock'
import { parseOtx, type OtxGeneral, type OtxPassiveDns } from '../../src/main/modules/domain/otx'
import { parseUrlscan, type UrlscanResult } from '../../src/main/modules/domain/urlscan'
import { eventbriteOrigin, modules as accountModules } from '../../src/main/modules/email/accounts'
import emailInfo from '../../src/main/modules/email/info'
import { buildGeoOutput, fromIpWhoIs, type IpWhoIs } from '../../src/main/modules/ip/geo'
import greynoise, { parseGreyNoise, type GreyNoiseCommunity } from '../../src/main/modules/ip/greynoise'
import { parseReverseIp } from '../../src/main/modules/ip/reverseIp'
import { parseGeopf } from '../../src/main/modules/location/_geo'
import { reverseOutput } from '../../src/main/modules/location/reverse'
import frDirigeants, { companiesFor, mandateConsistency, parsePartialDate, selectMandates, type ReResponse } from '../../src/main/modules/person/frDirigeants'
import kick from '../../src/main/modules/social/kick'
import reddit from '../../src/main/modules/social/reddit'
import { blockedError, rethrow } from '../../src/main/modules/social/_lib'
import { fakeContext, fixture, fixtureJson } from '../fixtures/domain/_fake'
import { entity } from '../helpers/context'
import { fakeContext as routeContext, type Route } from './social_helpers'

const labels = (out: { entities?: Array<{ type: string; label: string }> }, type: string): string[] =>
  (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

describe('null MX (RFC 7505)', () => {
  it('analyse « priorité hôte » et reconnaît l’hôte vide ou « . »', () => {
    // Le résolveur DoH retire le point final : « 0 . » arrive sous la forme « 0 ».
    expect(parseMxRecord('0 ')).toEqual({ priority: 0, host: '' })
    expect(parseMxRecord('0 .')).toEqual({ priority: 0, host: '' })
    expect(parseMxRecord('0')).toEqual({ priority: 0, host: '' })
    expect(parseMxRecord('10 ASPMX.L.Google.com.')).toEqual({ priority: 10, host: 'aspmx.l.google.com' })
    expect(parseMx(['0 '])).toEqual({ hosts: [], nullMx: true })
    expect(parseMx(['20 b.example.net', '5 a.example.net', '20 b.example.net']).hosts.map((h) => h.host)).toEqual(['a.example.net', 'b.example.net'])
  })

  it('domain.dns sur les enregistrements réels de example.com', () => {
    const rec = fixtureJson<DnsRecords>('domain/dns_example.json')
    expect(rec.MX).toEqual(['0 '])
    const out = buildDnsOutput('example.com', rec, 'fr')
    expect(labels(out, 'domain')).not.toContain('0')
    expect(out.entities?.some((e) => e.linkLabel === 'MX')).toBe(false)
    expect(out.properties?.mx).toBeUndefined()
    expect(out.properties?.mx_null).toBe(true)
    expect(out.properties?.spf).toBe('v=spf1 -all')
    expect(labels(out, 'domain')).toEqual(['hera.ns.cloudflare.com', 'elliott.ns.cloudflare.com'])
  })

  it('domain.dns : la propriété mx ne garde que les hôtes, par priorité', async () => {
    const dns = { 'example.org|MX': ['20 mx2.example.net', '10 mx1.example.net'] }
    const out = await dnsModule.run(entity('domain', 'example.org'), fakeContext({ dns }))
    expect(out.properties?.mx).toEqual(['mx1.example.net', 'mx2.example.net'])
    expect(out.properties?.mx_null).toBeUndefined()
  })

  it('email.info : null MX sans entité ni « 0 »', async () => {
    const ctx = fakeContext({ dns: { 'example.com|MX': ['0 '], 'example.com|TXT': ['v=spf1 -all'] } })
    const out = await emailInfo.run(entity('email', 'jean.dupont@example.com'), ctx)
    expect(out.properties).toMatchObject({ valid_mx: false, mx_null: true, domain_exists: true })
    expect(out.properties?.mx).toBeUndefined()
    const domain = out.entities?.find((e) => e.type === 'domain')
    expect(domain?.data).toEqual({ mx_null: true })
    expect(JSON.stringify(out.properties)).not.toMatch(/"0"/)
  })
})

describe('infrastructures partagées', () => {
  it('reconnaît CDN, DNS publics et adresses réservées', () => {
    expect(inCidr('104.20.23.154', '104.16.0.0/13')).toBe(true)
    expect(inCidr('104.24.0.1', '104.16.0.0/13')).toBe(false)
    expect(inCidr('2606:4700:10::6814:179a', '2606:4700::/32')).toBe(true)
    expect(inCidr('::ffff:1.2.3.4', '2606:4700::/32')).toBe(false)
    expect(sharedInfrastructure('8.8.8.8')).toEqual({ name: 'Google Public DNS', kind: 'public_dns' })
    expect(sharedInfrastructure('172.66.147.243')).toEqual({ name: 'Cloudflare', kind: 'cdn' })
    expect(sharedInfrastructure('2606:4700:10::ac42:93f3')?.name).toBe('Cloudflare')
    expect(sharedInfrastructure('151.101.1.69')?.name).toBe('Fastly')
    expect(sharedInfrastructure('23.40.0.1')?.name).toBe('Akamai')
    expect(sharedInfrastructure('192.168.1.10')?.kind).toBe('reserved')
    expect(sharedInfrastructure('213.186.33.16')).toBeNull()
    expect(sharedInfrastructure('203.0.113.9', { asn: 'AS20940' })?.name).toBe('Akamai')
    expect(sharedInfrastructure('203.0.113.9', { asn: 'AS16276 OVH SAS' })).toBeNull()
    expect(sharedInfrastructure('203.0.113.9', { asn: 'AS63949', org: 'Akamai Connected Cloud' })).toBeNull()
    expect(sharedInfrastructure('203.0.113.9', { org: 'Cloudflare, Inc.' })?.kind).toBe('cdn')
  })

  it('plafonne les listes de la fiche avec le total', () => {
    const list = Array.from({ length: 120 }, (_, i) => `d${i}.example`)
    const p = cappedList('hosted_domains', list)
    expect((p.hosted_domains as string[]).length).toBe(50)
    expect(p.hosted_domains_count).toBe(120)
    expect(cappedList('x', [])).toEqual({})
  })
})

describe('ip.otx : DNS passif', () => {
  const pdns8 = fixtureJson<OtxPassiveDns>('ip/otx_pdns_8.8.8.8.json')

  it('aucune entité pour 8.8.8.8 (DNS public), liste plafonnée en propriété', () => {
    const out = parseOtx('8.8.8.8', 'ip', null, pdns8, 'fr')
    expect(out.entities).toEqual([])
    expect(out.properties?.shared_infrastructure).toBe('Google Public DNS')
    expect((out.properties?.otx_hostnames as string[]).length).toBe(50)
    expect(Number(out.properties?.otx_hostnames_count)).toBeGreaterThan(50)
    expect(out.properties?.otx_passive_dns_count).toBe(500)
  })

  it('au plus 10 domaines, les plus récents d’abord, pour une IP ordinaire', () => {
    const real = fixtureJson<OtxPassiveDns>('ip/otx_pdns_213.186.33.16.json')
    // Hébergement mutualisé OVH : les lignes réelles sont complétées pour dépasser le plafond.
    const extra = Array.from({ length: 30 }, (_, i) => ({ hostname: `old${i}.example.fr`, address: '213.186.33.16', first: '2019-01-01T00:00:00', last: `2019-02-${String(i % 28 + 1).padStart(2, '0')}T00:00:00` }))
    const pdns = { ...real, passive_dns: [...extra, ...(real.passive_dns ?? [])] }
    const out = parseOtx('213.186.33.16', 'ip', null, pdns, 'fr')
    expect(out.entities!.length).toBe(10)
    const seen = out.entities!.map((e) => String(e.data?.last_seen))
    expect([...seen].sort().reverse()).toEqual(seen)
    const latest = [...(pdns.passive_dns ?? [])].sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''))[0]
    expect(out.entities![0].label).toBe(latest.hostname)
  })

  it('reconnaît un CDN par l’ASN connu de l’entité', () => {
    const rows = { count: 2, passive_dns: [{ hostname: 'a.example', last: '2026-01-01' }, { hostname: 'b.example', last: '2026-01-02' }] }
    expect(parseOtx('203.0.113.9', 'ip', null, rows, 'fr', { asn: 'AS13335' }).entities).toEqual([])
    expect(parseOtx('203.0.113.9', 'ip', null, rows, 'fr').entities).toHaveLength(2)
  })

  it('domaine en liste blanche OTX (example.com) : pas de tags ni familles de malware', () => {
    const general = fixtureJson<OtxGeneral>('domain/otx_general_example.json')
    const out = parseOtx('example.com', 'domain', general, null, 'fr')
    expect(out.properties?.otx_whitelisted).toBe(true)
    expect(out.properties?.otx_tags).toBeUndefined()
    expect(out.properties?.otx_malware_families).toBeUndefined()
    expect((out.properties?.otx_pulse_names as string[]).length).toBeLessThanOrEqual(5)
    expect(out.properties?.otx_pulses).toBe(50)
  })
})

describe('urlscan : pages de la cible seulement', () => {
  const data = fixtureJson<{ results: UrlscanResult[]; total: number }>('domain/urlscan_example.json')

  it('ignore les pages tierces qui chargent une ressource de example.com', () => {
    // La recherche « domain: » enregistrée mêle yahoo.com, britannica.com... à example.com.
    expect(data.results.some((r) => r.page?.domain === 'www.yahoo.com')).toBe(true)
    const out = parseUrlscan('example.com', data.results, data.total, 'fr')
    const ips = labels(out, 'ip')
    expect(ips.length).toBeGreaterThan(0)
    expect(ips.length).toBeLessThanOrEqual(10)
    expect(ips.every((ip) => sharedInfrastructure(ip)?.name === 'Cloudflare')).toBe(true)
    expect(ips.some((ip) => ip.startsWith('69.147.'))).toBe(false)
    const ipEntity = out.entities!.find((e) => e.type === 'ip')!
    expect(ipEntity.data?.shared_infrastructure).toBe('Cloudflare (CDN)')
    const redirecting = labels(out, 'domain')
    expect(redirecting.length).toBeLessThanOrEqual(10)
    expect(redirecting).not.toContain('www.yahoo.net')
    expect(out.entities!.find((e) => e.type === 'url')?.label).toMatch(/^https?:\/\/(www\.)?example\.com/)
  })

  it('IP de CDN : sites observés en propriété, pas en entités', () => {
    const onIp = data.results.filter((r) => r.page?.ip === '172.66.147.243')
    const out = parseUrlscan('172.66.147.243', onIp, onIp.length, 'fr', true)
    expect(labels(out, 'domain')).toEqual([])
    expect(out.properties?.shared_infrastructure).toBe('Cloudflare (CDN)')
    expect(out.properties?.urlscan_domains).toContain('example.com')
  })
})

describe('ip.reverse_ip', () => {
  const text = Array.from({ length: 120 }, (_, i) => `site${i}.example.fr`).join('\n')

  it('10 entités au plus, 50 domaines dans la fiche avec le total', () => {
    const out = parseReverseIp(text, 'fr', '213.186.33.16')
    expect(out.entities).toHaveLength(10)
    expect((out.properties?.hosted_domains as string[]).length).toBe(50)
    expect(out.properties?.hosted_domains_count).toBe(120)
    // 120 domaines : hébergement mutualisé, les voisins attendent dans « À vérifier ».
    expect(out.entities?.every((e) => e.review && /mutualisé/.test(e.reviewReason ?? ''))).toBe(true)
    expect(out.properties?.shared_infrastructure).toBe('hébergement mutualisé (120 domaines)')
  })

  it('quelques domaines sur une IP dédiée : entités directes', () => {
    const out = parseReverseIp('free.fr\naliceadsl.fr\nfree-infra.fr', 'fr', '212.27.48.10')
    expect(out.entities?.map((e) => [e.label, !!e.review])).toEqual([
      ['free.fr', false],
      ['aliceadsl.fr', false],
      ['free-infra.fr', false]
    ])
    expect(out.properties?.shared_infrastructure).toBeUndefined()
  })

  it('aucune entité pour une IP Cloudflare', () => {
    const out = parseReverseIp(text, 'fr', '104.16.1.1')
    expect(out.entities).toEqual([])
    expect(out.properties?.shared_infrastructure).toBe('Cloudflare (CDN)')
  })
})

describe('person.fr_dirigeants : homonymes de Marie Curie', () => {
  const pages = fixtureJson<ReResponse[]>('person/recherche_entreprises_curie.json')
  const results = pages.flatMap((p) => p.results)
  const name = { firstNames: ['Marie'], lastName: 'Curie' }
  const routes = (): Route[] => [
    [/recherche-entreprises\.api\.gouv\.fr\/search/, (url) => ({ body: /[?&]page=2(&|$)/.test(url) ? pages[1] : pages[0] })]
  ]

  it('lit les dates partielles', () => {
    expect(parsePartialDate('1867-11-07')).toEqual({ year: 1867, month: 11, day: 7 })
    expect(parsePartialDate('1867')).toEqual({ year: 1867, month: undefined, day: undefined })
    expect(parsePartialDate('07/11/1867')).toEqual({ year: 1867, month: 11, day: 7 })
    expect(parsePartialDate('11/1867')).toEqual({ year: 1867, month: 11, day: undefined })
    expect(parsePartialDate('inconnue')).toBeNull()
  })

  it('sans date connue : 10 entreprises au plus, toutes à vérifier (homonyme possible)', () => {
    const { kept } = selectMandates(results, name)
    expect(kept.length).toBeGreaterThan(10)
    // Premier prénom exact d'abord : « MARIE », « MARIE ANNE » avant « HÉLÈNE MARIE ».
    expect(kept.slice(0, 5).every((c) => /^MARIE\b/.test(c.matches[0].prenoms ?? ''))).toBe(true)
    const out = companiesFor(results, name)
    expect(out).toHaveLength(10)
    expect(out.every((e) => e.review && e.reviewReason?.startsWith('homonyme possible'))).toBe(true)
  })

  it('décès en 1934 : aucun mandat ouvert ni entreprise créée après', async () => {
    const input = entity('person', 'Marie Curie', { data: { birth_date: '1867-11-07', death_date: '1934-07-04' } })
    const out = await frDirigeants.run(input, routeContext(routes()))
    expect(out.entities).toEqual([])
    expect(Number(out.properties?.officer_companies_excluded)).toBeGreaterThan(30)
  })

  it('date de naissance concordante : identité confirmée, sans mention d’homonymie', () => {
    const r = results.find((x) => x.nom_complet === 'THICU')!
    const d = r.dirigeants!.find((x) => x.prenoms === 'HÉLÈNE MARIE')!
    expect(mandateConsistency(r, d, { birth: { year: 1985, month: 3 } })).toBe('confirmed')
    expect(mandateConsistency(r, d, { birth: { year: 1985, month: 4 } })).toBe('excluded')
    expect(mandateConsistency(r, d, { birth: { year: 1985 } })).toBe('possible')
    const helene = companiesFor(results, { firstNames: ['Hélène'], lastName: 'Curie' }, { birth: { year: 1985, month: 3 } })
    expect(helene[0].label).toBe('THICU')
    expect(helene[0].linkLabel).toBe('Associé indéfiniment responsable · né(e) 03/1985')
    expect(helene[0].review).toBeUndefined()
    // Cherchée sous « Marie », Hélène Marie Curie reste un homonyme possible malgré la date.
    const marie = companiesFor(results, name, { birth: { year: 1985, month: 3 } })
    expect(marie.length).toBeLessThanOrEqual(10)
    expect(marie.every((e) => e.review === true)).toBe(true)
    expect(marie.some((e) => /né\(e\) (?!03\/1985)\d/.test(e.linkLabel ?? ''))).toBe(false)
  })
})

describe('noms de pays traduits', () => {
  it('à partir du code ou du nom anglais renvoyé par une API', () => {
    expect(countryCodeFromName('United States')).toBe('US')
    expect(countryCodeFromName('Germany')).toBe('DE')
    expect(countryCodeFromName('Russian Federation')).toBe('RU')
    expect(localizeCountry('United States', 'US', 'fr')).toBe('États-Unis')
    expect(localizeCountry('Viet Nam', null, 'fr')).toBe('Viêt Nam')
    expect(localizeCountry('Hong Kong', null, 'fr')).toBe('Hong Kong')
    expect(localizeCountry('US', null, 'en')).toBe('United States')
    expect(localizeCountry('Deutschland', null, 'fr')).toBe('Deutschland')
    expect(localizeCountry(null, null, 'fr')).toBeNull()
  })

  it('ip.geo suit la langue de l’interface', () => {
    const g = fromIpWhoIs(fixtureJson<IpWhoIs>('ip/ipwhois_8.8.8.8.json'))
    expect(buildGeoOutput(g, 'fr').properties?.country).toBe('États-Unis')
    expect(buildGeoOutput(g, 'en').properties?.country).toBe('United States')
    expect(buildGeoOutput(g, 'fr').entities?.[0].data?.country).toBe('États-Unis')
  })
})

describe('location.reverse : adresse BAN', () => {
  it('espace après la virgule (« Paris, Paris 7e Arrondissement »)', () => {
    const raw = fixtureJson<{ features: Parameters<typeof parseGeopf>[0][] }>('location/geopf_reverse_paris7.json')
    expect(raw.features[0].properties.label).toContain('Paris,Paris 7e')
    const r = parseGeopf(raw.features[0])
    expect(r.label).toBe('Avenue Anatole France 75007 Paris, Paris 7e Arrondissement')
    const out = reverseOutput({ lang: 'fr' }, { lat: 48.8584, lon: 2.2945 }, r)
    expect(out.properties?.address).toBe('Avenue Anatole France 75007 Paris, Paris 7e Arrondissement')
    expect(out.properties?.district).toBe('Paris 7e Arrondissement')
    expect(out.entities?.[0].label).not.toMatch(/,\S/)
  })
})

describe('ip.greynoise (API communautaire)', () => {
  it('8.8.8.8 : 404 « non observée » interprété, sans conclure sur RIOT', async () => {
    const ctx = fakeContext({ routes: { 'https://api.greynoise.io/': { status: 404, body: fixture('ip/greynoise_8.8.8.8.json') } } })
    const out = await greynoise.run(entity('ip', '8.8.8.8'), ctx)
    expect(out.properties).toEqual({ greynoise_noise: false, greynoise_link: 'https://viz.greynoise.io/ip/8.8.8.8' })
  })

  it('robot connu et RIOT', () => {
    const bot = parseGreyNoise(fixtureJson<GreyNoiseCommunity>('ip/greynoise_40.77.167.1.json'))
    expect(bot.properties).toMatchObject({ greynoise_noise: true, greynoise_classification: 'benign', greynoise_name: 'BingBot' })
    expect(bot.properties?.greynoise_riot).toBeUndefined()
    const riot = parseGreyNoise({ ip: '8.8.8.8', noise: false, riot: true, classification: 'benign', name: 'Google Public DNS', link: 'https://viz.greynoise.io/riot/8.8.8.8' })
    expect(riot.properties).toMatchObject({ greynoise_riot: true, greynoise_name: 'Google Public DNS', greynoise_link: 'https://viz.greynoise.io/riot/8.8.8.8' })
    expect(parseGreyNoise({ ip: '1.2.3.4', noise: false, riot: false }, true).properties?.greynoise_riot).toBe(false)
  })

  it('quota anonyme : message explicite', async () => {
    const ctx = fakeContext({ routes: { 'https://api.greynoise.io/': { status: 429, body: fixture('ip/greynoise_ratelimit.json') } } })
    const err = await greynoise.run(entity('ip', '8.8.8.8'), ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ModuleError)
    expect((err as ModuleError).code).toBe('rate_limited')
    expect((err as ModuleError).message).toMatch(/25 requêtes par semaine/)
  })
})

describe('domain.hudsonrock : délais et erreurs', () => {
  it('délai long et messages clairs', async () => {
    expect(hudsonRock.timeoutMs).toBeGreaterThanOrEqual(60_000)
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    expect(hudsonRockDomainError(timeout).message).toMatch(/45 s/)
    expect(hudsonRockDomainError(timeout).code).toBe('unavailable')
    const ctx = fakeContext({
      routes: { 'https://cavalier.hudsonrock.com/': { status: 500, body: { error: 'An internal error occurred. Please try again later.' } } }
    })
    await expect(hudsonRock.run(entity('domain', 'example.com'), ctx)).rejects.toThrow(/très répandus/)
    const refused = fakeContext({ routes: { 'https://cavalier.hudsonrock.com/': { status: 400, body: 'Cannot complete search for that domain.' } } })
    await expect(hudsonRock.run(entity('domain', 'gmail.com'), refused)).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('blocages anti-robot (Reddit, Kick)', () => {
  it('Reddit 403 « blocked by network security » : code blocked, proxy ou Tor suggéré', async () => {
    const ctx = routeContext([[/reddit\.com/, { status: 403, body: fixture('social/reddit_blocked.html'), headers: { 'content-type': 'text/html' } }]])
    const err = (await reddit.run(entity('username', 'spez'), ctx).catch((e: unknown) => e)) as ModuleError
    expect(err).toBeInstanceOf(ModuleError)
    expect(err.code).toBe('blocked')
    expect(err.message).toMatch(/^Reddit bloque la requête \(HTTP 403\)/)
    expect(err.message).toMatch(/proxy/)
    expect(err.message).toMatch(/Tor/)
  })

  it('Kick derrière Cloudflare (403 ou défi 503)', async () => {
    const challenge = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf_chl_opt</body></html>'
    for (const status of [403, 503]) {
      const ctx = routeContext([[/kick\.com/, { status, body: challenge, headers: { 'content-type': 'text/html' } }]])
      const err = (await kick.run(entity('username', 'xqc'), ctx).catch((e: unknown) => e)) as ModuleError
      expect(err.code).toBe('blocked')
      expect(err.message).toMatch(/^Kick bloque la requête/)
    }
  })

  it('un 403 de quota (GitHub) reste un dépassement de quota', () => {
    expect(() => rethrow({ status: 403, body: '{"message":"API rate limit exceeded for 1.2.3.4."}' }, 'GitHub')).toThrow(/trop de requêtes/)
    expect(blockedError('X').code).toBe('blocked')
  })
})

describe('email.eventbrite : domaine national', () => {
  it('appelle l’API sur le domaine servi après redirection, en POST', async () => {
    const eventbrite = accountModules.find((m) => m.id === 'email.eventbrite')!
    const lookup = { user_id: '1585477192', can_login: true, exists: true, is_email_verified: false, sign_in_methods: ['password'] }
    const routes: Route[] = [
      [/^https:\/\/www\.eventbrite\.com\/signin\/$/, { status: 302, headers: { location: 'https://www.eventbrite.fr/signin/' } }],
      [/^https:\/\/www\.eventbrite\.fr\/signin\/$/, { status: 200, body: '<html></html>', headers: { 'set-cookie': 'csrftoken=tok123; Domain=.eventbrite.fr; Path=/' } }],
      // eventbrite.com renverrait la requête vers .fr par un 302, qui la changerait en GET (HTTP 405).
      [/^https:\/\/www\.eventbrite\.com\/api\//, { status: 302, headers: { location: 'https://www.eventbrite.fr/api/v3/users/lookup/' } }],
      [/^https:\/\/www\.eventbrite\.fr\/api\/v3\/users\/lookup\/$/, (_url, init) => (init.method === 'POST' ? { body: lookup } : { status: 405, body: { error: 'METHOD_NOT_ALLOWED' } })]
    ]
    const ctx = routeContext(routes)
    const out = await eventbrite.run(entity('email', 'test@example.com'), ctx)
    expect(out.found).toBe(true)
    const call = ctx.calls.find((c) => c.url.includes('/api/v3/users/lookup/'))!
    expect(call).toMatchObject({ url: 'https://www.eventbrite.fr/api/v3/users/lookup/', method: 'POST' })
    expect(call.headers).toMatchObject({ 'x-csrftoken': 'tok123', origin: 'https://www.eventbrite.fr', referer: 'https://www.eventbrite.fr/signin/' })
    expect(eventbriteOrigin('https://www.eventbrite.co.uk/signin/')).toBe('https://www.eventbrite.co.uk')
    expect(eventbriteOrigin('https://evil.example/signin/')).toBe('https://www.eventbrite.com')
  })
})
