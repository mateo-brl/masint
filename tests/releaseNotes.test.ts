import { describe, expect, it } from 'vitest'
import { releaseNotesText } from '../src/shared/releaseNotes'

describe('notes de version', () => {
  it('met le HTML du flux GitHub en texte simple', () => {
    const html = '<p>Grosse mise à jour.</p>\n<h2>Nouvelles sources</h2>\n<ul>\n<li><strong>Domaines</strong> : tenant &amp; DNS</li>\n<li>Email</li>\n</ul>'
    expect(releaseNotesText(html)).toBe('Grosse mise à jour.\n## Nouvelles sources\n- Domaines : tenant & DNS\n- Email')
  })

  it('accepte la forme en liste et ignore les notes vides', () => {
    expect(releaseNotesText([{ version: '0.1.5', note: '<li>Correctif</li>' }])).toBe('- Correctif')
    expect(releaseNotesText(null)).toBeUndefined()
    expect(releaseNotesText('  ')).toBeUndefined()
  })
})
