import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { isProviderHost, sharedInfrastructure } from '../domain/_hosting'
import { cappedList, compact, getJsonOrNull, isIPv4, MAX_LIST_ENTITIES, normalizeHost } from '../domain/_util'

const MAX_CVE = 20

export interface InternetDb {
  ip?: string
  ports?: number[]
  hostnames?: string[]
  cpes?: string[]
  tags?: string[]
  vulns?: string[]
  detail?: string
}

const KNOWN: Record<string, string> = {
  http: 'HTTP',
  openssh: 'OpenSSH',
  openbsd: 'OpenBSD',
  openssl: 'OpenSSL',
  nginx: 'nginx',
  jquery: 'jQuery',
  wordpress: 'WordPress',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'PostgreSQL',
  litespeed: 'LiteSpeed',
  lighttpd: 'lighttpd',
  proftpd: 'ProFTPD',
  vsftpd: 'vsftpd',
  phpmyadmin: 'phpMyAdmin',
  iis: 'IIS',
  centos: 'CentOS',
  freebsd: 'FreeBSD',
  redhat: 'Red Hat',
  mongodb: 'MongoDB',
  openresty: 'OpenResty',
  nodejs: 'Node.js',
  'node.js': 'Node.js'
}

/** `cpe:/a:apache:http_server:2.4.7` → { name: 'Apache HTTP Server', version: '2.4.7' } */
export function cpeToTechnology(cpe: string): { name: string; version: string | null; kind: string } | null {
  const m = cpe.match(/^cpe:(?:2\.3:|\/)([aho]):([^:]+):([^:]+)(?::([^:]+))?/)
  if (!m) return null
  const [, part, vendor, product, version] = m
  const pretty = (s: string): string =>
    s
      .split('_')
      .map((w) => KNOWN[w] ?? (w.length <= 3 && w !== 'for' ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
  const vendorName = pretty(vendor)
  const productName = pretty(product)
  const name = productName.toLowerCase().startsWith(vendorName.toLowerCase()) ? productName : `${vendorName} ${productName}`
  return {
    name,
    version: version && version !== '*' && version !== '-' ? version : null,
    kind: part === 'o' ? 'OS' : part === 'h' ? 'Hardware' : 'Software'
  }
}

export function parseInternetDb(d: InternetDb | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!d || !d.ip) return {}
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  // IP de CDN ou de DNS public (1.1.1.1) : noms d'autres clients, gardés en propriété seulement.
  // Même chose pour les noms des machines d'un hébergeur connu (`reverse-proxy-ip-1.infomaniak.ch`,
  // `ec2-...amazonaws.com`).
  const shared = sharedInfrastructure(d.ip)
  const hostnames = d.hostnames ?? []
  const linked = shared ? [] : hostnames.filter((h) => !isProviderHost(h)).slice(0, MAX_LIST_ENTITIES)
  for (const host of linked) entities.push({ type: 'domain', label: host, linkLabel: 'hostname' })
  for (const cpe of d.cpes ?? []) {
    const t = cpeToTechnology(cpe)
    if (t) entities.push({ type: 'technology', label: t.name, data: compact({ version: t.version, kind: t.kind, cpe }), linkLabel: fr ? 'exécute' : 'runs' })
  }
  const vulns = [...(d.vulns ?? [])].sort().reverse()
  for (const cve of vulns.slice(0, MAX_CVE)) entities.push({ type: 'cve', label: cve.toUpperCase(), linkLabel: fr ? 'vulnérable à' : 'vulnerable to' })
  return {
    properties: compact({
      ports: (d.ports ?? []).map(String),
      shodan_tags: d.tags ?? [],
      vulns,
      cpes: d.cpes ?? [],
      ...(hostnames.length > linked.length ? cappedList('hostnames', hostnames) : {}),
      shodan_link: `https://www.shodan.io/host/${d.ip}`
    }),
    entities,
    raw: d
  }
}

export default defineModule({
  id: 'ip.internetdb',
  name: { fr: 'Shodan InternetDB', en: 'Shodan InternetDB' },
  description: {
    fr: 'Ports ouverts, vulnérabilités connues (CVE), logiciels (CPE), noms d’hôtes et tags vus par les scans Shodan. Gratuit, sans clé, sans contacter la cible.',
    en: 'Open ports, known vulnerabilities (CVE), software (CPE), hostnames and tags seen by Shodan scans. Free, no key, without contacting the target.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://internetdb.shodan.io',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !ip.includes(':')) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    return parseInternetDb(await getJsonOrNull<InternetDb>(ctx, `https://internetdb.shodan.io/${ip}`, 'InternetDB'), ctx.lang)
  }
})
