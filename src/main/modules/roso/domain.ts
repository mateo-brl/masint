// roso.info : scan d'un domaine (page /domain/ : start, observation CTI, puis
// RDAP, crt.sh, historique WHOIS, IntelX, Hudson Rock, Wayback, VirusTotal,
// urlscan, AbuseIPDB et OTX en parallèle).

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { localizeCountry, MAX_LIST_ENTITIES } from '../domain/_util'
import { creditsOf, redact, ROSO_COMMON, RosoClient, toRosoError, type Json, type RosoResponse } from './_client'
import {
  asArr,
  asObj,
  dropEmpty,
  imageUrl,
  intelxEntities,
  isDomain,
  isEmail,
  isIp,
  isMasked,
  fullPhone,
  pick,
  pickNum,
  str,
  strList,
  uniq,
  type Obj
} from './_parse'

const PAGE = '/domain/'
const MAX_SUBDOMAINS = 150
const REDACTED = /redact|privacy|private|protected|withheld|not disclosed|gdpr|data protected|statutory masking|whoisguard|domains by proxy|contact privacy|^n\/?a$/i

type Lang = 'fr' | 'en'
const ll = (lang: Lang, fr: string, en: string): string => (lang === 'fr' ? fr : en)
const clean = (v: string): string => (v && !REDACTED.test(v) ? v : '')

interface Contact {
  role: string
  name?: string
  org?: string
  email?: string
  phone?: string
  address?: string
}

/** Contacts d'une réponse RDAP standard (`entities[].vcardArray`, rôles imbriqués). */
export function rdapContacts(rdap: Obj): { registrar?: string; contacts: Contact[] } {
  let registrar: string | undefined
  const contacts: Contact[] = []
  const walk = (list: unknown): void => {
    for (const e of asArr(list)) {
      const ent = asObj(e)
      const roles = strList(ent.roles).map((r) => r.toLowerCase())
      const card: Contact = { role: roles[0] ?? 'contact' }
      for (const f of asArr(asArr(ent.vcardArray)[1])) {
        const row = asArr(f)
        const key = str(row[0])
        const val = row[3]
        if (key === 'fn' && !card.name) card.name = clean(str(val))
        if (key === 'org' && !card.org) card.org = clean(Array.isArray(val) ? str(val[0]) : str(val))
        if (key === 'email' && !card.email && isEmail(clean(str(val)))) card.email = str(val)
        if (key === 'tel' && !card.phone) card.phone = clean(str(val).replace(/^tel:/, ''))
        if (key === 'adr' && !card.address) card.address = clean(asArr(val).map(str).filter(Boolean).join(', ') || str(asObj(asObj(row[1]).label)))
      }
      if (roles.includes('registrar')) registrar = registrar ?? (card.name || card.org)
      else if (card.name || card.org || card.email || card.phone) contacts.push(card)
      walk(ent.entities)
    }
  }
  walk(rdap.entities)
  return { registrar, contacts }
}

export function rdapProps(rdap: Obj): Record<string, PropValue | undefined> {
  const events: Record<string, string> = {}
  for (const e of asArr(rdap.events)) {
    const o = asObj(e)
    const action = str(o.eventAction).toLowerCase()
    if (action && !events[action]) events[action] = str(o.eventDate)
  }
  const ns = asArr(rdap.nameservers)
    .map((n) => str(asObj(n).ldhName).toLowerCase())
    .filter(Boolean)
  const { registrar } = rdapContacts(rdap)
  return {
    registrar,
    created_at: events.registration || undefined,
    expires_at: events.expiration || undefined,
    updated_at: events['last changed'] || events['last update of rdap database'] || undefined,
    nameservers: ns.length ? uniq(ns) : undefined,
    status: strList(rdap.status).length ? strList(rdap.status) : undefined
  }
}

