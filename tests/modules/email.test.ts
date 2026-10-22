import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModuleContext } from '@shared/modules'
import { createSession, splitEmail } from '../../src/main/modules/email/_lib'
import { classifyAmazon, parseAmazonSignin } from '../../src/main/modules/email/_amazon'
import { interpretEntra, interpretMsa, parseMsaLoginPage } from '../../src/main/modules/email/_microsoft'
import emailrep, { parseEmailRep, usDate } from '../../src/main/modules/email/emailrep'
import github, { parseGithubCommits } from '../../src/main/modules/email/github'
import gravatar, { parseGravatarLegacy, parseGravatarV3 } from '../../src/main/modules/email/gravatar'
import { parseHibp } from '../../src/main/modules/email/hibp'
import hudsonrock, { parseCavalier, windowsUser } from '../../src/main/modules/email/hudsonrock'
import info, { canonicalEmail, dmarcPolicy, isDisposable, mailHost, usernameCandidate } from '../../src/main/modules/email/info'
import leakcheck, { parseLeakcheck } from '../../src/main/modules/email/leakcheck'
import links from '../../src/main/modules/email/links'
import microsoft from '../../src/main/modules/email/microsoft'
import office365 from '../../src/main/modules/email/office365'
import amazon from '../../src/main/modules/email/amazon'
import xposedornot, { parseXposedOrNot } from '../../src/main/modules/email/xposedornot'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fx = (name: string): string => readFileSync(resolve(__dirname, '../fixtures/email', name), 'utf8')
const json = <T = any>(name: string): T => JSON.parse(fx(name)) as T

/** Contexte hors ligne : fetch simulé par une table d'URL. */
function fakeContext(routes: Array<[RegExp, (init?: RequestInit) => Response]>, extra: Partial<ModuleContext> = {}): ModuleContext {
  const base = makeContext()
  return {
    ...base,
    fetch: async (url, init) => {
      const route = routes.find(([re]) => re.test(url))
      if (!route) throw new Error(`URL non simulée : ${url}`)
      return route[1](init)
    },
    ...extra
  }
}

describe('email : utilitaires', () => {
  it('découpe et normalise une adresse', () => {
    expect(splitEmail(' John.Doe+news@GMail.com ')).toEqual({ email: 'john.doe+news@gmail.com', local: 'john.doe+news', domain: 'gmail.com' })
    expect(splitEmail('pas une adresse')).toBeNull()
  })

  it('suit les redirections et conserve les cookies', async () => {
    const seen: string[] = []
    const ctx = fakeContext([
      [/\/start$/, () => new Response(null, { status: 302, headers: { location: '/next', 'set-cookie': 'sid=abc; Path=/' } })],
      [
        /\/next$/,
        (init) => {
          seen.push(new Headers(init?.headers).get('cookie') ?? '')
          return new Response('ok', { status: 200, headers: { 'set-cookie': 'csrftoken=xyz; Path=/' } })
        }
      ]
    ])
    const s = createSession(ctx)
    const r = await s.request('https://example.test/start')
    expect(r.url).toBe('https://example.test/next')
    expect(await r.res.text()).toBe('ok')
    expect(seen[0]).toBe('sid=abc')
    expect(s.cookie('csrftoken')).toBe('xyz')
  })
})

