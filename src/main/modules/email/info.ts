// Analyse d'une adresse sans contacter de service tiers (hors DNS) : fournisseur,
// domaine, serveurs MX, hébergeur de messagerie, SPF/DMARC, domaine jetable.
// Liste des domaines jetables : projet disposable-email-domains (domaine public, CC0).

import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import { emailProvider } from '@shared/platforms'
import { parseMx } from '../domain/_mail'
import { compact, splitEmail, tr } from './_lib'
import disposableList from './_disposable-domains.json'

const DISPOSABLE = new Set<string>(disposableList as string[])

/** Domaine jetable, sous-domaines compris (`x.yopmail.com`). */
export function isDisposable(domain: string): boolean {
  const parts = domain.toLowerCase().split('.')
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE.has(parts.slice(i).join('.'))) return true
  return false
}

// Hébergeur de messagerie déduit des serveurs MX.
const MAIL_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)(google\.com|googlemail\.com)$/, 'Google Workspace'],
  [/\.mail\.protection\.outlook\.com$/, 'Microsoft 365'],
  [/(^|\.)(outlook\.com|hotmail\.com)$/, 'Outlook'],
  [/(^|\.)protonmail\.ch$/, 'Proton Mail'],
  [/(^|\.)zoho\.(com|eu|in)$/, 'Zoho Mail'],
  [/(^|\.)messagingengine\.com$/, 'Fastmail'],
  [/(^|\.)icloud\.com$/, 'iCloud Mail'],
  [/(^|\.)(yandex\.net|yandex\.ru)$/, 'Yandex'],
  [/(^|\.)mail\.ru$/, 'Mail.ru'],
  [/(^|\.)tutanota\.de$/, 'Tuta'],
  [/(^|\.)ovh\.net$/, 'OVHcloud'],
  [/(^|\.)gandi\.net$/, 'Gandi'],
  [/(^|\.)(ionos\.\w+|kundenserver\.de)$/, 'IONOS'],
  [/(^|\.)infomaniak\.ch$/, 'Infomaniak'],
  [/(^|\.)o2switch\.net$/, 'o2switch'],
  [/(^|\.)secureserver\.net$/, 'GoDaddy'],
  [/(^|\.)registrar-servers\.com$/, 'Namecheap'],
  [/(^|\.)hostinger\.com$/, 'Hostinger'],
  [/(^|\.)emailsrvr\.com$/, 'Rackspace'],
  [/(^|\.)mimecast\.com$/, 'Mimecast'],
  [/(^|\.)pphosted\.com$/, 'Proofpoint'],
  [/(^|\.)barracudanetworks\.com$/, 'Barracuda'],
  [/(^|\.)amazonaws\.com$/, 'Amazon SES'],
  [/(^|\.)mailgun\.org$/, 'Mailgun'],
  [/(^|\.)(orange\.fr|wanadoo\.fr)$/, 'Orange'],
  [/(^|\.)free\.fr$/, 'Free'],
  [/(^|\.)sfr\.fr$/, 'SFR'],
  [/(^|\.)laposte\.net$/, 'La Poste']
]

export function mailHost(mxHosts: string[]): string | undefined {
  for (const host of mxHosts) {
    const h = host.toLowerCase().replace(/\.$/, '')
    const hit = MAIL_HOSTS.find(([re]) => re.test(h))
    if (hit) return hit[1]
  }
  return undefined
}

/** Adresse canonique : sans sous-adresse (`+tag`) et, pour Gmail, sans points. */
export function canonicalEmail(email: string): string {
  const parts = splitEmail(email)
  if (!parts) return email
  let { local, domain } = parts
  local = local.split('+')[0]
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '')
    domain = 'gmail.com'
  }
  return `${local}@${domain}`
}

const GENERIC_LOCALS = new Set(
  (
    'contact info admin administrator support hello bonjour salut test mail email noreply no-reply ' +
    'sales vente ventes office webmaster postmaster hostmaster accueil service services team equipe jobs job ' +
    'recrutement press presse billing facturation compta comptabilite rh hr marketing dev abuse security ' +
    'privacy dpo rgpd help aide newsletter news commercial direction secretariat reception booking reservation'
  ).split(' ')
)

