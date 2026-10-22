// Fichiers publics qui désignent le propriétaire d'un site : ads.txt (comptes publicitaires
// autorisés à vendre son espace) et associations d'applications mobiles (assetlinks.json pour
// Android, apple-app-site-association pour iOS). Comme web.robots, ces lectures contactent la cible.

import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { cappedList, compact, toUrl, uniq } from '../domain/_util'
import { fetchSiteFile } from './_files'
import { normalizeTracker } from './tracker'

const MAX_FILE = 500_000
/** Identifiants AdSense reliés au site : au-delà, ads.txt recopie sans doute ceux d'une régie. */
const MAX_ADSENSE = 5

export interface AdsRecord {
  /** Domaine de la plateforme publicitaire (`google.com`). */
  domain: string
  /** Compte du vendeur sur cette plateforme (`pub-9273264035880389`). */
  account: string
  relation: 'DIRECT' | 'RESELLER'
}

export interface AdsTxt {
  records: AdsRecord[]
  /** Variables `nom=valeur` (contact, ownerdomain, managerdomain, subdomain...), clés en minuscules. */
  variables: Record<string, string[]>
}

/** Fichier ads.txt (IAB Tech Lab) : une ligne `domaine, compte, DIRECT|RESELLER[, autorité]`. */
export function parseAdsTxt(text: string): AdsTxt {
  const out: AdsTxt = { records: [], variables: {} }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const variable = line.match(/^([a-z][a-z-]*)\s*=\s*(.+)$/i)
    if (variable && !line.includes(',')) {
      const key = variable[1].toLowerCase()
      out.variables[key] = uniq([...(out.variables[key] ?? []), variable[2].trim()])
      continue
    }
    const [domain, account, relation] = line.split(',').map((f) => f.trim())
    const rel = relation?.toUpperCase()
    if (!domain || !account || (rel !== 'DIRECT' && rel !== 'RESELLER')) continue
    const rec: AdsRecord = { domain: domain.toLowerCase(), account, relation: rel }
    if (!out.records.some((r) => r.domain === rec.domain && r.account === rec.account && r.relation === rec.relation)) out.records.push(rec)
  }
  return out
}

export interface AndroidApp {
  package: string
  fingerprints: string[]
}

/** Digital Asset Links (`/.well-known/assetlinks.json`) : applications Android liées au site. */
export function parseAssetLinks(json: unknown): AndroidApp[] {
  if (!Array.isArray(json)) return []
  const apps = new Map<string, Set<string>>()
  for (const st of json as Array<{ target?: { namespace?: string; package_name?: string; sha256_cert_fingerprints?: unknown } }>) {
    const t = st?.target
    if (t?.namespace !== 'android_app' || typeof t.package_name !== 'string' || !t.package_name) continue
    const set = apps.get(t.package_name) ?? new Set<string>()
    for (const f of Array.isArray(t.sha256_cert_fingerprints) ? t.sha256_cert_fingerprints : [])
      if (typeof f === 'string' && f.trim()) set.add(f.trim().toUpperCase())
    apps.set(t.package_name, set)
  }
  return Array.from(apps, ([pkg, fps]) => ({ package: pkg, fingerprints: Array.from(fps) }))
}

export interface AppleApps {
  teamIds: string[]
  bundleIds: string[]
}

/**
 * apple-app-site-association : identifiants `EQUIPE.bundle` des liens universels (`applinks`,
 * ancien `appID` ou nouveau `appIDs`), du trousseau partagé (`webcredentials`), des App Clips et
 * de Handoff. L'identifiant d'équipe Apple (10 caractères) désigne le compte développeur.
 */
export function parseAppleAppSite(json: unknown): AppleApps {
  const ids: string[] = []
  const add = (v: unknown): void => {
    if (typeof v === 'string') ids.push(v.trim())
    else if (Array.isArray(v)) v.forEach(add)
  }
  const doc = (json ?? {}) as Record<string, { apps?: unknown; details?: Array<{ appID?: unknown; appIDs?: unknown }> } | undefined>
  for (const d of doc.applinks?.details ?? []) {
    add(d?.appID)
    add(d?.appIDs)
  }
  for (const section of ['applinks', 'webcredentials', 'appclips', 'activitycontinuation']) add(doc[section]?.apps)
  const parsed = ids.map((id) => id.match(/^([A-Z0-9]{10})\.([A-Za-z0-9.-]+)$/)).filter((m): m is RegExpMatchArray => !!m)
  return { teamIds: uniq(parsed.map((m) => m[1])), bundleIds: uniq(parsed.map((m) => m[2])) }
}

