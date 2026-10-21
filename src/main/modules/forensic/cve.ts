// Fiche d'une vulnérabilité CVE : score CVSS, résumé, faiblesses (CWE), produits affectés,
// exploitation connue (catalogue KEV de la CISA) et probabilité d'exploitation (EPSS).
// Sources gratuites sans clé : cve.circl.lu (Vulnerability-Lookup), NVD en secours, FIRST EPSS.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, getJson, isoDate, tr, uniq } from '../misc/_util'

const MAX_REFS = 10
const MAX_PRODUCTS = 5

export interface CveInfo {
  id: string
  state: string | null
  title: string | null
  summary: string | null
  cvss: number | null
  severity: string | null
  vector: string | null
  cvssVersion: string | null
  cwe: string[]
  published: string | null
  updated: string | null
  kevAdded: string | null
  exploitation: string | null
  references: string[]
  products: Array<{ vendor: string; product: string }>
}

type Json = Record<string, any>

const CVSS_KEYS = ['cvssV4_0', 'cvssV3_1', 'cvssV3_0', 'cvssV2_0']

function pickCvss(metrics: Json[] | undefined): { score: number; severity: string | null; vector: string | null; version: string } | null {
  for (const key of CVSS_KEYS) {
    for (const m of metrics ?? []) {
      const c = m?.[key]
      if (c && typeof c.baseScore === 'number') {
        return { score: c.baseScore, severity: c.baseSeverity ?? null, vector: c.vectorString ?? null, version: c.version ?? key.slice(5).replace('_', '.') }
      }
    }
  }
  return null
}

/** Enregistrement CVE JSON 5 (cve.circl.lu, cve.org). */
export function parseCveRecord(d: Json): CveInfo | null {
  const meta = d?.cveMetadata
  if (!meta?.cveId) return null
  const cna = d.containers?.cna ?? {}
  const adp: Json[] = d.containers?.adp ?? []
  const cvss = pickCvss(cna.metrics) ?? pickCvss(adp.flatMap((a) => a.metrics ?? []))
  const others: Json[] = adp.flatMap((a) => (a.metrics ?? []).map((m: Json) => m.other).filter(Boolean))
  const kev = others.find((o) => o.type === 'kev')?.content
  const ssvc = others.find((o) => o.type === 'ssvc')?.content
  const exploitation = (ssvc?.options as Json[] | undefined)?.find((o) => 'Exploitation' in o)?.Exploitation ?? null
  const desc = (cna.descriptions as Json[] | undefined)?.find((x) => x.lang?.startsWith('en')) ?? cna.descriptions?.[0]
  const cwe = uniq(
    (cna.problemTypes as Json[] | undefined)?.flatMap((p) => (p.descriptions ?? []).map((x: Json) => x.cweId ?? '')).filter(Boolean) ?? []
  )
  return {
    id: meta.cveId,
    state: meta.state ?? null,
    title: cna.title ?? null,
    summary: desc?.value?.trim() ?? (cna.rejectedReasons?.[0]?.value ?? null),
    cvss: cvss?.score ?? null,
    severity: cvss?.severity ?? null,
    vector: cvss?.vector ?? null,
    cvssVersion: cvss?.version ?? null,
    cwe,
    published: meta.datePublished ?? null,
    updated: meta.dateUpdated ?? null,
    kevAdded: kev?.dateAdded ?? null,
    exploitation,
    references: uniq((cna.references as Json[] | undefined)?.map((r) => r.url).filter(Boolean) ?? []),
    products: ((cna.affected as Json[] | undefined) ?? [])
      .filter((a) => a.vendor && a.product && a.vendor !== 'n/a')
      .map((a) => ({ vendor: a.vendor, product: a.product }))
  }
}

/** Réponse NVD API 2.0. */
export function parseNvd(d: Json): CveInfo | null {
  const c = d?.vulnerabilities?.[0]?.cve
  if (!c?.id) return null
  const m = c.metrics ?? {}
  const order = ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']
  let cvss: Json | null = null
  for (const k of order) {
    const list: Json[] = m[k] ?? []
    const best = list.find((x) => x.type === 'Primary') ?? list[0]
    if (best) {
      cvss = { ...best.cvssData, baseSeverity: best.cvssData?.baseSeverity ?? best.baseSeverity }
      break
    }
  }
  const ssvc = m.ssvcV203?.[0]?.ssvcData?.options as Json[] | undefined
  return {
    id: c.id,
    state: c.vulnStatus ?? null,
    title: c.cisaVulnerabilityName ?? null,
    summary: (c.descriptions as Json[] | undefined)?.find((x) => x.lang === 'en')?.value ?? null,
    cvss: cvss?.baseScore ?? null,
    severity: cvss?.baseSeverity ?? null,
    vector: cvss?.vectorString ?? null,
    cvssVersion: cvss?.version ?? null,
    cwe: uniq(
      ((c.weaknesses as Json[] | undefined) ?? [])
        .flatMap((w) => (w.description ?? []).map((x: Json) => x.value))
        .filter((v: string) => /^CWE-\d+$/.test(v))
    ),
    published: c.published ? `${c.published}Z` : null,
    updated: c.lastModified ? `${c.lastModified}Z` : null,
    kevAdded: c.cisaExploitAdd ?? null,
    exploitation: ssvc?.find((o) => 'exploitation' in o)?.exploitation ?? null,
    references: uniq(((c.references as Json[] | undefined) ?? []).map((r) => r.url)),
    products: []
  }
}

