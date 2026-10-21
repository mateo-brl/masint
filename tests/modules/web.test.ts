import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import { emails, metas, socialLink, technologies, trackers } from '../../src/main/modules/web/_html'
import favicon, { buildFaviconOutput, encodebytes, faviconHash, iconUrl, murmur3 } from '../../src/main/modules/web/favicon'
import page, { analyzePage, guessCountry } from '../../src/main/modules/web/page'
import robots, { parseRobots, parseSecurityTxt } from '../../src/main/modules/web/robots'
import tracker, { normalizeTracker, parseAnalyticsLookup } from '../../src/main/modules/web/tracker'
import { fakeContext, fixture, fixtureBytes, fixtureJson } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const types = (out: { entities?: Array<{ type: string; label: string }> }, type: string): string[] =>
  (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

describe('extraction HTML', () => {
  it('lit les balises meta dans n’importe quel ordre d’attributs', () => {
    const m = metas('<meta content="Découvrez l&#039;hébergement" name="description"><meta property=og:title content=\'Titre\'>')
    expect(m.description).toBe("Découvrez l'hébergement")
    expect(m['og:title']).toBe('Titre')
  })

  it('filtre les faux emails', () => {
    const html = '<img src="logo@2x.png"> contact@exemple-reel.fr <a href="mailto:Info@Societe.fr?subject=x">x</a> https://abc123@o123.ingest.sentry.io/1 you@example.com'
    expect(emails(html).sort()).toEqual(['contact@exemple-reel.fr', 'info@societe.fr'])
  })

  it('reconnaît les profils sociaux et ignore les liens de partage', () => {
    expect(socialLink('https://www.facebook.com/LDLC.com/')).toMatchObject({ platform: 'facebook', username: 'LDLC.com' })
    expect(socialLink('https://twitter.com/LDLC')).toMatchObject({ platform: 'x', username: 'LDLC' })
    expect(socialLink('https://www.youtube.com/user/LDLCcom')).toMatchObject({ platform: 'youtube', username: 'user/LDLCcom' })
    expect(socialLink('https://www.tiktok.com/@ldlc.com')).toMatchObject({ platform: 'tiktok', username: 'ldlc.com' })
    expect(socialLink('https://www.linkedin.com/company/o2switch/')).toMatchObject({ platform: 'linkedin', username: 'company/o2switch' })
    expect(socialLink('https://www.facebook.com/sharer/sharer.php?u=x')).toBeNull()
    expect(socialLink('https://twitter.com/intent/tweet?text=x')).toBeNull()
    expect(socialLink('https://mastodon.social/@Gargron')).toMatchObject({ platform: 'mastodon', username: '@Gargron@mastodon.social' })
  })

  it('détecte les identifiants de traçage', () => {
    const html = `gtag('config', 'G-ABCDE12345'); <script src="https://www.googletagmanager.com/gtag/js?id=G-ABCDE12345"></script>
      fbq('init', '1234567890123'); ym(87654321, "init", {}); hjid:1234567, ca-pub-1234567890123456, UA-12345-6`
    const ids = trackers(html).map((t) => `${t.kind}|${t.id}`)
    expect(ids).toEqual(
      expect.arrayContaining([
        'Google Analytics 4|G-ABCDE12345',
        'Facebook Pixel|1234567890123',
        'Yandex Metrica|87654321',
        'Hotjar|1234567',
        'Google AdSense|ca-pub-1234567890123456',
        'Google Analytics (UA)|UA-12345-6'
      ])
    )
    expect(trackers('id="G-ABCDE12345"')).toEqual([])
  })

  it('identifie serveur, CMS et bibliothèques', () => {
    const tech = technologies(
      '<link href="/wp-content/themes/x/style.css?ver=6.4.2"><script src="/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>',
      { server: 'nginx/1.18.0', 'x-powered-by': 'PHP/8.1.2', 'cf-ray': 'abc' },
      { generator: 'WordPress 6.4.2' }
    )
    const byName = Object.fromEntries(tech.map((t) => [t.name, t.version ?? null]))
    expect(byName).toMatchObject({ nginx: '1.18.0', PHP: '8.1.2', WordPress: '6.4.2', Cloudflare: null })
    expect(Object.keys(byName)).toContain('jQuery')
  })
})

describe('web.page', () => {
  it('analyse la page réelle de LDLC (réduite)', () => {
    const out = analyzePage(
      {
        url: 'https://www.ldlc.com',
        finalUrl: 'https://www.ldlc.com/',
        status: 200,
        headers: fixtureJson('web/ldlc_headers.json'),
        cookies: ['PHPSESSID=abc; path=/'],
        html: fixture('web/ldlc.html')
      },
      'fr'
    )
    expect(out.properties?.title).toBe('LDLC - High-Tech Expérience')
    expect(out.properties?.lang).toBe('fr-FR')
    expect(out.properties?.server).toBe('ldlc')
    expect(types(out, 'phone')).toEqual(['+33427466000'])
    expect(types(out, 'tracker')).toEqual(['GTM-MFCHFFT'])
    const accounts = out.entities?.filter((e) => e.type === 'account').map((e) => `${e.platform}:${e.label}`)
    expect(accounts).toEqual(expect.arrayContaining(['x:LDLC', 'facebook:LDLC.com', 'instagram:ldlc', 'tiktok:ldlc.com', 'youtube:user/LDLCcom']))
    expect(out.properties?.missing_security_headers).toEqual(expect.arrayContaining(['permissions-policy']))
    expect(out.properties?.cookies).toEqual(['PHPSESSID'])
    expect(types(out, 'domain')).toEqual([])
  })

  it('analyse la page réelle de Marmiton (réduite) et signale la redirection', () => {
    const out = analyzePage(
      {
        url: 'https://marmiton.fr',
        finalUrl: 'https://www.marmiton.org/',
        status: 200,
        headers: fixtureJson('web/marmiton_headers.json'),
        cookies: [],
        html: fixture('web/marmiton.html')
      },
      'fr'
    )
    expect(types(out, 'email')).toEqual(['partenariats.licences@reworldmedia.com'])
    expect(types(out, 'tracker')).toEqual(expect.arrayContaining(['UA-1901803-10', 'GTM-MX2D67', 'GTM-N8FW6BPP']))
    expect(types(out, 'account').length).toBeGreaterThanOrEqual(5)
    expect(types(out, 'domain')).toEqual(['marmiton.org'])
    expect(String(out.properties?.description)).toMatch(/recettes de cuisine/)
  })

  it('exécute le module sur une réponse simulée', async () => {
    const ctx = fakeContext({
      routes: {
        'https://www.ldlc.com': { body: fixture('web/ldlc.html'), headers: { 'content-type': 'text/html; charset=UTF-8', server: 'ldlc' } }
      }
    })
    const out = await page.run(entity('website', 'www.ldlc.com'), ctx)
    expect(out.properties?.status_code).toBe(200)
    expect(guessCountry('fr', 'example.com')).toBe('FR')
    expect(guessCountry(null, 'example.co.uk')).toBe('GB')
  })

  it('signale un site injoignable', async () => {
    const ctx = fakeContext({})
    ctx.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(page.run(entity('url', 'https://nx.invalid/'), ctx)).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('web.robots', () => {
  it('lit robots.txt et security.txt', () => {
    const r = parseRobots(fixture('web/robots_ldlc.txt'))
    expect(r.disallow).toContain('/cart/')
    const g = parseSecurityTxt(fixture('web/security_google.txt'))
    expect(g.emails).toEqual(['security@google.com'])
    expect(g.expires).toBe('2030-04-01T00:00:00.000Z')
    expect(g.hiring).toBe('https://g.co/SecurityPrivacyEngJobs')
    expect(parseSecurityTxt(fixture('web/security_ovhcloud.txt')).emails).toEqual(['csirt@ovhcloud.com'])
  })

  it('exécute le module', async () => {
    const ctx = fakeContext({
      routes: {
        'https://www.ovhcloud.com/robots.txt': { body: 'User-agent: *\nDisallow: /admin/\nSitemap: https://www.ovhcloud.com/sitemap.xml', headers: { 'content-type': 'text/plain' } },
        'https://www.ovhcloud.com/.well-known/security.txt': { body: fixture('web/security_ovhcloud.txt'), headers: { 'content-type': 'text/plain' } }
      }
    })
    const out = await robots.run(entity('domain', 'www.ovhcloud.com'), ctx)
    expect(types(out, 'email')).toEqual(['csirt@ovhcloud.com'])
    expect(out.properties?.robots_interesting_paths).toEqual(['/admin/'])
    expect(types(out, 'url')).toContain('https://www.ovhcloud.com/sitemap.xml')
  })
})

describe('web.favicon', () => {
  it('implémente MurmurHash3 comme mmh3 (Python)', () => {
    expect(murmur3(Buffer.from('hello'))).toBe(613153351)
    expect(murmur3(Buffer.from(''))).toBe(0)
    expect(murmur3(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(776992547)
    const bytes = Buffer.concat([0, 1, 2].map(() => Buffer.from(Array.from({ length: 256 }, (_, i) => i))))
    expect(murmur3(Buffer.from(encodebytes(bytes)))).toBe(1836528006)
  })

  it('calcule l’empreinte Shodan d’un vrai favicon', () => {
    const ico = fixtureBytes('web/favicon_ldlc.ico')
    expect(faviconHash(ico)).toBe(-124005466)
    const out = buildFaviconOutput('https://www.ldlc.com/favicon.ico', ico, 'image/vnd.microsoft.icon', 'fr')
    expect(out.properties?.favicon_md5).toBe('01cb58472c5f9b0f2c08a636a79bcdad')
    expect(types(out, 'hash')).toEqual(['-124005466'])
    expect(types(out, 'search_link').length).toBe(4)
    expect(iconUrl(fixture('web/ldlc.html'), 'https://www.ldlc.com/')).toBe('https://www.ldlc.com/ldlc/build/img/common/favicon/favicon.ico')
  })

  it('exécute le module', async () => {
    const ctx = fakeContext({
      routes: {
        'https://www.ldlc.com/ldlc/build/img/common/favicon/favicon.ico': { body: fixtureBytes('web/favicon_ldlc.ico'), headers: { 'content-type': 'image/vnd.microsoft.icon' } },
        'https://www.ldlc.com/': { body: fixture('web/ldlc.html'), headers: { 'content-type': 'text/html' } }
      }
    })
    const out = await favicon.run(entity('website', 'https://www.ldlc.com'), ctx)
    expect(out.properties?.favicon_mmh3).toBe('-124005466')
  })
})

describe('tracker.lookup', () => {
  it('normalise les identifiants', () => {
    expect(normalizeTracker('ua-1901803-10')).toEqual({ id: 'UA-1901803-10', kind: 'Google Analytics (UA)', account: 'UA-1901803' })
    expect(normalizeTracker('pub-1234567890123456')?.id).toBe('ca-pub-1234567890123456')
    expect(normalizeTracker('gtm-p24pf4b')?.id).toBe('GTM-P24PF4B')
  })

  it('retrouve les sites partageant le même identifiant', async () => {
    expect(parseAnalyticsLookup(fixture('web/hackertarget_analytics_gtm.txt'))).toContain('bbpress.org')
    expect(parseAnalyticsLookup('no results found')).toEqual([])
    const ctx = fakeContext({ routes: { 'https://api.hackertarget.com/analyticslookup/': fixture('web/hackertarget_analytics_gtm.txt') } })
    const out = await tracker.run(entity('tracker', 'GTM-P24PF4B'), ctx)
    expect(types(out, 'domain')).toContain('af.wordpress.org')
    expect(types(out, 'search_link')).toContain('PublicWWW GTM-P24PF4B')
  })
})

describe.skipIf(!LIVE)('web en direct', () => {
  const ctx = makeContext()

  it('web.page', async () => {
    const out = await runModule(page, entity('website', 'https://www.ldlc.com'), ctx)
    expect(out.properties?.title).toBeTruthy()
    expect(types(out, 'account').length).toBeGreaterThan(2)
  }, 60000)

  it('web.robots', async () => {
    const out = await runModule(robots, entity('website', 'https://www.google.com'), ctx)
    expect(types(out, 'email')).toContain('security@google.com')
  })

  it('web.favicon', async () => {
    const out = await runModule(favicon, entity('website', 'https://www.ldlc.com'), ctx)
    expect(out.properties?.favicon_mmh3).toBeTruthy()
  })

  it('tracker.lookup', async (t) => {
    try {
      const out = await runModule(tracker, entity('tracker', 'GTM-P24PF4B'), ctx)
      expect(types(out, 'search_link').length).toBe(4)
    } catch (e) {
      // Quota gratuit HackerTarget partagé par adresse IP (50 requêtes par jour).
      if (e instanceof ModuleError && e.code === 'rate_limited') t.skip()
      else throw e
    }
  })
})
