// Agenda Google public d'une adresse Gmail ou Google Workspace.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import gcal, { calendarOutput, icsDate, MAX_PLACES, parseIcs } from '../../src/main/modules/email/gcalendar'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext } from './social_helpers'

const ics = readFileSync(resolve(__dirname, '../fixtures/email/gcal_public.ics'), 'utf8').replace(/\r?\n/g, '\r\n')

describe('lecture iCal', () => {
  it('dates en journée entière, UTC et heure locale', () => {
    expect(icsDate('20250316')).toBe('2025-03-16')
    expect(icsDate('20250601T080000Z')).toBe('2025-06-01T08:00:00Z')
    expect(icsDate('20250105T093000')).toBe('2025-01-05T09:30:00')
    expect(icsDate('demain')).toBeUndefined()
  })

  it('en-têtes, événements triés, texte échappé et lignes repliées', () => {
    const cal = parseIcs(ics)!
    expect(cal).toMatchObject({ name: 'Club de randonnée (exemple)', timezone: 'Europe/Paris', description: 'Agenda fictif pour les tests, sorties du dimanche' })
    expect(cal.events.map((e) => e.start)).toEqual(['2025-01-05T09:30:00', '2025-03-16', '2025-06-01T08:00:00Z', '2025-09-20'])
    expect(cal.events[2]).toMatchObject({ lat: 45.767, lon: 4.836, location: 'Mairie de Lyon, 1 Place de la Comédie, 69001 Lyon, France' })
    expect(parseIcs('<html>404</html>')).toBeNull()
  })

  it('propriétés de l’adresse et lieux à vérifier (dates pour la frise, coordonnées pour la carte)', () => {
    const { properties, entities } = calendarOutput(parseIcs(ics)!, 'https://calendar.google.com/x', 'fr')
    expect(properties).toMatchObject({
      calendar_name: 'Club de randonnée (exemple)',
      calendar_timezone: 'Europe/Paris',
      calendar_events_count: 4,
      calendar_first_event: 'Galette des rois',
      calendar_first_event_date: '2025-01-05T09:30:00',
      calendar_last_event: 'Occupé',
      calendar_last_event_date: '2025-09-20'
    })
    // Le lieu le plus fréquent d'abord, avec la date de son premier événement.
    expect(entities.map((e) => e.label)).toEqual(['Mairie de Lyon, 1 Place de la Comédie, 69001 Lyon, France', 'Mont Ventoux, 84410 Bédoin, France'])
    expect(entities[0]).toMatchObject({
      type: 'address',
      review: true,
      data: { date: '2025-01-05T09:30:00', lat: 45.767, lon: 4.836, event_titles: ['Galette des rois', 'Réunion du bureau'] }
    })
    expect(entities.every((e) => e.reviewReason)).toBe(true)
  })

  it(`au plus ${MAX_PLACES} lieux`, () => {
    const events = Array.from({ length: 15 }, (_, i) => ({ summary: `E${i}`, start: `2025-01-${String(i + 1).padStart(2, '0')}`, location: `Lieu ${i}` }))
    expect(calendarOutput({ events }, 'u', 'fr').entities).toHaveLength(MAX_PLACES)
  })
})

describe('email.google_calendar (fetch simulé)', () => {
  it('agenda public d’une adresse Gmail', async () => {
    const ctx = fakeContext([[/calendar\/ical\/club\.exemple%40gmail\.com\/public\/basic\.ics/, { body: ics }]])
    const out = await runModule(gcal, entity('email', 'club.exemple@gmail.com'), ctx)
    expect(out.properties?.calendar_events_count).toBe(4)
    expect(out.entities).toHaveLength(2)
  })

  it('404 : agenda privé ou absent, résultat vide (ne prouve pas l’absence du compte)', async () => {
    const ctx = fakeContext([[/calendar\.google\.com/, { status: 404, body: 'Not Found' }]])
    const out = await runModule(gcal, entity('email', 'jean@gmail.com'), ctx)
    expect(out.found).toBeUndefined()
    expect(out.properties).toBeUndefined()
  })

  it('429 : quota de Google', async () => {
    const ctx = fakeContext([[/calendar\.google\.com/, { status: 429, body: '<html>Sorry...</html>' }]])
    await expect(runModule(gcal, entity('email', 'jean@gmail.com'), ctx)).rejects.toBeInstanceOf(ModuleError)
  })

  it('domaine Google Workspace reconnu par ses MX ; autre domaine ignoré sans requête', async () => {
    const ctx = fakeContext([[/calendar\.google\.com/, { body: ics }]])
    const workspace = entity('email', 'contact@example.com', { data: { mx: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'] } })
    expect((await runModule(gcal, workspace, ctx)).properties?.calendar_name).toBe('Club de randonnée (exemple)')
    const other = entity('email', 'contact@example.org', { data: { mx: ['mx.example.org'] } })
    const before = ctx.calls.length
    expect(await runModule(gcal, other, ctx)).toEqual({})
    expect(ctx.calls.length).toBe(before)
  })

  it('n’est pas proposé pour un fournisseur connu autre que Google', () => {
    expect(gcal.accepts?.(entity('email', 'jean@outlook.com'))).toBe(false)
    expect(gcal.accepts?.(entity('email', 'jean@gmail.com'))).toBe(true)
    expect(gcal.accepts?.(entity('email', 'jean@example.com'))).toBe(true)
  })
})

describe.skipIf(!LIVE)('email.google_calendar (live)', () => {
  it('test@gmail.com : pas d’agenda public (404)', async (t) => {
    try {
      const out = await runModule(gcal, entity('email', 'test@gmail.com'), makeContext())
      expect(out.properties).toBeUndefined()
    } catch (e) {
      if (e instanceof ModuleError && e.code === 'rate_limited') t.skip(e.message)
      throw e
    }
  })
  it('agenda public des jours fériés (même point d’accès, identifiant d’agenda public)', async (t) => {
    const res = await makeContext().fetch('https://calendar.google.com/calendar/ical/fr.french%23holiday%40group.v.calendar.google.com/public/basic.ics')
    if (res.status === 429) return t.skip('Google : quota atteint depuis cette adresse IP')
    expect(res.status).toBe(200)
    const cal = parseIcs(await res.text())!
    expect(cal.events.length).toBeGreaterThan(5)
  })
})
