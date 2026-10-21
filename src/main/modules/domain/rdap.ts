import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { domainAndParents, getJsonOrNull, isDomain, normalizeDomain, uniq } from './_util'

type VcardProp = [string, Record<string, unknown>, string, unknown]

export interface RdapEntity {
  handle?: string
  roles?: string[]
  vcardArray?: [string, VcardProp[]]
  entities?: RdapEntity[]
  publicIds?: Array<{ type: string; identifier: string }>
  links?: Array<{ rel?: string; href?: string; type?: string }>
}

export interface RdapDomain {
  ldhName?: string
  handle?: string
  status?: string[]
  events?: Array<{ eventAction: string; eventDate: string }>
  nameservers?: Array<{ ldhName?: string }>
  entities?: RdapEntity[]
  links?: Array<{ rel?: string; href?: string; type?: string }>
  secureDNS?: { delegationSigned?: boolean }
}

export interface Contact {
  roles: string[]
  name: string | null
  org: string | null
  emails: string[]
  phones: string[]
  street: string | null
  city: string | null
  postcode: string | null
  country: string | null
  url: string | null
}

const HIDDEN =
  /redacted|privacy|withheld|not disclosed|non[- ]public|data protected|gdpr|statutory masking|domains by proxy|whoisguard|perfect privacy|contact privacy|identity protect|private registration|registration private|please query|hidden|not available|^n\/?a$/i

const visible = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && !HIDDEN.test(s) ? s : null
}

export function parseVcard(entity: RdapEntity): Contact {
  const props = entity.vcardArray?.[1] ?? []
  const c: Contact = {
    roles: entity.roles ?? [],
    name: null,
    org: null,
    emails: [],
    phones: [],
    street: null,
    city: null,
    postcode: null,
    country: null,
    url: null
  }
  for (const [name, params, , value] of props) {
    switch (name) {
      case 'fn':
        c.name = visible(value)
        break
      case 'org':
        c.org = visible(Array.isArray(value) ? value.join(' ') : value)
        break
      case 'email': {
        const e = visible(value)?.replace(/^mailto:/i, '').toLowerCase()
        if (e && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) c.emails.push(e)
        break
      }
      case 'tel': {
        const t = visible(value)
        const digits = t?.replace(/^tel:/i, '').replace(/[.\s()-]/g, '').replace(/;ext=.*$/i, '')
        if (digits && /^\+?\d{6,15}$/.test(digits)) c.phones.push(digits.startsWith('+') ? digits : '+' + digits)
        break
      }
      case 'adr': {
        const parts = Array.isArray(value) ? value.map((p) => (Array.isArray(p) ? p.join(', ') : String(p ?? ''))) : []
        c.street = visible([parts[0], parts[1], parts[2]].filter(Boolean).join(', ')) ?? c.street
        c.city = visible(parts[3]) ?? c.city
        c.postcode = visible(parts[5]) ?? c.postcode
        const cc = typeof params?.cc === 'string' ? params.cc : visible(parts[6])
        c.country = cc ? cc.toUpperCase() : c.country
        break
      }
      case 'url':
      case 'contact-uri':
        c.url = c.url ?? visible(value)
        break
    }
  }
  c.emails = uniq(c.emails)
  c.phones = uniq(c.phones)
  return c
}

/** Toutes les entités RDAP, sous-entités comprises (contact abus du registrar...). */
function flatten(entities: RdapEntity[] = [], parentRoles: string[] = []): Array<{ e: RdapEntity; parentRoles: string[] }> {
  return entities.flatMap((e) => [{ e, parentRoles }, ...flatten(e.entities, e.roles ?? [])])
}

const ROLE_LABELS: Record<string, { fr: string; en: string }> = {
  registrant: { fr: 'titulaire', en: 'registrant' },
  administrative: { fr: 'contact administratif', en: 'admin contact' },
  technical: { fr: 'contact technique', en: 'tech contact' },
  billing: { fr: 'contact facturation', en: 'billing contact' }
}

