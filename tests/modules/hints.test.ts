import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FetchOptions, ModuleContext } from '@shared/modules'
import crossmatch, { analyze, hintsOf } from '../../src/main/modules/hints/crossmatch'
import recovery, { queryOf } from '../../src/main/modules/hints/recovery'
import { localPartsFor, namesOf, phonesOf, pseudosOf, splitFullName } from '../../src/main/modules/hints/_candidates'
import { EMAIL_PROVIDERS, isMicrosoftConsumerDomain, plausibleLocal } from '../../src/main/modules/hints/_domains'
import {
  callingCodeLabel,
  domainsMatching,
  emailMatches,
  maskKey,
  parseEmailMask,
  parseHint,
  parsePhoneMask,
  phoneMatches,
  type EmailMask,
  type PhoneMask
} from '../../src/main/modules/hints/_mask'
import {
  adobeHints,
  interpretAdobeProfile,
  interpretAvailability,
  interpretMsaHints,
  microsoftAvailability,
  msaSafeBody,
  parseSignupPage,
  type MsaHintResponse
} from '../../src/main/modules/hints/_services'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fx = (name: string): string => readFileSync(resolve(__dirname, '../fixtures/hints', name), 'utf8')
const json = <T = any>(name: string): T => JSON.parse(fx(name)) as T
const msLogin = readFileSync(resolve(__dirname, '../fixtures/email/microsoft_login.html'), 'utf8')

const em = (mask: string): EmailMask => parseEmailMask(mask)!
const pm = (mask: string, country?: string): PhoneMask => parsePhoneMask(mask, country)!

interface Call {
  url: string
  method: string
  headers: Headers
  body: unknown
}

/** Contexte hors ligne : fetch simulé par une table d'URL, requêtes enregistrées. */
function fakeContext(routes: Array<[RegExp, (call: Call) => Response]>, calls: Call[] = []): ModuleContext {
  const base = makeContext()
  return {
    ...base,
    fetch: async (url: string, init: FetchOptions = {}) => {
      const target = init.query ? `${url}?${new URLSearchParams(init.query as Record<string, string>)}` : url
      const call: Call = { url: target, method: (init.method ?? 'GET').toUpperCase(), headers: new Headers(init.headers as ConstructorParameters<typeof Headers>[0]), body: init.json ?? init.body }
      calls.push(call)
      const route = routes.find(([re]) => re.test(target))
      if (!route) throw new Error(`URL non simulée : ${target}`)
      return route[1](call)
    }
  }
}

describe('hints : lecture des indices', () => {
  it('sépare le masque, les sources et le pays', () => {
    expect(parseHint('a•••••@g•••••.com (Apple)')).toEqual({ kind: 'email', mask: 'a•••••@g•••••.com', sources: ['Apple'] })
    expect(parseHint('j••••@g••••.com (Apple, Sleeper)')?.sources).toEqual(['Apple', 'Sleeper'])
    expect(parseHint('Microsoft : te*****@gmail.com')).toEqual({ kind: 'email', mask: 'te*****@gmail.com', sources: ['Microsoft'] })
    expect(parseHint('********59 (US)', 'Microsoft')).toEqual({ kind: 'phone', mask: '********59', sources: ['Microsoft'], country: 'US' })
    expect(parseHint('+33 •• •• •• •• 42')).toMatchObject({ kind: 'phone', mask: '+33 •• •• •• •• 42', sources: [] })
  })

  it('ignore les valeurs en clair et le texte libre', () => {
    expect(parseHint('jean@gmail.com')).toBeNull()
    expect(parseHint('+33612345678')).toBeNull()
    expect(parseHint('texte libre')).toBeNull()
    expect(parseHint('')).toBeNull()
  })

  it('reconnaît le même masque écrit avec des caractères différents', () => {
    const a = parseHint('a*****@g*****.com')!
    const b = parseHint('a•••••@g•••••.com (Apple)')!
    expect(maskKey(a)).toBe(maskKey(b))
    expect(maskKey(parseHint('+33 6 XX XX XX 42')!)).toBe(maskKey(parseHint('+336••••••42')!))
  })
})