function contactEntities(contacts: Contact[], lang: Lang, source: string): OutEntity[] {
  const out: OutEntity[] = []
  contacts.forEach((ct, i) => {
    const label = `${ct.role} (${source})`
    const ref = `${source}_${i}`
    if (ct.org) out.push({ ref, type: 'organization', label: ct.org, data: dropEmpty({ kind: ct.role, address: ct.address }), linkLabel: label })
    if (ct.name) out.push({ ref: ct.org ? undefined : ref, type: 'person', label: ct.name, linkLabel: label, from: ct.org ? ref : undefined })
    const from = ct.org || ct.name ? ref : undefined
    if (ct.email && isEmail(ct.email) && !isMasked(ct.email)) out.push({ type: 'email', label: ct.email.toLowerCase(), from, linkLabel: from ? 'email' : label })
    const ph = ct.phone ? fullPhone(ct.phone) : null
    if (ph) out.push({ type: 'phone', label: ph, from, linkLabel: from ? ll(lang, 'téléphone', 'phone') : label })
  })
  return out
}

/** Contacts des enregistrements historiques WhoisFreaks. */
export function whoisHistoryContacts(records: unknown): Contact[] {
  const out: Contact[] = []
  const seen = new Set<string>()
  for (const r of asArr(records).slice(0, 50)) {
    const rec = asObj(r)
    const blocks: Array<[string, Obj]> = [
      ['registrant', asObj(rec.registrant ?? rec.registrant_contact)],
      ['administrative', asObj(rec.administrative ?? rec.administrative_contact)],
      ['technical', asObj(rec.technical ?? rec.technical_contact)]
    ]
    blocks[0][1] = {
      name: pick(rec, 'registrant_name'),
      company: pick(rec, 'registrant_organization'),
      email: pick(rec, 'registrant_email'),
      ...blocks[0][1]
    }
    for (const [role, c] of blocks) {
      const ct: Contact = {
        role,
        name: clean(pick(c, 'name')),
        org: clean(pick(c, 'company', 'organization')),
        email: clean(pick(c, 'email')),
        phone: clean(pick(c, 'phone')),
        address: clean([pick(c, 'street'), pick(c, 'zip'), pick(c, 'city'), pick(c, 'country_name', 'country_code')].filter(Boolean).join(', '))
      }
      if (!ct.name && !ct.org && !ct.email && !ct.phone) continue
      const key = [ct.name, ct.org, ct.email, ct.phone].join('|').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(ct)
    }
  }
  return out
}

