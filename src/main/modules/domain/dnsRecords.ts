import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { detectDnsProvider, sharedInfrastructure } from './_hosting'
import {
  analyzeMail,
  analyzeSpf,
  DKIM_SELECTORS,
  dkimProviders,
  dmarcPolicy,
  expandSpf,
  isDkimRecord,
  parseBimi,
  parseMx,
  reportRecipients,
  reportUris
} from './_mail'
import { cappedList, isIPv4, normalizeHost, uniq } from './_util'

export const RECORD_TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'CAA'] as const
export type RecordType = (typeof RECORD_TYPES)[number]
/** Enregistrements TXT des noms annexes : `_dmarc`, `default._bimi`, `_mta-sts`, `_smtp._tls`. */
export type PolicyRecord = 'DMARC' | 'BIMI' | 'MTA_STS' | 'TLSRPT'
export type DnsRecords = Partial<Record<RecordType | PolicyRecord, string[]>> & {
  /** Clés DKIM trouvées, par sélecteur (`selector1` → enregistrement). */
  DKIM?: Record<string, string>
  /** Enregistrements SPF des include suivis (`_spf.example.com` → enregistrement). */
  SPF_INCLUDES?: Record<string, string>
}

const MAX_IPS = 20
const MAX_HOSTS = 10
/** Adresses isolées du SPF devenues entités (vraies machines d'envoi, souvent hors CDN). */
const MAX_SPF_IPS = 10

/** Adresse email du responsable de zone (champ RNAME du SOA). */
export function soaEmail(soa: string | undefined): string | null {
  const rname = soa?.split(/\s+/)[1]?.replace(/\.$/, '')
  if (!rname || !rname.includes('.')) return null
  const unescaped = rname.replace(/\\\./g, '\u0000')
  const i = unescaped.indexOf('.')
  return (unescaped.slice(0, i) + '@' + unescaped.slice(i + 1)).replace(/\u0000/g, '.').toLowerCase()
}

/** Premier enregistrement TXT qui commence par la version attendue (`v=BIMI1`, `v=STSv1`...). */
const versioned = (records: string[] | undefined, re: RegExp): string | undefined => (records ?? []).find((t) => re.test(t.trim()))