describe('email.info', () => {
  it('reconnaît les domaines jetables, y compris les sous-domaines', () => {
    expect(isDisposable('yopmail.com')).toBe(true)
    expect(isDisposable('abc.mailinator.com')).toBe(true)
    expect(isDisposable('gmail.com')).toBe(false)
  })

  it("déduit l'hébergeur de messagerie des MX", () => {
    expect(mailHost(['aspmx.l.google.com', 'alt1.aspmx.l.google.com'])).toBe('Google Workspace')
    expect(mailHost(['contoso-com.mail.protection.outlook.com'])).toBe('Microsoft 365')
    expect(mailHost(['mx1.mail.ovh.net'])).toBe('OVHcloud')
    expect(mailHost(['mx.example.org'])).toBeUndefined()
  })

  it('calcule l’adresse canonique, la politique DMARC et le pseudo possible', () => {
    expect(canonicalEmail('j.o.h.n+promo@googlemail.com')).toBe('john@gmail.com')
    expect(canonicalEmail('jean+tag@outlook.fr')).toBe('jean@outlook.fr')
    expect(dmarcPolicy(['v=DMARC1; p=reject; rua=mailto:x@y.z'])).toBe('reject')
    expect(dmarcPolicy(['google-site-verification=abc'])).toBeUndefined()
    expect(usernameCandidate('jean.dupont75+promo')).toBe('jean.dupont75')
    expect(usernameCandidate('contact')).toBeUndefined()
    expect(usernameCandidate('1234')).toBeUndefined()
  })

  it('analyse une adresse professionnelle avec un DNS simulé', async () => {
    const dns: Record<string, string[]> = {
      'MX example.fr': ['10 mx1.mail.ovh.net', '20 mx2.mail.ovh.net'],
      'TXT example.fr': ['v=spf1 include:mx.ovh.com ~all'],
      'TXT _dmarc.example.fr': ['v=DMARC1; p=none']
    }
    const ctx = fakeContext([], { resolveDns: async (name, type) => dns[`${type} ${name}`] ?? [] })
    const out = await runModule(info, entity('email', 'Jean.Dupont@example.fr'), ctx)
    expect(out.properties).toMatchObject({
      domain: 'example.fr',
      valid_mx: true,
      disposable: false,
      provider: 'OVHcloud',
      dmarc_policy: 'none',
      mx: ['mx1.mail.ovh.net', 'mx2.mail.ovh.net']
    })
    expect(out.entities?.find((e) => e.type === 'domain')?.label).toBe('example.fr')
    // Partie locale de l'adresse : pseudo plausible, mis de côté dans « À vérifier ».
    expect(out.entities?.find((e) => e.type === 'username')).toMatchObject({ label: 'jean.dupont', review: true })
  })

  it("ne crée pas d'entité domaine pour un webmail", async () => {
    const ctx = fakeContext([], { resolveDns: async () => ['5 gmail-smtp-in.l.google.com'] })
    const out = await runModule(info, entity('email', 'j.doe+x@gmail.com'), ctx)
    expect(out.properties?.provider).toBe('Gmail')
    expect(out.entities?.some((e) => e.type === 'domain')).toBe(false)
    expect(out.entities?.find((e) => e.type === 'email')?.label).toBe('jdoe@gmail.com')
  })
})

describe('email.links', () => {
  it('propose quelques recherches manuelles, aucune entité', async () => {
    const out = await runModule(links, entity('email', 'john@example.com'))
    expect(out.entities).toBeUndefined()
    const urls = out.manual!.map((m) => m.url)
    expect(urls).toContain('https://www.google.com/search?q=%22john%40example.com%22')
    expect(urls.some((u) => u.startsWith('https://epieos.com/'))).toBe(true)
    expect(out.manual!.map((m) => m.label)).toEqual(['Google', 'Epieos', 'Intelligence X'])
    expect(out.manual!.every((m) => m.hint)).toBe(true)
  })
})