type Res = RosoResponse | null
const okResult = (r: Res): Obj | null => (r && r.ok && r.data.success !== false ? asObj(r.data.result ?? r.data.data ?? r.data) : null)

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.domain',
  name: { fr: 'roso.info : domaine', en: 'roso.info: domain' },
  description: {
    fr: "Scan roso.info d'un domaine : observation CTI (capture, DNS, emails), RDAP, sous-domaines crt.sh, historique WHOIS, IntelX, Hudson Rock, Wayback, VirusTotal, urlscan, AbuseIPDB, OTX. Consomme des crédits roso.info.",
    en: 'roso.info domain scan: CTI observation (screenshot, DNS, emails), RDAP, crt.sh subdomains, WHOIS history, IntelX, Hudson Rock, Wayback, VirusTotal, urlscan, AbuseIPDB, OTX. Consumes roso.info credits.'
  },
  inputTypes: ['domain'],
  timeoutMs: 240_000,
  async run(input, ctx) {
    const domain = input.label
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '')
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    const lang = ctx.lang
    const c = new RosoClient(ctx, 'domain')
    await c.checkMaintenance('domain')

    const start = await c.launch('/api/gateway/domain/start', { domain }, { page: PAGE })

    const q = { domain }
    const get = (path: string, timeoutMs = 60000, extra: Record<string, string> = {}): Promise<Res> =>
      c.get(path, { query: { ...q, ...extra }, timeoutMs, retries: 1, throwOnError: false, page: PAGE }).catch(() => null)
    const [cti, rdap, crtsh, history, intelx, hudson, wayback, vt, urlscan, abuse, otx] = await Promise.all([
      get('/api/gateway/domain/cti', 65000, { visual: '1' }),
      get('/api/gateway/domain/rdap'),
      get('/api/gateway/domain/crtsh'),
      get('/api/gateway/domain/whois-history'),
      get('/api/gateway/domain/intelx'),
      get('/api/gateway/domain/hudsonrock'),
      get('/api/gateway/domain/wayback'),
      get('/api/gateway/domain/virustotal'),
      get('/api/gateway/domain/urlscan'),
      get('/api/gateway/domain/abuseipdb'),
      get('/api/gateway/domain/otx')
    ])
    const all = { cti, rdap, crtsh, history, intelx, hudson, wayback, vt, urlscan, abuse, otx }
    const denied = Object.values(all).find((r) => r?.status === 401)
    if (denied) throw toRosoError(401, denied.data, 'domain', lang)

    const entities: OutEntity[] = []
    const props: Record<string, PropValue | undefined> = { roso_credits_left: creditsOf(start) }
    const subdomains = new Set<string>()
    const ips = new Set<string>()

    // RDAP
    if (rdap?.ok && rdap.data.success && rdap.data.data) {
      const r = asObj(rdap.data.data)
      Object.assign(props, rdapProps(r))
      entities.push(...contactEntities(rdapContacts(r).contacts, lang, 'RDAP'))
    } else if (rdap?.data.notRegistered || rdap?.data.error === 'not_registered') props.roso_not_registered = true

    // Observation CTI (navigateur côté roso.info)
    const ctiData = cti?.ok ? asObj(cti.data.data) : null
    if (ctiData && Object.keys(ctiData).length) {
      const page = asObj(ctiData.page)
      const geo = asObj(ctiData.geo)
      const [lat, lon] = str(geo.coordinates)
        .split(',')
        .map((x) => Number(x.trim()))
      const finalUrl = str(ctiData.final_url)
      const lastHop = asObj(asArr(ctiData.hops).slice(-1)[0])
      const shot = str(asObj(ctiData.browser).screenshot)
      if (finalUrl) {
        entities.push({
          ref: 'site',
          type: 'website',
          label: finalUrl,
          data: dropEmpty({
            title: str(page.title) || undefined,
            description: str(page.description) || undefined,
            server: str(asObj(lastHop.headers).server) || undefined,
            server_ip: str(geo.ip) || undefined,
            server_location: [str(geo.place), str(geo.region)].filter(Boolean).join(', ') || undefined,
            isp: str(geo.isp) || undefined,
            lat: Number.isFinite(lat) ? lat : undefined,
            lon: Number.isFinite(lon) ? lon : undefined,
            scanned_at: str(ctiData.scanned_at) || undefined
          }),
          image: shot ? imageUrl(`data:image/jpeg;base64,${shot}`) : undefined,
          linkLabel: ll(lang, 'site observé', 'observed site')
        })
      }
      for (const e of uniq(strList(ctiData.emails).map((x) => x.toLowerCase())).slice(0, 30))
        if (isEmail(e)) entities.push({ type: 'email', label: e, from: finalUrl ? 'site' : undefined, linkLabel: ll(lang, 'email sur le site', 'email on site') })
      const dns = asObj(ctiData.dns)
      for (const a of [...strList(dns.a), ...strList(dns.aaaa)]) if (isIp(a)) ips.add(a)
      for (const n of strList(asObj(ctiData.passive_dns).names)) subdomains.add(n.toLowerCase())
      const w = asObj(ctiData.whois)
      if (!props.registrar && str(w.registrar)) props.registrar = str(w.registrar)
      if (!props.created_at && str(w.created)) props.created_at = str(w.created)
      if (!props.expires_at && str(w.expires)) props.expires_at = str(w.expires)
      if (!props.nameservers && strList(w.nameservers).length) props.nameservers = strList(w.nameservers)
    }

    // crt.sh
    if (crtsh?.ok && crtsh.data.success !== false) for (const s of strList(crtsh.data.subdomains)) subdomains.add(s.toLowerCase())

    // Historique WHOIS
    if (history?.ok && history.data.success !== false) {
      const records = asArr(history.data.records)
      props.roso_whois_history_records = pickNum(history.data, 'total_records') ?? records.length
      entities.push(...contactEntities(whoisHistoryContacts(records), lang, 'WHOIS'))
    }

    // IntelX
    const ix = okResult(intelx)
    if (ix && pickNum(ix, 'totalRecords')) {
      props.roso_intelx_records = pickNum(ix, 'totalRecords')
      entities.push(...intelxEntities(ix.records, '$input', lang))
    }

    // Hudson Rock (statistiques par domaine, pas de machine individuelle)
    const hr = okResult(hudson)
    if (hr && pickNum(hr, 'total')) {
      props.roso_hudsonrock_total = pickNum(hr, 'total')
      props.roso_hudsonrock_employees = pickNum(hr, 'employees')
      props.roso_hudsonrock_users = pickNum(hr, 'users')
      props.roso_hudsonrock_third_parties = pickNum(hr, 'thirdParties')
      props.roso_hudsonrock_last_employee_compromised = pick(hr, 'lastEmployeeCompromised') || undefined
      props.roso_hudsonrock_last_user_compromised = pick(hr, 'lastUserCompromised') || undefined
      const fam = strList(hr.stealerFamilies)
      if (fam.length) props.roso_hudsonrock_families = fam
    }

    // Wayback
    const wb = okResult(wayback)
    if (wb) {
      const urls = asArr(wb.urls).map(asObj)
      if (urls.length) {
        props.roso_wayback_urls_count = urls.length
        props.roso_wayback_urls = urls
          .sort((a, b) => (pickNum(b, 'captures') ?? 0) - (pickNum(a, 'captures') ?? 0))
          .slice(0, 25)
          .map((u) => str(u.url))
          .filter(Boolean)
      }
    }

    // VirusTotal
    const v = okResult(vt)
    if (v) {
      const stats = asObj(v.stats)
      props.roso_vt_malicious = pickNum(v, 'positives') ?? pickNum(stats, 'malicious')
      props.roso_vt_engines = pickNum(v, 'scanned')
      props.roso_vt_reputation = pickNum(v, 'reputation')
      for (const rec of asArr(v.lastDns)) {
        const o = asObj(rec)
        const type = str(o.type).toUpperCase()
        const value = str(o.value)
        if ((type === 'A' || type === 'AAAA') && isIp(value)) ips.add(value)
      }
    }

    // urlscan
    const us = okResult(urlscan)
    if (us && asArr(us.results).length) props.roso_urlscan_scans = pickNum(us, 'total') ?? asArr(us.results).length

    // AbuseIPDB
    const ab = okResult(abuse)
    for (const h of asArr(ab?.hits).slice(0, 20)) {
      const o = asObj(h)
      const ip = str(o.ip)
      if (!isIp(ip)) continue
      ips.delete(ip)
      entities.push({
        type: 'ip',
        label: ip,
        data: dropEmpty({
          abuse_score: pickNum(o, 'score'),
          abuse_reports: pickNum(o, 'reports'),
          isp: str(o.isp) || undefined,
          country: localizeCountry(str(o.country), str(o.countryCode), lang) || undefined
        }),
        linkLabel: ll(lang, 'IP (AbuseIPDB)', 'IP (AbuseIPDB)')
      })
    }

    // OTX
    const ox = okResult(otx)
    if (ox) {
      const pulses = pickNum(ox, 'pulseCount') ?? asArr(ox.pulses).length
      if (pulses) props.roso_otx_pulses = pulses
      for (const d of asArr(ox.passiveDns).slice(0, 60)) {
        const o = asObj(d)
        const addr = str(o.address) || str(o.ip)
        const host = str(o.hostname).toLowerCase()
        if (isIp(addr)) ips.add(addr)
        if (host && host.endsWith(domain)) subdomains.add(host)
      }
    }

    // Enregistrements actuels d'abord (VirusTotal), puis DNS passif : 10 au plus.
    for (const ip of Array.from(ips).slice(0, MAX_LIST_ENTITIES)) entities.push({ type: 'ip', label: ip, linkLabel: ll(lang, 'résolution DNS', 'DNS resolution') })
    subdomains.delete(domain)
    const subs = Array.from(subdomains).filter((s) => isDomain(s) && s.endsWith(domain))
    props.roso_subdomains_count = subs.length || undefined
    for (const s of subs.slice(0, MAX_SUBDOMAINS)) entities.push({ type: 'domain', label: s, linkLabel: ll(lang, 'sous-domaine', 'subdomain') })

    const rawAll: Json = {}
    for (const [k, r] of Object.entries(all)) {
      if (!r) continue
      const d = { ...r.data }
      // La capture d'écran est jointe au nœud du site, inutile de la dupliquer dans `raw`.
      if (k === 'cti' && d.data) d.data = { ...asObj(d.data), browser: { ...asObj(asObj(d.data).browser), screenshot: undefined } }
      rawAll[k] = { status: r.status, body: d }
    }
    return {
      properties: dropEmpty(props),
      entities,
      raw: redact({ start, results: rawAll }, c.key)
    }
  }
})
