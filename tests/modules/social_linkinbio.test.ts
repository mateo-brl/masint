// Pages « lien en bio » : reconnaissance des URL, extraction des liens, emails et téléphones.

import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import linkinbio, { bioEntities, bioPage, parseBioPage } from '../../src/main/modules/social/linkinbio'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture } from './social_helpers'

describe('reconnaissance des pages', () => {
  it.each([
    ['https://beacons.ai/exemple', 'Beacons', 'exemple'],
    ['https://taplink.cc/exemple', 'Taplink', 'exemple'],
    ['https://atelier-exemple.carrd.co/', 'Carrd', 'atelier-exemple'],
    ['bio.link/exemple', 'bio.link', 'exemple'],
    ['https://lnk.bio/exemple', 'Lnk.Bio', 'exemple'],
    ['https://allmylinks.com/allmylinks', 'AllMyLinks', 'allmylinks'],
    ['https://solo.to/exemple', 'solo.to', 'exemple'],
    ['https://hoo.be/exemple', 'hoo.be', 'exemple']
  ])('%s', (url, service, handle) => {
    expect(bioPage(url)).toMatchObject({ service, handle })
  })

  it('pages de la plateforme et autres sites écartés', () => {
    for (const url of ['https://beacons.ai/', 'https://taplink.cc/support', 'https://carrd.co/', 'https://www.carrd.co/', 'https://allmylinks.com/privacy', 'https://example.com/exemple'])
      expect(bioPage(url), url).toBeNull()
    expect(linkinbio.accepts?.(entity('url', 'https://solo.to/exemple'))).toBe(true)
    expect(linkinbio.accepts?.(entity('website', 'https://example.com'))).toBe(false)
    expect(linkinbio.accepts?.(entity('account', 'exemple', { data: { url: 'https://lnk.bio/exemple' } }))).toBe(true)
  })
})

describe('extraction', () => {
  it('AllMyLinks : comptes reconnus et email, liens de la plateforme écartés', () => {
    const p = parseBioPage(fixture('social/linkinbio_allmylinks.html'))
    expect(p.data.display_name).toBe('AllMyLinks (@allmylinks)')
    expect(p.links).toEqual(['https://twitter.com/All_My_Links', 'https://www.instagram.com/AllMyLinks'])
    expect(p.emails).toEqual(['support@allmylinks.com'])
    const labels = bioEntities(p, 'fr').map((e) => `${e.type}:${e.platform ?? ''}:${e.label}`)
    expect(labels).toEqual(['email::support@allmylinks.com', 'account:x:All_My_Links', 'account:instagram:AllMyLinks'])
  })

  it('Carrd fictif : réseaux, site, email, téléphone, WhatsApp ; partage, polices et pied de page écartés', () => {
    const p = parseBioPage(fixture('social/linkinbio_carrd.html'))
    expect(p.links).toEqual(['https://www.instagram.com/atelier.exemple/', 'https://www.youtube.com/@AtelierExemple', 'https://wa.me/33199001234', 'https://boutique.example.com/atelier'])
    expect(p.emails).toEqual(['contact@example.com'])
    expect(p.phones).toEqual(['+33199001234'])
    const entities = bioEntities(p, 'fr')
    const labels = entities.map((e) => `${e.type}:${e.platform ?? ''}:${e.label}`)
    expect(labels).toEqual(
      expect.arrayContaining([
        'account:instagram:atelier.exemple',
        'account:youtube:AtelierExemple',
        'account:whatsapp:33199001234',
        'url::https://boutique.example.com/atelier',
        'email::contact@example.com',
        'email::atelier@example.com',
        'url::https://www.atelier-exemple.example.org',
        'phone::+33199001234'
      ])
    )
    expect(labels.some((l) => /carrd|sharer|googleapis/.test(l))).toBe(false)
  })

  it('données JSON embarquées (Beacons fictif) : URL échappées décodées', () => {
    const p = parseBioPage(fixture('social/linkinbio_beacons.html'))
    expect(p.links).toEqual(['https://www.tiktok.com/@exemple.creatrice', 'https://blog.example.net/?a=1&b=2'])
    expect(p.emails).toEqual(['pro@example.net'])
    expect(p.data.display_name).toBe('Exemple Créatrice')
  })
})

describe('social.linkinbio (fetch simulé)', () => {
  it('page lue : propriétés sur le nœud d’origine, avatar joint', async () => {
    const ctx = fakeContext([[/atelier-exemple\.carrd\.co/, { body: fixture('social/linkinbio_carrd.html') }]])
    const input = entity('url', 'https://atelier-exemple.carrd.co')
    const out = await runModule(linkinbio, input, ctx)
    expect(out.found).toBe(true)
    expect(out.properties).toMatchObject({ service: 'Carrd', username: 'atelier-exemple', display_name: 'Atelier Exemple', phones: ['+33199001234'] })
    expect(out.entities?.[0]).toEqual({ type: 'url', label: 'https://atelier-exemple.carrd.co', image: 'https://atelier-exemple.carrd.co/assets/images/card.jpg?v=1' })
  })

  it('pare-feu anti-robot et défi Taplink : blocage explicite', async () => {
    const cf = fakeContext([[/beacons\.ai/, { status: 403, body: fixture('social/linkinbio_blocked.html') }]])
    await expect(runModule(linkinbio, entity('url', 'https://beacons.ai/exemple'), cf)).rejects.toMatchObject({ code: 'blocked' })
    const taplink = fakeContext([[/taplink\.cc/, { status: 301, headers: { location: '/system/challenge.html' } }]])
    await expect(runModule(linkinbio, entity('url', 'https://taplink.cc/exemple'), taplink)).rejects.toBeInstanceOf(ModuleError)
  })

  it('pseudo inconnu : 404 ou renvoi vers l’accueil', async () => {
    const missing = fakeContext([[/hoo\.be/, { status: 404, body: '' }]])
    expect((await runModule(linkinbio, entity('url', 'https://hoo.be/zq8xk2vmw93pq7'), missing)).found).toBe(false)
    const home = fakeContext([[/taplink\.cc/, { status: 302, headers: { location: 'https://taplink.at/en/' } }]])
    expect((await runModule(linkinbio, entity('url', 'https://taplink.cc/zq8xk2vmw93pq7'), home)).found).toBe(false)
  })
})

describe.skipIf(!LIVE)('social.linkinbio (live)', () => {
  it('AllMyLinks : page de la plateforme', async (t) => {
    try {
      const out = await runModule(linkinbio, entity('url', 'https://allmylinks.com/allmylinks'), makeContext())
      expect(out.entities?.some((e) => e.platform === 'instagram')).toBe(true)
    } catch (e) {
      if (e instanceof ModuleError && e.code === 'blocked') t.skip(e.message)
      throw e
    }
  })
  it('Carrd : sous-domaine inexistant', async () => {
    expect((await runModule(linkinbio, entity('url', `https://zq${Date.now().toString(36)}x.carrd.co`), makeContext())).found).toBe(false)
  })
})