describe('hints : emails masqués', () => {
  it('propose les fournisseurs compatibles avec le domaine masqué', () => {
    expect(domainsMatching(em('a•••••@g•••••.com'), EMAIL_PROVIDERS)).toEqual(['gmail.com', 'gmx.com', 'googlemail.com'])
    const o = domainsMatching(em('j•••@o•••••.fr'), EMAIL_PROVIDERS)
    expect(o.slice(0, 2)).toEqual(['outlook.fr', 'orange.fr'])
    expect(domainsMatching(em('te*****@gmail.com'), EMAIL_PROVIDERS)).toEqual(['gmail.com'])
    expect(domainsMatching(em('x•••@c•••••.fr'), EMAIL_PROVIDERS)).toContain('club-internet.fr')
    expect(domainsMatching(em('x•••@q•••••.fr'), EMAIL_PROVIDERS)).toEqual([])
  })

  it('teste la compatibilité d’une adresse complète', () => {
    // Format Adobe : première et dernière lettre de la partie locale et du domaine.
    expect(emailMatches(em('p•••••s@a•••••e.com'), 'press@adobe.com')).toBe(true)
    expect(emailMatches(em('p•••••s@a•••••e.com'), 'presse@adobe.com')).toBe(false)
    expect(emailMatches(em('te*****@gmail.com'), 'Test.User@GMAIL.com')).toBe(true)
    expect(emailMatches(em('te*****@gmail.com'), 'tx@gmail.com')).toBe(false)
    // Format X : extension masquée aussi.
    expect(emailMatches(em('ab**********@g****.***'), 'abcdef@gmail.com')).toBe(true)
  })
})

describe('hints : téléphones masqués', () => {
  it('lit indicatif, chiffres de tête et de fin', () => {
    expect(pm('+33 •• •• •• •• 42')).toMatchObject({ cc: '33', leading: '', trailing: '42' })
    expect(pm('********59', 'US')).toMatchObject({ cc: '1', trailing: '59' })
    expect(pm('06 •• •• •• 42')).toMatchObject({ cc: undefined, leading: '6', trailing: '42' })
    expect(pm('+33 6 XX XX XX 42')).toMatchObject({ cc: '33', leading: '6', trailing: '42' })
    expect(pm('+336•••••••42')).toMatchObject({ cc: '33', leading: '6', trailing: '42' })
    expect(pm('+1 ***-***-71')).toMatchObject({ cc: '1', trailing: '71' })
    expect(parsePhoneMask('+33612345678')).toBeNull()
  })

  it('teste la compatibilité d’un numéro complet', () => {
    expect(phoneMatches(pm('+33 •• •• •• •• 42'), '+33612345642')).toBe(true)
    expect(phoneMatches(pm('+33 •• •• •• •• 42'), '+33612345678')).toBe(false)
    expect(phoneMatches(pm('+33 •• •• •• •• 42'), '+447700900042')).toBe(false)
    expect(phoneMatches(pm('06 •• •• •• 42'), '0612345642')).toBe(true)
    // Un seul chiffre visible ne suffit pas pour rapprocher.
    expect(phoneMatches(pm('+33 •••••••••2'), '+33612345642')).toBe(false)
  })

  it('nomme le pays d’un indicatif', () => {
    expect(callingCodeLabel('33', 'fr')).toBe('France')
    expect(callingCodeLabel('44', 'en')).toBe('United Kingdom')
    expect(callingCodeLabel('1', 'fr')).toBe('Amérique du Nord')
  })
})

