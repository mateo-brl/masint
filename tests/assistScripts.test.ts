// Scripts injectés dans les pages de la recherche assistée. Ils sont écrits dans des gabarits de
// chaînes, où `\n` devient un vrai retour à la ligne : une erreur de syntaxe y passe inaperçue
// (l'extraction renvoie alors zéro résultat sans rien signaler). Ils sont compilés ici, puis
// l'extraction est jouée sur des pages de résultats réduites à l'essentiel.

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

const { extractScript, INSPECT } = await import('../src/main/assist')

interface FakeLink {
  href: string
  text: string
  h3?: string
  block?: string
}

/** Exécute un script de page sur un document minimal : liens, bloc de chaque lien, texte de la page. */
function runInPage(script: string, page: { host: string; links: FakeLink[]; body?: string }): unknown {
  const anchors = page.links.map((l) => ({
    href: l.href,
    innerText: l.text,
    title: '',
    querySelector: (sel: string) => (sel === 'h3' && l.h3 ? { innerText: l.h3 } : null),
    closest: () => ({ innerText: l.block ?? l.text })
  }))
  const document = {
    body: { innerText: page.body ?? page.links.map((l) => l.block ?? l.text).join('\n') },
    querySelectorAll: (sel: string) => (sel === 'a[href]' ? anchors : []),
    querySelector: () => null,
    readyState: 'complete',
    title: 'Résultats'
  }
  return new Function('document', 'location', `return ${script}`)(document, { hostname: page.host, href: `https://${page.host}/` })
}

const needles = { text: ['xavier niel', 'niel xavier'], digits: [] }

describe('scripts de la recherche assistée', () => {
  it('se compilent', () => {
    expect(() => new Function(`return ${INSPECT}`)).not.toThrow()
    expect(() => new Function(`return ${extractScript(needles)}`)).not.toThrow()
  })

  it('Startpage : liens directs gardés, liens du moteur écartés, titre sur une ligne', () => {
    const out = runInPage(extractScript(needles), {
      host: 'www.startpage.com',
      links: [
        { href: 'https://www.startpage.com/do/settings', text: 'Paramètres' },
        { href: 'https://www.startpage.com/do/search?query=Xavier+Niel&page=2', text: 'Xavier Niel page 2' },
        // Icône du résultat (sans texte) avant le lien titre : le titre est repris du second.
        { href: 'https://fr.wikipedia.org/wiki/Xavier_Niel', text: '', block: 'Xavier Niel est un homme d’affaires français.' },
        { href: 'https://fr.wikipedia.org/wiki/Xavier_Niel', text: 'Xavier Niel, Wikipédia\nhttps://fr.wikipedia.org', block: 'Xavier Niel est un homme d’affaires français.' },
        { href: 'https://example.org/autre', text: 'Sans rapport', block: 'Rien à voir' }
      ]
    }) as Array<{ title: string; url: string }>
    expect(out.map((m) => m.url)).toEqual(['https://fr.wikipedia.org/wiki/Xavier_Niel'])
    expect(out[0].title).toBe('Xavier Niel, Wikipédia')
  })

  it('Google : redirection /url?q= dépliée, adresse opaque /goto gardée avec le titre du h3', () => {
    const out = runInPage(extractScript(needles), {
      host: 'www.google.com',
      links: [
        { href: 'https://www.google.com/url?q=https://example.org/niel&sa=U', text: 'Xavier Niel, portrait', block: 'Portrait de Xavier Niel' },
        { href: 'https://www.google.com/goto?url=CAESabc', text: 'Xavier Niel : biographie\nexample.net › bio', h3: 'Xavier Niel : biographie', block: 'Biographie de Xavier Niel' },
        { href: 'https://www.google.com/search?q=Xavier+Niel&tbm=isch', text: 'Images de Xavier Niel' },
        { href: 'https://maps.google.com/?q=Paris', text: 'Plans' }
      ]
    }) as Array<{ title: string; url: string }>
    expect(out.map((m) => m.url)).toEqual(['https://example.org/niel', 'https://www.google.com/goto?url=CAESabc'])
    expect(out[1].title).toBe('Xavier Niel : biographie')
  })

  it('inspection : captcha repéré', () => {
    const page = (body: string, selector: unknown = null): unknown =>
      new Function('document', `return ${INSPECT}`)({
        body: { innerText: body },
        querySelectorAll: (sel: string) => (sel === 'a[href]' ? [{}, {}] : []),
        querySelector: () => selector,
        readyState: 'complete',
        title: 'Page'
      })
    expect(page('Résultats de la recherche')).toMatchObject({ captcha: false, ready: true, links: 2 })
    expect(page('Nous avons détecté un trafic inhabituel')).toMatchObject({ captcha: true })
    expect(page('', { id: 'captcha' })).toMatchObject({ captcha: true })
  })
})