/** Construit la sortie du module à partir des enregistrements résolus. */
export function buildDnsOutput(domain: string, rec: DnsRecords, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const a = uniq(rec.A ?? [])
  const aaaa = uniq(rec.AAAA ?? [])
  const { hosts: mxRecords, nullMx } = parseMx(rec.MX ?? [])
  const mx = mxRecords.map((r) => r.host)
  const ns = uniq((rec.NS ?? []).map((n) => n.toLowerCase().replace(/\.$/, '')))
  const txt = uniq(rec.TXT ?? [])
  const cname = uniq((rec.CNAME ?? []).map((c) => c.toLowerCase().replace(/\.$/, '')))
  const caa = uniq(rec.CAA ?? [])
  const soa = rec.SOA?.[0]
  const dmarc = versioned(rec.DMARC, /^v=DMARC1/i)
  const bimi = versioned(rec.BIMI, /^v=BIMI1/i)
  const mtaSts = versioned(rec.MTA_STS, /^v=STSv1/i)
  const tlsRpt = versioned(rec.TLSRPT, /^v=TLSRPTv1/i)
  const dkimSelectors = Object.keys(rec.DKIM ?? {})

  const total =
    a.length + aaaa.length + mx.length + (nullMx ? 1 : 0) + ns.length + txt.length + cname.length + caa.length + (soa ? 1 : 0) + dkimSelectors.length
  if (!total) return {}

  const mail = analyzeMail(mx, txt)
  // SPF en profondeur : fournisseurs, domaines tiers et adresses des include suivis.
  const spf = analyzeSpf(domain, mail.spf, rec.SPF_INCLUDES)
  const senders = uniq([...mail.senders, ...spf.senders])
  // Sélecteurs DKIM propres à un service : renforcent la détection (messagerie derrière une passerelle).
  const dkimSenders = dkimProviders(dkimSelectors).filter((p) => !mail.mailProviders.includes(p) && !senders.includes(p))
  const dmarcUris = [...reportUris(dmarc, 'rua'), ...reportUris(dmarc, 'ruf')]
  const dmarcTo = reportRecipients(domain, dmarcUris)
  const tlsRptUris = reportUris(tlsRpt, 'rua')
  const tlsRptTo = reportRecipients(domain, tlsRptUris)
  const bimiTags = parseBimi(bimi)
  const dnsProvider = detectDnsProvider(ns)
  const entities: OutEntity[] = []

  for (const ip of a.slice(0, MAX_IPS)) entities.push({ type: 'ip', label: ip, data: { version: 'IPv4' }, linkLabel: 'A' })
  for (const ip of aaaa.slice(0, MAX_IPS)) entities.push({ type: 'ip', label: ip, data: { version: 'IPv6' }, linkLabel: 'AAAA' })
  for (const target of cname.slice(0, 3)) entities.push({ type: 'domain', label: target, linkLabel: 'CNAME' })
  // Serveurs MX et NS d'un fournisseur reconnu (Infomaniak, OVHcloud, Google, Route 53...) : partagés
  // par tous ses clients, ils n'apprennent rien de plus que le nœud messagerie ou hébergeur et restent
  // en propriétés. Les NS Cloudflare, attribués par compte, restent des entités (pivot entre domaines).
  const mxHosts = mx.filter((h) => h !== domain && !analyzeMail([h], []).mailProviders.length)
  const nsHosts = ns.filter((h) => {
    const provider = detectDnsProvider([h])
    return !provider || provider.platform === 'cloudflare'
  })
  for (const host of mxHosts.slice(0, MAX_HOSTS)) entities.push({ type: 'domain', label: host, linkLabel: 'MX' })
  for (const host of nsHosts.slice(0, MAX_HOSTS)) entities.push({ type: 'domain', label: host, linkLabel: 'NS' })

  const sending = { kind: fr ? 'Envoi d’emails' : 'Email sending' }
  for (const name of mail.mailProviders)
    entities.push({ type: 'technology', label: name, data: { kind: fr ? 'Messagerie' : 'Email hosting' }, linkLabel: fr ? 'messagerie' : 'email hosting' })
  for (const name of senders.filter((s) => !mail.mailProviders.includes(s)).slice(0, 12))
    entities.push({ type: 'technology', label: name, data: sending, linkLabel: fr ? 'autorisé par SPF' : 'allowed by SPF' })
  for (const name of dkimSenders) entities.push({ type: 'technology', label: name, data: sending, linkLabel: fr ? 'signature DKIM' : 'DKIM signing' })

  // Domaines tiers inclus dans le SPF (`include:_spf.mozilla.com` → mozilla.com) : organisation liée.
  for (const d of spf.domains.slice(0, MAX_HOSTS))
    entities.push({ type: 'domain', label: d, linkLabel: fr ? 'autorisé à envoyer (SPF)' : 'allowed to send (SPF)' })
  // Adresses isolées du SPF : souvent les vraies machines derrière un CDN. Les blocs restent en propriété.
  const spfIps = spf.hosts.filter((ip) => !sharedInfrastructure(ip)).slice(0, MAX_SPF_IPS)
  for (const ip of spfIps)
    entities.push({ type: 'ip', label: ip, data: { version: isIPv4(ip) ? 'IPv4' : 'IPv6' }, linkLabel: fr ? 'autorisée à envoyer (SPF)' : 'allowed to send (SPF)' })

  // Destinataires des rapports DMARC et TLS-RPT : prestataire connu ou domaine tiers.
  const reports: Array<[typeof dmarcTo, string]> = [
    [dmarcTo, fr ? 'reçoit les rapports DMARC' : 'receives DMARC reports'],
    [tlsRptTo, fr ? 'reçoit les rapports TLS-RPT' : 'receives TLS-RPT reports']
  ]
  for (const [to, linkLabel] of reports) {
    for (const name of to.providers)
      entities.push({ type: 'technology', label: name, data: { kind: fr ? 'Analyse des rapports email' : 'Email report analysis' }, linkLabel })
    for (const d of to.domains.slice(0, MAX_HOSTS)) entities.push({ type: 'domain', label: d, linkLabel })
  }

  if (a.length || aaaa.length || cname.length)
    entities.push({ type: 'website', label: `https://${domain}`, linkLabel: fr ? 'site web' : 'website' })

  const properties: Record<string, PropValue> = {
    a,
    aaaa,
    mx,
    mx_null: nullMx && !mx.length ? true : null,
    nameservers: ns,
    txt,
    cname,
    caa,
    soa: soa ?? null,
    soa_email: soaEmail(soa),
    spf: mail.spf,
    spf_includes: spf.includes,
    ...cappedList('spf_ip_ranges', spf.ranges),
    dmarc: dmarc ?? null,
    dmarc_policy: dmarcPolicy(dmarc),
    dmarc_rua: reportUris(dmarc, 'rua'),
    dmarc_ruf: reportUris(dmarc, 'ruf'),
    tls_rpt: tlsRpt ?? null,
    tls_rpt_rua: tlsRptUris,
    mta_sts: mtaSts ?? null,
    bimi_logo: bimiTags.logo,
    bimi_certificate: bimiTags.certificate,
    dkim_selectors: dkimSelectors,
    mail_providers: mail.mailProviders,
    mail_senders: senders,
    txt_verifications: mail.verifications.map((v) => `${v.service}: ${v.value}`),
    dns_provider: dnsProvider?.name ?? null
  }
  for (const k of Object.keys(properties)) {
    const v = properties[k]
    if (v === null || (Array.isArray(v) && !v.length)) delete properties[k]
  }
  return { properties, entities, raw: rec }
}