describe('email.microsoft (parsing)', () => {
  it('extrait les jetons de la page de connexion', () => {
    const t = parseMsaLoginPage(fx('microsoft_login.html'))
    expect(t?.url).toMatch(/^https:\/\/login\.live\.com\/GetCredentialType\.srf\?/)
    expect(t?.flowToken.length).toBeGreaterThan(20)
    expect(t?.uaid).toMatch(/^[a-f0-9]{32}$/)
  })

  it('lit un compte existant et ses preuves masquées', () => {
    const r = interpretMsa(json('microsoft_found.json'))
    expect(r.found).toBe(true)
    expect(r.data.has_password).toBe(true)
    expect(r.data.recovery_phones).toEqual(['********59 (US)'])
    expect(interpretMsa(json('microsoft_found_email_proof.json')).data.recovery_emails).toEqual(['test@gmail.com'])
  })

  it('distingue un compte inexistant et une session refusée', () => {
    expect(interpretMsa(json('microsoft_notfound.json')).found).toBe(false)
    expect(() => interpretMsa({ ErrorHR: '80046703' })).toThrow(/session/)
  })

  it('domaine réservé à une organisation (microsoft.com) : absent, pas une session refusée', () => {
    expect(interpretMsa(json('microsoft_reserved_domain.json'))).toEqual({ found: false, data: {} })
  })

  it('enchaîne page de connexion et vérification (fetch simulé)', async () => {
    const ctx = fakeContext([
      [/login\.srf/, () => new Response(fx('microsoft_login.html'), { headers: { 'set-cookie': 'MSPRequ=1; path=/' } })],
      [/GetCredentialType\.srf/, () => new Response(fx('microsoft_found.json'))]
    ])
    const out = await runModule(microsoft, entity('email', 'test@outlook.com'), ctx)
    expect(out.found).toBe(true)
    expect(out.entities?.[0]).toMatchObject({ type: 'account', platform: 'microsoft', label: 'test@outlook.com' })
  })
})

describe('email.office365 (parsing)', () => {
  it('interprète les types de domaine Entra ID', () => {
    expect(interpretEntra(json('entra_found.json'))).toMatchObject({ found: true, tenant: 'managed' })
    expect(interpretEntra(json('entra_notfound.json'))).toMatchObject({ found: false, tenant: 'managed' })
    expect(interpretEntra(json('entra_nodomain.json'))).toMatchObject({ found: false, tenant: 'none' })
    const fed = interpretEntra(json('entra_federated.json'))
    expect(fed.found).toBeUndefined()
    expect(fed.identityProvider).toBe('okta.okta.com')
  })

  it('ignore les webmails grand public', () => {
    expect(office365.accepts?.(entity('email', 'jean@gmail.com'))).toBe(false)
    expect(office365.accepts?.(entity('email', 'jean@contoso.com'))).toBe(true)
  })
})

describe('email.amazon (parsing)', () => {
  it('lit le formulaire de connexion', () => {
    const form = parseAmazonSignin(fx('amazon_signin.html'))
    expect(form?.action).toMatch(/^\/ax\/claim\?arb=/)
    expect(form?.fields.some(([n]) => n === 'anti-csrftoken-a2z')).toBe(true)
  })

  it('classe la page suivante', () => {
    expect(classifyAmazon(fx('amazon_found.html'), 'https://www.amazon.com/ax/claim?arb=x').found).toBe(true)
    expect(classifyAmazon(fx('amazon_notfound.html'), 'https://www.amazon.com/ax/claim/intent?arb=x').found).toBe(false)
    expect(() => classifyAmazon('<img id="auth-captcha-image" src="x">', 'https://www.amazon.com/ap/cvf')).toThrow(/captcha/)
  })

  it('enchaîne les deux étapes (fetch simulé)', async () => {
    const ctx = fakeContext([
      [/\/ap\/signin/, () => new Response(null, { status: 302, headers: { location: '/ax/claim?arb=1' } })],
      [/\/ax\/claim\?arb=1$/, () => new Response(fx('amazon_signin.html'))],
      [/\/ax\/claim\?arb=771c/, () => new Response(fx('amazon_found.html'))]
    ])
    const out = await runModule(amazon, entity('email', 'john@gmail.com'), ctx)
    expect(out.found).toBe(true)
    expect(out.entities?.[0]).toMatchObject({ platform: 'amazon', label: 'john@gmail.com' })
  })
})

