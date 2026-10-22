// Reconnaissance des hébergeurs, CDN et fournisseurs DNS à partir de l'ASN,
// du nom du réseau, des CNAME / PTR et des serveurs de noms.

import { getPlatform } from '@shared/platforms'

interface HostingRule {
  platform: string
  asns?: number[]
  org?: RegExp
  host?: RegExp
}

const RULES: HostingRule[] = [
  { platform: 'cloudflare', asns: [13335, 209242], org: /cloudflare/i, host: /\.cdn\.cloudflare\.net$|\.cloudflare\.(com|net)$/ },
  { platform: 'ovh', asns: [16276, 35540], org: /\bovh/i, host: /\.ovh\.(net|com|ca)$|\.ip-\d+-\d+-\d+\.(eu|net|us)$|\.kimsufi\.com$/ },
  {
    platform: 'aws',
    asns: [16509, 14618, 8987, 7224, 38895],
    org: /amazon|\baws\b/i,
    host: /\.amazonaws\.com$|\.cloudfront\.net$|\.awsglobalaccelerator\.com$|\.awsapps\.com$/
  },
  {
    platform: 'gcp',
    asns: [15169, 396982, 19527, 139070, 139190],
    org: /google/i,
    host: /\.googleusercontent\.com$|ghs\.googlehosted\.com$|\.appspot\.com$|\.run\.app$|\.web\.app$|\.firebaseapp\.com$|\.1e100\.net$/
  },
  {
    platform: 'azure',
    asns: [8075, 8068, 8069, 12076, 3598],
    org: /microsoft/i,
    host: /\.azurewebsites\.net$|\.cloudapp\.(net|azure\.com)$|\.azureedge\.net$|\.trafficmanager\.net$|\.azurefd\.net$|\.(blob|web)\.core\.windows\.net$/
  },
  { platform: 'digitalocean', asns: [14061, 200130, 393406, 394362], org: /digitalocean/i, host: /\.ondigitalocean\.app$|\.digitaloceanspaces\.com$/ },
  { platform: 'hetzner', asns: [24940, 213230, 212317, 215859], org: /hetzner/i, host: /\.your-server\.de$|\.hetzner\.(com|de)$/ },
  { platform: 'scaleway', asns: [12876], org: /scaleway|online s\.?a\.?s/i, host: /\.scw\.cloud$|\.poneytelecom\.eu$|\.online\.net$/ },
  { platform: 'gandi', asns: [29169, 203476], org: /gandi/i, host: /\.gandi\.net$/ },
  { platform: 'ionos', asns: [8560], org: /ionos|1&1|1and1/i, host: /\.kundenserver\.de$|\.ionos\.(com|fr|de|co\.uk)$/ },
  { platform: 'godaddy', asns: [26496, 398101, 44273], org: /godaddy|go daddy/i, host: /\.secureserver\.net$/ },
  { platform: 'namecheap', asns: [22612], org: /namecheap/i, host: /\.web-hosting\.com$/ },
  { platform: 'vercel', org: /vercel/i, host: /\.vercel(-dns)?\.(app|com)$/ },
  { platform: 'netlify', org: /netlify/i, host: /\.netlify\.(app|com)$/ },
  { platform: 'githubpages', host: /\.github\.io$/ },
  { platform: 'github_hosting', asns: [36459], org: /github/i, host: /\.github\.com$|\.githubusercontent\.com$/ },
  { platform: 'heroku', org: /heroku/i, host: /\.heroku(app|dns|ssl)\.com$/ },
  { platform: 'shopify_hosting', asns: [62679], org: /shopify/i, host: /\.myshopify\.com$/ },
  { platform: 'wix', asns: [58182], org: /\bwix/i, host: /\.wix(dns)?\.(com|net)$|\.wixsite\.com$/ },
  { platform: 'squarespace', asns: [53831], org: /squarespace/i, host: /\.squarespace\.com$/ },
  { platform: 'wordpress_com', asns: [2635], org: /automattic/i, host: /\.wordpress\.com$|\.wp\.com$/ },
  { platform: 'fastly', asns: [54113], org: /fastly/i, host: /\.fastly\.net$|\.fastlylb\.net$/ },
  {
    platform: 'akamai',
    asns: [20940, 16625, 63949, 32787, 21342, 35994],
    org: /akamai|linode/i,
    host: /\.akamai(edge|technologies)?\.(net|com)$|\.edgekey\.net$|\.edgesuite\.net$|\.linodeusercontent\.com$|\.members\.linode\.com$/
  },
  { platform: 'oracle_cloud', asns: [31898], org: /oracle/i, host: /\.oraclecloud\.com$/ },
  { platform: 'alibabacloud', asns: [45102, 37963], org: /alibaba|aliyun/i, host: /\.aliyuncs\.com$/ },
  { platform: 'hostinger', asns: [47583], org: /hostinger/i, host: /\.hstgr\.(io|cloud)$/ },
  { platform: 'o2switch', asns: [50474], org: /o2switch/i, host: /\.o2switch\.net$/ },
  { platform: 'infomaniak', asns: [29222], org: /infomaniak/i, host: /\.infomaniak\.(ch|com)$/ },
  { platform: 'lws', org: /ligne web services|\blws\b/i, host: /\.lws-hosting\.com$/ },
  { platform: 'contabo', asns: [51167, 40021, 141995], org: /contabo/i, host: /\.contaboserver\.net$/ },
  { platform: 'vultr', asns: [20473], org: /vultr|choopa/i, host: /\.vultrusercontent\.com$|\.vultr\.com$/ },
  { platform: 'leaseweb', asns: [60781, 16265, 28753, 59253, 7203, 19148], org: /leaseweb/i, host: /\.leaseweb\.(net|com)$/ },
  { platform: 'm247', asns: [9009], org: /\bm247\b/i, host: /\.m247\.com$/ },
  { platform: 'render', org: /^render\b|render services/i, host: /\.onrender\.com$/ }
]