/** Joker TXT : la plupart des sélecteurs renvoient la même « clé », ce n'en est pas une. */
function dropWildcardDkim(found: Record<string, string>): Record<string, string> {
  const values = Object.values(found)
  const top = Math.max(0, ...values.map((v) => values.filter((w) => w === v).length))
  return top > DKIM_SELECTORS.length / 2 ? {} : found
}

export default defineModule({
  id: 'domain.dns',
  name: { fr: 'Enregistrements DNS', en: 'DNS records' },
  description: {
    fr: 'Résout A, AAAA, MX, NS, TXT, CNAME, SOA, CAA, DMARC, BIMI, MTA-STS, TLS-RPT et les sélecteurs DKIM courants (DNS-over-HTTPS) ; suit les include SPF (10 résolutions au plus). En déduit la messagerie (Google Workspace, Microsoft 365...), les services d’envoi, les domaines tiers autorisés par SPF ou destinataires des rapports DMARC, les adresses d’envoi du SPF, les jetons de vérification et le fournisseur DNS.',
    en: 'Resolves A, AAAA, MX, NS, TXT, CNAME, SOA, CAA, DMARC, BIMI, MTA-STS, TLS-RPT and common DKIM selectors (DNS-over-HTTPS); follows SPF includes (at most 10 lookups). Infers email hosting (Google Workspace, Microsoft 365...), sending services, third-party domains allowed by SPF or receiving DMARC reports, SPF sending addresses, verification tokens and DNS provider.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  async run(input, ctx) {
    const domain = normalizeHost(input.label)
    if (!domain.includes('.')) throw new ModuleError('Domaine invalide', 'invalid_input')
    const queries: Array<[RecordType | PolicyRecord, string, RecordType]> = [
      ...RECORD_TYPES.map((t) => [t, domain, t] as [RecordType, string, RecordType]),
      ['DMARC', `_dmarc.${domain}`, 'TXT'],
      ['BIMI', `default._bimi.${domain}`, 'TXT'],
      ['MTA_STS', `_mta-sts.${domain}`, 'TXT'],
      ['TLSRPT', `_smtp._tls.${domain}`, 'TXT']
    ]
    const [results, dkimResults] = await Promise.all([
      Promise.allSettled(queries.map(([, name, type]) => ctx.resolveDns(name, type))),
      Promise.allSettled(DKIM_SELECTORS.map((s) => ctx.resolveDns(`${s}._domainkey.${domain}`, 'TXT')))
    ])
    if (results.every((r) => r.status === 'rejected')) {
      const reason = (results[0] as PromiseRejectedResult).reason
      throw new ModuleError(`Résolution DNS impossible : ${reason instanceof Error ? reason.message : reason}`, 'unavailable')
    }
    const rec: DnsRecords = {}
    queries.forEach(([key], i) => {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.length) rec[key] = r.value
    })
    const dkim: Record<string, string> = {}
    DKIM_SELECTORS.forEach((selector, i) => {
      const r = dkimResults[i]
      const key = r.status === 'fulfilled' ? r.value.find(isDkimRecord) : undefined
      if (key) dkim[selector] = key
    })
    const dkimFound = dropWildcardDkim(dkim)
    if (Object.keys(dkimFound).length) rec.DKIM = dkimFound
    const spf = rec.TXT?.find((t) => /^v=spf1\b/i.test(t.trim()))
    if (spf) {
      const includes = await expandSpf(spf, (name) => ctx.resolveDns(name, 'TXT'))
      if (Object.keys(includes).length) rec.SPF_INCLUDES = includes
    }
    return buildDnsOutput(domain, rec, ctx.lang)
  }
})
