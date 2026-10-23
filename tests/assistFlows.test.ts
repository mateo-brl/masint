// Parcours scripté « Facebook : retrouver le compte », joué sur des pages simulées (fictives,
// d'après la structure observée de la page de Facebook) : lecture des candidats, des options de
// récupération et du message « aucun compte », et preuve qu'aucun bouton n'est cliqué sur la
// page des options (aucun code ne peut être envoyé).

import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  FACEBOOK_FILL,
  FACEBOOK_READ,
  FLOW_TIMING,
  facebookExtract,
  facebookIdentifyCheck,
  facebookSubmitScript,
  facebookTypedScript,
  facebookValue,
  maskedContacts,
  runFacebookIdentify,
  type FacebookRead,
  type FlowPage
} from '../src/main/flows/facebook'
import { fakePage, type FakePage, type Spec } from './helpers/fakeDom'

vi.mock('electron', () => ({}))
const { INSPECT, INSPECT_PASSIVE } = await import('../src/main/assist')

const IDENTIFY = 'https://www.facebook.com/login/identify/?ctx=recover'
// Silhouette par défaut de Facebook (image publique) et photo fictive.
const SILHOUETTE = 'https://scontent.xx.fbcdn.net/v/t1.30497-1/84628273_176159830277856_972693363922829312_n.jpg?stp=dst-jpg_s200x200'
const PHOTO = 'https://scontent.xx.fbcdn.net/v/t39.30808-1/100000001_000000000000001_0000000000000000001_n.jpg?_nc_cat=1'
const SEARCHED = '+33639981234'

/** Nouvelle page d'identification : champ sans nom, bouton « Continuer » hors du formulaire. */
const identifyNew = (extra: Spec[] = []): FakePage =>
  fakePage(
    [
      {
        tag: 'div',
        attrs: { role: 'main' },
        children: [
          { tag: 'span', text: 'Trouvez votre compte' },
          {
            tag: 'form',
            attrs: { method: 'POST' },
            children: [
              { tag: 'input', attrs: { id: '_r_2_', type: 'text' } },
              { tag: 'label', attrs: { for: '_r_2_' }, text: 'Numéro mobile ou e-mail' },
              ...extra
            ]
          },
          { tag: 'div', attrs: { role: 'button', tabindex: '0' }, text: 'Continuer' }
        ]
      }
    ],
    { url: IDENTIFY, title: 'Facebook' }
  )

/** Ancienne page d'identification : `#identify_email` et bouton « Rechercher » du formulaire. */
const identifyOld = (): FakePage =>
  fakePage(
    [
      {
        tag: 'form',
        attrs: { id: 'identify_yourself_flow', method: 'post', action: '/ajax/login/help/identify.php?ctx=recover' },
        children: [
          { tag: 'input', attrs: { id: 'identify_email', name: 'email', type: 'text' } },
          { tag: 'a', attrs: { role: 'button', href: '/login.php' }, text: 'Annuler' },
          { tag: 'button', attrs: { id: 'did_submit', name: 'did_submit', type: 'submit' }, text: 'Rechercher' }
        ]
      }
    ],
    { url: IDENTIFY, title: 'Facebook' }
  )

const candidate = (name: string, photo: string): Spec => ({
  tag: 'div',
  attrs: { role: 'button', tabindex: '0' },
  children: [
    { tag: 'div', attrs: { role: 'img', 'aria-label': `Photo de profil, ${name}` }, children: [{ tag: 'image', attrs: { 'xlink:href': photo } }] },
    { tag: 'div', text: name }
  ]
})