export interface HostingMatch {
  platform?: string
  name: string
  /** Indice ayant permis l'identification (asn, org, host). */
  via: 'asn' | 'org' | 'host' | 'ip' | 'name'
}

/** Numéro d'AS à partir de `AS16276`, `16276` ou `AS16276 OVH SAS`. */
export function parseAsn(v: unknown): number | null {
  const m = String(v ?? '').match(/^\s*(?:AS)?(\d{1,10})\b/i)
  return m ? Number(m[1]) : null
}

// Adresses d'entrée des plateformes servies derrière le réseau d'un tiers (Fastly, AWS, Cloudflare).
const PLATFORM_IPS: Record<string, string> = {
  '185.199.108.153': 'githubpages',
  '185.199.109.153': 'githubpages',
  '185.199.110.153': 'githubpages',
  '185.199.111.153': 'githubpages',
  '75.2.60.5': 'netlify',
  '76.76.21.21': 'vercel',
  '23.227.38.65': 'shopify_hosting'
}

/** Hébergeur à partir de l'ASN, du nom du réseau, des noms d'hôtes (CNAME, PTR) et des IP. */
export function detectHosting(hint: {
  asn?: number | null
  org?: string | null
  hosts?: string[]
  ips?: string[]
}): HostingMatch | null {
  const hosts = (hint.hosts ?? []).map((h) => h.toLowerCase().replace(/\.$/, ''))
  // Les CNAME désignent le service réellement utilisé (Netlify, Vercel...) : prioritaires sur l'ASN.
  for (const r of RULES) if (r.host && hosts.some((h) => r.host!.test(h))) return match(r, 'host')
  for (const ip of hint.ips ?? []) {
    const rule = RULES.find((r) => r.platform === PLATFORM_IPS[ip])
    if (rule) return match(rule, 'ip')
  }
  if (hint.asn) for (const r of RULES) if (r.asns?.includes(hint.asn)) return match(r, 'asn')
  if (hint.org) for (const r of RULES) if (r.org?.test(hint.org)) return match(r, 'org')
  if (hint.org) return { name: cleanOrg(hint.org), via: 'name' }
  return null
}

