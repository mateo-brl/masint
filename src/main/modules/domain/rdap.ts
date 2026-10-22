import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { emailProvider } from '@shared/platforms'
import type { PropValue } from '@shared/types'
import { detectDnsProvider, detectHosting } from './_hosting'
import { compact, countryName, domainAndParents, getJsonOrNull, isDomain, normalizeDomain, uniq } from './_util'
import { companyCore, domainBase, foldText, isCompanyName, isProxyEmail, looksLikePerson, sameCompany, visibleName, visibleValue } from './_whois'

type VcardProp = [string, Record<string, unknown>, string, unknown]

export interface RdapEntity {
  handle?: string
  roles?: string[]
  vcardArray?: [string, VcardProp[]]
  entities?: RdapEntity[]
  publicIds?: Array<{ type: string; identifier: string }>
  links?: Array<{ rel?: string; href?: string; type?: string }>
  remarks?: Array<{ title?: string; type?: string; description?: string[] }>
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
  /** Nature déclarée par le registre (vCard `kind`, remarque AFNIC « contact type »). */
  kind: 'organization' | 'person' | null
  /** Publication restreinte demandée par le titulaire (AFNIC) : nom et adresse ne sont pas les siens. */
  restricted: boolean
}

/** Email exploitable : syntaxe valide, ni étoilé, ni adresse relais d'un service d'anonymat. */
export function visibleEmail(v: unknown): string | null {
  const e = typeof v === 'string' ? v.trim().replace(/^mailto:/i, '').toLowerCase() : ''
  if (!/^[^@\s*]+@[^@\s*]+\.[a-z]{2,}$/i.test(e) || isProxyEmail(e)) return null
  return e
}

/** Numéro au format E.164 (`tel:+41.228203544` → `+41228203544`), sans les numéros factices (`+33.000000000`). */
export function visiblePhone(v: unknown): string | null {
  const t = visibleValue(v)
  const digits = t?.replace(/^tel:/i, '').replace(/;ext=.*$/i, '').replace(/[.\s()-]/g, '')
  if (!digits || !/^\+?\d{6,15}$/.test(digits) || /^\+?\d{0,3}0{6,}$/.test(digits)) return null
  // Préfixe international `00` (`0041228203541`, Verisign) : même numéro que `+41228203541`.
  return digits.startsWith('+') ? digits : digits.startsWith('00') ? '+' + digits.slice(2) : '+' + digits
}

const remark = (e: RdapEntity, type: string): string =>
  (e.remarks ?? [])
    .filter((r) => (r.type ?? r.title ?? '').toLowerCase() === type)
    .flatMap((r) => r.description ?? [])
    .join(' ')
    .trim()
    .toLowerCase()

/**
 * Contact d'une vCard RDAP, valeurs masquées retirées. `masked` à faux pour le registrar,
 * dont le nom n'est jamais masqué mais peut contenir un mot de la liste (« Privacy », « Domains »).
 */
export function parseVcard(entity: RdapEntity, masked = true): Contact {
  const props = entity.vcardArray?.[1] ?? []
  const name = (v: unknown): string | null => (masked ? visibleName(v) : typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null)
  const declared = remark(entity, 'contact type')
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
    url: null,
    kind: declared === 'organization' ? 'organization' : declared === 'person' ? 'person' : null,
    restricted: /^(yes|oui|true)$/.test(remark(entity, 'contact restricted publication'))
  }
  for (const [prop, params, , value] of props) {
    switch (prop) {
      case 'fn':
        c.name = name(value)
        break
      case 'org':
        c.org = name(Array.isArray(value) ? value.join(' ') : value)
        break
      case 'kind':
        if (value === 'org' || value === 'group') c.kind = 'organization'
        else if (value === 'individual') c.kind = 'person'
        break
      case 'email': {
        const e = visibleEmail(value)
        if (e) c.emails.push(e)
        break
      }
      case 'tel': {
        // Les numéros de fax n'apportent rien à l'enquête.
        const types = ([] as unknown[]).concat(params?.type ?? []).map((t) => String(t).toLowerCase())
        const p = types.includes('fax') ? null : visiblePhone(value)
        if (p) c.phones.push(p)
        break
      }
      case 'adr': {
        const parts = Array.isArray(value) ? value.map((p) => (Array.isArray(p) ? p.join(', ') : String(p ?? ''))) : []
        c.street = visibleValue([parts[0], parts[1], parts[2]].map((p) => visibleValue(p)).filter(Boolean).join(', ')) ?? c.street
        c.city = visibleValue(parts[3]) ?? c.city
        c.postcode = visibleValue(parts[5]) ?? c.postcode
        const cc = typeof params?.cc === 'string' ? params.cc : visibleValue(parts[6])
        c.country = cc && /^[a-z]{2}$/i.test(cc) ? cc.toUpperCase() : c.country
        break
      }
      case 'url':
      case 'contact-uri':
        c.url = c.url ?? visibleValue(value)
        break
    }
  }
  if (c.restricted) {
    c.name = null
    c.org = null
    c.street = null
    c.city = null
    c.postcode = null
  }
  c.emails = uniq(c.emails)
  c.phones = uniq(c.phones)
  return c
}

