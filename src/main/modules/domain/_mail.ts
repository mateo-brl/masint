// Services révélés par les enregistrements MX et TXT : messagerie hébergée,
// plateformes d'envoi autorisées par SPF, jetons de vérification de propriété,
// destinataires des rapports DMARC et TLS-RPT, BIMI et sélecteurs DKIM.

import { isDomain, isIPv4, isIPv6, registrableDomain, uniq } from './_util'

const MX_RULES: Array<[RegExp, string]> = [
  [/(^|\.)(aspmx\.l\.google\.com|googlemail\.com|google\.com|smtp\.google\.com)$/, 'Google Workspace'],
  [/\.mail\.protection\.outlook\.com$|\.outlook\.com$/, 'Microsoft 365'],
  [/(^|\.)mx\d*\.ovh\.(net|com|ca)$|\.ovh\.net$/, 'OVHcloud Mail'],
  [/\.zoho\.(com|eu|in|com\.au)$|\.zohomail\.com$/, 'Zoho Mail'],
  [/\.protonmail\.ch$|\.proton\.me$/, 'Proton Mail'],
  [/\.pphosted\.com$|\.ppe-hosted\.com$/, 'Proofpoint'],
  [/\.mimecast\.(com|co\.za)$/, 'Mimecast'],
  [/\.messagelabs\.com$/, 'Broadcom Email Security'],
  [/\.barracudanetworks\.com$/, 'Barracuda'],
  [/\.iphmx\.com$/, 'Cisco Secure Email'],
  [/\.gandi\.net$/, 'Gandi Mail'],
  [/\.kundenserver\.de$|\.ionos\.(com|fr|de|co\.uk)$/, 'IONOS Mail'],
  [/\.yandex\.(net|ru)$/, 'Yandex 360'],
  [/\.mailgun\.org$/, 'Mailgun'],
  [/inbound-smtp\..*\.amazonaws\.com$/, 'Amazon SES'],
  [/\.icloud\.com$/, 'iCloud Mail'],
  [/\.secureserver\.net$/, 'GoDaddy Mail'],
  [/\.registrar-servers\.com$|\.privateemail\.com$/, 'Namecheap Mail'],
  [/\.infomaniak\.ch$/, 'Infomaniak Mail'],
  [/\.messagingengine\.com$|\.fastmail\.com$/, 'Fastmail'],
  [/\.mx\.cloudflare\.net$/, 'Cloudflare Email Routing'],
  [/\.tutanota\.de$|\.tuta\.io$/, 'Tuta'],
  [/\.migadu\.com$/, 'Migadu'],
  [/\.o2switch\.net$/, 'o2switch Mail'],
  [/\.hostinger\.com$/, 'Hostinger Mail'],
  [/\.mail\.ru$/, 'VK WorkSpace (Mail.ru)'],
  [/\.qq\.com$/, 'Tencent Exmail'],
  [/\.orange-business\.com$|\.orange\.fr$/, 'Orange'],
  [/\.mailinblack\.com$/, 'Mailinblack'],
  [/\.vadesecure\.com$/, 'Vade Secure'],
  [/\.trendmicro\.(com|eu)$/, 'Trend Micro Email Security'],
  [/\.sophos\.com$/, 'Sophos Email']
]