describe('email.gravatar (parsing)', () => {
  it('lit le profil historique et les comptes vérifiés', () => {
    const out = parseGravatarLegacy(json('gravatar_legacy.json'), 'beau@automattic.com', 'fr')
    const main = out.entities?.[0]
    expect(main).toMatchObject({ type: 'account', platform: 'gravatar', label: 'beau' })
    expect(main?.data?.location).toBe('Golden, CO')
    expect(main?.image).toContain('gravatar.com/avatar/')
    const linked = out.entities?.filter((e) => e.from === 'gravatar' && e.type === 'account') ?? []
    expect(linked.map((e) => `${e.platform}:${e.label}`)).toEqual(
      expect.arrayContaining(['x:beaulebens', 'github:beaulebens', 'linkedin:beaulebens', 'instagram:beaulebens'])
    )
  })

  it("lit le profil de l'API v3", () => {
    const out = parseGravatarV3(json('gravatar_v3.json'), 'beau@automattic.com', 'en')
    expect(out.entities?.[0]).toMatchObject({ platform: 'gravatar', label: 'beau' })
    expect(out.entities?.some((e) => e.platform === 'github' && e.label === 'beaulebens')).toBe(true)
  })
})

describe('email.hudsonrock (parsing)', () => {
  it('crée une entité par infection', () => {
    const out = parseCavalier(json('hudsonrock_found.json'), 'fr')
    expect(out.entities).toHaveLength(3)
    const first = out.entities![0]
    expect(first.type).toBe('infostealer')
    expect(first.data?.date_compromised).toBe('2026-10-19T12:18:06.000Z')
    expect(first.data?.windows_user).toBe('ASUS-TUF')
    expect(out.entities![2].data?.computer_name).toBeUndefined()
    expect(out.properties?.infostealer_count).toBe(3)
    expect(new Set(out.entities!.map((e) => e.label)).size).toBe(3)
  })

  it('renvoie un résultat vide sans infection', () => {
    expect(parseCavalier(json('hudsonrock_notfound.json'), 'fr').entities).toBeUndefined()
    expect(windowsUser('C:\\Users\\Public\\x.exe')).toBeUndefined()
  })
})

describe('fuites de données (parsing)', () => {
  it('XposedOrNot', () => {
    const out = parseXposedOrNot(json('xposedornot_found.json'), 'fr')
    expect(out.entities).toHaveLength(4)
    expect(out.entities![0].type).toBe('breach')
    expect(Array.isArray(out.entities![0].data?.data_classes)).toBe(true)
    expect((out.properties?.breaches as string[]).length).toBe(4)
    expect(parseXposedOrNot(json('xposedornot_notfound.json'), 'fr').entities).toBeUndefined()
  })

  it('LeakCheck', () => {
    const out = parseLeakcheck(json('leakcheck_found.json'), 'fr')
    expect(out.entities).toHaveLength(6)
    expect(out.properties?.leak_count).toBe(json('leakcheck_found.json').found)
    expect(parseLeakcheck(json('leakcheck_notfound.json'), 'fr').entities).toBeUndefined()
  })

  it('Have I Been Pwned', () => {
    const out = parseHibp(json('hibp_breaches.json'), json('hibp_pastes.json'), 'fr')
    const adobe = out.entities?.find((e) => e.label === 'Adobe')
    expect(adobe?.data).toMatchObject({ breach_date: '2013-10-04', records: 152445165 })
    expect(adobe?.data?.description).not.toMatch(/<a /)
    expect(out.entities?.find((e) => e.type === 'document')?.data?.url).toBe('https://pastebin.com/8Q0BvKD8')
    expect(parseHibp([], [], 'fr')).toEqual({})
  })
})