/** Titulaire réel d'un contact : organisation ou personne, ou `null` s'il est masqué. */
export interface Holder {
  type: 'organization' | 'person'
  label: string
  /** Personne citée à côté de la raison sociale (contact nommé de la société). */
  contactName?: string
}

export function contactHolder(c: Contact): Holder | null {
  const { name, org } = c
  const person = (v: string | null): string | undefined => (v && looksLikePerson(v) ? v : undefined)
  if (name && org && foldText(name) === foldText(org)) return { type: c.kind === 'person' ? 'person' : 'organization', label: org }
  if (name && org && sameCompany(name, org)) return { type: 'organization', label: org }
  // Champs inversés (AFNIC) : raison sociale dans `fn`, personne dans `org`.
  if (name && org && isCompanyName(name) && !isCompanyName(org)) return { type: 'organization', label: name, contactName: person(org) }
  if (org) return { type: 'organization', label: org, contactName: person(name) }
  if (!name) return null
  // Identifiant plutôt qu'un nom (« Customer 12345 »).
  if (/\d/.test(name) && name.includes(' ') && !isCompanyName(name)) return null
  if (c.kind === 'person' && !isCompanyName(name)) return { type: 'person', label: name }
  if (c.kind === 'organization' || isCompanyName(name) || !looksLikePerson(name)) return { type: 'organization', label: name }
  return { type: 'person', label: name }
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

/** Contact du titulaire (ou d'un tiers), regroupé entre rôles et entre réponses. */
interface ContactGroup {
  roles: string[]
  holder: Holder | null
  card: Contact
}

/** Analyse la réponse RDAP du registre et, si disponible, celle du registrar. */
export function parseRdap(domain: string, registry: RdapDomain, registrar: RdapDomain | null, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const all = [...flatten(registry.entities), ...flatten(registrar?.entities)]
  const registrarEnt = all.find(({ e }) => e.roles?.includes('registrar'))?.e
  const registrarCard = registrarEnt ? parseVcard(registrarEnt, false) : null
  const registrarName = registrarCard?.org ?? registrarCard?.name ?? null
  const ianaId = registrarEnt?.publicIds?.find((p) => /iana/i.test(p.type))?.identifier ?? null
  const registrarSite = registrarEnt?.links?.find((l) => l.rel === 'about' && /^https?:/.test(l.href ?? ''))?.href ?? registrarCard?.url ?? null
  const abuse = all.filter(({ e, parentRoles }) => e.roles?.includes('abuse') && parentRoles.includes('registrar')).map(({ e }) => parseVcard(e, false))
  // AFNIC publie l'adresse d'abus directement dans la fiche du registrar.
  const abuseEmail = abuse.flatMap((a) => a.emails)[0] ?? registrarCard?.emails.find((e) => /abuse/.test(e)) ?? null
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

  // Coordonnées du registrar : sa fiche, son contact d'abus, les domaines de ses adresses et sa raison sociale.
  const alnum = (s: string | null): string => (s ?? '').replace(/[^a-z0-9]/g, '')
  const registrarEmails = uniq([...(registrarCard?.emails ?? []), ...abuse.flatMap((a) => a.emails)])
  const registrarPhones = new Set([...(registrarCard?.phones ?? []), ...abuse.flatMap((a) => a.phones)])
  // Les messageries grand public (gmail.com...) ne désignent personne en particulier.
  const registrarBases = new Set(
    [registrarSite, ...registrarEmails.filter((m) => !emailProvider(m))]
      .map((v) => alnum(v ? domainBase(v) : null))
      .concat(registrarName ? [alnum(companyCore(registrarName).join(''))] : [])
      .filter((b) => b.length >= 3)
  )
  const onRegistrarDomain = (email: string): boolean => !emailProvider(email) && registrarBases.has(alnum(domainBase(email)))
  // Registrar qui est aussi un hébergeur connu (Infomaniak, OVHcloud, Gandi...) : même nœud que celui
  // de domain.hosting et des modules IP (type, plateforme et libellé identiques).
  const known = registrarName ? detectHosting({ org: registrarName }) : null
  const provider = known?.platform ? known : null
  const isRegistrar = (c: Contact): boolean =>
    !!registrarName &&
    [c.name, c.org].some((v) => sameCompany(v, registrarName) || (!!v && !!provider && detectHosting({ org: v })?.platform === provider.platform))

  // Contacts publics (titulaire, administratif, technique), dédoublonnés entre rôles et entre réponses.
  // Ceux du registrar et ceux qui sont masqués ne deviennent pas des entités.
  const groups = new Map<string, ContactGroup>()
  const registrarRoles: string[] = []
  const maskedRoles: string[] = []
  const extraEmails: string[] = []
  const extraPhones: string[] = []
  for (const { e } of all) {
    const roles = (e.roles ?? []).filter((r) => r in ROLE_LABELS)
    if (!roles.length) continue
    const c = parseVcard(e)
    const holder = contactHolder(c)
    const fromRegistrar = isRegistrar(c) || (!holder && c.emails.length > 0 && c.emails.every(onRegistrarDomain))
    if (fromRegistrar || (!holder && !c.emails.length && c.phones.length > 0 && c.phones.every((p) => registrarPhones.has(p)))) {
      registrarRoles.push(...roles)
      extraEmails.push(...c.emails)
      extraPhones.push(...c.phones)
      continue
    }
    // Adresse ou numéro du registrar recopié dans le contact du titulaire : rangé chez le registrar.
    const emails = c.emails.filter((m) => !onRegistrarDomain(m) && !registrarEmails.includes(m))
    const phones = c.phones.filter((p) => !registrarPhones.has(p))
    extraEmails.push(...c.emails.filter((m) => !emails.includes(m)))
    extraPhones.push(...c.phones.filter((p) => !phones.includes(p)))
    if (!holder && !emails.length && !phones.length) {
      maskedRoles.push(...roles)
      continue
    }
    const card = { ...c, emails, phones }
    const key = holder ? `${holder.type}|${foldText(holder.label)}` : `masked|${emails[0] ?? phones[0]}`
    const prev = groups.get(key)
    if (prev) {
      prev.roles = uniq([...prev.roles, ...roles])
      prev.card.emails = uniq([...prev.card.emails, ...emails])
      prev.card.phones = uniq([...prev.card.phones, ...phones])
      prev.card.street = prev.card.street ?? c.street
      prev.card.city = prev.card.city ?? c.city
      prev.card.postcode = prev.card.postcode ?? c.postcode
      prev.card.country = prev.card.country ?? c.country
      if (prev.holder && holder?.contactName) prev.holder.contactName = prev.holder.contactName ?? holder.contactName
    } else groups.set(key, { roles: uniq(roles), holder, card })
  }

  const order = Object.keys(ROLE_LABELS)
  const rolesLabel = (roles: string[]): string =>
    uniq(roles)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((r) => ROLE_LABELS[r][fr ? 'fr' : 'en'])
      .join(', ')
  const entities: OutEntity[] = []
  const summaries: string[] = []

  if (registrarName) {
    const dns = detectDnsProvider(nameservers)
    const holderToo = registrarRoles.includes('registrant')
    const sameDns = !!provider && dns?.platform === provider.platform
    const linkLabel =
      'registrar' + (holderToo ? (fr ? ' et titulaire' : ' and registrant') : '') + (sameDns ? (fr ? ' (et DNS)' : ' (and DNS)') : '')
    entities.push({
      ref: 'registrar',
      type: provider ? 'hosting' : 'organization',
      label: provider ? provider.name : registrarName,
      platform: provider?.platform,
      data: compact({
        kind: 'Registrar',
        legal_name: provider && foldText(provider.name) !== foldText(registrarName) ? registrarName : null,
        website: registrarSite,
        country: countryName(registrarCard?.country, lang) ?? registrarCard?.country ?? null,
        registrar_iana_id: ianaId,
        abuse_email: abuseEmail,
        abuse_phone: abusePhone,
        emails: uniq([...registrarEmails, ...extraEmails]).filter((m) => m !== abuseEmail),
        phones: uniq([...registrarPhones, ...extraPhones]).filter((p) => p !== abusePhone)
      }),
      linkLabel
    })
    if (registrarRoles.length) summaries.push(`${rolesLabel(registrarRoles)}: ${registrarName} (registrar)`)
  }

  let i = 0
  for (const { roles, holder, card: c } of groups.values()) {
    const roleLabel = rolesLabel(roles)
    summaries.push(`${roleLabel}: ${[holder?.label, ...c.emails, ...c.phones, c.country].filter(Boolean).join(' / ')}`)
    let parent = '$input'
    if (holder) {
      // Contact technique ou administratif tenu par un hébergeur connu (autre que le registrar) :
      // ses coordonnées vont dans la fiche de l'hébergeur, pas dans le graphe.
      const known = roles.includes('registrant') ? null : detectHosting({ org: holder.label })
      if (known?.platform) {
        entities.push({
          type: 'hosting',
          label: known.name,
          platform: known.platform,
          data: compact({
            legal_name: foldText(known.name) !== foldText(holder.label) ? holder.label : null,
            emails: c.emails,
            phones: c.phones
          }),
          linkLabel: roleLabel
        })
        continue
      }
      const ref = `contact${i++}`
      entities.push({
        ref,
        type: holder.type,
        label: holder.label,
        data:
          holder.type === 'organization'
            ? compact({ country: countryName(c.country, lang) ?? c.country, contact_name: holder.contactName ?? null })
            : {},
        linkLabel: roleLabel
      })
      parent = ref
    }
    for (const email of c.emails.slice(0, 3)) entities.push({ type: 'email', label: email, from: parent, linkLabel: parent === '$input' ? roleLabel : 'email' })
    for (const phone of c.phones.slice(0, 2)) entities.push({ type: 'phone', label: phone, from: parent, linkLabel: parent === '$input' ? roleLabel : fr ? 'téléphone' : 'phone' })
    if (holder && c.street && c.city) {
      const label = [c.street, [c.postcode, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ')
      entities.push({
        type: 'address',
        label,
        from: parent,
        data: { street: c.street, postcode: c.postcode ?? undefined, city: c.city, country: c.country ?? undefined } as Record<string, PropValue>,
        linkLabel: fr ? 'adresse' : 'address'
      })
    }
  }
  if (maskedRoles.length) summaries.push(`${rolesLabel(maskedRoles)}: ${fr ? 'masqué' : 'redacted'}`)

  const properties = compact({
    ...events,
    registrar: registrarName,
    registrar_iana_id: ianaId,
    registrar_abuse_email: abuseEmail,
    registrar_abuse_phone: abusePhone,
    status,
    nameservers,
    dnssec: registry.secureDNS?.delegationSigned ?? null,
    whois_contacts: summaries,
    registered_domain: domain !== normalizeDomain(registry.ldhName ?? domain) ? (registry.ldhName ?? '').toLowerCase() : null
  })
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