const SPF_RULES: Array<[RegExp, string]> = [
  [/_spf\.google\.com|_netblocks\d?\.google\.com|googlemail\.com/, 'Google Workspace'],
  [/spf\.protection\.outlook\.com/, 'Microsoft 365'],
  [/mx\.ovh\.(com|net)|\.ovh\.net/, 'OVHcloud Mail'],
  [/sendgrid\.net/, 'SendGrid'],
  [/servers\.mcsv\.net|mailchimp/, 'Mailchimp'],
  [/mandrillapp\.com/, 'Mandrill'],
  [/mailgun\.org/, 'Mailgun'],
  [/amazonses\.com/, 'Amazon SES'],
  [/_spf\.salesforce\.com|exacttarget\.com|cust-spf\.exacttarget/, 'Salesforce'],
  [/zoho\.(com|eu|in)/, 'Zoho Mail'],
  [/protonmail\.ch|proton\.me/, 'Proton Mail'],
  [/sendinblue\.com|brevo\.com/, 'Brevo'],
  [/mail\.zendesk\.com/, 'Zendesk'],
  [/hubspotemail\.net|hubspot/, 'HubSpot'],
  [/mktomail\.com/, 'Marketo'],
  [/mailjet\.com/, 'Mailjet'],
  [/intercom\.io/, 'Intercom'],
  [/freshdesk\.com|freshemail\.io/, 'Freshdesk'],
  [/messagingengine\.com/, 'Fastmail'],
  [/mlsend\.com|mailerlite/, 'MailerLite'],
  [/pphosted\.com/, 'Proofpoint'],
  [/mimecast/, 'Mimecast'],
  [/atlassian\.net|atlassian\.com/, 'Atlassian'],
  [/smtp2go\.com/, 'SMTP2GO'],
  [/mtasv\.net|postmarkapp\.com/, 'Postmark'],
  [/mailersend\.net/, 'MailerSend'],
  [/icloud\.com/, 'iCloud Mail'],
  [/gandi\.net/, 'Gandi Mail'],
  [/yandex\.(net|ru)/, 'Yandex 360'],
  [/secureserver\.net/, 'GoDaddy Mail'],
  [/elasticemail\.com/, 'Elastic Email'],
  [/registrar-servers\.com/, 'Namecheap Mail'],
  [/infomaniak\.ch/, 'Infomaniak Mail'],
  [/sparkpostmail\.com/, 'SparkPost'],
  [/emsd1\.com|klaviyo/, 'Klaviyo'],
  [/shopify\.com/, 'Shopify'],
  [/helpscoutemail\.com/, 'Help Scout'],
  [/stspg-customer\.com/, 'Atlassian Statuspage'],
  [/qualtrics\.com/, 'Qualtrics'],
  [/ionos\.(com|fr|de)|kundenserver\.de/, 'IONOS Mail'],
  [/o2switch\.net/, 'o2switch Mail'],
  [/mailinblack\.com/, 'Mailinblack'],
  [/vali\.email/, 'Valimail'],
  [/messagelabs\.com/, 'Broadcom Email Security'],
  [/iphmx\.com/, 'Cisco Secure Email'],
  [/barracudanetworks\.com/, 'Barracuda'],
  [/constantcontact\.com/, 'Constant Contact'],
  [/pardot\.com/, 'Salesforce Pardot'],
  [/eloqua\.com/, 'Oracle Eloqua'],
  [/customeriomail\.com|customer\.io/, 'Customer.io'],
  [/createsend\.com|cmail\d*\.com/, 'Campaign Monitor'],
  [/emarsys\.net/, 'Emarsys'],
  [/sendpulse\.com/, 'SendPulse'],
  [/surveymonkey(user)?\.com/, 'SurveyMonkey'],
  [/vadesecure\.com/, 'Vade Secure'],
  [/sparkpost\.com/, 'SparkPost'],
  [/mailpace\.com/, 'MailPace'],
  [/zcsend\.net/, 'Zoho Campaigns'],
  [/mailup\.(it|com|net)/, 'MailUp'],
  [/sarbacane\.com|tipimail\.com/, 'Sarbacane'],
  [/docusign\.(com|net)/, 'DocuSign']
]