/**
 * Nom d'hôte de l'infrastructure d'un hébergeur connu (`ec2-...amazonaws.com`, `ns301234.ip-51-75-1.eu`,
 * `reverse-proxy-ip-1.infomaniak.ch`) : il désigne la machine de l'hébergeur, pas un site lié à la cible.
 */
export function isProviderHost(host: string): boolean {
  return !!detectHosting({ hosts: [host] })
}

function match(r: HostingRule, via: HostingMatch['via']): HostingMatch {
  return { platform: r.platform, name: getPlatform(r.platform)?.name ?? r.platform, via }
}

/** `OVH OVH SAS` → `OVH SAS`, `CLOUDFLARENET - Cloudflare, Inc.` → `Cloudflare, Inc.` */
export function cleanOrg(org: string): string {
  const s = org.trim()
  const dash = s.match(/^[A-Z0-9_-]+\s+-\s+(.+)$/)
  if (dash) return dash[1].trim()
  const dup = s.match(/^([A-Z0-9-]+)\s+(\1\b.*)$/i)
  if (dup) return dup[2].trim()
  return s
}

const DNS_PROVIDERS: Array<{ name: string; platform?: string; re: RegExp }> = [
  { name: 'Cloudflare', platform: 'cloudflare', re: /\.ns\.cloudflare\.com$/ },
  { name: 'Amazon Route 53', platform: 'aws', re: /awsdns-\d+\./ },
  { name: 'OVHcloud', platform: 'ovh', re: /\.ovh\.(net|ca|com)$/ },
  { name: 'Gandi', platform: 'gandi', re: /\.gandi\.net$/ },
  { name: 'GoDaddy', platform: 'godaddy', re: /\.domaincontrol\.com$/ },
  { name: 'Namecheap', platform: 'namecheap', re: /registrar-servers\.com$/ },
  { name: 'Google Cloud DNS', platform: 'gcp', re: /\.googledomains\.com$|\.google\.com$/ },
  { name: 'Azure DNS', platform: 'azure', re: /\.azure-dns\.(com|net|org|info)$/ },
  { name: 'DigitalOcean', platform: 'digitalocean', re: /\.digitalocean\.com$/ },
  { name: 'Hetzner', platform: 'hetzner', re: /\.hetzner\.(com|de)$|\.your-server\.de$|\.second-ns\.(com|de)$/ },
  { name: 'IONOS', platform: 'ionos', re: /\.ui-dns\.(com|de|org|biz)$/ },
  { name: 'o2switch', platform: 'o2switch', re: /\.o2switch\.net$/ },
  { name: 'Infomaniak', platform: 'infomaniak', re: /\.infomaniak\.ch$/ },
  { name: 'Wix', platform: 'wix', re: /\.wixdns\.net$/ },
  { name: 'Vercel', platform: 'vercel', re: /\.vercel-dns\.com$/ },
  { name: 'Hostinger', platform: 'hostinger', re: /\.dns-parking\.com$/ },
  { name: 'Akamai', platform: 'akamai', re: /\.akam\.net$|\.linode\.com$/ },
  { name: 'Scaleway', platform: 'scaleway', re: /\.scaleway\.com$|\.online\.net$/ },
  { name: 'Shopify', platform: 'shopify_hosting', re: /\.myshopify\.com$/ },
  { name: 'Squarespace', platform: 'squarespace', re: /\.squarespacedns\.com$/ },
  { name: 'NS1', platform: 'ns1', re: /\.nsone\.net$/ },
  { name: 'UltraDNS', platform: 'ultradns', re: /\.ultradns\.(com|net|org|biz|info|co\.uk)$/ },
  { name: 'Dyn (Oracle)', platform: 'oracle_dyn', re: /\.dynect\.net$/ },
  { name: 'DNSimple', re: /\.dnsimple(-edge)?\.(com|net|org|info)$/ },
  { name: 'DNS Made Easy', re: /\.dnsmadeeasy\.com$/ },
  { name: 'Bunny DNS', platform: 'bunny', re: /\.bunny\.net$/ },
  { name: 'Netim', re: /\.netim\.(net|com)$/ },
  { name: 'Afnic', re: /\.nic\.fr$/ }
]

