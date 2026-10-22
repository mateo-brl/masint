// Fichiers publics du site (plan du site, ads.txt, associations d'applications), conteneur
// Google Tag Manager et contrôle des pages BuiltWith.

import { gzipSync } from 'node:zlib'
import { describe, expect, it, type TestContext } from 'vitest'
import { ModuleError } from '@shared/modules'
import gtm, { buildGtmOutput, gtmResource, gtmTagIds } from '../../src/main/modules/web/gtm'
import robots, { buildRobotsOutput, parseRobots, parseSitemap, readFirstSitemap, sitemapDocuments } from '../../src/main/modules/web/robots'
import tracker, { builtWithMatches, normalizeTracker } from '../../src/main/modules/web/tracker'
import wellknown, { buildWellKnownOutput, parseAdsTxt, parseAppleAppSite, parseAssetLinks } from '../../src/main/modules/web/wellknown'
import { fakeContext, fixture, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const types = (out: { entities?: Array<{ type: string; label: string }> }, type: string): string[] =>
  (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

const xml = { 'content-type': 'application/xml' }

describe('web.robots : plan du site', () => {
  it('lit un index et une liste d’URL, sans les images', () => {
    const index = parseSitemap(fixture('web/sitemap_index_arcep.xml'))
    expect(index?.kind).toBe('index')
    expect(index?.children).toHaveLength(16)
    expect(index?.children[0]).toBe('https://www.arcep.fr/sitemap/pages/0/sitemap.xml')
    // Extrait réel du plan de l'Arcep, complété de deux documents et d'une image pour le test.
    const pages = parseSitemap(fixture('web/sitemap_arcep_pages.xml'))
    expect(pages?.kind).toBe('urlset')
    expect(pages?.urls).toHaveLength(12)
    expect(pages?.urls).toContain('https://www.arcep.fr/la-regulation/exemple.html?a=1&b=2')
    expect(pages?.urls).toContain('https://www.arcep.fr/recherche.html?q=x&page=2')
    expect(pages?.urls.some((u) => u.endsWith('.jpg'))).toBe(false)
    expect(sitemapDocuments(pages!.urls)).toEqual([
      'https://www.arcep.fr/uploads/tx_gspublication/rapport-exemple.pdf',
      'https://www.arcep.fr/uploads/tx_gspublication/donnees-exemple.XLSX?v=2'
    ])
    expect(parseSitemap('<html><body>404</body></html>')).toBeNull()
  })

  it('suit le premier plan d’un index et range les documents dans la fiche', async () => {
    const ctx = fakeContext({
      routes: {
        'https://www.arcep.fr/robots.txt': { body: 'User-agent: *\nDisallow: /admin/\nSitemap: https://www.arcep.fr/sitemap.xml\n', headers: { 'content-type': 'text/plain' } },
        'https://www.arcep.fr/sitemap.xml': { body: fixture('web/sitemap_index_arcep.xml'), headers: xml },
        'https://www.arcep.fr/sitemap/pages/0/sitemap.xml': { body: fixture('web/sitemap_arcep_pages.xml'), headers: xml }
      }
    })
    const out = await robots.run(entity('website', 'https://www.arcep.fr'), ctx)
    expect(out.properties).toMatchObject({
      sitemap_url: 'https://www.arcep.fr/sitemap/pages/0/sitemap.xml',
      sitemap_urls_count: 12,
      sitemap_children_count: 16,
      documents_count: 2
    })
    expect(out.entities).toEqual([])
    expect(ctx.requests.filter((u) => u.includes('sitemap')).length).toBe(2)
  })

  it('décompresse un plan gzip et s’arrête à 2 Mo', async () => {
    const gz = gzipSync(Buffer.from(fixture('web/sitemap_arcep_pages.xml')))
    const ctx = fakeContext({ routes: { 'https://exemple.fr/sitemap.xml.gz': { body: gz, headers: { 'content-type': 'application/x-gzip' } } } })
    expect((await readFirstSitemap(ctx, ['https://exemple.fr/sitemap.xml.gz']))?.urls).toHaveLength(12)
    const big = `<urlset>${'<url><loc>https://exemple.fr/page</loc></url>'.repeat(60_000)}`
    const huge = fakeContext({ routes: { 'https://exemple.fr/s.xml': { body: big, headers: xml } } })
    const partial = await readFirstSitemap(huge, ['https://exemple.fr/s.xml'])
    expect(partial?.truncated).toBe(true)
    expect(buildRobotsOutput(parseRobots('Sitemap: https://exemple.fr/s.xml'), null, 'https://exemple.fr', 'fr', partial).properties?.sitemap_partial).toBe(true)
  })
})

describe('web.wellknown', () => {
  it('ads.txt : compte AdSense direct relié, revendeurs dans la fiche', () => {
    const ads = parseAdsTxt(fixture('web/ads_lemonde.txt'))
    expect(ads.variables.ownerdomain).toEqual(['mpublicite.fr'])
    expect(ads.variables.subdomain).toHaveLength(3)
    expect(ads.records.find((r) => r.domain === 'triplelift.com')?.relation).toBe('DIRECT')
    const out = buildWellKnownOutput(ads, [], null, 'fr')
    expect(out.entities).toEqual([{ type: 'tracker', label: 'ca-pub-9273264035880389', data: { kind: 'Google AdSense' }, linkLabel: 'vendeur direct (ads.txt)' }])
    expect(out.properties).toMatchObject({
      adsense_ids: ['ca-pub-9273264035880389'],
      ads_owner_domain: 'mpublicite.fr',
      ads_resellers_count: 5
    })
    expect(out.properties?.ads_resellers).toContain('google.com, pub-7019376976432612')
    expect(out.properties?.ads_direct).toContain('teads.tv, 20307')
    // L'identifiant est le même que celui que web.page relève dans le code de la page.
    expect(normalizeTracker('pub-9273264035880389')?.id).toBe('ca-pub-9273264035880389')
  })

  it('assetlinks.json et apple-app-site-association (Doctolib)', () => {
    const android = parseAssetLinks(fixtureJson('web/assetlinks_doctolib.json'))
    expect(android.map((a) => a.package)).toContain('fr.doctolib.www')
    expect(android[0].fingerprints[0]).toMatch(/^19:9A:C4:B1/)
    const apple = parseAppleAppSite(fixtureJson('web/aasa_doctolib.json'))
    expect(apple.teamIds).toEqual(['84K7XVJ72Q'])
    expect(apple.bundleIds).toContain('fr.doctolib.www')
    // Format récent : `appIDs`, trousseau partagé et App Clips.
    expect(parseAppleAppSite({ applinks: { details: [{ appIDs: ['ABCDE12345.com.exemple.app'] }] }, webcredentials: { apps: ['ABCDE12345.com.exemple.app'] }, appclips: { apps: ['ABCDE12345.com.exemple.app.Clip'] } })).toEqual({
      teamIds: ['ABCDE12345'],
      bundleIds: ['com.exemple.app', 'com.exemple.app.Clip']
    })
    const out = buildWellKnownOutput(null, android, apple, 'fr')
    expect(out.entities).toEqual([])
    expect(out.properties).toMatchObject({ android_packages: expect.arrayContaining(['fr.doctolib.www']), apple_team_ids: ['84K7XVJ72Q'] })
    expect(out.properties?.android_cert_fingerprints).toHaveLength(2)
  })

  it('exécute le module et ignore les pages HTML servies à la place des fichiers', async () => {
    const ctx = fakeContext({
      routes: {
        'https://www.doctolib.fr/ads.txt': { body: '<html>introuvable</html>', headers: { 'content-type': 'text/html' } },
        'https://www.doctolib.fr/.well-known/assetlinks.json': { body: fixture('web/assetlinks_doctolib.json'), headers: { 'content-type': 'application/json' } },
        'https://www.doctolib.fr/apple-app-site-association': { body: fixture('web/aasa_doctolib.json'), headers: { 'content-type': 'application/json' } }
      }
    })
    const out = await wellknown.run(entity('website', 'https://www.doctolib.fr'), ctx)
    expect(out.properties).toMatchObject({ apple_team_ids: ['84K7XVJ72Q'] })
    expect(out.properties?.ads_txt_records).toBeUndefined()
    expect(wellknown.noisy).toBe(true)
    // Site injoignable : erreur, pas résultat vide.
    const down = fakeContext({ routes: {} })
    down.fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }
    await expect(wellknown.run(entity('domain', 'exemple.invalid'), down)).rejects.toThrow(ModuleError)
  })
})

describe('tracker.gtm', () => {
  it('extrait les balises du conteneur, sans celles du moteur de Google', () => {
    const script = fixture('web/gtm_mozilla.js')
    expect(gtmResource(script)).not.toContain('G-ENGINE1234')
    const tags = gtmTagIds(script)
    expect(tags.map((t) => t.id).sort()).toEqual(['G-9Y966W6Q7W', 'G-MQ7767QQQW', 'G-R74PYCVR6D', 'G-SLZPCL53DQ', 'G-XMR6B2WM5E', 'G-YBFC8BJZW8'])
    expect(tags.every((t) => t.kind === 'Google Analytics 4')).toBe(true)
    expect(gtmTagIds('"resource": {"x":"UA-1234567-1","y":"AW-123456789/AbC","z":"DC-1234567"}\n};')).toEqual([
      { id: 'UA-1234567-1', kind: 'Google Analytics (UA)' },
      { id: 'AW-123456789', kind: 'Google Ads' },
      { id: 'DC-1234567', kind: 'Google Floodlight (Campaign Manager)' }
    ])
  })

  it('relie au plus 15 identifiants', () => {
    const tags = Array.from({ length: 20 }, (_, i) => ({ id: `G-TEST${String(i).padStart(4, '0')}`, kind: 'Google Analytics 4' }))
    const out = buildGtmOutput('GTM-TEST', tags, '3', 'fr')
    expect(out.entities).toHaveLength(15)
    expect(out.entities?.[0]).toMatchObject({ type: 'tracker', linkLabel: 'déclenché par le conteneur' })
    expect(out.properties?.gtm_tags_count).toBe(20)
    expect(buildGtmOutput('GTM-TEST', [], '1', 'fr')).toEqual({})
  })

  it('télécharge le script chez Google, pas chez la cible', async () => {
    const ctx = fakeContext({ routes: { 'https://www.googletagmanager.com/gtm.js': fixture('web/gtm_mozilla.js') } })
    const out = await gtm.run(entity('tracker', 'gtm-mw3r8v'), ctx)
    expect(types(out, 'tracker')).toHaveLength(6)
    expect(out.properties?.gtm_version).toBe('264')
    expect(ctx.requests).toEqual(['https://www.googletagmanager.com/gtm.js?id=GTM-MW3R8V'])
    expect(gtm.accepts!(entity('tracker', 'G-9Y966W6Q7W'))).toBe(false)
    expect(gtm.noisy).toBeFalsy()
  })
})

describe('tracker.lookup : contrôle des pages BuiltWith', () => {
  it('n’accepte que la page de l’identifiant demandé', async () => {
    const page = fixture('web/builtwith_gtm.html')
    expect(builtWithMatches(page, 'GTM-P24PF4B')).toBe(true)
    expect(builtWithMatches(page, 'GTM-P24PF4')).toBe(false)
    expect(builtWithMatches(page, 'GTM-XXXXXXX')).toBe(false)
    expect(builtWithMatches('<title>ca-pub-9273264035880389 - Google Adsense Usage and History</title>', 'ca-pub-9273264035880389')).toBe(true)
    expect(builtWithMatches('<h1 class="display-4">CA-PUB-92732640358803891</h1>', 'ca-pub-9273264035880389')).toBe(false)
    // BuiltWith renvoie la page d'un autre identifiant en HTTP 200 : elle est ignorée.
    const ctx = fakeContext({
      routes: {
        'https://api.hackertarget.com/analyticslookup/': 'no results found',
        'https://builtwith.com/relationships/tag/GTM-ABCD123': page
      }
    })
    const out = await tracker.run(entity('tracker', 'GTM-ABCD123'), ctx)
    expect(types(out, 'domain')).toEqual([])
    expect(out.properties?.shared_domains_count).toBe(0)
  })
})

async function live(t: TestContext, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || (e instanceof Error && /fetch failed/i.test(e.message))) t.skip()
    else throw e
  }
}