const VERIFICATION_RULES: Array<[RegExp, string]> = [
  [/^google-site-verification=/i, 'Google Search Console'],
  [/^MS=/, 'Microsoft 365'],
  [/^facebook-domain-verification=/i, 'Meta (Facebook)'],
  [/^apple-domain-verification=/i, 'Apple'],
  [/^atlassian-domain-verification=/i, 'Atlassian'],
  [/^docusign=/i, 'DocuSign'],
  [/^adobe-(idp-site|sign)-verification=/i, 'Adobe'],
  [/^stripe-verification=/i, 'Stripe'],
  [/^ZOOM_verify_/i, 'Zoom'],
  [/^slack-domain-verification=/i, 'Slack'],
  [/^dropbox-domain-verification=/i, 'Dropbox'],
  [/^globalsign-domain-verification=|^_globalsign-domain-verification=/i, 'GlobalSign'],
  [/^miro-verification=/i, 'Miro'],
  [/^openai-domain-verification=/i, 'OpenAI'],
  [/^anthropic-domain-verification/i, 'Anthropic'],
  [/^yandex-verification:/i, 'Yandex Webmaster'],
  [/^pinterest-site-verification=/i, 'Pinterest'],
  [/^have-i-been-pwned-verification=/i, 'Have I Been Pwned'],
  [/^teamviewer-sso-verification=/i, 'TeamViewer'],
  [/^webexdomainverification/i, 'Webex'],
  [/^cisco-ci-domain-verification=/i, 'Cisco'],
  [/^citrix-verification-code=/i, 'Citrix'],
  [/^knowbe4-site-verification=/i, 'KnowBe4'],
  [/^mailru-verification:/i, 'Mail.ru'],
  [/^(brevo|sendinblue)-code:/i, 'Brevo'],
  [/^onetrust-domain-verification=/i, 'OneTrust'],
  [/^calendly-site-verification=/i, 'Calendly'],
  [/^jamf-site-verification=/i, 'Jamf'],
  [/^twilio-domain-verification=/i, 'Twilio'],
  [/^tiktok-(developers-)?site-verification=/i, 'TikTok'],
  [/^amazonses:/i, 'Amazon SES'],
  [/^mongodb-site-verification=/i, 'MongoDB'],
  [/^1password-site-verification=/i, '1Password'],
  [/^wiz-domain-verification=/i, 'Wiz'],
  [/^postman-domain-verification=/i, 'Postman'],
  [/^TAILSCALE-/, 'Tailscale'],
  [/^canva-site-verification=/i, 'Canva'],
  [/^airtable-verification=/i, 'Airtable'],
  [/^keybase-site-verification=/i, 'Keybase'],
  [/^detectify-verification=/i, 'Detectify'],
  [/^status-page-domain-verification=/i, 'Atlassian Statuspage'],
  [/^hubspot-developer-verification=|^hubspot-domain-verification/i, 'HubSpot'],
  [/^loaderio=/i, 'loader.io'],
  [/^cursor-domain-verification/i, 'Cursor'],
  [/^krisp-domain-verification=/i, 'Krisp'],
  [/^v=verifydomain/i, 'Microsoft'],
  [/^bluesky|^did=did:plc:/i, 'Bluesky'],
  [/^whimsical=/i, 'Whimsical'],
  [/^segment-site-verification=/i, 'Segment'],
  [/^cloudflare-verify/i, 'Cloudflare'],
  [/^ahrefs-site-verification_/i, 'Ahrefs'],
  [/^h1-domain-verification=/i, 'HackerOne'],
  [/^gitlab-pages-verification-code=/i, 'GitLab Pages'],
  [/^logmein-verification-code=/i, 'LogMeIn'],
  [/^zapier-domain-verification-challenge=/i, 'Zapier'],
  [/^notion-domain-verification/i, 'Notion'],
  [/^figma-domain-verification/i, 'Figma'],
  [/^linear-domain-verification/i, 'Linear']
]

export interface TxtVerification {
  service: string
  value: string
}

export interface MailAnalysis {
  /** Fournisseurs de messagerie (réception, d'après les MX). */
  mailProviders: string[]
  /** Services autorisés à envoyer pour le domaine (SPF). */
  senders: string[]
  spf: string | null
  verifications: TxtVerification[]
}

export interface MxRecord {
  priority: number
  host: string
}

/** Un enregistrement MX brut (`10 aspmx.l.google.com.`) : priorité et hôte, hôte vide pour un null MX. */
export function parseMxRecord(record: string): MxRecord {
  const parts = record.trim().split(/\s+/).filter(Boolean)
  const numeric = parts.length > 0 && /^\d+$/.test(parts[0])
  // Le résolveur retire le point final : « 0 . » arrive sous la forme « 0 » ou « 0 ».
  const rawHost = numeric ? (parts[1] ?? '') : (parts[0] ?? '')
  return { priority: numeric ? Number(parts[0]) : 0, host: rawHost.replace(/\.$/, '').toLowerCase() }
}

/**
 * Enregistrements MX triés par priorité. `nullMx` signale le « null MX » de la RFC 7505
 * (« 0 . ») : le domaine déclare explicitement ne recevoir aucun email.
 */
export function parseMx(records: string[]): { hosts: MxRecord[]; nullMx: boolean } {
  const parsed = records.map(parseMxRecord)
  const hosts = parsed.filter((r) => r.host).sort((a, b) => a.priority - b.priority)
  const seen = new Set<string>()
  return {
    hosts: hosts.filter((r) => !seen.has(r.host) && !!seen.add(r.host)),
    nullMx: parsed.some((r) => !r.host)
  }
}

/** `10 aspmx.l.google.com` → `aspmx.l.google.com` ; chaîne vide pour un null MX. */
export function mxHost(record: string): string {
  return parseMxRecord(record).host
}

