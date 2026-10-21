// CIRCL hashlookup : identifie un fichier connu (NSRL, paquets Linux, logiciels courants)
// à partir de son empreinte MD5, SHA-1 ou SHA-256. Gratuit, sans clé.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, getJson, num, tr } from '../misc/_util'
import { algorithmOf, hashValue } from './_hash'

const PATHS: Record<string, string> = { MD5: 'md5', 'SHA-1': 'sha1', 'SHA-256': 'sha256' }

export interface HashlookupRecord {
  FileName?: string
  FileSize?: string
  MD5?: string
  'SHA-1'?: string
  'SHA-256'?: string
  'SHA-512'?: string
  ProductCode?: { ProductName?: string; ProductVersion?: string; ApplicationType?: string; Language?: string }
  OpSystemCode?: { OpSystemName?: string; OpSystemVersion?: string }
  source?: string
  db?: string
  KnownMalicious?: string
  'hashlookup:trust'?: number
  parents?: Array<{ 'SHA-1'?: string; FileName?: string; FileSize?: string }>
}

export function parseHashlookup(ctx: Pick<ModuleContext, 'lang'>, algo: string, r: HashlookupRecord): ModuleOutput {
  const product = r.ProductCode?.ProductName ? [r.ProductCode.ProductName, r.ProductCode.ProductVersion].filter(Boolean).join(' ') : null
  const os = r.OpSystemCode?.OpSystemName && r.OpSystemCode.OpSystemName !== 'TBD' ? r.OpSystemCode.OpSystemName : null
  const properties = compact({
    known_file: true,
    file_name: r.FileName ?? null,
    file_size: num(r.FileSize),
    known_source: r.source ?? r.db ?? null,
    product,
    os,
    trust: r['hashlookup:trust'] ?? null,
    known_malicious: r.KnownMalicious ?? null,
    md5: r.MD5?.toLowerCase() ?? null,
    sha1: r['SHA-1']?.toLowerCase() ?? null,
    sha256: r['SHA-256']?.toLowerCase() ?? null
  })
  const entities: OutEntity[] = []
  if (r.FileName) {
    entities.push({
      ref: 'file',
      type: 'file',
      label: r.FileName,
      data: { size: num(r.FileSize), sha256: r['SHA-256']?.toLowerCase() ?? null, product },
      linkLabel: tr(ctx, 'fichier connu', 'known file')
    })
  }
  const others: Array<[string, string | undefined]> = [
    ['MD5', r.MD5],
    ['SHA-1', r['SHA-1']],
    ['SHA-256', r['SHA-256']]
  ]
  for (const [name, value] of others) {
    if (!value || name === algo) continue
    entities.push({
      type: 'hash',
      label: value.toLowerCase(),
      data: { algorithm: name },
      from: r.FileName ? 'file' : undefined,
      linkLabel: name
    })
  }
  for (const p of (r.parents ?? []).slice(0, 5)) {
    if (!p.FileName && !p['SHA-1']) continue
    entities.push({
      type: 'file',
      label: p.FileName ?? p['SHA-1']!,
      data: { size: num(p.FileSize), sha1: p['SHA-1']?.toLowerCase() ?? null },
      from: r.FileName ? 'file' : undefined,
      linkLabel: tr(ctx, 'contenu dans', 'contained in')
    })
  }
  return { properties, entities, raw: r }
}

export default defineModule({
  id: 'forensic.hashlookup',
  name: { fr: 'Fichier connu (CIRCL hashlookup)', en: 'Known file (CIRCL hashlookup)' },
  description: {
    fr: "Vérifie si l'empreinte correspond à un fichier légitime connu (base NSRL du NIST, paquets Linux, logiciels courants) : nom du fichier, produit, éditeur et autres empreintes.",
    en: 'Checks whether the hash matches a known legitimate file (NIST NSRL, Linux packages, common software): file name, product, vendor and other hashes.'
  },
  category: 'web',
  inputTypes: ['hash'],
  homepage: 'https://hashlookup.circl.lu',
  accepts: (input) => !!PATHS[algorithmOf(input) ?? ''],
  async run(input, ctx) {
    const algo = algorithmOf(input)
    const path = algo ? PATHS[algo] : null
    if (!algo || !path) return {}
    const r = await getJson<HashlookupRecord>(ctx, `https://hashlookup.circl.lu/lookup/${path}/${hashValue(input)}`, 'CIRCL hashlookup')
    if (!r) return {}
    return parseHashlookup(ctx, algo, r)
  }
})