/** Fournisseur DNS déduit des serveurs de noms. */
export function detectDnsProvider(nameservers: string[]): { name: string; platform?: string } | null {
  const ns = nameservers.map((n) => n.toLowerCase().replace(/\.$/, ''))
  for (const p of DNS_PROVIDERS) if (ns.some((n) => p.re.test(n))) return { name: p.name, platform: p.platform }
  return null
}

// ---------------------------------------------------------------------------
// Infrastructures partagées : une même IP sert des milliers de domaines sans lien
// entre eux (CDN, résolveurs DNS publics, adresses réservées). Les domaines « vus »
// sur ces IP ne doivent pas devenir des entités rattachées à la cible.

const PUBLIC_DNS: Record<string, string> = {
  '8.8.8.8': 'Google Public DNS',
  '8.8.4.4': 'Google Public DNS',
  '2001:4860:4860::8888': 'Google Public DNS',
  '2001:4860:4860::8844': 'Google Public DNS',
  '1.1.1.1': 'Cloudflare DNS',
  '1.0.0.1': 'Cloudflare DNS',
  '1.1.1.2': 'Cloudflare DNS',
  '1.0.0.2': 'Cloudflare DNS',
  '1.1.1.3': 'Cloudflare DNS',
  '1.0.0.3': 'Cloudflare DNS',
  '2606:4700:4700::1111': 'Cloudflare DNS',
  '2606:4700:4700::1001': 'Cloudflare DNS',
  '9.9.9.9': 'Quad9',
  '149.112.112.112': 'Quad9',
  '9.9.9.10': 'Quad9',
  '149.112.112.10': 'Quad9',
  '9.9.9.11': 'Quad9',
  '2620:fe::fe': 'Quad9',
  '2620:fe::9': 'Quad9',
  '208.67.222.222': 'OpenDNS (Cisco)',
  '208.67.220.220': 'OpenDNS (Cisco)',
  '208.67.222.123': 'OpenDNS (Cisco)',
  '208.67.220.123': 'OpenDNS (Cisco)',
  '2620:119:35::35': 'OpenDNS (Cisco)',
  '2620:119:53::53': 'OpenDNS (Cisco)',
  '94.140.14.14': 'AdGuard DNS',
  '94.140.15.15': 'AdGuard DNS',
  '76.76.2.0': 'Control D',
  '76.76.10.0': 'Control D',
  '185.228.168.9': 'CleanBrowsing',
  '185.228.169.9': 'CleanBrowsing',
  '77.88.8.8': 'Yandex DNS',
  '77.88.8.1': 'Yandex DNS',
  '8.26.56.26': 'Comodo Secure DNS',
  '8.20.247.20': 'Comodo Secure DNS',
  '64.6.64.6': 'Verisign Public DNS',
  '64.6.65.6': 'Verisign Public DNS',
  '84.200.69.80': 'DNS.WATCH',
  '84.200.70.40': 'DNS.WATCH',
  '194.242.2.2': 'Mullvad DNS',
  '4.2.2.1': 'Level 3 DNS',
  '4.2.2.2': 'Level 3 DNS',
  '4.2.2.3': 'Level 3 DNS',
  '4.2.2.4': 'Level 3 DNS',
  '4.2.2.5': 'Level 3 DNS',
  '4.2.2.6': 'Level 3 DNS'
}

