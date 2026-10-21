// Services révélés par les enregistrements MX et TXT : messagerie hébergée,
// plateformes d'envoi autorisées par SPF, jetons de vérification de propriété.

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
  [/mailinblack\.com/, 'Mailinblack']
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

/** `10 aspmx.l.google.com` → `aspmx.l.google.com` */
export function mxHost(record: string): string {
  const parts = record.trim().split(/\s+/)
  return (parts.length > 1 ? parts[1] : parts[0]).replace(/\.$/, '').toLowerCase()
}

export function analyzeMail(mx: string[], txt: string[]): MailAnalysis {
  const mailProviders = new Set<string>()
  for (const host of mx.map(mxHost)) {
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
