import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cappedList, compact, isDomain, isoDate, MAX_LIST_ENTITIES, normalizeHost, serviceError } from './_util'

const MAX_CERTS = 5
const MAX_NAMES = 50

export interface CertSpotterCert {
  id: string
  cert_sha256?: string
  pubkey_sha256?: string
  dns_names?: string[]
  issuer?: { friendly_name?: string; name?: string }
  not_before?: string
  not_after?: string
  revoked?: boolean
}

export function certLabel(c: { dns_names?: string[]; issuer?: string | null; not_before?: string | null }): string {
  const name = c.dns_names?.[0] ?? '?'
  const date = c.not_before ? c.not_before.slice(0, 10) : '?'
  return `${name} (${c.issuer ?? '?'}, ${date})`
}

/** Certificats valides couvrant exactement le nom, du plus récent au plus ancien. */
export function parseCertSpotterCerts(host: string, rows: CertSpotterCert[], lang: 'fr' | 'en'): ModuleOutput {
  const covers = (names: string[] = []): boolean =>
    names.some((n) => n === host || (n.startsWith('*.') && host.endsWith(n.slice(1)) && host.split('.').length === n.split('.').length))
  const certs = rows
    .filter((r) => covers(r.dns_names))
    .sort((a, b) => (b.not_before ?? '').localeCompare(a.not_before ?? ''))
  if (!certs.length) return {}
  const fr = lang === 'fr'
  // Renouvellements (mêmes noms couverts, même émetteur) : seul le plus récent devient une entité.
  const seen = new Set<string>()
  const distinct = certs.filter((c) => {
    const key = [c.issuer?.friendly_name ?? c.issuer?.name ?? '', ...[...(c.dns_names ?? [])].sort()].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const entities: OutEntity[] = distinct.slice(0, MAX_CERTS).map((c) => {
    const issuer = c.issuer?.friendly_name ?? c.issuer?.name ?? null
    return {
      type: 'certificate',
      label: certLabel({ dns_names: c.dns_names, issuer, not_before: c.not_before }),
      data: {
        issuer: issuer ?? undefined,
        issuer_dn: c.issuer?.name,
        not_before: isoDate(c.not_before) ?? undefined,
        not_after: isoDate(c.not_after) ?? undefined,
        sha256: c.cert_sha256,
        pubkey_sha256: c.pubkey_sha256,
        dns_names: (c.dns_names ?? []).slice(0, MAX_NAMES),
        revoked: c.revoked ?? false
      } as Record<string, PropValue>,
      linkLabel: fr ? 'certificat TLS' : 'TLS certificate'
    }
  })
  const latest = certs[0]
  // Noms voisins présents dans les certificats (SAN) : souvent d'autres domaines du même propriétaire.
  const sans = Array.from(new Set(certs.flatMap((c) => c.dns_names ?? []).map((n) => n.replace(/^\*\./, '')))).filter((n) => n !== host)
  return {
    properties: compact({
      tls_issuer: latest.issuer?.friendly_name ?? latest.issuer?.name ?? null,
      tls_not_after: isoDate(latest.not_after),
      ...cappedList('tls_san', sans),
      tls_certificates: certs.length
    }),
    entities,
    raw: certs.slice(0, 20)
  }
}

export interface CrtShCert {
  id?: number
  issuer_name?: string
  common_name?: string
  name_value?: string
  not_before?: string
  not_after?: string
  serial_number?: string
}

/** Domaines couverts par un certificat retrouvé sur crt.sh. */
export function parseCrtShCert(rows: CrtShCert[], lang: 'fr' | 'en'): ModuleOutput {
  if (!rows.length) return {}
  const fr = lang === 'fr'
  const c = rows[0]
  const names = Array.from(
    new Set(
      rows
        .flatMap((r) => (r.name_value ?? '').split('\n'))
        .map((n) => n.trim().toLowerCase().replace(/^\*\./, ''))
        .filter((n) => isDomain(n))
    )
  )
  return {
    properties: compact({
      issuer: c.issuer_name ?? null,
      not_before: isoDate(c.not_before),
      not_after: isoDate(c.not_after),
      serial: c.serial_number ?? null,
      ...cappedList('dns_names', names),
      crtsh_id: c.id ?? null
    }),
    // Un certificat mutualisé (CDN) peut couvrir des dizaines de domaines sans lien entre eux.
    entities: names.slice(0, MAX_LIST_ENTITIES).map((n) => ({ type: 'domain', label: n, linkLabel: fr ? 'nom couvert' : 'covered name' })),
    raw: rows.slice(0, 10)
  }
}

const domainCertificates = defineModule({
  id: 'domain.certificates',
  name: { fr: 'Certificats TLS', en: 'TLS certificates' },
  description: {
    fr: 'Certificats TLS valides émis pour ce nom (journaux Certificate Transparency via Cert Spotter) : émetteur, validité, empreintes et autres noms couverts (SAN), qui révèlent souvent des domaines liés.',
    en: 'Valid TLS certificates issued for this name (Certificate Transparency logs via Cert Spotter): issuer, validity, fingerprints and other covered names (SAN), often revealing related domains.'
  },
  category: 'domain',
  inputTypes: ['domain', 'website'],
  homepage: 'https://sslmate.com/certspotter/',
  async run(input, ctx) {
    const host = normalizeHost(input.label)
    if (!isDomain(host)) throw new ModuleError('Nom d’hôte invalide', 'invalid_input')
    const load = async (name: string): Promise<CertSpotterCert[]> => {
      try {
        return await ctx.fetchJson<CertSpotterCert[]>(
          `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(name)}&expand=dns_names&expand=issuer`
        )
      } catch (e) {
        throw serviceError(e, 'Cert Spotter')
      }
    }
    const out = parseCertSpotterCerts(host, await load(host), ctx.lang)
    // Un sous-domaine est souvent couvert par un certificat joker du parent (*.example.com).
    const parent = host.split('.').slice(1).join('.')
    if (out.entities?.length || !parent.includes('.')) return out
    return parseCertSpotterCerts(host, await load(parent), ctx.lang)
  }
})

const certificateLookup = defineModule({
  id: 'certificate.crtsh',
  name: { fr: 'Détails du certificat (crt.sh)', en: 'Certificate details (crt.sh)' },
  description: {
    fr: 'Retrouve un certificat par son empreinte SHA-256 dans crt.sh : émetteur, validité, numéro de série et domaines couverts.',
    en: 'Looks up a certificate by its SHA-256 fingerprint on crt.sh: issuer, validity, serial number and covered domains.'
  },
  category: 'domain',
  inputTypes: ['certificate'],
  homepage: 'https://crt.sh',
  experimental: true,
  accepts: (input) => !!certificateHash(input.label, input.data),
  async run(input, ctx) {
    const sha256 = certificateHash(input.label, input.data)
    if (!sha256) throw new ModuleError('Empreinte SHA-256 introuvable', 'invalid_input')
    let rows: CrtShCert[]
    try {
      rows = await ctx.fetchJson<CrtShCert[]>('https://crt.sh/', { query: { q: sha256, output: 'json' }, timeoutMs: 45000 })
    } catch (e) {
      // crt.sh est souvent saturé : on se contente des noms déjà connus du nœud.
      const known = Array.isArray(input.data.dns_names) ? (input.data.dns_names as string[]) : []
      if (known.length && !ctx.signal.aborted) return parseCrtShCert([{ name_value: known.join('\n') }], ctx.lang)
      throw serviceError(e, 'crt.sh')
    }
    return parseCrtShCert(rows, ctx.lang)
  }
})

/** Empreinte SHA-256 du certificat, prise dans les propriétés ou le libellé. */
export function certificateHash(label: string, data: Record<string, PropValue>): string | null {
  const candidates = [data.sha256, data.cert_sha256, data.fingerprint, label].map((v) => (typeof v === 'string' ? v.replace(/[:\s]/g, '') : ''))
  return candidates.find((v) => /^[a-f0-9]{64}$/i.test(v))?.toLowerCase() ?? null
}

export const modules = [domainCertificates, certificateLookup]
