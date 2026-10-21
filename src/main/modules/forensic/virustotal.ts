// Réputation d'un fichier dans VirusTotal (API v3, clé gratuite limitée à 4 requêtes par minute) :
// détections antivirus, famille de malware, noms connus, dates de soumission.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, getJson, isoDate, tr } from '../misc/_util'
import { algorithmOf, hashValue } from './_hash'

export interface VtFile {
  data?: {
    id: string
    attributes: {
      meaningful_name?: string
      names?: string[]
      type_description?: string
      size?: number
      md5?: string
      sha1?: string
      sha256?: string
      first_submission_date?: number
      last_analysis_date?: number
      times_submitted?: number
      reputation?: number
      tags?: string[]
      last_analysis_stats?: Record<string, number>
      popular_threat_classification?: {
        suggested_threat_label?: string
        popular_threat_category?: Array<{ value: string; count: number }>
        popular_threat_name?: Array<{ value: string; count: number }>
      }
    }
  }
}

export function parseVirusTotal(ctx: Pick<ModuleContext, 'lang'>, d: VtFile): ModuleOutput {
  const a = d.data?.attributes
  if (!a) return {}
  const stats = a.last_analysis_stats ?? {}
  const malicious = stats.malicious ?? 0
  const engines = Object.values(stats).reduce((s, n) => s + n, 0)
  const threat = a.popular_threat_classification
  const label = threat?.suggested_threat_label ?? null
  const sha256 = a.sha256 ?? d.data!.id
  const properties = compact({
    vt_detections: engines ? `${malicious}/${engines}` : null,
    vt_malicious: malicious,
    vt_suspicious: stats.suspicious ?? null,
    threat_label: label,
    threat_category: threat?.popular_threat_category?.[0]?.value ?? null,
    file_type: a.type_description ?? null,
    file_name: a.meaningful_name ?? null,
    file_names: (a.names ?? []).slice(0, 10),
    file_size: a.size ?? null,
    tags: a.tags ?? [],
    first_seen: isoDate(a.first_submission_date),
    last_analysis_at: isoDate(a.last_analysis_date),
    times_submitted: a.times_submitted ?? null,
    vt_reputation: a.reputation ?? null,
    vt_url: `https://www.virustotal.com/gui/file/${sha256}`
  })
  const entities: OutEntity[] = []
  if (a.meaningful_name) {
    entities.push({
      type: 'file',
      label: a.meaningful_name,
      data: { size: a.size ?? null, sha256, mime: a.type_description ?? null },
      linkLabel: tr(ctx, 'fichier', 'file')
    })
  }
  const family = threat?.popular_threat_name?.[0]?.value
  if (malicious > 0 && (family || label)) {
    entities.push({
      type: 'malware',
      label: family ?? label!,
      data: { family: family ?? null, label },
      linkLabel: tr(ctx, `détecté par ${malicious} antivirus`, `flagged by ${malicious} engines`)
    })
  }
  return { properties, entities, raw: { id: d.data?.id, stats, threat, names: a.names?.slice(0, 10) } }
}

export default defineModule({
  id: 'forensic.virustotal',
  name: { fr: 'Réputation du fichier (VirusTotal)', en: 'File reputation (VirusTotal)' },
  description: {
    fr: "Détections antivirus, famille de malware probable, type et noms du fichier, première soumission, à partir d'une empreinte MD5, SHA-1 ou SHA-256.",
    en: 'Antivirus detections, likely malware family, file type and names, first submission, from an MD5, SHA-1 or SHA-256 hash.'
  },
  category: 'forensic',
  inputTypes: ['hash'],
  keys: [{ id: 'virustotal', label: 'VirusTotal API key', url: 'https://www.virustotal.com/gui/my-apikey' }],
  homepage: 'https://www.virustotal.com',
  experimental: true,
  accepts: (input) => ['MD5', 'SHA-1', 'SHA-256'].includes(algorithmOf(input) ?? ''),
  async run(input, ctx) {
    const d = await getJson<VtFile>(ctx, `https://www.virustotal.com/api/v3/files/${hashValue(input)}`, 'VirusTotal', {
      headers: { 'x-apikey': ctx.key('virustotal') ?? '' },
      keyed: true
    })
    if (!d) return {}
    return parseVirusTotal(ctx, d)
  }
})