describe('hints : matière des candidats', () => {
  it('découpe un nom complet', () => {
    expect(splitFullName('Jean Dupont')).toMatchObject({ first: 'Jean', last: 'Dupont' })
    expect(splitFullName('DUPONT Jean')).toMatchObject({ first: 'Jean', last: 'DUPONT' })
    expect(splitFullName('Jean-Pierre de la Fontaine')).toMatchObject({ first: 'Jean-Pierre', last: 'de la Fontaine' })
    expect(splitFullName('jean')).toBeNull()
    expect(splitFullName('jean@example.com')).toBeNull()
  })

  it('construit les parties locales, les plus courantes d’abord', () => {
    const parts = localPartsFor({ first: 'Hélène', last: 'Lefèvre', display: 'Hélène Lefèvre' }, 'fr').map((p) => p.local)
    expect(parts.slice(0, 4)).toEqual(['helene.lefevre', 'helenelefevre', 'h.lefevre', 'hlefevre'])
    const compound = localPartsFor({ first: 'Jean-Pierre', last: 'Martin', display: 'Jean-Pierre Martin' }, 'en').map((p) => p.local)
    expect(compound).toContain('jean-pierre.martin')
    expect(compound).toContain('jeanpierre.martin')
  })

  it('lit noms, pseudos et numéros de la fiche', () => {
    const acc = entity('account', 'alicem', { platform: 'apple', data: { display_name: 'Alice Martin', aliases: ['@Alice_M', '0612345678'], phone: '06 12 34 56 42' } })
    expect(namesOf(acc).map((n) => n.display)).toEqual(['Alice Martin'])
    expect(pseudosOf(acc)).toEqual(['alicem', 'alice_m'])
    expect(phonesOf(acc)).toEqual(['+33612345642'])
    expect(pseudosOf(entity('email', 'alice.m@orange.fr'))).toEqual(['alice.m'])
    expect(namesOf(entity('person', 'Alice Martin', { data: { first_name: 'Alice', last_name: 'Martin' } }))).toHaveLength(1)
  })

  it('applique les règles connues des fournisseurs', () => {
    expect(plausibleLocal('jean.dupont', 'gmail.com')).toBe(true)
    expect(plausibleLocal('jean_dupont', 'gmail.com')).toBe(false)
    expect(plausibleLocal('alice', 'gmail.com')).toBe(false)
    expect(plausibleLocal('jdupont', 'outlook.fr')).toBe(true)
    expect(plausibleLocal('1abc', 'outlook.fr')).toBe(false)
    expect(isMicrosoftConsumerDomain('hotmail.fr')).toBe(true)
    expect(isMicrosoftConsumerDomain('gmail.com')).toBe(false)
  })
})