describe.skipIf(!LIVE)('fichiers publics et GTM (live)', () => {
  const ctx = makeContext()

  it('web.wellknown : ads.txt du Monde', (t) =>
    live(t, async () => {
      const out = await runModule(wellknown, entity('website', 'https://www.lemonde.fr'), ctx)
      expect(types(out, 'tracker')).toContain('ca-pub-9273264035880389')
    }), 60000)

  it('web.wellknown : applications de Doctolib', (t) =>
    live(t, async () => {
      const out = await runModule(wellknown, entity('website', 'https://www.doctolib.fr'), ctx)
      expect(out.properties?.android_packages).toContain('fr.doctolib.www')
      expect(out.properties?.apple_team_ids).toContain('84K7XVJ72Q')
    }), 60000)

  it('web.robots : plan du site de cyber.gouv.fr', (t) =>
    live(t, async () => {
      const out = await runModule(robots, entity('website', 'https://cyber.gouv.fr'), ctx)
      expect(Number(out.properties?.sitemap_urls_count)).toBeGreaterThan(10)
    }), 60000)

  it('tracker.gtm : conteneur de mozilla.org', (t) =>
    live(t, async () => {
      const out = await runModule(gtm, entity('tracker', 'GTM-MW3R8V'), ctx)
      expect(types(out, 'tracker').filter((id) => id.startsWith('G-')).length).toBeGreaterThanOrEqual(6)
    }), 60000)
})
