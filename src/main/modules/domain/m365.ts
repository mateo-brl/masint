// Tenant Microsoft 365 d'un domaine : identifiant, région, authentification gérée ou fédérée
// (avec le fournisseur d'identité) et autres domaines enregistrés dans le même tenant.
// Seuls les points d'accès publics de Microsoft sont interrogés, jamais la cible.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { cappedList, compact, isDomain, normalizeDomain, registrableDomain, serviceError, uniq } from './_util'

const LOGIN = 'https://login.microsoftonline.com'
const AUTODISCOVER = 'https://autodiscover-s.outlook.com/autodiscover/autodiscover.svc'
const SOAP_ACTION = 'http://schemas.microsoft.com/exchange/2010/Autodiscover/Autodiscover/GetFederationInformation'
const MAX_DOMAINS = 25

/** Réponse de `getuserrealm.srf` (format JSON). */
export interface UserRealm {
  NameSpaceType?: string
  DomainName?: string
  FederationBrandName?: string
  AuthURL?: string
  CloudInstanceName?: string
}

/** Extrait de la configuration OpenID Connect du tenant. */
export interface OpenIdConfig {
  issuer?: string
  token_endpoint?: string
  tenant_region_scope?: string
  tenant_region_sub_scope?: string
  cloud_instance_name?: string
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Identifiant du tenant (GUID) dans `issuer` ou `token_endpoint`. */
export function tenantId(cfg: OpenIdConfig | null): string | null {
  for (const url of [cfg?.issuer, cfg?.token_endpoint]) {
    const m = url?.match(GUID)
    if (m) return m[0].toLowerCase()
  }
  return null
}

const REGIONS: Record<string, { fr: string; en: string }> = {
  NA: { fr: 'Amérique du Nord', en: 'North America' },
  EU: { fr: 'Europe', en: 'Europe' },
  AS: { fr: 'Asie', en: 'Asia' },
  OC: { fr: 'Océanie', en: 'Oceania' },
  SA: { fr: 'Amérique du Sud', en: 'South America' },
  AF: { fr: 'Afrique', en: 'Africa' },
  WW: { fr: 'mondial', en: 'worldwide' }
}

/** Région du tenant (`EU` → « Europe (EU) »), avec la sous-région (`GCC`...) si elle existe. */
export function tenantRegion(cfg: OpenIdConfig | null, lang: 'fr' | 'en'): string | null {
  const scope = cfg?.tenant_region_scope?.toUpperCase()
  if (!scope) return null
  const name = REGIONS[scope]?.[lang]
  const sub = cfg?.tenant_region_sub_scope ? ` ${cfg.tenant_region_sub_scope}` : ''
  return name ? `${name} (${scope}${sub})` : `${scope}${sub}`
}

/**
 * Corps SOAP de GetFederationInformation (Autodiscover d'Exchange Online), tel que l'envoient
 * AADInternals et les outils de reconnaissance de tenant. Le domaine est validé avant l'appel.
 */
export function federationRequest(domain: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:exm="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:ext="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<soap:Header>
<a:Action soap:mustUnderstand="1">${SOAP_ACTION}</a:Action>
<a:To soap:mustUnderstand="1">${AUTODISCOVER}</a:To>
<a:ReplyTo><a:Address>http://www.w3.org/2005/08/addressing/anonymous</a:Address></a:ReplyTo>
</soap:Header>
<soap:Body>
<GetFederationInformationRequestMessage xmlns="http://schemas.microsoft.com/exchange/2010/Autodiscover">
<Request><Domain>${domain}</Domain></Request>
</GetFederationInformationRequestMessage>
</soap:Body>
</soap:Envelope>`
}

/** Domaines du tenant dans la réponse GetFederationInformation (vide en cas d'erreur). */
export function parseFederationDomains(xml: string): string[] {
  if (!/<ErrorCode>\s*NoError\s*<\/ErrorCode>/i.test(xml)) return []
  const block = xml.match(/<Domains>([\s\S]*?)<\/Domains>/i)?.[1] ?? ''
  return uniq(Array.from(block.matchAll(/<Domain>\s*([^<\s]+)\s*<\/Domain>/gi), (m) => m[1].toLowerCase())).filter(isDomain)
}

// Fournisseurs d'identité reconnus d'après l'adresse de connexion fédérée (`AuthURL`).
const IDP_RULES: Array<[RegExp, string]> = [
  [/\.okta(-emea|-gov)?\.com$|\.oktapreview\.com$/, 'Okta'],
  [/\.onelogin\.com$/, 'OneLogin'],
  [/\.pingone\.(com|eu|asia|ca)$|\.pingidentity\.com$|\.ping(one)?\.cloud$/, 'Ping Identity'],
  [/\.duosecurity\.com$/, 'Cisco Duo'],
  [/\.jumpcloud\.com$/, 'JumpCloud'],
  [/(^|\.)accounts\.google\.com$/, 'Google'],
  [/\.auth0\.com$/, 'Auth0'],
  [/\.my\.salesforce\.com$/, 'Salesforce'],
  [/\.(centrify\.com|idaptive\.app|cyberark\.cloud)$/, 'CyberArk'],
  [/\.secureauth\.com$/, 'SecureAuth'],
  [/\.verify\.ibm\.com$|\.ibmcloudsecurity\.com$/, 'IBM Security Verify'],
  [/\.rsa\.net$|\.securid\.com$/, 'RSA SecurID'],
  [/\.miniorange\.(com|in)$|\.xecurify\.com$/, 'miniOrange']
]

/** Hôte et éditeur du fournisseur d'identité d'un domaine fédéré (ADFS reconnu à son chemin). */
export function federationProvider(authUrl: string | undefined): { host: string; provider: string | null } | null {
  if (!authUrl) return null
  let url: URL
  try {
    url = new URL(authUrl)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  const rule = IDP_RULES.find(([re]) => re.test(host))
  return { host, provider: rule?.[1] ?? (/\/adfs\//i.test(url.pathname) ? 'AD FS' : null) }
}

/** Marque utile : ni vide, ni le domaine lui-même ou son nom (« mozilla » pour mozilla.org). */
export function meaningfulBrand(brand: string | undefined, domain: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const b = norm(brand ?? '')
  if (!b) return false
  const reg = registrableDomain(domain)
  return ![domain, reg, reg.split('.')[0]].some((d) => norm(d) === b)
}

/** Construit la sortie à partir des trois réponses de Microsoft. */
export function parseM365(domain: string, realm: UserRealm | null, openid: OpenIdConfig | null, tenantDomains: string[], lang: 'fr' | 'en'): ModuleOutput {
  const type = realm?.NameSpaceType ?? ''
  if (!type || /^unknown$/i.test(type)) return {}
  const fr = lang === 'fr'
  const others = tenantDomains.filter((d) => d !== domain)
  // Domaines techniques `<tenant>.onmicrosoft.com` : propres au tenant mais sans intérêt comme nœud.
  const onmicrosoft = others.filter((d) => d.endsWith('.onmicrosoft.com'))
  const domains = others.filter((d) => !d.endsWith('.onmicrosoft.com'))
  const brand = realm?.FederationBrandName?.trim() ?? ''
  const idp = /^federated$/i.test(type) ? federationProvider(realm?.AuthURL) : null

  const entities: OutEntity[] = domains.slice(0, MAX_DOMAINS).map((d) => ({
    type: 'domain',
    label: d,
    linkLabel: fr ? 'même tenant Microsoft 365' : 'same Microsoft 365 tenant'
  }))
  if (meaningfulBrand(brand, domain)) entities.push({ type: 'organization', label: brand, linkLabel: fr ? 'marque du tenant' : 'tenant brand' })

  return {
    properties: compact({
      m365_tenant: type.toLowerCase(),
      m365_tenant_id: tenantId(openid),
      m365_tenant_region: tenantRegion(openid, lang),
      m365_brand: brand || null,
      identity_provider: idp?.host ?? null,
      m365_federation_provider: idp?.provider ?? null,
      m365_onmicrosoft: onmicrosoft,
      ...cappedList('m365_tenant_domains', domains)
    }),
    entities,
    raw: { realm: { ...realm, AuthURL: idp?.host }, tenant_id: tenantId(openid), region: openid?.tenant_region_scope, domains: tenantDomains }
  }
}

async function getFederationDomains(ctx: ModuleContext, domain: string): Promise<string[]> {
  const xml = await ctx.fetchText(AUTODISCOVER, {
    method: 'POST',
    // Avec un User-Agent de navigateur, le service demande une authentification (401).
    headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: `"${SOAP_ACTION}"`, 'user-agent': 'AutodiscoverClient' },
    body: federationRequest(domain),
    timeoutMs: 20000
  })
  return parseFederationDomains(xml)
}

export default defineModule({
  id: 'domain.m365',
  name: { fr: 'Tenant Microsoft 365', en: 'Microsoft 365 tenant' },
  description: {
    fr: 'Interroge les services publics de Microsoft (getuserrealm, configuration OpenID, Autodiscover) : identifiant et région du tenant, authentification gérée ou fédérée (Okta, AD FS...), marque, et autres domaines du même tenant (25 en entités). Aucune requête vers la cible.',
    en: 'Queries Microsoft public endpoints (getuserrealm, OpenID configuration, Autodiscover): tenant ID and region, managed or federated authentication (Okta, AD FS...), brand, and other domains of the same tenant (25 as entities). No request to the target.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  homepage: 'https://learn.microsoft.com/entra/identity-platform/v2-protocols-oidc',
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    let realm: UserRealm
    try {
      realm = await ctx.fetchJson<UserRealm>(`${LOGIN}/getuserrealm.srf`, { query: { login: `x@${domain}`, json: 1 }, timeoutMs: 20000 })
    } catch (e) {
      throw serviceError(e, 'Microsoft (getuserrealm)')
    }
    // Domaine inconnu de Microsoft : pas de tenant, rien à chercher de plus.
    if (!realm.NameSpaceType || /^unknown$/i.test(realm.NameSpaceType)) return {}
    ctx.progress(1, 2, 'OpenID, Autodiscover')
    const [openid, federation] = await Promise.allSettled([
      ctx.fetchJson<OpenIdConfig>(`${LOGIN}/${domain}/.well-known/openid-configuration`, { timeoutMs: 20000 }),
      getFederationDomains(ctx, domain)
    ])
    if (openid.status === 'rejected') ctx.log(`configuration OpenID en échec : ${openid.reason instanceof Error ? openid.reason.message : openid.reason}`)
    if (federation.status === 'rejected')
      ctx.log(`GetFederationInformation en échec : ${federation.reason instanceof Error ? federation.reason.message : federation.reason}`)
    ctx.progress(2, 2)
    return parseM365(
      domain,
      realm,
      openid.status === 'fulfilled' ? openid.value : null,
      federation.status === 'fulfilled' ? federation.value : [],
      ctx.lang
    )
  }
})
