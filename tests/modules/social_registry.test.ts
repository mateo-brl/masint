import { describe, expect, it } from 'vitest'
import { allModules } from '../../src/main/engine/registry'
import { ENTITY_TYPES } from '@shared/entityTypes'

describe('registre', () => {
  it('découvre les modules pseudo, réseaux sociaux, messageries et personnes', () => {
    const mine = allModules().filter((m) => /^(username|social|messaging|person)\./.test(m.id))
    const ids = mine.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(
      expect.arrayContaining([
        'username.sites',
        'username.sites_nsfw',
        'social.github',
        'social.youtube',
        'messaging.telegram',
        'messaging.discord_invite',
        'person.usernames',
        'person.search_links',
        'person.fr_dirigeants'
      ])
    )
    const types = new Set(ENTITY_TYPES.map((t) => t.id))
    for (const m of mine) {
      for (const t of m.inputTypes) expect(types.has(t), `${m.id} ${t}`).toBe(true)
      expect(m.name.fr && m.name.en && m.description.fr && m.description.en, m.id).toBeTruthy()
      expect(`${m.name.fr}${m.name.en}${m.description.fr}${m.description.en}`, m.id).not.toMatch(/[–—]/)
    }
  })
})