describe('hints.crossmatch (sans réseau)', () => {
  const apple = entity('account', 'alicem', {
    platform: 'apple',
    data: { masked_emails: ['a•••••@g•••••.com'], masked_phones: ['+33 •• •• •• •• 42'], display_name: 'Alice Martin' }
  })

  it('attribue les indices d’un compte à sa plateforme et regroupe les doublons', () => {
    const node = entity('phone', '+33612345642', {
      data: { masked_emails: ['a•••••@g•••••.com (Apple)', 'a*****@g*****.com (Microsoft)'], recovery_hints: ['+1 ***-***-71'] }
    })
    expect(hintsOf(apple).map((h) => h.sources)).toEqual([['Apple'], ['Apple']])
    const hints = hintsOf(node)
    expect(hints).toHaveLength(2)
    expect(hints[0].sources).toEqual(['Apple', 'Microsoft'])
  })

  it('déduit lettre, fournisseurs et chiffres connus', () => {
    const { deductions, domains } = analyze(apple, 'fr')
    expect(deductions[0]).toBe('a•••••@g•••••.com (Apple) : commence par « a », fournisseur probable : gmail.com, gmx.com, googlemail.com')
    expect(deductions[1]).toBe('+33 •• •• •• •• 42 (Apple) : indicatif +33 (France), se termine par 42')
    expect(domains).toEqual(['gmail.com', 'gmx.com', 'googlemail.com'])
  })

  it('propose des adresses compatibles, les plus probables d’abord', () => {
    const { candidates } = analyze(apple, 'fr')
    const values = candidates.map((c) => c.value)
    expect(values.slice(0, 3)).toEqual(['alice.martin@gmail.com', 'alicem@gmail.com', 'alicemartin@gmail.com'])
    expect(values).toContain('a.martin@gmail.com')
    expect(values).not.toContain('alice_martin@gmail.com')
    expect(values).not.toContain('martin.alice@gmail.com')
    for (const v of values) expect(emailMatches(em('a•••••@g•••••.com'), v)).toBe(true)
    expect(candidates[0].basis).toBe('construit à partir de « Alice Martin » (prénom.nom)')
  })

  it('met en tête les adresses et numéros déjà présents dans la fiche', () => {
    const node = entity('person', 'Jean Dupont', {
      data: { masked_emails: ['j•••••@g•••••.com (Apple)'], masked_phones: ['+33 •• •• •• •• 42 (Apple)'], emails: ['jdupont75@gmail.com', 'autre@yahoo.fr'], phone: '+33612345642' }
    })
    const { candidates } = analyze(node, 'fr')
    expect(candidates.filter((c) => c.type === 'email')[0]).toMatchObject({ value: 'jdupont75@gmail.com', origin: 'known' })
    expect(candidates.find((c) => c.type === 'phone')).toMatchObject({ value: '+33612345642', hints: ['+33 •• •• •• •• 42 (Apple)'] })
    expect(candidates.some((c) => c.value === 'autre@yahoo.fr')).toBe(false)
  })

  it('ne construit rien depuis un masque sans lettre visible ni depuis l’entrée elle-même', () => {
    const blind = analyze(entity('person', 'Jean Dupont', { data: { masked_emails: ['•••••@gmail.com'] } }), 'fr')
    expect(blind.deductions[0]).toContain('partie locale entièrement masquée')
    expect(blind.candidates).toEqual([])
    const self = analyze(entity('email', 'jean.dupont@gmail.com', { data: { masked_emails: ['j•••••@g•••••.com (Adobe)'] } }), 'fr')
    expect(self.deductions[0]).toContain("correspond à l'adresse étudiée")
    expect(self.candidates).toEqual([])
  })

  it('n’est proposé que si l’entité porte des indices masqués', () => {
    expect(crossmatch.accepts?.(entity('email', 'x@example.com'))).toBe(false)
    expect(crossmatch.accepts?.(apple)).toBe(true)
    expect(crossmatch.accepts?.(entity('phone', '+33612345678', { data: { recovery_phones: ['********59 (US)'] } }))).toBe(true)
  })
})