export function analyzeMail(mx: string[], txt: string[]): MailAnalysis {
  const mailProviders = new Set<string>()
  for (const host of mx.map(mxHost).filter(Boolean)) {
    for (const [re, name] of MX_RULES) {
      if (re.test(host)) {
        mailProviders.add(name)
        break
      }
    }
  }
  const spf = txt.find((t) => /^v=spf1\b/i.test(t.trim())) ?? null
  const senders = new Set<string>()
  if (spf) {
    const mechanisms = spf
      .split(/\s+/)
      .filter((m) => /^[+~?-]?(include|redirect|exists|a|mx):|^redirect=/i.test(m))
      .join(' ')
      .toLowerCase()
    for (const [re, name] of SPF_RULES) if (re.test(mechanisms)) senders.add(name)
  }
  const verifications: TxtVerification[] = []
  for (const t of txt) {
    const value = t.trim()
    if (/^v=spf1/i.test(value)) continue
    const rule = VERIFICATION_RULES.find(([re]) => re.test(value))
    if (rule) {
      verifications.push({ service: rule[1], value })
      continue
    }
    // Forme générique « <service>-site-verification=… » ou « <service>-domain-verification=… ».
    const generic = value.match(/^([a-z0-9][a-z0-9.-]*?)[-_](?:site|domain)[-_]verification[=:]/i)
    if (generic) verifications.push({ service: capitalize(generic[1]), value })
  }
  return { mailProviders: Array.from(mailProviders), senders: Array.from(senders), spf, verifications }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Politique DMARC (`p=`) à partir de l'enregistrement `_dmarc`. */
export function dmarcPolicy(record: string | undefined): string | null {
  if (!record || !/^v=DMARC1/i.test(record)) return null
  return record.match(/\bp=([a-z]+)/i)?.[1]?.toLowerCase() ?? null
}

// ---------------------------------------------------------------------------
// SPF en profondeur : include suivis, plages d'adresses autorisées, domaines tiers.

/** Fournisseur d'envoi reconnu dans le nom d'un include SPF (`_spf.google.com` → Google Workspace). */
export function spfProvider(host: string): string | null {
  const h = host.toLowerCase()
  return SPF_RULES.find(([re]) => re.test(h))?.[1] ?? null
}

export interface SpfTerms {
  includes: string[]
  redirect: string | null
  /** Blocs `ip4:` et `ip6:` autorisés (`185.24.184.82`, `63.245.208.0/20`). */
  ranges: string[]
}

/** Mécanismes utiles d'un enregistrement SPF ; les termes en échec (`-ip4:`) sont ignorés. */
export function parseSpf(record: string): SpfTerms {
  const out: SpfTerms = { includes: [], redirect: null, ranges: [] }
  for (const raw of record.trim().split(/\s+/).slice(1)) {
    const fail = raw.startsWith('-')
    const term = raw.replace(/^[+?~-]/, '')
    const include = term.match(/^include:(.+)$/i)
    const redirect = term.match(/^redirect=(.+)$/i)
    const range = term.match(/^ip[46]:(.+)$/i)
    if (include && !fail) out.includes.push(include[1].toLowerCase().replace(/\.$/, ''))
    else if (redirect) out.redirect = redirect[1].toLowerCase().replace(/\.$/, '')
    else if (range && !fail) out.ranges.push(range[1].toLowerCase())
  }
  return out
}

/** Limite de la RFC 7208 (§4.6.4) sur les requêtes DNS d'une évaluation SPF. */
export const SPF_MAX_LOOKUPS = 10

/** Include à suivre : ni macro (`%{i}`), ni fournisseur connu dont les plages n'apprennent rien. */
function followable(host: string): boolean {
  return !host.includes('%') && isDomain(host) && !spfProvider(host)
}

function nextHosts(record: string): string[] {
  const t = parseSpf(record)
  return [...t.includes, ...(t.redirect ? [t.redirect] : [])].filter(followable)
}

/**
 * Suit les `include:` et `redirect=` qui ne désignent pas un fournisseur connu, niveau par
 * niveau, au plus 10 résolutions comme le prévoit la RFC 7208. Renvoie l'enregistrement SPF
 * trouvé pour chaque nom suivi (chaîne vide s'il n'en publie pas).
 */
export async function expandSpf(
  spf: string,
  resolveTxt: (name: string) => Promise<string[]>,
  maxLookups = SPF_MAX_LOOKUPS
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let lookups = 0
  let level = nextHosts(spf)
  while (level.length && lookups < maxLookups) {
    const batch = uniq(level)
      .filter((h) => !(h in out))
      .slice(0, maxLookups - lookups)
    lookups += batch.length
    const records = await Promise.all(
      batch.map(async (h) => {
        const txt = await resolveTxt(h).catch(() => [] as string[])
        return txt.find((t) => /^v=spf1\b/i.test(t.trim())) ?? ''
      })
    )
    level = []
    batch.forEach((h, i) => {
      out[h] = records[i]
      if (records[i]) level.push(...nextHosts(records[i]))
    })
  }
  return out
}

export interface SpfAnalysis {
  /** Fournisseurs d'envoi reconnus dans tous les enregistrements suivis. */
  senders: string[]
  /** Domaines enregistrables tiers inclus : ni fournisseur connu, ni la cible. */
  domains: string[]
  /** Tous les noms inclus (y compris ceux des fournisseurs). */
  includes: string[]
  /** Blocs `ip4:` et `ip6:` de la cible et des include suivis. */
  ranges: string[]
  /** Adresses isolées (`/32`, `/128` ou sans masque) : de vraies machines d'envoi. */
  hosts: string[]
}

/** `1.2.3.4/32` → `1.2.3.4` ; null pour un bloc plus large ou une valeur invalide. */
function isolatedAddress(range: string): string | null {
  const [ip, mask] = range.split('/')
  if (isIPv4(ip)) return !mask || mask === '32' ? ip : null
  if (isIPv6(ip)) return !mask || mask === '128' ? ip : null
  return null
}

/** Analyse le SPF de la cible et des include suivis par `expandSpf`. */
export function analyzeSpf(domain: string, spf: string | null, expanded: Record<string, string> = {}): SpfAnalysis {
  const own = registrableDomain(domain)
  const senders = new Set<string>()
  const domains = new Set<string>()
  const includes = new Set<string>()
  const ranges = new Set<string>()
  const visited = new Set<string>()
  const walk = (record: string): void => {
    const t = parseSpf(record)
    for (const r of t.ranges) ranges.add(r)
    for (const host of [...t.includes, ...(t.redirect ? [t.redirect] : [])]) {
      includes.add(host)
      const provider = spfProvider(host)
      if (provider) {
        senders.add(provider)
        continue
      }
      if (host.includes('%') || !isDomain(host)) continue
      const reg = registrableDomain(host)
      if (reg !== own) domains.add(reg)
      if (!visited.has(host) && expanded[host]) {
        visited.add(host)
        walk(expanded[host])
      }
    }
  }
  if (spf) walk(spf)
  return {
    senders: Array.from(senders),
    domains: Array.from(domains),
    includes: Array.from(includes),
    ranges: Array.from(ranges),
    hosts: uniq(Array.from(ranges).map(isolatedAddress).filter((ip): ip is string => !!ip))
  }
}

// ---------------------------------------------------------------------------
// Destinataires des rapports DMARC (`rua`, `ruf`) et TLS-RPT (`rua`).

const REPORT_RULES: Array<[RegExp, string]> = [
  [/(^|\.)(vali\.email|valimail\.com)$/, 'Valimail'],
  [/(^|\.)dmarcian(-eu)?\.(com|eu)$/, 'dmarcian'],
  [/(^|\.)agari\.com$/, 'Agari'],
  [/(^|\.)proofpoint\.com$/, 'Proofpoint'],
  [/(^|\.)easydmarc\.(com|us|eu|co|io)$/, 'EasyDMARC'],
  [/(^|\.)dmarcmanager\.app$/, 'DMARC Manager'],
  [/(^|\.)(mimecast\.(com|net|co\.za)|dmarcanalyzer\.com)$/, 'Mimecast'],
  [/(^|\.)(ondmarc\.com|redsift\.(cloud|io|com))$/, 'Red Sift OnDMARC'],
  [/(^|\.)powerdmarc\.com$/, 'PowerDMARC'],
  [/(^|\.)uriports\.com$/, 'URIports'],
  [/(^|\.)postmarkapp\.com$/, 'Postmark'],
  [/(^|\.)dmarc-reports\.cloudflare\.net$/, 'Cloudflare DMARC Management'],
  [/(^|\.)(dmarc-report\.com|mxtoolbox\.com)$/, 'MxToolbox'],
  [/(^|\.)fraudmarc\.com$/, 'Fraudmarc'],
  [/(^|\.)sendmarc\.com$/, 'Sendmarc'],
  [/(^|\.)dmarcly\.com$/, 'Dmarcly'],
  [/(^|\.)mailhardener\.com$/, 'Mailhardener'],
  [/(^|\.)report-uri\.com$/, 'Report URI'],
  [/(^|\.)250ok\.net$/, 'Validity (250ok)'],
  [/(^|\.)dmarcadvisor\.com$/, 'DMARC Advisor'],
  [/(^|\.)dmarc\.brevo\.com$/, 'Brevo'],
  [/(^|\.)mailinblack\.com$/, 'Mailinblack'],
  [/(^|\.)vadesecure\.com$/, 'Vade Secure']
]

/** Destinataires d'une balise de rapport (`rua=mailto:a@b.com,mailto:c@d.org!10m`) : adresses ou URL. */
export function reportUris(record: string | null | undefined, tag: 'rua' | 'ruf'): string[] {
  const value = record?.match(new RegExp(`(?:^|;)\\s*${tag}\\s*=\\s*([^;]+)`, 'i'))?.[1]
  if (!value) return []
  return uniq(
    value
      .split(',')
      .map((u) => u.trim())
      .map((u) => (/^mailto:/i.test(u) ? u.slice(7).replace(/!\d+[kmgt]?$/i, '').toLowerCase() : u))
      .filter(Boolean)
  )
}

/** Domaine qui reçoit un rapport : partie après `@` d'une adresse, hôte d'une URL. */
function reportHost(uri: string): string | null {
  let host: string | undefined
  if (/^https?:\/\//i.test(uri)) {
    try {
      host = new URL(uri).hostname.toLowerCase()
    } catch {
      return null
    }
  } else host = uri.split('@')[1]?.toLowerCase()
  return host && isDomain(host) ? host : null
}

export interface ReportRecipients {
  /** Prestataires d'analyse reconnus (Valimail, dmarcian...). */
  providers: string[]
  /** Domaines enregistrables tiers qui reçoivent les rapports (organisation liée). */
  domains: string[]
}

/** Qui reçoit les rapports ; les adresses de la cible elle-même n'apprennent rien. */
export function reportRecipients(domain: string, uris: string[]): ReportRecipients {
  const own = registrableDomain(domain)
  const providers = new Set<string>()
  const domains = new Set<string>()
  for (const uri of uris) {
    const host = reportHost(uri)
    if (!host) continue
    const provider = REPORT_RULES.find(([re]) => re.test(host))?.[1]
    if (provider) providers.add(provider)
    else if (registrableDomain(host) !== own) domains.add(registrableDomain(host))
  }
  return { providers: Array.from(providers), domains: Array.from(domains) }
}

// ---------------------------------------------------------------------------
// BIMI et DKIM.

/** Logo et certificat (VMC) déclarés par BIMI (`v=BIMI1; l=<logo>; a=<certificat>`). */
export function parseBimi(record: string | null | undefined): { logo: string | null; certificate: string | null } {
  if (!record || !/^v=BIMI1/i.test(record.trim())) return { logo: null, certificate: null }
  const tag = (t: string): string | null => {
    const v = record.match(new RegExp(`(?:^|;)\\s*${t}=([^;]*)`, 'i'))?.[1]?.trim()
    return v && /^https:\/\//i.test(v) ? v : null
  }
  return { logo: tag('l'), certificate: tag('a') }
}

/** Sélecteurs DKIM courants, testés en TXT sur `<sélecteur>._domainkey.<domaine>`. */
export const DKIM_SELECTORS = ['selector1', 'selector2', 'google', 'k1', 's1', 's2', 'default', 'dkim', 'mail', 'mxvault', 'mandrill', 'smtp']

// Sélecteurs propres à un service : Microsoft 365 publie selector1 et selector2, Google
// Workspace « google », Mailchimp et Mandrill « k1 ».
const DKIM_PROVIDERS: Record<string, string> = {
  selector1: 'Microsoft 365',
  selector2: 'Microsoft 365',
  google: 'Google Workspace',
  k1: 'Mailchimp',
  mandrill: 'Mandrill'
}

/** Vraie clé DKIM, pas un joker TXT du domaine qui répondrait pour tous les sélecteurs. */
export function isDkimRecord(txt: string): boolean {
  return /(^|;)\s*(v=DKIM1\b|k=(rsa|ed25519)\b|p=)/i.test(txt.trim())
}

/** Services d'envoi signalés par les sélecteurs DKIM trouvés. */
export function dkimProviders(selectors: string[]): string[] {
  return uniq(selectors.map((s) => DKIM_PROVIDERS[s]).filter((p): p is string => !!p))
}