describe('email.emailrep et email.github (parsing)', () => {
  it('EmailRep', () => {
    const out = parseEmailRep(json('emailrep.json'), 'bill@microsoft.com', 'fr')
    expect(out.properties).toMatchObject({ reputation: 'high', first_seen: '2008-07-01', credentials_leaked: true })
    expect(out.entities?.some((e) => e.platform === 'x')).toBe(true)
    expect(usDate('never')).toBeUndefined()
  })

  it('GitHub', () => {
    const out = parseGithubCommits(json('github_commits.json'), 'fr')
    expect(out.found).toBe(true)
    expect(out.entities).toHaveLength(1)
    expect(out.entities![0]).toMatchObject({ platform: 'github', label: 'octocat' })
    expect(out.properties?.github_commit_names).toEqual(['The Octocat', 'Octocat'])
    expect(parseGithubCommits({ total_count: 0, items: [] }, 'fr').found).toBe(false)
  })
})

describe.skipIf(!LIVE)('email (live)', () => {
  const ctx = makeContext()
  const absent = `zq8xk2vmw93pq7.${Date.now().toString(36)}@gmail.com`

  it('email.info', async () => {
    const out = await runModule(info, entity('email', 'satyan@microsoft.com'), ctx)
    expect(out.properties?.valid_mx).toBe(true)
    expect(out.properties?.provider).toBe('Microsoft 365')
  })

  it('email.microsoft', async () => {
    expect((await runModule(microsoft, entity('email', 'test@outlook.com'), ctx)).found).toBe(true)
    expect((await runModule(microsoft, entity('email', absent), ctx)).found).toBe(false)
    // Domaine réservé à une organisation (ErrorHR 800478AC) : absent, pas une session refusée.
    expect((await runModule(microsoft, entity('email', 'zq8xk2vmw93pq7abc@microsoft.com'), ctx)).found).toBe(false)
  })

  it('email.office365', async () => {
    expect((await runModule(office365, entity('email', 'satyan@microsoft.com'), ctx)).found).toBe(true)
    expect((await runModule(office365, entity('email', 'zq8xk2vmw93pq7@microsoft.com'), ctx)).found).toBe(false)
  })

  it('email.amazon', async () => {
    expect((await runModule(amazon, entity('email', 'john@gmail.com'), ctx)).found).toBe(true)
    expect((await runModule(amazon, entity('email', absent), ctx)).found).toBe(false)
  }, 60000)

  it('email.gravatar', async () => {
    const out = await runModule(gravatar, entity('email', 'beau@automattic.com'), ctx)
    expect(out.found).toBe(true)
    expect(out.entities?.some((e) => e.platform === 'github')).toBe(true)
    expect((await runModule(gravatar, entity('email', absent), ctx)).found).toBe(false)
  })

  it('email.hudsonrock', async () => {
    expect((await runModule(hudsonrock, entity('email', 'test@gmail.com'), ctx)).entities?.length).toBeGreaterThan(0)
    expect((await runModule(hudsonrock, entity('email', absent), ctx)).entities).toBeUndefined()
  })

  it('email.xposedornot', async () => {
    expect((await runModule(xposedornot, entity('email', 'test@gmail.com'), ctx)).entities?.length).toBeGreaterThan(0)
    expect((await runModule(xposedornot, entity('email', absent), ctx)).entities).toBeUndefined()
  })

  it('email.leakcheck', async () => {
    expect((await runModule(leakcheck, entity('email', 'test@gmail.com'), ctx)).entities?.length).toBeGreaterThan(0)
    expect((await runModule(leakcheck, entity('email', absent), ctx)).entities).toBeUndefined()
  })

  it.skipIf(!process.env.MASINT_KEY_EMAILREP)('email.emailrep', async () => {
    expect((await runModule(emailrep, entity('email', 'bill@microsoft.com'), ctx)).properties?.reputation).toBeTruthy()
  })

  // L'API de recherche GitHub est bloquée dans certains bacs à sable : test activé à la demande.
  it.skipIf(!process.env.MASINT_LIVE_GITHUB)('email.github', async () => {
    const out = await runModule(github, entity('email', 'torvalds@linux-foundation.org'), ctx)
    expect(out.found).toBe(true)
  })
})