describe('hints.crossmatch (vérification Microsoft simulée)', () => {
  const node = entity('person', 'Jean Dupont', { data: { masked_emails: ['j•••••@h•••••.com (Apple)'] } })
  const signupRoutes = (taken: string[], calls: Call[]): ModuleContext =>
    fakeContext(
      [
        [/signup\.live\.com\/signup/, () => new Response(fx('signup_page.html'))],
        [
          /CheckAvailableSigninNames/,
          (call) => {
            const name = (call.body as { signInName: string }).signInName
            return new Response(taken.includes(name) ? fx('signup_taken.json') : fx('signup_free.json'))
          }
        ]
      ],
      calls
    )

  it('écarte les adresses libres et garde celles qui existent', async () => {
    const calls: Call[] = []
    const out = await runModule(crossmatch, node, signupRoutes(['jean.dupont@hotmail.com'], calls))
    const checks = calls.filter((c) => /CheckAvailableSigninNames/.test(c.url))
    expect(checks).toHaveLength(8)
    // Jeton de la page, puis celui renvoyé par la dernière réponse qui en contenait un.
    expect(checks[0].headers.get('canary')).toBe('canary+exemple/1')
    expect(checks[1].headers.get('canary')).toBe('canary+exemple/1')
    expect(checks[2].headers.get('canary')).toBe('canary-suivant')
    // Huit adresses vérifiées, une seule existe ; la neuvième n'a pas été vérifiée.
    expect(out.entities?.map((e) => e.label)).toEqual(['jean.dupont@hotmail.com', 'jean@hotmail.com'])
    expect(out.entities?.[0]).toMatchObject({
      type: 'email',
      review: true,
      reviewReason: 'compatible avec j•••••@h•••••.com (Apple) ; construit à partir de « Jean Dupont » (prénom.nom) ; compte Microsoft existant',
      data: { mailbox_exists: true, match_source: 'j•••••@h•••••.com (Apple)' }
    })
    expect(out.properties?.hint_email_domains).toEqual(['hotmail.com'])
  })

  it('garde les candidats si la vérification échoue', async () => {
    const ctx = fakeContext([[/signup\.live\.com/, () => new Response('indisponible', { status: 503 })]])
    const out = await runModule(crossmatch, node, ctx)
    expect(out.entities?.length).toBe(9)
    expect((out.raw as { verification_error?: string }).verification_error).toMatch(/Microsoft/)
  })

  it('garde les réponses obtenues avant une interruption', async () => {
    let n = 0
    const ctx = fakeContext([
      [/signup\.live\.com\/signup/, () => new Response(fx('signup_page.html'))],
      [/CheckAvailableSigninNames/, () => (++n === 1 ? new Response(fx('signup_taken.json')) : n === 2 ? new Response(fx('signup_free.json')) : new Response('', { status: 429 }))]
    ])
    const out = await runModule(crossmatch, node, ctx)
    expect(out.entities?.[0]).toMatchObject({ label: 'jean.dupont@hotmail.com', data: { mailbox_exists: true } })
    expect(out.entities?.map((e) => e.label)).not.toContain('jeandupont@hotmail.com')
    expect(out.entities?.length).toBe(8)
    expect((out.raw as { verification_error?: string }).verification_error).toMatch(/trop de requêtes/)
  })

  it('ne vérifie pas les domaines Microsoft fermés à l’inscription', async () => {
    const calls: Call[] = []
    const out = await runModule(crossmatch, entity('person', 'Jean Dupont', { data: { masked_emails: ['j•••••@h•••••.fr (Apple)'] } }), fakeContext([], calls))
    expect(calls).toEqual([])
    expect(out.entities?.length).toBe(9)
  })

  it('fait passer en tête une adresse utilisée par un compte Microsoft, sans écarter les autres', async () => {
    const calls: Call[] = []
    const alice = entity('person', 'Alice Martin', { data: { masked_emails: ['a•••••@g•••••.com (Apple)'] } })
    const out = await runModule(crossmatch, alice, signupRoutes(['amartin@gmail.com'], calls))
    expect(calls.filter((c) => /CheckAvailableSigninNames/.test(c.url))).toHaveLength(8)
    expect(out.entities?.[0]).toMatchObject({
      label: 'amartin@gmail.com',
      reviewReason: 'compatible avec a•••••@g•••••.com (Apple) ; construit à partir de « Alice Martin » (pnom) ; adresse utilisée par un compte Microsoft'
    })
    expect(out.entities?.[0].data?.mailbox_exists).toBeUndefined()
    expect(out.entities?.length).toBe(10)
    expect(out.entities?.map((e) => e.label)).toContain('alice.martin@gmail.com')
  })
})

