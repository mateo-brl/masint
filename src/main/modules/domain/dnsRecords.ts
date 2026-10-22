import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { detectDnsProvider } from './_hosting'
import { analyzeMail, dmarcPolicy, parseMx } from './_mail'
import { normalizeHost, uniq } from './_util'

export const RECORD_TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'CAA'] as const
export type RecordType = (typeof RECORD_TYPES)[number]
export type DnsRecords = Partial<Record<RecordType | 'DMARC', string[]>>

const MAX_IPS = 20
const MAX_HOSTS = 10

/** Adresse email du responsable de zone (champ RNAME du SOA). */
export function soaEmail(soa: string | undefined): string | null {
  const rname = soa?.split(/\s+/)[1]?.replace(/\.$/, '')
  if (!rname || !rname.includes('.')) return null
  const unescaped = rname.replace(/\\\./g, '\u0000')
  const i = unescaped.indexOf('.')
  return (unescaped.slice(0, i) + '@' + unescaped.slice(i + 1)).replace(/\u0000/g, '.').toLowerCase()
}

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
  const dmarc = (rec.DMARC ?? []).find((t) => /^v=DMARC1/i.test(t))

  const total = a.length + aaaa.length + mx.length + (nullMx ? 1 : 0) + ns.length + txt.length + cname.length + caa.length + (soa ? 1 : 0)
  if (!total) return {}

  const mail = analyzeMail(mx, txt)
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

  for (const name of mail.mailProviders)
    entities.push({ type: 'technology', label: name, data: { kind: fr ? 'Messagerie' : 'Email hosting' }, linkLabel: fr ? 'messagerie' : 'email hosting' })
  for (const name of mail.senders.filter((s) => !mail.mailProviders.includes(s)).slice(0, 12))
    entities.push({ type: 'technology', label: name, data: { kind: fr ? 'Envoi d’emails' : 'Email sending' }, linkLabel: fr ? 'autorisé par SPF' : 'allowed by SPF' })

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
    dmarc: dmarc ?? null,
    dmarc_policy: dmarcPolicy(dmarc),
    mail_providers: mail.mailProviders,
    mail_senders: mail.senders,
    txt_verifications: mail.verifications.map((v) => `${v.service}: ${v.value}`),
    dns_provider: dnsProvider?.name ?? null
  }
  for (const k of Object.keys(properties)) {
    const v = properties[k]
    if (v === null || (Array.isArray(v) && !v.length)) delete properties[k]
  }
  return { properties, entities, raw: rec }
}

export default defineModule({
  id: 'domain.dns',
  name: { fr: 'Enregistrements DNS', en: 'DNS records' },
  description: {
    fr: 'Résout A, AAAA, MX, NS, TXT, CNAME, SOA, CAA et DMARC (DNS-over-HTTPS) ; en déduit la messagerie (Google Workspace, Microsoft 365...), les services d’envoi SPF, les jetons de vérification et le fournisseur DNS.',
    en: 'Resolves A, AAAA, MX, NS, TXT, CNAME, SOA, CAA and DMARC (DNS-over-HTTPS); infers email hosting (Google Workspace, Microsoft 365...), SPF senders, verification tokens and DNS provider.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  async run(input, ctx) {
    const domain = normalizeHost(input.label)
    if (!domain.includes('.')) throw new ModuleError('Domaine invalide', 'invalid_input')
    const queries: Array<[RecordType | 'DMARC', string, RecordType]> = [
      ...RECORD_TYPES.map((t) => [t, domain, t] as [RecordType, string, RecordType]),
      ['DMARC', `_dmarc.${domain}`, 'TXT']
    ]
    const results = await Promise.allSettled(queries.map(([, name, type]) => ctx.resolveDns(name, type)))
    if (results.every((r) => r.status === 'rejected')) {
      const reason = (results[0] as PromiseRejectedResult).reason
      throw new ModuleError(`Résolution DNS impossible : ${reason instanceof Error ? reason.message : reason}`, 'unavailable')
    }
    const rec: DnsRecords = {}
    queries.forEach(([key], i) => {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.length) rec[key] = r.value
    })
    return buildDnsOutput(domain, rec, ctx.lang)
  }
})
