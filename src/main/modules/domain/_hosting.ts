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