describe('hints : services', () => {
  it('demande à Microsoft une étape sans code ni notification', () => {
    expect(msaSafeBody('jean@example.com', 'u', 'f')).toMatchObject({
      otclogindisallowed: true,
      forceotclogin: false,
      isRemoteNGCSupported: false,
      isFidoSupported: false,
      checkPhones: false
    })
    expect(msaSafeBody('+33612345678', 'u', 'f').checkPhones).toBe(true)
  })

  it('lit les preuves masquées de Microsoft, sans la valeur recherchée', () => {
    const r = interpretMsaHints(json('msa_proofs.json'), 'jean.exemple@example.com')
    expect(r).toMatchObject({ found: true, emails: ['je*****@gmail.com'], phones: ['+33 *******42'] })
    expect(r.alert).toBeUndefined()
    expect(interpretMsaHints(json('msa_notfound.json'), 'zq8xk2vmw93pq7@example.com')).toMatchObject({ found: false, emails: [], phones: [] })
  })

  it('signale une réponse qui indique un envoi', () => {
    const sent = json<MsaHintResponse>('msa_proofs.json')
    sent.Credentials!.OtcLoginEligibleProofs![0].otcSent = true
    expect(interpretMsaHints(sent, 'jean.exemple@example.com').alert).toBe(true)
    const push: MsaHintResponse = { IfExistsResult: 0, Credentials: { PrefCredential: 2, RemoteNgcParams: { SessionIdentifier: 'x' } } }
    expect(interpretMsaHints(push, 'jean.exemple@example.com').alert).toBe(true)
  })

  it('lit le profil de récupération Adobe sans l’email principal', () => {
    expect(interpretAdobeProfile(json('adobe_challenges.json'), 'jean.exemple@example.com')).toMatchObject({
      found: true,
      emails: ['a•••••n@g•••••l.com'],
      phones: ['+33 •••••••42']
    })
    // Réponse observée pour une adresse presse publique : seul l'email principal, déjà connu.
    expect(interpretAdobeProfile(json('adobe_challenges_press.json'), 'press@adobe.com')).toMatchObject({ emails: [], phones: [] })
  })

  it('lit la page et les réponses de l’inscription Microsoft', () => {
    expect(parseSignupPage(fx('signup_page.html'))).toEqual({
      url: 'https://signup.live.com/API/CheckAvailableSigninNames',
      canary: 'canary+exemple/1',
      uaid: '0123456789abcdef0123456789abcdef'
    })
    expect(parseSignupPage('<html></html>')).toBeNull()
    expect(interpretAvailability(json('signup_free.json'))).toBe('free')
    expect(interpretAvailability(json('signup_taken.json'))).toBe('taken')
    expect(interpretAvailability({ error: { code: '1242' } })).toBe('taken')
    expect(interpretAvailability({ error: { code: '1043' } })).toBe('unknown')
  })

  it('ne démarre jamais de vérification Adobe', async () => {
    const calls: Call[] = []
    const ctx = fakeContext(
      [
        [/authenticationstate/, () => new Response(fx('adobe_state.json'), { headers: { 'x-ims-authentication-state-encrypted': 'jeton' } })],
        [/v3\/challenges/, () => new Response(fx('adobe_challenges.json'))]
      ],
      calls
    )
    const r = await adobeHints(ctx, 'jean.exemple@example.com')
    expect(r.emails).toEqual(['a•••••n@g•••••l.com'])
    const challenge = calls.find((c) => /challenges/.test(c.url))!
    expect(challenge.method).toBe('GET')
    expect(challenge.url).toMatch(/purpose=passwordRecovery/)
    expect(challenge.headers.get('x-ims-authentication-state-encrypted')).toBe('jeton')
  })
})