/** Liste de comptes (nouvelle page) : un compte Meta au nom du numéro, deux profils Facebook. */
const candidates = (): FakePage =>
  fakePage(
    [
      {
        tag: 'div',
        attrs: { role: 'main' },
        children: [
          { tag: 'span', text: 'Choisissez votre compte' },
          { tag: 'span', text: 'Ces Comptes Meta correspondent à l’adresse e-mail ou au numéro de mobile que vous avez entré(e).' },
          candidate(SEARCHED, SILHOUETTE),
          { tag: 'span', text: 'Ces profils Facebook correspondent à l’adresse e-mail ou au numéro de mobile que vous avez entré.' },
          candidate('Camille Exemple', PHOTO),
          candidate('D... M...', SILHOUETTE)
        ]
      }
    ],
    { url: IDENTIFY, title: 'Facebook' }
  )

/** Liste de comptes de l'ancienne page : lignes avec « C'est mon compte ». */
const candidatesOld = (): FakePage =>
  fakePage(
    [
      {
        tag: 'table',
        children: [
          {
            tag: 'tr',
            children: [
              { tag: 'td', children: [{ tag: 'img', attrs: { src: PHOTO } }] },
              { tag: 'td', children: [{ tag: 'div', text: 'Camille Exemple' }, { tag: 'div', text: 'Utilisateur Facebook' }] },
              { tag: 'td', children: [{ tag: 'a', attrs: { role: 'button', href: '/recover/initiate/?x' }, text: 'C’est mon compte' }] }
            ]
          },
          {
            tag: 'tr',
            children: [
              { tag: 'td', children: [{ tag: 'img', attrs: { src: SILHOUETTE } }] },
              { tag: 'td', children: [{ tag: 'div', text: 'Dominique Fictif' }] },
              { tag: 'td', children: [{ tag: 'a', attrs: { role: 'button', href: '/recover/initiate/?y' }, text: 'C’est mon compte' }] }
            ]
          }
        ]
      }
    ],
    { url: IDENTIFY, title: 'Facebook' }
  )

/** Un seul compte : page des options de récupération, contacts masqués en libellés de boutons radio. */
const options = (): FakePage =>
  fakePage(
    [
      {
        tag: 'form',
        attrs: { method: 'post', action: '/ajax/recover/initiate/' },
        children: [
          { tag: 'h2', text: 'Réinitialisez votre mot de passe' },
          { tag: 'div', text: 'Comment voulez-vous recevoir le code pour réinitialiser votre mot de passe ?' },
          { tag: 'input', attrs: { type: 'radio', id: 'send_email', name: 'recover_method', value: 'send_email:0', checked: '1' } },
          { tag: 'label', attrs: { for: 'send_email' }, children: [{ tag: 'div', text: 'Envoyer le code par e-mail' }, { tag: 'div', text: 'c*****@e******.fr' }] },
          { tag: 'input', attrs: { type: 'radio', id: 'send_sms', name: 'recover_method', value: 'send_sms:0' } },
          { tag: 'label', attrs: { for: 'send_sms' }, children: [{ tag: 'div', text: 'Envoyer le code par SMS' }, { tag: 'div', text: '+33 ••• •• •• 34' }] },
          { tag: 'input', attrs: { type: 'radio', id: 'send_sms_2', name: 'recover_method', value: 'send_sms:1' } },
          { tag: 'label', attrs: { for: 'send_sms_2' }, children: [{ tag: 'div', text: 'Envoyer le code par SMS' }, { tag: 'div', text: '+44 ••••• •••• 56' }] },
          { tag: 'div', children: [{ tag: 'img', attrs: { src: PHOTO } }, { tag: 'div', text: 'Camille Exemple' }, { tag: 'div', text: 'Utilisateur Facebook' }] },
          { tag: 'a', attrs: { role: 'button', href: '/login/identify/?ctx=not_me' }, text: 'Ce n’est pas vous ?' },
          { tag: 'button', attrs: { type: 'submit', name: 'reset_action', value: '1' }, text: 'Continuer' },
          { tag: 'button', attrs: { type: 'button' }, text: 'Envoyer' },
          { tag: 'input', attrs: { type: 'submit', value: 'Submit' } }
        ]
      }
    ],
    { url: 'https://www.facebook.com/recover/initiate/?privacy_mutation_token=fictif', title: 'Réinitialisez votre mot de passe' }
  )