const parseJson = (text: string | undefined): unknown => {
  if (!text) return null
  try {
    return JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return null
  }
}

export function buildWellKnownOutput(ads: AdsTxt | null, android: AndroidApp[], apple: AppleApps | null, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const records = ads?.records ?? []
  // Compte Google en vente directe : c'est le compte AdSense (ou Ad Manager) du propriétaire.
  const adsense = uniq(
    records
      .filter((r) => r.relation === 'DIRECT' && r.domain === 'google.com')
      .map((r) => normalizeTracker(r.account))
      .filter((t) => t?.kind === 'Google AdSense')
      .map((t) => t!.id)
  )
  const entities: OutEntity[] = adsense.slice(0, MAX_ADSENSE).map((id) => ({
    type: 'tracker',
    label: id,
    data: { kind: 'Google AdSense' },
    linkLabel: fr ? 'vendeur direct (ads.txt)' : 'direct seller (ads.txt)'
  }))
  const line = (r: AdsRecord): string => `${r.domain}, ${r.account}`
  const vars = ads?.variables ?? {}
  const properties = compact({
    ads_txt_records: ads ? records.length : null,
    adsense_ids: adsense,
    ...cappedList('ads_direct', records.filter((r) => r.relation === 'DIRECT' && r.domain !== 'google.com').map(line)),
    ...cappedList('ads_resellers', records.filter((r) => r.relation === 'RESELLER').map(line)),
    ads_owner_domain: vars.ownerdomain?.[0] ?? null,
    ads_manager_domains: vars.managerdomain ?? [],
    ads_contacts: vars.contact ?? [],
    android_packages: android.map((a) => a.package),
    android_cert_fingerprints: uniq(android.flatMap((a) => a.fingerprints)),
    apple_team_ids: apple?.teamIds ?? [],
    apple_bundle_ids: apple?.bundleIds ?? []
  })
  if (!Object.keys(properties).length) return {}
  return { properties, entities, raw: { ads: ads ? { ...ads, records: records.slice(0, 500) } : null, android, apple } }
}

export default defineModule({
  id: 'web.wellknown',
  name: { fr: 'ads.txt et applications mobiles liées', en: 'ads.txt and linked mobile apps' },
  description: {
    fr: 'Contacte le site cible pour lire ads.txt (compte AdSense du propriétaire relié comme traceur, régies et revendeurs dans la fiche) et les associations d’applications mobiles : assetlinks.json (paquet Android et empreinte du certificat de signature) et apple-app-site-association (identifiant d’équipe Apple et identifiants des applications).',
    en: 'Contacts the target site to read ads.txt (owner AdSense account linked as a tracker, ad networks and resellers in the record) and mobile app associations: assetlinks.json (Android package and signing certificate fingerprint) and apple-app-site-association (Apple Team ID and app bundle IDs).'
  },
  category: 'web',
  inputTypes: ['url', 'website', 'domain'],
  noisy: true,
  async run(input, ctx) {
    let origin: string
    try {
      origin = new URL(toUrl(input.label)).origin
    } catch {
      throw new ModuleError('URL invalide', 'invalid_input')
    }
    const [adsFile, assetFile, appleFile] = await Promise.all([
      fetchSiteFile(ctx, `${origin}/ads.txt`, MAX_FILE),
      fetchSiteFile(ctx, `${origin}/.well-known/assetlinks.json`, MAX_FILE),
      fetchSiteFile(ctx, `${origin}/.well-known/apple-app-site-association`, MAX_FILE)
    ])
    // Emplacement historique, encore servi seul par certains sites.
    const apple = appleFile ?? (await fetchSiteFile(ctx, `${origin}/apple-app-site-association`, MAX_FILE))
    if (!adsFile && !assetFile && !apple) {
      // Vérifie que le site répond : sinon c'est une erreur, pas un résultat vide.
      try {
        const res = await ctx.fetch(origin, { redirect: 'follow', timeoutMs: 15000 })
        await res.body?.cancel().catch(() => undefined)
      } catch (e) {
        throw new ModuleError(`Site injoignable : ${e instanceof Error ? e.message : e}`, 'unavailable')
      }
      return {}
    }
    const ads = adsFile ? parseAdsTxt(adsFile.text) : null
    return buildWellKnownOutput(
      ads && (ads.records.length || Object.keys(ads.variables).length) ? ads : null,
      parseAssetLinks(parseJson(assetFile?.text)),
      apple ? parseAppleAppSite(parseJson(apple.text)) : null,
      ctx.lang
    )
  }
})