describe('hints.recovery (fetch simulé)', () => {
  const routes = (calls: Call[], adobe: () => Response = () => new Response(fx('adobe_state.json'), { headers: { 'x-ims-authentication-state-encrypted': 'jeton' } })): ModuleContext =>
    fakeContext(
      [
        [/login\.srf/, () => new Response(msLogin, { headers: { 'set-cookie': 'MSPRequ=1; path=/' } })],
        [/GetCredentialType\.srf/, () => new Response(fx('msa_proofs.json'))],
        [/authenticationstate/, adobe],
        [/v3\/challenges/, () => new Response(fx('adobe_challenges.json'))]
      ],
      calls
    )

  it('range les indices dans les emails et téléphones masqués, avec leur source', async () => {
    const calls: Call[] = []
    const out = await runModule(recovery, entity('email', 'Jean.Exemple@example.com'), routes(calls))
    expect(out.properties).toEqual({
      masked_emails: ['je*****@gmail.com (Microsoft)', 'a•••••n@g•••••l.com (Adobe)'],
      masked_phones: ['+33 *******42 (Microsoft)', '+33 •••••••42 (Adobe)']
    })
    const gct = calls.find((c) => /GetCredentialType/.test(c.url))!
    expect(gct.body).toMatchObject({ username: 'jean.exemple@example.com', otclogindisallowed: true, isRemoteNGCSupported: false })
    expect(calls.some((c) => /challenges/.test(c.url) && c.method === 'POST')).toBe(false)
    expect(out.found).toBeUndefined()
  })

  it('continue quand un service refuse, échoue quand tous refusent', async () => {
    const out = await runModule(recovery, entity('email', 'jean.exemple@example.com'), routes([], () => new Response('{}', { status: 429 })))
    expect(out.properties?.masked_emails).toEqual(['je*****@gmail.com (Microsoft)'])
    expect(JSON.stringify(out.raw)).toMatch(/Adobe : trop de requêtes/)
    const down = fakeContext([[/./, () => new Response('', { status: 503 })]])
    await expect(runModule(recovery, entity('email', 'jean.exemple@example.com'), down)).rejects.toThrow(/indisponible/)
  })

  it('n’interroge que Microsoft pour un numéro', async () => {
    const calls: Call[] = []
    const out = await runModule(recovery, entity('phone', '06 12 34 56 78'), routes(calls))
    expect(calls.some((c) => /adobe/.test(c.url))).toBe(false)
    expect((calls.find((c) => /GetCredentialType/.test(c.url))!.body as { username: string }).username).toBe('+33612345678')
    expect(out.properties?.masked_emails).toContain('je*****@gmail.com (Microsoft)')
  })

  it('refuse une valeur masquée', () => {
    expect(queryOf('phone', '06 12 34 56 78')).toBe('+33612345678')
    expect(queryOf('email', 'a•••@example.com')).toBeNull()
    expect(recovery.accepts?.(entity('phone', '+33 •• •• •• •• 42'))).toBe(false)
  })
})

// Services réels : adresses manifestement inexistantes, et adresses publiques d'organisations
// sur des étapes qui n'envoient rien.
describe.skipIf(!LIVE)('hints (live)', () => {
  const absent = 'zq8xk2vmw93pq7nouser@outlook.com'

  it('hints.recovery : rien pour une adresse inexistante', async () => {
    const out = await runModule(recovery, entity('email', absent))
    expect(out.properties).toBeUndefined()
    expect(JSON.stringify(out.raw)).toMatch(/"found":false/)
  })

  it('Adobe : profil de récupération d’une adresse presse publique', async () => {
    const r = await adobeHints(makeContext(), 'press@adobe.com')
    expect(r.found).toBe(true)
    expect(r.raw).toHaveProperty('availableFactors')
  })

  it('inscription Microsoft : adresse libre et adresse prise', async () => {
    const other = 'zq8xk2vmw93pq7nouser2@hotmail.com'
    const reserved = 'zq8xk2vmw93pq7nouser2@hotmail.fr'
    const res = await microsoftAvailability(makeContext(), ['support@mojang.com', absent, other, reserved])
    expect(res.get('support@mojang.com')).toBe('taken')
    expect(res.get(absent)).toBe('free')
    expect(res.get(other)).toBe('free')
    // Domaine fermé à l'inscription : la réponse ne dit rien de l'adresse.
    expect(res.get(reserved)).toBe('unknown')
  })
})