// Plages publiées par les CDN (cloudflare.com/ips, api.fastly.com/public-ip-list,
// ip-ranges.amazonaws.com pour CloudFront) et grands blocs Akamai (AS20940, AS16625).
const CDN_RANGES: Array<[string, string[]]> = [
  [
    'Cloudflare',
    [
      '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
      '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
      '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32',
      '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
    ]
  ],
  [
    'Fastly',
    [
      '23.235.32.0/20', '43.249.72.0/22', '103.244.50.0/24', '103.245.222.0/23', '103.245.224.0/24', '104.156.80.0/20',
      '140.248.64.0/18', '140.248.128.0/17', '146.75.0.0/17', '151.101.0.0/16', '157.52.64.0/18', '167.82.0.0/17',
      '167.82.128.0/20', '167.82.160.0/20', '167.82.224.0/20', '172.111.64.0/18', '185.31.16.0/22', '199.27.72.0/21',
      '199.232.0.0/16', '2a04:4e40::/32', '2a04:4e42::/31', '2a04:4e44::/32'
    ]
  ],
  [
    'Amazon CloudFront',
    [
      '108.138.0.0/15', '108.156.0.0/14', '13.224.0.0/14', '13.249.0.0/16', '13.32.0.0/15', '13.35.0.0/16', '143.204.0.0/16',
      '144.220.0.0/16', '15.158.0.0/16', '18.154.0.0/15', '18.160.0.0/15', '18.164.0.0/15', '18.172.0.0/15', '18.238.0.0/15',
      '18.244.0.0/15', '18.64.0.0/14', '18.68.0.0/16', '3.160.0.0/14', '3.165.0.0/16', '3.166.0.0/15', '3.168.0.0/14',
      '3.174.0.0/15', '52.84.0.0/15', '54.182.0.0/16', '54.192.0.0/16', '54.230.0.0/16', '65.8.0.0/16', '99.84.0.0/16',
      '99.86.0.0/16', '205.251.192.0/19', '2600:9000::/28'
    ]
  ],
  [
    'Akamai',
    [
      '23.0.0.0/12', '23.32.0.0/11', '23.64.0.0/14', '23.72.0.0/13', '23.192.0.0/11', '2.16.0.0/13', '104.64.0.0/10',
      '184.24.0.0/13', '184.50.0.0/15', '184.84.0.0/14', '96.6.0.0/15', '96.16.0.0/15', '72.246.0.0/15', '88.221.0.0/16',
      '95.100.0.0/15', '2600:1400::/24', '2a02:26f0::/29'
    ]
  ]
]

// Réseaux dont les adresses sont partagées entre clients (CDN, anycast, proxys inverses).
const CDN_ASNS: Record<number, string> = {
  13335: 'Cloudflare',
  209242: 'Cloudflare',
  54113: 'Fastly',
  20940: 'Akamai',
  16625: 'Akamai',
  16702: 'Akamai',
  21342: 'Akamai',
  21357: 'Akamai',
  21399: 'Akamai',
  32787: 'Akamai',
  33905: 'Akamai',
  34164: 'Akamai',
  35994: 'Akamai',
  18680: 'Akamai',
  15133: 'Edgio (Edgecast)',
  22822: 'Edgio (Limelight)',
  60068: 'CDN77',
  200325: 'Bunny CDN',
  19551: 'Imperva',
  30148: 'Sucuri',
  20446: 'StackPath (Highwinds)'
}

const RESERVED_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/3']
const RESERVED_V6 = ['::/127', 'fc00::/7', 'fe80::/10', 'ff00::/8']

