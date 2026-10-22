// URLhaus et ThreatFox (abuse.ch) : réponses tirées des exemples de la documentation officielle.

import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import { ABUSECH_KEY, abusechDate } from '../../src/main/modules/forensic/_abusech'
import malwarebazaar from '../../src/main/modules/forensic/malwarebazaar'
import threatfox, { iocHost, matchesInput, parseThreatFox, threatFoxQuery, type TfResponse } from '../../src/main/modules/forensic/threatfox'
import urlhaus, { parseUrlhausHost, type UrlhausHost } from '../../src/main/modules/forensic/urlhaus'
import { fakeContext, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fr = { lang: 'fr' as const }
const types = (out: { entities?: Array<{ type: string; label: string }> }, type: string): string[] =>
  (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

describe('abuse.ch : clé commune', () => {
  it('MalwareBazaar, URLhaus et ThreatFox partagent la même clé', () => {
    for (const m of [malwarebazaar, urlhaus, threatfox]) expect(m.keys).toEqual([ABUSECH_KEY])
    expect(abusechDate('2019-01-15 07:09:01 UTC')).toBe('2019-01-15T07:09:01.000Z')
    expect(abusechDate('2021-03-26 13:15:07')).toBe('2021-03-26T13:15:07.000Z')
    expect(abusechDate(null)).toBeNull()
  })

  it('refuse de partir sans clé et envoie l’en-tête Auth-Key', async () => {
    await expect(urlhaus.run(entity('domain', 'vektorex.com'), fakeContext({}))).rejects.toMatchObject({ code: 'auth' })
    const ctx = fakeContext({ keys: { abusech: 'k' }, routes: { 'https://urlhaus-api.abuse.ch/v1/host/': { status: 401, body: { error: 'Unauthorized' } } } })
    await expect(urlhaus.run(entity('domain', 'vektorex.com'), ctx)).rejects.toMatchObject({ code: 'auth' })
  })
})

describe('forensic.urlhaus', () => {
  it('résume les URL malveillantes et les garde à vérifier', () => {
    const out = parseUrlhausHost(fr, fixtureJson<UrlhausHost>('forensic/urlhaus_host_vektorex.json'))
    expect(out.properties).toMatchObject({
      urlhaus_urls_count: 120,
      urlhaus_online: 1,
      urlhaus_first_seen: '2019-01-15T07:09:01.000Z',
      urlhaus_last_seen: '2019-02-11T07:45:05.000Z',
      urlhaus_threats: ['malware_download'],
      urlhaus_spamhaus_dbl: 'abused_legit_malware',
      urlhaus_link: 'https://urlhaus.abuse.ch/host/vektorex.com/'
    })
    expect(out.properties?.urlhaus_tags).toEqual(expect.arrayContaining(['AZORult', 'Loki', 'exe']))
    expect(out.properties?.urlhaus_surbl).toBeUndefined()
    // Les plus récentes d'abord, toutes dans « À vérifier ».
    expect(types(out, 'url')).toEqual(['http://vektorex.com/source/Z/5016223.exe', 'http://vektorex.com/source/Z/Order%20839.png'])
    expect(out.entities?.every((e) => e.review && e.reviewReason)).toBe(true)
    expect(out.entities?.[0].data).toMatchObject({ status: 'offline', threat: 'malware_download' })
  })

  it('plafonne à 10 URL et gère les statuts', () => {
    const many: UrlhausHost = {
      query_status: 'ok',
      url_count: 250,
      urls: Array.from({ length: 30 }, (_, i) => ({ url: `http://203.0.113.5/bin${i}.sh`, url_status: 'online', date_added: `2026-10-${String(i % 28 + 1).padStart(2, '0')} 10:00:00 UTC` }))
    }
    const out = parseUrlhausHost(fr, many)
    expect(out.entities).toHaveLength(10)
    expect(out.properties?.urlhaus_urls_count).toBe(250)
    expect((out.properties?.urlhaus_urls as string[]).length).toBe(30)
    expect(parseUrlhausHost(fr, { query_status: 'no_results' })).toEqual({})
    expect(() => parseUrlhausHost(fr, { query_status: 'invalid_host' })).toThrow(ModuleError)
  })

  it('interroge l’API host en POST', async () => {
    const ctx = fakeContext({ keys: { abusech: 'k' }, routes: { 'https://urlhaus-api.abuse.ch/v1/host/': fixtureJson('forensic/urlhaus_host_vektorex.json') } })
    const out = await urlhaus.run(entity('domain', 'www.vektorex.com'), ctx)
    expect(out.properties?.urlhaus_urls_count).toBe(120)
    await expect(urlhaus.run(entity('ip', '2001:db8::1'), ctx)).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('forensic.threatfox', () => {
  it('construit la requête selon le type d’entité', () => {
    expect(threatFoxQuery(entity('ip', '139.180.203.104'))?.body).toEqual({ query: 'search_ioc', search_term: '139.180.203.104' })
    expect(threatFoxQuery(entity('domain', 'www.jetos.com'))?.value).toBe('jetos.com')
    expect(threatFoxQuery(entity('url', 'http://harold.jetos.com:3606/is-ready'))?.body).toMatchObject({ exact_match: true })
    expect(threatFoxQuery(entity('hash', '2151c4b970eff0071948dbbc19066aa4'))?.body).toEqual({ query: 'search_hash', hash: '2151c4b970eff0071948dbbc19066aa4' })
    expect(threatFoxQuery(entity('hash', 'a'.repeat(40)))).toBeNull()
    expect(threatfox.accepts!(entity('hash', 'a'.repeat(40)))).toBe(false)
  })

  it('ne garde que les IOC de l’entrée (recherche approximative de ThreatFox)', () => {
    const ioc = { ioc: '139.180.203.104:443', ioc_type: 'ip:port' }
    expect(iocHost(ioc)).toBe('139.180.203.104')
    expect(matchesInput(ioc, 'ip', '139.180.203.104')).toBe(true)
    expect(matchesInput(ioc, 'ip', '139.180.203.10')).toBe(false)
    const url = { ioc: 'http://harold.jetos.com:3606/is-ready', ioc_type: 'url' }
    expect(matchesInput(url, 'domain', 'jetos.com')).toBe(true)
    expect(matchesInput({ ioc: 'notjetos.com', ioc_type: 'domain' }, 'domain', 'jetos.com')).toBe(false)
    expect(iocHost({ ioc: '[2001:db8::1]:443', ioc_type: 'ip:port' })).toBe('2001:db8::1')
  })

  it('IP de serveur de commande : famille de malware reliée', () => {
    const d = fixtureJson<TfResponse>('forensic/threatfox_ioc_139.180.203.104.json')
    const out = parseThreatFox(fr, d, { type: 'ip', value: '139.180.203.104' })
    expect(out.properties).toMatchObject({
      threatfox_iocs: 1,
      threatfox_malware: ['Cobalt Strike'],
      threatfox_threat_types: ['botnet_cc'],
      threatfox_confidence: 75,
      threatfox_first_seen: '2020-12-06T09:10:23.000Z',
      threatfox_link: 'https://threatfox.abuse.ch/browse.php?search=ioc%3A139.180.203.104'
    })
    expect(out.entities).toEqual([
      expect.objectContaining({ type: 'malware', label: 'Cobalt Strike', data: expect.objectContaining({ malpedia: expect.stringContaining('malpedia') }) })
    ])
    expect(out.entities?.[0].review).toBeUndefined()
    // La même réponse pour une autre adresse (préfixe commun) ne donne rien.
    expect(parseThreatFox(fr, d, { type: 'ip', value: '139.180.203.10' })).toEqual({})
  })

  it('empreinte : famille et serveurs de commande à vérifier', () => {
    const out = parseThreatFox(fr, fixtureJson<TfResponse>('forensic/threatfox_hash_houdini.json'), { type: 'hash', value: '2151c4b970eff0071948dbbc19066aa4' })
    expect(types(out, 'malware')).toEqual(['Houdini'])
    expect(types(out, 'url')).toEqual(['http://harold.jetos.com:3606/is-ready', 'http://harold.jetos.com:3606/moz-sdk'])
    expect(out.entities?.filter((e) => e.type === 'url').every((e) => e.review && /ThreatFox Houdini/.test(e.reviewReason ?? ''))).toBe(true)
    expect(out.properties?.threatfox_tags).toEqual(['WSHRAT'])
    expect(out.properties?.threatfox_link).toBeUndefined()
  })

  it('attribution peu sûre : famille à vérifier', () => {
    const out = parseThreatFox(fr, { query_status: 'ok', data: [{ ioc: 'exemple-c2.example', ioc_type: 'domain', malware_printable: 'AsyncRAT', confidence_level: 25 }] }, { type: 'domain', value: 'exemple-c2.example' })
    expect(out.entities?.[0]).toMatchObject({ type: 'malware', review: true })
    expect(out.entities?.[0].reviewReason).toMatch(/25 %/)
    expect(parseThreatFox(fr, { query_status: 'no_result', data: 'Your search did not yield any results' }, { type: 'ip', value: '1.2.3.4' })).toEqual({})
    expect(() => parseThreatFox(fr, { query_status: 'illegal_search_term' }, { type: 'ip', value: '1.2.3.4' })).toThrow(/refusée/)
  })

  it('exécute le module en POST JSON', async () => {
    const ctx = fakeContext({ keys: { abusech: 'k' }, routes: { 'https://threatfox-api.abuse.ch/api/v1/': fixtureJson('forensic/threatfox_hash_houdini.json') } })
    const out = await threatfox.run(entity('domain', 'jetos.com'), ctx)
    expect(out.properties?.threatfox_iocs).toBe(2)
    expect(types(out, 'malware')).toEqual(['Houdini'])
  })
})

describe.skipIf(!LIVE)('abuse.ch (live)', () => {
  const ctx = makeContext()

  it.skipIf(!process.env.MASINT_KEY_ABUSECH)('forensic.urlhaus', async () => {
    const out = await runModule(urlhaus, entity('domain', 'vektorex.com'), ctx)
    expect(out.properties?.urlhaus_urls_count).toBeGreaterThan(0)
  })

  it.skipIf(!process.env.MASINT_KEY_ABUSECH)('forensic.threatfox', async () => {
    const out = await runModule(threatfox, entity('ip', '139.180.203.104'), ctx)
    expect(out.properties?.threatfox_malware).toContain('Cobalt Strike')
  })

  it('sans clé, les API abuse.ch répondent 401 (clé devenue obligatoire)', async () => {
    const res = await ctx.fetch('https://threatfox-api.abuse.ch/api/v1/', { method: 'POST', json: { query: 'search_ioc', search_term: '139.180.203.104' } })
    expect(res.status).toBe(401)
  })
})
