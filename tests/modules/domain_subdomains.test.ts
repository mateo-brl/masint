// domain.subdomains (sources fusionnées, vérification DNS) et domain.typosquat (nouvelles
// variantes, messagerie sans site web), sur des réponses réelles de cnil.fr (octobre 2026).

import { describe, expect, it } from 'vitest'
import { ModuleError, type ModuleOutput, type OsintModule } from '@shared/modules'
import subdomains, {
  buildSubdomainOutput,
  checkName,
  parseAnubis,
  parseOtxHostnames,
  parseRapidDns,
  parseThc,
  type DnsCheck,
  type OtxHostnamePdns,
  type ThcSubdomains
} from '../../src/main/modules/domain/subdomains'
import typosquat, { buildTyposquatOutput, generateCandidates, prioritize, toPunycode, type CheckedCandidate } from '../../src/main/modules/domain/typosquat'
import { fakeContext, fixture, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

type Out = { entities?: Array<{ type: string; label: string; linkLabel?: string; data?: Record<string, unknown> }> }
const labels = (out: Out, type: string): string[] => (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

const THC = 'https://ip.thc.org/api/v1/lookup/subdomains'
const OTX = 'https://otx.alienvault.com/api/v1/indicators/hostname/cnil.fr/passive_dns'
const ANUBIS = 'https://anubisdb.com/anubis/subdomains/cnil.fr'
const RAPIDDNS = 'https://rapiddns.io/subdomain/cnil.fr'

describe('domain.subdomains : formats des sources', () => {
  it('THC (API JSON)', () => {
    const names = parseThc('cnil.fr', fixtureJson<ThcSubdomains>('domain/thc_subdomains_cnil.json'))
    expect(names).toContain('agrement.cnil.fr')
    expect(names).toContain('xn--mes-donnes-i7a.beta.cnil.fr')
    expect(names).not.toContain('cnil.fr')
    expect(names[0].split('.').length).toBe(3)
  })

  it('OTX (DNS passif par nom d’hôte), Anubis et RapidDNS', () => {
    expect(parseOtxHostnames('cnil.fr', fixtureJson<OtxHostnamePdns>('domain/otx_hostname_pdns_cnil.json'))).toEqual(
      expect.arrayContaining(['agenda.pro.cnil.fr', 'piwik.cnil.fr', 'www.cnil.fr'])
    )
    expect(parseAnubis('cnil.fr', fixtureJson('domain/anubis_subdomains_cnil.json'))).toContain('correspondants.cnil.fr')
    expect(parseAnubis('cnil.fr', {})).toEqual([])
    const rapid = parseRapidDns('cnil.fr', fixture('domain/rapiddns_cnil.html'))
    expect(rapid).toEqual(expect.arrayContaining(['elections.cnil.fr', 'www.jeunes.cnil.fr', 'eye.information.cnil.fr']))
    // Cibles CNAME d'autres domaines et types d'enregistrement ignorés.
    expect(rapid.every((n) => n.endsWith('.cnil.fr'))).toBe(true)
  })
})

describe('domain.subdomains : vérification DNS', () => {
  it('A, sinon CNAME ; une erreur de résolution ne conclut pas', async () => {
    const ctx = fakeContext({ dns: { 'www.exemple.fr|A': ['192.0.2.1'], 'cdn.exemple.fr|CNAME': ['exemple.cdn-tiers.net'] } })
    expect(await checkName(ctx, 'www.exemple.fr')).toEqual({ status: 'live', a: ['192.0.2.1'], cname: [] })
    expect(await checkName(ctx, 'cdn.exemple.fr')).toEqual({ status: 'live', a: [], cname: ['exemple.cdn-tiers.net'] })
    expect(await checkName(ctx, 'ancien.exemple.fr')).toEqual({ status: 'dead' })
    ctx.resolveDns = async () => {
      throw new Error('DoH injoignable')
    }
    expect(await checkName(ctx, 'www.exemple.fr')).toEqual({ status: 'unchecked' })
  })

  it('noms vivants en entités (50 au plus, les plus courts), morts en propriété', () => {
    const names = Array.from({ length: 70 }, (_, i) => `n${String(i).padStart(2, '0')}.exemple.fr`)
    const checks = new Map<string, DnsCheck>(names.map((n, i) => [n, i % 7 === 6 ? { status: 'dead' } : { status: 'live', a: ['192.0.2.1'], cname: [] }]))
    checks.delete(names[69])
    const out = buildSubdomainOutput(names, checks, [{ name: 'THC', count: 70 }, { name: 'crt.sh', count: 0, error: 'délai dépassé' }], 'fr')
    expect(labels(out, 'domain')).toHaveLength(50)
    expect(out.properties).toMatchObject({
      subdomain_count: 70,
      subdomains_count: 60,
      subdomains_unresolved_count: 9,
      subdomains_unchecked: ['n69.exemple.fr'],
      subdomain_sources: ['THC : 70'],
      subdomain_sources_failed: ['crt.sh : délai dépassé']
    })
  })

  it('cnil.fr : fusionne les sources en parallèle et ne garde que les noms qui résolvent', async () => {
    const live = ['aide.cnil.fr', 'agrement.cnil.fr', 'eye.information.cnil.fr', 'piwik.cnil.fr', 'elections.cnil.fr']
    const ctx = fakeContext({
      routes: {
        'https://crt.sh/': [{ common_name: 'cnil.fr', name_value: 'cnil.fr\n*.cnil.fr\naide.cnil.fr' }],
        'https://api.certspotter.com/v1/issuances': [{ id: '1', dns_names: ['www.cnil.fr', 'aide.cnil.fr'] }],
        [THC]: fixtureJson('domain/thc_subdomains_cnil.json'),
        [OTX]: fixtureJson('domain/otx_hostname_pdns_cnil.json'),
        [ANUBIS]: fixtureJson('domain/anubis_subdomains_cnil.json'),
        [RAPIDDNS]: fixture('domain/rapiddns_cnil.html'),
        'https://api.hackertarget.com/hostsearch/': 'API count exceeded - Increase Quota with Membership'
      },
      dns: {
        ...Object.fromEntries(live.filter((n) => n !== 'eye.information.cnil.fr').map((n) => [`${n}|A`, ['46.18.194.45']])),
        'eye.information.cnil.fr|CNAME': ['eye.customizedurl.com']
      }
    })
    const progress: string[] = []
    ctx.progress = (_done, _total, detail) => progress.push(detail ?? '')
    const out = (await subdomains.run(entity('domain', 'cnil.fr'), ctx)) as ModuleOutput & Out
    expect(labels(out, 'domain').sort()).toEqual([...live].sort())
    expect(out.entities?.find((e) => e.label === 'eye.information.cnil.fr')?.data).toEqual({ cname: ['eye.customizedurl.com'] })
    const sources = out.properties?.subdomain_sources as string[]
    expect(sources.map((s) => s.split(' : ')[0])).toEqual(['crt.sh', 'Cert Spotter', 'THC', 'AlienVault OTX', 'Anubis', 'RapidDNS'])
    expect(out.properties?.subdomain_sources_failed).toEqual(['HackerTarget : quota quotidien dépassé'])
    expect(Number(out.properties?.subdomain_count)).toBeGreaterThan(40)
    expect(out.properties?.subdomains_unresolved_count).toBe(Number(out.properties?.subdomain_count) - live.length)
    // Avancement : une étape par source, puis la vérification DNS.
    expect(progress).toEqual(expect.arrayContaining(['THC', 'RapidDNS', 'DNS']))
    // THC interrogé en POST JSON, une seule page (moins de 200 noms).
    expect(ctx.requests.filter((r) => r === THC)).toHaveLength(1)
  })

  it('toutes les sources en échec : erreur explicite', async () => {
    const ctx = fakeContext({ routes: { 'https://': { status: 503, body: 'Service Unavailable' } } })
    await expect(subdomains.run(entity('domain', 'cnil.fr'), ctx)).rejects.toMatchObject({ code: 'unavailable' })
  }, 20000)
})

describe('domain.typosquat : variantes', () => {
  const variants = (domain: string, fuzzer: string): string[] =>
    generateCandidates(domain)
      .filter((c) => c.fuzzer === fuzzer)
      .map((c) => c.domain)

  it('ajout, voyelle, dictionnaire, bitsquat et homoglyphes cyrilliques', () => {
    expect(variants('cnil.fr', 'addition')).toEqual(expect.arrayContaining(['cnila.fr', 'cnils.fr']))
    expect(variants('cnil.fr', 'vowel-swap')).toEqual(expect.arrayContaining(['cnal.fr', 'cnel.fr']))
    expect(variants('cnil.fr', 'dictionary')).toEqual(expect.arrayContaining(['login-cnil.fr', 'cnil-secure.fr', 'mail-cnil.fr', 'cnil-app.fr']))
    // c (0x63) ^ 0x02 = a, n ^ 0x01 = o, i ^ 0x08 = a...
    expect(variants('cnil.fr', 'bitsquatting')).toEqual(expect.arrayContaining(['anil.fr', 'coil.fr']))
    expect(variants('cnil.fr', 'bitsquatting').every((d) => /^[a-z0-9-]+\.fr$/.test(d))).toBe(true)
    const cyr = variants('paypal.com', 'cyrillic')
    expect(cyr.every((d) => d.startsWith('xn--'))).toBe(true)
    // Nom entièrement en sosies cyrilliques (р а у р а ӏ).
    expect(cyr).toContain(`${toPunycode('раураӏ', 'com')}.com`)
    expect(prioritize(generateCandidates('cnil.fr')).length).toBeLessThanOrEqual(250)
  })

  it('messagerie sans site web : signalée, priorisée ; sans A ni MX : propriété seulement', () => {
    const c = (domain: string, a: string[], mx: string[]): CheckedCandidate => ({ domain, fuzzer: 'omission', registered: true, a, mx })
    const out = buildTyposquatOutput(
      [c('cnl.fr', ['192.0.2.7'], []), c('cil.fr', [], ['mx.cil.fr']), c('nil.fr', [], []), { ...c('cni.fr', [], []), registered: false }],
      new Set(['192.0.2.1']),
      'fr'
    )
    expect(labels(out, 'domain')).toEqual(['cil.fr', 'cnl.fr'])
    expect(out.entities?.[0]).toMatchObject({ linkLabel: 'domaine similaire (email seul)', data: { mx_only: true, mx: ['mx.cil.fr'] } })
    expect(out.properties).toMatchObject({
      typosquat_checked: 4,
      typosquat_registered: ['cnl.fr (omission)', 'cil.fr (omission)', 'nil.fr (omission)'],
      typosquat_mx_only: ['cil.fr']
    })
  })

  it('vérifie le MX des variantes enregistrées', async () => {
    const ctx = fakeContext({
      dns: {
        'gogle.com|NS': ['ns1.example.net'],
        'gogle.com|A': ['1.2.3.4'],
        'login-google.com|NS': ['ns1.example.net'],
        'login-google.com|MX': ['10 mx.login-google.com']
      }
    })
    const out = await typosquat.run(entity('domain', 'google.com'), ctx)
    expect(labels(out, 'domain')).toEqual(['login-google.com', 'gogle.com'])
    expect(out.properties?.typosquat_mx_only).toEqual(['login-google.com'])
  })
})

async function live(m: OsintModule, value: string, t: { skip: () => void }): Promise<ModuleOutput> {
  try {
    return await runModule(m, entity('domain', value), makeContext())
  } catch (e) {
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || /fetch failed/i.test(String(e))) t.skip()
    throw e
  }
}

describe.skipIf(!LIVE)('sous-domaines et typosquatting en direct', () => {
  it('domain.subdomains : cnil.fr', async (t) => {
    const out = await live(subdomains, 'cnil.fr', t)
    expect(Number(out.properties?.subdomain_count)).toBeGreaterThan(50)
    expect(Number(out.properties?.subdomains_count)).toBeGreaterThan(20)
    expect((out.properties?.subdomain_sources as string[]).some((s) => s.startsWith('THC'))).toBe(true)
  }, 200000)

  it('domain.typosquat : cnil.fr', async (t) => {
    const out = await live(typosquat, 'cnil.fr', t)
    // « cnil » est court : une centaine de variantes ; cnil.net est un enregistrement défensif connu.
    expect(Number(out.properties?.typosquat_checked)).toBeGreaterThan(80)
    expect(out.properties?.typosquat_registered).toContain('cnil.net (tld-swap)')
  }, 200000)
})
