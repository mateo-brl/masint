import { describe, expect, it } from 'vitest'
import { entityBadgeHtml, platformBadgeHtml } from '../src/renderer/src/components/export/badges'
import {
  escapeHtml,
  exportFileName,
  fmt,
  formatValue,
  humanizeKey,
  isImageDataUrl,
  jsonForScript,
  orderedProps,
  safeColor,
  safeFileName,
  safeHttpUrl
} from '../src/renderer/src/components/export/format'
import { renderMarkdown } from '../src/renderer/src/components/export/markdown'
import type { GraphNode } from '@shared/types'

describe('échappement HTML', () => {
  it('échappe les caractères spéciaux', () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;')
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(3)).toBe('3')
  })

  it('produit un JSON qui ne peut pas refermer la balise script', () => {
    const json = jsonForScript({ label: '</script><script>alert(1)</script>', sep: '\u2028' })
    expect(json).not.toContain('</script')
    expect(json).not.toContain('\u2028')
    expect(JSON.parse(json)).toEqual({ label: '</script><script>alert(1)</script>', sep: '\u2028' })
  })

  it("n'accepte que les liens http(s)", () => {
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('https://exa mple.com')).toBeNull()
  })

  it("n'accepte que les images en data URL", () => {
    expect(isImageDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isImageDataUrl('masint-file://att/123')).toBe(false)
    expect(isImageDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
  })

  it('filtre les couleurs', () => {
    expect(safeColor('#e5484d', 'x')).toBe('#e5484d')
    expect(safeColor('red;background:url(x)', '#000')).toBe('#000')
  })
})

describe('noms de fichiers', () => {
  it('retire les caractères interdits', () => {
    expect(safeFileName('Affaire: "X/Y" <test>?')).toBe('Affaire_ _X_Y_ _test_')
    expect(safeFileName('   ')).toBe('enquete')
  })

  it('ajoute le suffixe et la date', () => {
    expect(exportFileName('Dossier Alpha', new Date(2026, 9, 21), 'noeuds', 'csv')).toBe('Dossier Alpha_noeuds_2026-10-21.csv')
    expect(exportFileName('Dossier Alpha', new Date(2026, 0, 2), '', 'json')).toBe('Dossier Alpha_2026-01-02.json')
  })
})

describe('valeurs et propriétés', () => {
  it('formate les valeurs', () => {
    expect(formatValue(['a', 'b'], 'fr')).toBe('a, b')
    expect(formatValue(true, 'fr')).toBe('oui')
    expect(formatValue(false, 'en')).toBe('no')
    expect(formatValue({ a: 1 }, 'fr')).toBe('{"a":1}')
    expect(formatValue(null, 'fr')).toBe('')
  })

  it('remplace les variables', () => {
    expect(fmt('{{a}} et {{b}}', { a: 1, b: 'deux' })).toBe('1 et deux')
  })

  it('humanise les clés inconnues', () => {
    expect(humanizeKey('first_seen_at')).toBe('First seen at')
    expect(humanizeKey('userId')).toBe('User Id')
  })

  it('ordonne les champs du type avant les autres et ignore les vides', () => {
    const n = { type: 'phone', data: { zzz: 'x', carrier: 'Orange', country: 'France', empty: '', _internal: 1, list: [] } } as unknown as GraphNode
    const rows = orderedProps(n, 'fr')
    expect(rows.map((r) => r.key)).toEqual(['country', 'carrier', 'zzz'])
    expect(rows[0].label).toBe('Pays')
    expect(rows[2].label).toBe('Zzz')
  })
})

describe('pastilles', () => {
  const markup = (name: string): string => (name === 'Phone' ? '<path d="M1 1"/>' : '')

  it('utilise le logo de la plateforme', () => {
    const html = platformBadgeHtml('facebook', 26)
    expect(html).toContain('background:#0866FF')
    expect(html).toContain('<path d="')
  })

  it("se rabat sur l'icône du type", () => {
    const html = entityBadgeHtml({ type: 'phone', platform: null }, 26, markup)
    expect(html).toContain('<path d="M1 1"/>')
    expect(html).toContain('#c084fc22')
  })

  it('affiche des initiales pour une plateforme sans logo', () => {
    expect(platformBadgeHtml('linkedin', 26)).toContain('>LI<')
  })
})

describe('renderMarkdown', () => {
  it('rend titres, listes et emphase', () => {
    const html = renderMarkdown('# Titre\n\nTexte **gras** et *italique*.\n\n- un\n- deux\n\n1. a\n2. b', 3)
    expect(html).toContain('<h3>Titre</h3>')
    expect(html).toContain('<strong>gras</strong>')
    expect(html).toContain('<em>italique</em>')
    expect(html).toContain('<ul><li>un</li><li>deux</li></ul>')
    expect(html).toContain('<ol><li>a</li><li>b</li></ol>')
  })

  it('échappe le HTML et neutralise les liens dangereux', () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.fr/p?q=1&r=2)')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('href="javascript')
    expect(html).toContain('<a href="https://a.fr/p?q=1&amp;r=2">ok</a>')
  })

  it("reconnaît les URL nues sans casser les tirets bas", () => {
    const html = renderMarkdown('Profil : https://x.com/john_doe_.')
    expect(html).toContain('<a href="https://x.com/john_doe_">https://x.com/john_doe_</a>.')
    expect(html).not.toContain('<em>')
  })

  it('garde les blocs de code tels quels', () => {
    expect(renderMarkdown('```\n**pas gras** <b>\n```')).toBe('<pre><code>**pas gras** &lt;b&gt;</code></pre>')
  })

  it('rend les citations et les cases à cocher', () => {
    const html = renderMarkdown('> cité\n\n- [x] fait\n- [ ] à faire')
    expect(html).toContain('<blockquote>cité</blockquote>')
    expect(html).toContain('☑ fait')
    expect(html).toContain('☐ à faire')
  })
})