/** Analyse la réponse RDAP du registre et, si disponible, celle du registrar. */
export function parseRdap(domain: string, registry: RdapDomain, registrar: RdapDomain | null, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const all = [...flatten(registry.entities), ...flatten(registrar?.entities)]
  const registrarEnt = all.find(({ e }) => e.roles?.includes('registrar'))?.e
  const registrarContact = registrarEnt ? parseVcard(registrarEnt) : null
  const registrarName = registrarContact?.org ?? registrarContact?.name ?? null
  const ianaId = registrarEnt?.publicIds?.find((p) => /iana/i.test(p.type))?.identifier ?? null
  const registrarSite = registrarEnt?.links?.find((l) => l.rel === 'about' && /^https?:/.test(l.href ?? ''))?.href ?? registrarContact?.url ?? null
  const abuse = all.filter(({ e, parentRoles }) => e.roles?.includes('abuse') && parentRoles.includes('registrar')).map(({ e }) => parseVcard(e))
  const abuseEmail = abuse.flatMap((a) => a.emails)[0] ?? null
  const abusePhone = abuse.flatMap((a) => a.phones)[0] ?? null

  const events: Record<string, string> = {}
  for (const ev of [...(registry.events ?? []), ...(registrar?.events ?? [])]) {
    const key =
      ev.eventAction === 'registration'
        ? 'created_at'
        : ev.eventAction === 'expiration' || ev.eventAction === 'registrar expiration'
          ? 'expires_at'
          : ev.eventAction === 'last changed'
            ? 'updated_at'
            : ev.eventAction === 'transfer'
              ? 'transferred_at'
              : null
    if (key && ev.eventDate && !events[key]) events[key] = new Date(ev.eventDate).toISOString()
  }

  const nameservers = uniq((registry.nameservers ?? registrar?.nameservers ?? []).map((n) => (n.ldhName ?? '').toLowerCase()).filter(Boolean))
  const status = uniq([...(registry.status ?? []), ...(registrar?.status ?? [])])

  const entities: OutEntity[] = []
  if (registrarName) {
    entities.push({
      ref: 'registrar',
      type: 'organization',
      label: registrarName,
      data: { kind: 'Registrar', website: registrarSite ?? undefined, country: registrarContact?.country ?? undefined } as Record<string, PropValue>,
      linkLabel: 'registrar'
    })
  }

  // Contacts publics (titulaire, administratif, technique), dédoublonnés entre rôles et entre réponses.
  const contacts = new Map<string, Contact>()
  for (const { e } of all) {
    const roles = (e.roles ?? []).filter((r) => r in ROLE_LABELS)
    if (!roles.length) continue
    const c = parseVcard(e)
    if (!c.name && !c.org && !c.emails.length && !c.phones.length) continue
    const key = (c.org ?? c.name ?? c.emails[0] ?? c.phones[0] ?? '').toLowerCase()
    const prev = contacts.get(key)
    if (prev) {
      prev.roles = uniq([...prev.roles, ...roles])
      prev.emails = uniq([...prev.emails, ...c.emails])
      prev.phones = uniq([...prev.phones, ...c.phones])
      prev.street = prev.street ?? c.street
      prev.city = prev.city ?? c.city
      prev.postcode = prev.postcode ?? c.postcode
      prev.country = prev.country ?? c.country
    } else contacts.set(key, { ...c, roles })
  }

  const summaries: string[] = []
  let i = 0
  for (const c of contacts.values()) {
    const roleLabel = c.roles.map((r) => ROLE_LABELS[r][fr ? 'fr' : 'en']).join(', ')
    const holder = c.org ?? c.name
    const sameAsRegistrar = !!holder && !!registrarName && holder.toLowerCase() === registrarName.toLowerCase()
    let parent = '$input'
    if (holder && !sameAsRegistrar) {
      const ref = `contact${i++}`
      entities.push({
        ref,
        type: c.org ? 'organization' : 'person',
        label: holder,
        data: c.org ? ({ country: c.country ?? undefined } as Record<string, PropValue>) : {},
        linkLabel: roleLabel
      })
      parent = ref
    } else if (sameAsRegistrar) parent = 'registrar'
    for (const email of c.emails.slice(0, 3)) entities.push({ type: 'email', label: email, from: parent, linkLabel: parent === '$input' ? roleLabel : 'email' })
    for (const phone of c.phones.slice(0, 2)) entities.push({ type: 'phone', label: phone, from: parent, linkLabel: parent === '$input' ? roleLabel : fr ? 'téléphone' : 'phone' })
    if (c.street && c.city && !sameAsRegistrar) {
      const label = [c.street, [c.postcode, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ')
      entities.push({
        type: 'address',
        label,
        from: parent,
        data: { street: c.street, postcode: c.postcode ?? undefined, city: c.city, country: c.country ?? undefined } as Record<string, PropValue>,
        linkLabel: fr ? 'adresse' : 'address'
      })
    }
    summaries.push(`${roleLabel}: ${[holder, ...c.emails, ...c.phones, c.country].filter(Boolean).join(' / ')}`)
  }

  const properties: Record<string, PropValue> = {
    ...events,
    registrar: registrarName,
    registrar_iana_id: ianaId,
    registrar_abuse_email: abuseEmail,
    registrar_abuse_phone: abusePhone,
    status,
    nameservers,
    dnssec: registry.secureDNS?.delegationSigned ?? null,
    whois_contacts: summaries
  }
  for (const k of Object.keys(properties)) {
    const v = properties[k]
    if (v === null || (Array.isArray(v) && !v.length)) delete properties[k]
  }
  if (domain !== normalizeDomain(registry.ldhName ?? domain)) properties.registered_domain = (registry.ldhName ?? '').toLowerCase()
  return { properties, entities, raw: { registry, registrar } }
}

async function fetchRdap(ctx: ModuleContext, url: string): Promise<RdapDomain | null> {
  return getJsonOrNull<RdapDomain>(ctx, url, 'RDAP', { headers: { accept: 'application/rdap+json, application/json' } })
}

export default defineModule({
  id: 'domain.whois',
  name: { fr: 'WHOIS (RDAP)', en: 'WHOIS (RDAP)' },
  description: {
    fr: 'Données d’enregistrement via RDAP (successeur du WHOIS) : registrar, dates de création et d’expiration, statuts, serveurs DNS, DNSSEC et contacts quand ils sont publics.',
    en: 'Registration data via RDAP (the WHOIS successor): registrar, creation and expiry dates, statuses, nameservers, DNSSEC and contacts when public.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  homepage: 'https://rdap.org',
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    // Un sous-domaine n'a pas de fiche propre : on remonte jusqu'au domaine enregistré.
    for (const candidate of domainAndParents(domain).slice(0, 3)) {
      const registry = await fetchRdap(ctx, `https://rdap.org/domain/${encodeURIComponent(candidate)}`)
      if (!registry) continue
      const related = registry.links?.find(
        (l) => l.rel === 'related' && /rdap/.test(l.type ?? '') && l.href && !/rdap\.org/.test(l.href)
      )?.href
      const registrar = related ? await fetchRdap(ctx, related).catch(() => null) : null
      return parseRdap(domain, registry, registrar, ctx.lang)
    }
    return {}
  }
})