export function cveOutput(ctx: Pick<ModuleContext, 'lang'>, c: CveInfo, epss: { epss: number; percentile: number } | null): ModuleOutput {
  const properties = compact({
    title: c.title,
    summary: c.summary,
    cvss: c.cvss,
    severity: c.severity,
    cvss_vector: c.vector,
    cvss_version: c.cvssVersion,
    cwe: c.cwe,
    state: c.state,
    published_at: isoDate(c.published),
    updated_at: isoDate(c.updated),
    exploited: c.kevAdded ? true : c.exploitation === 'active' ? true : null,
    kev_added_date: c.kevAdded,
    exploitation: c.exploitation,
    epss: epss ? `${(epss.epss * 100).toFixed(2)} %` : null,
    epss_percentile: epss ? Math.round(epss.percentile * 1000) / 10 : null,
    references: c.references.slice(0, MAX_REFS),
    affected: c.products.map((p) => `${p.vendor} ${p.product}`).slice(0, 20),
    url: `https://www.cve.org/CVERecord?id=${c.id}`,
    nvd_url: `https://nvd.nist.gov/vuln/detail/${c.id}`
  })
  const entities: OutEntity[] = c.products.slice(0, MAX_PRODUCTS).map((p) => ({
    type: 'technology',
    label: p.product.toLowerCase().startsWith(p.vendor.toLowerCase()) ? p.product : `${p.vendor} ${p.product}`,
    data: { vendor: p.vendor },
    linkLabel: tr(ctx, 'produit affecté', 'affected product')
  }))
  return { properties, entities, raw: { ...c, epss } }
}

async function epssOf(ctx: ModuleContext, id: string): Promise<{ epss: number; percentile: number } | null> {
  try {
    const d = await ctx.fetchJson<{ data?: Array<{ epss: string; percentile: string }> }>('https://api.first.org/data/v1/epss', {
      query: { cve: id },
      timeoutMs: 10000
    })
    const row = d.data?.[0]
    return row ? { epss: Number(row.epss), percentile: Number(row.percentile) } : null
  } catch {
    return null
  }
}

export default defineModule({
  id: 'forensic.cve',
  name: { fr: 'Vulnérabilité CVE', en: 'CVE vulnerability' },
  description: {
    fr: "Score CVSS et gravité, résumé, faiblesses CWE, produits affectés, dates, exploitation active connue (catalogue KEV de la CISA) et probabilité d'exploitation EPSS d'une CVE.",
    en: 'CVSS score and severity, summary, CWE weaknesses, affected products, dates, known active exploitation (CISA KEV catalog) and EPSS exploitation probability of a CVE.'
  },
  category: 'forensic',
  inputTypes: ['cve'],
  homepage: 'https://cve.circl.lu',
  async run(input, ctx) {
    const id = input.label.trim().toUpperCase()
    if (!/^CVE-\d{4}-\d{4,}$/.test(id)) throw new ModuleError('Identifiant CVE invalide (format CVE-AAAA-NNNN)', 'invalid_input')
    let info: CveInfo | null = null
    let primaryError: unknown = null
    try {
      info = parseCveRecord((await getJson<Json>(ctx, `https://cve.circl.lu/api/cve/${id}`, 'cve.circl.lu')) ?? {})
    } catch (e) {
      primaryError = e
    }
    if (!info) {
      // Secours : base NVD du NIST (aussi pour les CVE très récentes).
      try {
        info = parseNvd((await getJson<Json>(ctx, 'https://services.nvd.nist.gov/rest/json/cves/2.0', 'NVD', { query: { cveId: id }, timeoutMs: 30000 })) ?? {})
      } catch (e) {
        throw primaryError ?? e
      }
    }
    if (!info) return {}
    return cveOutput(ctx, info, await epssOf(ctx, id))
  }
})
