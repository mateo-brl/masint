// Agenda Google public d'une adresse Gmail ou Google Workspace : l'adresse sert
// d'identifiant d'agenda et l'export iCal est lisible sans compte quand l'agenda
// est rendu public. Nom, fuseau horaire, événements et lieux (carte et frise).

import { defineModule, ModuleError, type InputEntity, type OutEntity } from '@shared/modules'
import { emailProvider } from '@shared/platforms'
import type { PropValue } from '@shared/types'
import { compact, httpFailure, requireEmail, splitEmail, tr } from './_lib'

const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']
/** Nombre maximal de lieux d'événements transformés en adresses. */
export const MAX_PLACES = 10

export interface IcsEvent {
  summary?: string
  /** Début : `AAAA-MM-JJ` (journée entière) ou `AAAA-MM-JJTHH:MM:SS[Z]`. */
  start?: string
  location?: string
  lat?: number
  lon?: number
}

export interface IcsCalendar {
  name?: string
  timezone?: string
  description?: string
  events: IcsEvent[]
}

/** Texte iCal : `\n`, `\,`, `\;` et `\\` décodés. */
function icsText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim()
}

/** `20250101` → `2025-01-01` ; `20250101T100000Z` → `2025-01-01T10:00:00Z`. */
export function icsDate(v: string): string | undefined {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return undefined
  const [, y, mo, d, h, mi, s, z] = m
  return h ? `${y}-${mo}-${d}T${h}:${mi}:${s}${z ?? ''}` : `${y}-${mo}-${d}`
}

/** Lecture d'un export iCal (RFC 5545) : en-têtes de l'agenda et événements. `null` si ce n'en est pas un. */
export function parseIcs(text: string): IcsCalendar | null {
  if (!/^BEGIN:VCALENDAR/m.test(text)) return null
  // Lignes repliées : une ligne qui commence par un espace prolonge la précédente.
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const cal: IcsCalendar = { events: [] }
  let event: IcsEvent | null = null
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9-]+)((?:;[^:;]+=(?:"[^"]*"|[^:;]*))*):(.*)$/)
    if (!m) continue
    const name = m[1].toUpperCase()
    const value = m[3]
    if (name === 'BEGIN' && value === 'VEVENT') event = {}
    else if (name === 'END' && value === 'VEVENT') {
      if (event) cal.events.push(event)
      event = null
    } else if (event) {
      if (name === 'SUMMARY') event.summary = icsText(value) || undefined
      else if (name === 'DTSTART') event.start = icsDate(value)
      else if (name === 'LOCATION') event.location = icsText(value) || undefined
      else if (name === 'GEO') {
        const [lat, lon] = value.split(';').map(Number)
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) Object.assign(event, { lat, lon })
      }
    } else if (name === 'X-WR-CALNAME') cal.name = icsText(value) || undefined
    else if (name === 'X-WR-TIMEZONE') cal.timezone = value.trim() || undefined
    else if (name === 'X-WR-CALDESC') cal.description = icsText(value) || undefined
  }
  cal.events.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
  return cal
}