const none = (): FakePage => identifyNew([{ tag: 'div', children: [{ tag: 'span', text: 'Aucun compte trouvé. Vérifiez votre numéro de mobile ou e-mail, puis réessayez.' }] }])

describe('Facebook « retrouver le compte » : recherche manuelle', () => {
  it('porte le parcours scripté et l’explique honnêtement', () => {
    const check = facebookIdentifyCheck('fr')
    expect(check).toMatchObject({ flow: 'facebook_identify', url: IDENTIFY })
    expect(check.hint).toMatch(/Il ne clique jamais sur Continuer : aucun code n’est envoyé/)
    expect(facebookIdentifyCheck('en').hint).toMatch(/never clicks Continue: no code is sent/)
  })

  it('saisit un numéro au format international, un email en minuscules', () => {
    expect(facebookValue('phone', '06 39 98 12 34')).toBe(SEARCHED)
    expect(facebookValue('email', ' Camille.Exemple@Example.org ')).toBe('camille.exemple@example.org')
    expect(facebookValue('username', 'zx445')).toBeNull()
  })
})

describe('Facebook « retrouver le compte » : scripts de page', () => {
  it('se compilent', () => {
    for (const script of [FACEBOOK_FILL, FACEBOOK_READ, facebookTypedScript(SEARCHED), facebookSubmitScript(SEARCHED), INSPECT_PASSIVE])
      expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('lit les candidats de la nouvelle page : noms, noms masqués, photos hors silhouette', () => {
    const page = candidates()
    const read = page.run<FacebookRead>(FACEBOOK_READ)
    expect(read.state).toBe('candidates')
    expect(read.candidates.map((c) => c.name)).toEqual([SEARCHED, 'Camille Exemple', 'D... M...'])
    const ex = facebookExtract(read, SEARCHED)
    // Le compte Meta qui porte le numéro lui-même n'est pas un nom.
    expect(ex).toMatchObject({ state: 'candidates', names: ['Camille Exemple'], maskedNames: ['D... M...'], photos: [PHOTO], photoOf: { 'Camille Exemple': PHOTO } })
    expect(page.clicks).toEqual([])
  })

  it('lit les candidats de l’ancienne page', () => {
    const page = candidatesOld()
    const ex = facebookExtract(page.run<FacebookRead>(FACEBOOK_READ), SEARCHED)
    expect(ex.names).toEqual(['Camille Exemple', 'Dominique Fictif'])
    expect(ex.photos).toEqual([PHOTO])
    expect(page.clicks).toEqual([])
  })

  it('page des options : contacts masqués lus, le numéro cherché lui-même écarté, aucun clic', () => {
    const page = options()
    const read = page.run<FacebookRead>(FACEBOOK_READ)
    expect(read.state).toBe('options')
    expect(read.options).toHaveLength(3)
    const ex = facebookExtract(read, SEARCHED)
    expect(ex.maskedEmails).toEqual(['c*****@e******.fr'])
    // « +33 ••• •• •• 34 » est le numéro cherché, masqué : rien de nouveau.
    expect(ex.maskedPhones).toEqual(['+44 ••••• •••• 56'])
    expect(ex.names).toEqual(['Camille Exemple'])
    expect(ex.photos).toEqual([PHOTO])
    expect(page.clicks).toEqual([])
  })

  it('aucun compte : message reconnu, liste vide', () => {
    const read = none().run<FacebookRead>(FACEBOOK_READ)
    expect(read.state).toBe('none')
    expect(read.message).toMatch(/^Aucun compte trouvé/)
    expect(facebookExtract(read, SEARCHED)).toMatchObject({ state: 'none', names: [], maskedNames: [], maskedEmails: [], maskedPhones: [], photos: [] })
  })

  it('formulaire : champ trouvé et vidé, focus donné, aucun clic', () => {
    for (const page of [identifyNew(), identifyOld()]) {
      expect(page.run(FACEBOOK_FILL)).toEqual({ ok: true, reason: '' })
      expect(page.document.activeElement?.tagName).toBe('INPUT')
      expect(page.run<FacebookRead>(FACEBOOK_READ).state).toBe('form')
      expect(page.clicks).toEqual([])
    }
  })

  it('la seule action de clic ne vise que « Rechercher » du formulaire d’identification', () => {
    // Ancienne page, valeur saisie : le bouton « Rechercher » du formulaire, et lui seul.
    const old = identifyOld()
    old.run(FACEBOOK_FILL)
    old.document.activeElement!.value = SEARCHED
    expect(old.run(facebookSubmitScript(SEARCHED))).toEqual({ clicked: true, reason: 'rechercher' })
    expect(old.clicks).toEqual(['Rechercher'])

    // Champ vide ou autre valeur : rien.
    const empty = identifyOld()
    expect(empty.run(facebookSubmitScript(SEARCHED))).toMatchObject({ clicked: false })
    expect(empty.clicks).toEqual([])

    // Nouvelle page : son bouton s'appelle « Continuer », il n'est jamais cliqué (Entrée suffit).
    const fresh = identifyNew()
    fresh.run(FACEBOOK_FILL)
    fresh.document.activeElement!.value = SEARCHED
    expect(fresh.run(facebookSubmitScript(SEARCHED))).toMatchObject({ clicked: false, reason: 'no_button' })
    expect(fresh.clicks).toEqual([])
  })

  it('page des options et liste de comptes : aucun script ne clique, ne saisit ni ne coche rien', () => {
    for (const page of [options(), candidates(), candidatesOld()]) {
      expect(page.run(FACEBOOK_FILL)).toMatchObject({ ok: false })
      expect(page.run(facebookSubmitScript(SEARCHED))).toMatchObject({ clicked: false })
      page.run(FACEBOOK_READ)
      page.run(INSPECT_PASSIVE)
      expect(page.clicks).toEqual([])
    }
    // Même avec un champ qui contiendrait la valeur, la page des options refuse le clic.
    const opt = options()
    expect(opt.run(facebookSubmitScript(SEARCHED))).toEqual({ clicked: false, reason: 'options' })
  })

  it('bandeau de cookies de Facebook : refusé au chargement, jamais cliqué ensuite', () => {
    const banner = (): FakePage =>
      fakePage(
        [
          {
            tag: 'div',
            attrs: { role: 'dialog' },
            children: [
              { tag: 'div', attrs: { role: 'button' }, text: 'Autoriser tous les cookies' },
              { tag: 'div', attrs: { role: 'button' }, text: 'Refuser les cookies optionnels' }
            ]
          }
        ],
        { url: IDENTIFY }
      )
    const first = banner()
    expect(first.run(INSPECT)).toMatchObject({ consent: true })
    expect(first.clicks).toEqual(['Refuser les cookies optionnels'])
    const later = banner()
    expect(later.run(INSPECT_PASSIVE)).toMatchObject({ consent: false })
    expect(later.clicks).toEqual([])
  })

  it('vérification Cloudflare (« Un instant… ») reconnue comme une action à faire', () => {
    const page = fakePage([{ tag: 'h2', text: 'Vérification de sécurité en cours' }], { url: 'https://www.tellows.fr/num/0639981234', title: 'Un instant…' })
    expect(page.run(INSPECT_PASSIVE)).toMatchObject({ captcha: true })
  })

  it('contacts masqués : adresses et numéros dans des libellés', () => {
    expect(maskedContacts(['Envoyer le code par e-mail c*****@e******.fr', 'Send code via SMS +33 ••• •• •• 34.', 'Recevoir le code sur WhatsApp ********34 (FR)'])).toEqual({
      emails: ['c*****@e******.fr'],
      phones: ['+33 ••• •• •• 34', '********34']
    })
    expect(maskedContacts(['Continuer', 'Envoyer le code par e-mail'])).toEqual({ emails: [], phones: [] })
  })
})

/** Fenêtre simulée : une page par étape, la touche Entrée mène à la page suivante. */
function fakeFlow(steps: Array<() => FakePage>, opts: { enterWorks?: boolean } = {}) {
  let i = 0
  let page = steps[0]()
  const scripts: string[] = []
  const clicks: string[] = []
  const shown: string[] = []
  const advance = (): void => {
    clicks.push(...page.clicks)
    i = Math.min(i + 1, steps.length - 1)
    page = steps[i]()
  }
  const flow: FlowPage = {
    run: async <T>(script: string) => {
      scripts.push(script)
      const before = page.clicks.length
      const out = page.run<T>(script)
      // Clic sur « Rechercher » : la recherche part, page suivante.
      if (page.clicks.length > before) advance()
      return out
    },
    type: async (text) => {
      const el = page.document.activeElement
      if (el && el.tagName === 'INPUT') el.value = (el.value ?? '') + text
    },
    enter: async () => {
      if (opts.enterWorks !== false) advance()
    },
    show: (reason) => void shown.push(reason),
    closed: () => false,
    sleep: async () => undefined
  }
  return { flow, scripts, clicks: () => [...clicks, ...page.clicks], shown, current: () => page }
}

describe('Facebook « retrouver le compte » : déroulé', () => {
  beforeAll(() => {
    FLOW_TIMING.submitFallbackMs = 0
    FLOW_TIMING.settleMs = 0
    FLOW_TIMING.pollMs = 0
  })

  const inspect = async (p: FlowPage): Promise<{ captcha: boolean } | null> => p.run<{ captcha: boolean }>(INSPECT_PASSIVE)

  it('un seul compte : saisie, Entrée, options lues, aucun clic', async () => {
    const sim = fakeFlow([identifyNew, options])
    const out = await runFacebookIdentify(sim.flow, SEARCHED, inspect)
    expect(out).toMatchObject({ status: 'ok', clicked: false })
    expect(out.read?.state).toBe('options')
    expect(sim.clicks()).toEqual([])
    // Seuls les scripts du parcours ont tourné : aucun script de consentement (qui clique).
    const allowed = new Set([FACEBOOK_FILL, FACEBOOK_READ, facebookTypedScript(SEARCHED), INSPECT_PASSIVE])
    expect(sim.scripts.every((s) => allowed.has(s))).toBe(true)
    expect(facebookExtract(out.read, SEARCHED).maskedEmails).toEqual(['c*****@e******.fr'])
  })

  it('plusieurs comptes : candidats lus, aucun clic', async () => {
    const sim = fakeFlow([identifyNew, candidates])
    const out = await runFacebookIdentify(sim.flow, SEARCHED, inspect)
    expect(out.read?.state).toBe('candidates')
    expect(sim.clicks()).toEqual([])
  })

  it('aucun compte : résultat vide', async () => {
    const sim = fakeFlow([identifyNew, none])
    const out = await runFacebookIdentify(sim.flow, 'personne@example.org', inspect)
    expect(out.status).toBe('ok')
    expect(facebookExtract(out.read, 'personne@example.org').state).toBe('none')
    expect(sim.clicks()).toEqual([])
  })

  it('Entrée sans effet sur l’ancienne page : un seul clic, sur « Rechercher », puis rien sur les options', async () => {
    const sim = fakeFlow([identifyOld, options], { enterWorks: false })
    const out = await runFacebookIdentify(sim.flow, SEARCHED, inspect)
    expect(out).toMatchObject({ status: 'ok', clicked: true })
    expect(out.read?.state).toBe('options')
    expect(sim.clicks()).toEqual(['Rechercher'])
  })

  it('page qui n’est pas le formulaire : erreur, rien saisi, aucun clic', async () => {
    const sim = fakeFlow([options])
    const out = await runFacebookIdentify(sim.flow, SEARCHED, inspect)
    expect(out.status).toBe('error')
    expect(out.error).toBe('facebook_form:options')
    expect(sim.clicks()).toEqual([])
  })
})