/** Partie locale exploitable comme pseudo (ni générique, ni trop courte, ni purement numérique). */
export function usernameCandidate(local: string): string | undefined {
  const u = local.split('+')[0]
  if (u.length < 4 || u.length > 40 || !/[a-z]/i.test(u) || !/^[\w.-]+$/.test(u)) return undefined
  if (GENERIC_LOCALS.has(u.toLowerCase())) return undefined
  return u
}

/** Politique DMARC (`p=`) d'un enregistrement `v=DMARC1`. */
export function dmarcPolicy(records: string[]): string | undefined {
  const rec = records.find((r) => /^v=DMARC1/i.test(r.trim()))
  return rec?.match(/(?:^|;)\s*p=([a-z]+)/i)?.[1]?.toLowerCase()
}

async function resolve(ctx: ModuleContext, name: string, type: 'MX' | 'TXT' | 'A'): Promise<string[] | null> {
  try {
    return await ctx.resolveDns(name, type)
  } catch {
    return null
  }
}

export default defineModule({
  id: 'email.info',
  name: { fr: "Analyse de l'adresse", en: 'Address analysis' },
  description: {
    fr: 'Fournisseur, domaine, serveurs MX et hébergeur de messagerie, SPF/DMARC, domaine jetable, adresse canonique (Gmail sans points ni +tag) et pseudo possible. Seules des requêtes DNS sont faites.',
    en: 'Provider, domain, MX servers and mail host, SPF/DMARC, disposable domain, canonical address (Gmail without dots or +tag) and possible username. Only DNS queries are made.'
  },
  category: 'email',
  inputTypes: ['email'],
  async run(input, ctx) {
    const parts = splitEmail(input.label)
    if (!parts) throw new ModuleError('Adresse email invalide', 'invalid_input')
    const { email, local, domain } = parts
    const webmail = emailProvider(email)
    const disposable = isDisposable(domain)

    const mxRaw = await resolve(ctx, domain, 'MX')
    if (mxRaw === null) throw new ModuleError('Résolution DNS impossible', 'unavailable')
    const parsedMx = parseMx(mxRaw)
    const mx = parsedMx.hosts.map((r) => r.host)
    // Null MX (RFC 7505) : le domaine existe mais refuse explicitement tout email.
    const nullMx = parsedMx.nullMx && !mx.length
    const host = mailHost(mx)

    let spf: string | undefined
    let dmarc: string | undefined
    let domainExists = mx.length > 0 || nullMx
    if (!webmail) {
      const [txt, dmarcTxt, a] = await Promise.all([
        resolve(ctx, domain, 'TXT'),
        resolve(ctx, `_dmarc.${domain}`, 'TXT'),
        mx.length ? Promise.resolve(['mx']) : resolve(ctx, domain, 'A')
      ])
      spf = txt?.find((r) => /^v=spf1/i.test(r.trim()))
      dmarc = dmarcPolicy(dmarcTxt ?? [])
      domainExists = domainExists || !!a?.length
    }

    const canonical = canonicalEmail(email)
    const entities: OutEntity[] = []
    if (!webmail && !disposable && domainExists) {
      entities.push({
        type: 'domain',
        label: domain,
        data: compact({ mx, mx_null: nullMx || undefined, mail_host: host }),
        linkLabel: tr(ctx, 'domaine', 'domain')
      })
    }
    if (canonical !== email) {
      entities.push({ type: 'email', label: canonical, linkLabel: tr(ctx, 'adresse canonique', 'canonical address') })
    }
    const user = usernameCandidate(local)
    if (user && !disposable) entities.push({ type: 'username', label: user, linkLabel: tr(ctx, 'pseudo possible', 'possible username') })

    return {
      properties: compact({
        provider: webmail?.name ?? host,
        domain,
        valid_mx: mx.length > 0,
        disposable,
        mx,
        mx_null: nullMx || undefined,
        mail_host: host,
        spf: spf?.slice(0, 300),
        dmarc_policy: webmail ? undefined : (dmarc ?? (domainExists ? 'absent' : undefined)),
        domain_exists: webmail ? undefined : domainExists
      }),
      entities,
      raw: { mx: mxRaw, spf, dmarc, webmail: webmail?.id, disposable }
    }
  }
})