/** Adresse IP en entier (BigInt) et nombre de bits, ou null si la syntaxe est invalide. */
function ipToBig(ip: string): { value: bigint; bits: 32 | 128 } | null {
  const s = ip.trim().toLowerCase()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const parts = s.split('.').map(Number)
    if (parts.some((p) => p > 255)) return null
    return { value: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n), bits: 32 }
  }
  if (!s.includes(':') || !/^[0-9a-f:.]+$/.test(s)) return null
  const [head, tail = ''] = s.split('::')
  if (s.split('::').length > 2) return null
  const toGroups = (part: string): number[] | null => {
    if (!part) return []
    const out: number[] = []
    for (const g of part.split(':')) {
      if (g.includes('.')) {
        const v4 = ipToBig(g)
        if (!v4 || v4.bits !== 32) return null
        out.push(Number(v4.value >> 16n), Number(v4.value & 0xffffn))
      } else if (/^[0-9a-f]{1,4}$/.test(g)) out.push(parseInt(g, 16))
      else return null
    }
    return out
  }
  const h = toGroups(head)
  const t = toGroups(tail)
  if (!h || !t) return null
  const missing = 8 - h.length - t.length
  if ((s.includes('::') && missing < 1) || (!s.includes('::') && missing !== 0)) return null
  const groups = [...h, ...Array<number>(Math.max(0, missing)).fill(0), ...t]
  return { value: groups.reduce((acc, g) => (acc << 16n) + BigInt(g), 0n), bits: 128 }
}

/** L'adresse appartient-elle au bloc CIDR (`104.16.0.0/13`, `2606:4700::/32`) ? */
export function inCidr(ip: string, cidr: string): boolean {
  const [net, len] = cidr.split('/')
  const a = ipToBig(ip)
  const b = ipToBig(net)
  if (!a || !b || a.bits !== b.bits) return false
  const prefix = BigInt(Number(len ?? a.bits))
  const shift = BigInt(a.bits) - prefix
  return a.value >> shift === b.value >> shift
}

export interface SharedInfrastructure {
  name: string
  kind: 'cdn' | 'public_dns' | 'reserved'
}

/**
 * IP partagée par de nombreux sites sans lien entre eux : résolveur DNS public, CDN
 * (plages publiées ou ASN connu, transmis par un autre module) ou adresse réservée.
 */
export function sharedInfrastructure(ip: string, hint: { asn?: unknown; org?: unknown } = {}): SharedInfrastructure | null {
  const s = ip.trim().toLowerCase()
  const dns = PUBLIC_DNS[s]
  if (dns) return { name: dns, kind: 'public_dns' }
  const parsed = ipToBig(s)
  if (!parsed) return null
  const reserved = parsed.bits === 32 ? RESERVED_V4 : RESERVED_V6
  if (reserved.some((c) => inCidr(s, c))) return { name: 'reserved', kind: 'reserved' }
  for (const [name, ranges] of CDN_RANGES) if (ranges.some((c) => inCidr(s, c))) return { name, kind: 'cdn' }
  const asn = parseAsn(hint.asn)
  // ASN connu : il fait foi (Akamai Connected Cloud, ex-Linode, loue des serveurs dédiés).
  if (asn) return CDN_ASNS[asn] ? { name: CDN_ASNS[asn], kind: 'cdn' } : null
  const org = typeof hint.org === 'string' ? hint.org : ''
  if (/\b(cloudflare|fastly|akamai|cloudfront|incapsula|imperva|sucuri|edgecast|limelight|cdn77|bunnycdn)\b/i.test(org) && !/linode|connected cloud/i.test(org)) {
    return { name: cleanOrg(org), kind: 'cdn' }
  }
  return null
}

/** Libellé affiché pour une infrastructure partagée. */
export function sharedLabel(s: SharedInfrastructure, lang: 'fr' | 'en'): string {
  if (s.kind === 'reserved') return lang === 'fr' ? 'adresse privée ou réservée' : 'private or reserved address'
  if (s.kind === 'cdn') return `${s.name} (CDN)`
  return s.name
}