/** Propriétés de l'adresse et lieux des événements (à vérifier). */
export function calendarOutput(cal: IcsCalendar, url: string, lang: 'fr' | 'en'): { properties: Record<string, PropValue>; entities: OutEntity[] } {
  const dated = cal.events.filter((e) => e.start)
  const first = dated[0]
  const last = dated[dated.length - 1]
  const places = new Map<string, { label: string; events: IcsEvent[] }>()
  for (const e of cal.events) {
    if (!e.location) continue
    const key = e.location.toLowerCase().replace(/\s+/g, ' ')
    const p = places.get(key) ?? { label: e.location.replace(/\s*\n\s*/g, ', '), events: [] }
    p.events.push(e)
    places.set(key, p)
  }
  // Les lieux les plus fréquents d'abord ; à fréquence égale, le plus récent.
  const top = [...places.values()]
    .sort((a, b) => b.events.length - a.events.length || (b.events[b.events.length - 1].start ?? '').localeCompare(a.events[a.events.length - 1].start ?? ''))
    .slice(0, MAX_PLACES)
  const entities: OutEntity[] = top.map((p) => {
    const geo = p.events.find((e) => e.lat !== undefined)
    return {
      type: 'address',
      label: p.label,
      data: compact({
        date: p.events.find((e) => e.start)?.start,
        title: p.events[0].summary,
        event_titles: [...new Set(p.events.map((e) => e.summary).filter((s): s is string => !!s))].slice(0, 5),
        lat: geo?.lat,
        lon: geo?.lon
      }),
      linkLabel: tr({ lang }, "lieu d'un événement (agenda)", 'event location (calendar)'),
      review: true,
      reviewReason: tr(
        { lang },
        "lieu saisi dans un événement de l'agenda public : peut désigner un rendez-vous, pas forcément un lieu fréquenté par la personne",
        'location typed in a public calendar event: may be an appointment, not necessarily a place the person visits'
      )
    }
  })
  const properties = compact({
    calendar_url: url,
    calendar_name: cal.name,
    calendar_timezone: cal.timezone,
    calendar_description: cal.description?.slice(0, 500),
    calendar_events_count: cal.events.length,
    calendar_first_event: first?.summary,
    calendar_first_event_date: first?.start,
    calendar_last_event: last && last !== first ? last.summary : undefined,
    calendar_last_event_date: last && last !== first ? last.start : undefined
  })
  return { properties, entities }
}

/** Adresse Gmail, ou domaine dont la messagerie est hébergée par Google (Workspace). */
async function isGoogleHosted(input: InputEntity, domain: string, resolveMx: (d: string) => Promise<string[]>): Promise<boolean> {
  if (GMAIL_DOMAINS.includes(domain)) return true
  const known = Array.isArray(input.data.mx) ? input.data.mx.map(String) : null
  const mx = known ?? (await resolveMx(domain).catch(() => []))
  return mx.some((h) => /(^|[\s.])(google|googlemail)\.com\.?$/i.test(h.trim()))
}

export default defineModule({
  id: 'email.google_calendar',
  name: { fr: 'Agenda Google public', en: 'Public Google Calendar' },
  description: {
    fr: "Lit l'agenda Google de l'adresse (Gmail ou Google Workspace) s'il est public : nom, fuseau horaire, nombre d'événements, premier et dernier événement. Les lieux des événements deviennent des adresses à vérifier (carte et frise). Un agenda privé ne prouve pas que le compte n'existe pas.",
    en: "Reads the address's Google Calendar (Gmail or Google Workspace) when it is public: name, timezone, number of events, first and last event. Event locations become addresses to review (map and timeline). A private calendar does not prove the account does not exist."
  },
  category: 'email',
  inputTypes: ['email'],
  homepage: 'https://support.google.com/calendar/answer/37083',
  // Un fournisseur connu autre que Google ne peut pas porter d'agenda Google.
  accepts: (input) => {
    const p = emailProvider(input.label.trim().toLowerCase())
    return !p || p.id === 'gmail'
  },
  async run(input, ctx) {
    const email = requireEmail(input)
    const domain = splitEmail(email)!.domain
    if (!(await isGoogleHosted(input, domain, (d) => ctx.resolveDns(d, 'MX')))) return {}
    const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(email)}/public/basic.ics`
    const res = await ctx.fetch(url, { headers: { accept: 'text/calendar' } })
    // 404 : agenda absent ou non public. Cela ne dit rien de l'existence du compte.
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined)
      return { raw: { status: res.status } }
    }
    if (res.status === 429) throw new ModuleError('Google Agenda : trop de requêtes depuis cette adresse IP, réessayez plus tard', 'rate_limited')
    if (!res.ok) throw httpFailure('Google Agenda', res.status)
    const cal = parseIcs(await res.text())
    if (!cal) throw new ModuleError('Google Agenda : réponse non iCal', 'other')
    const { properties, entities } = calendarOutput(cal, url, ctx.lang)
    return { properties, entities, raw: { name: cal.name, timezone: cal.timezone, events: cal.events.length } }
  }
})
