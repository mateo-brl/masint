// Listes noires de l'Autorité des marchés financiers : sites, adresses électroniques et
// sociétés non autorisés (forex, crypto-actifs, biens divers, usurpations). Fichier publié sur
// data.gouv.fr (3 500 entrées environ), téléchargé une fois puis gardé en cache 24 h.

import { defineModule, ModuleError, type InputEntity, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { normalizeDomain } from '../domain/_util'
import { EMAIL_PROVIDERS } from '../hints/_domains'
import { compact, serviceError, tr } from '../misc/_util'
import { normName } from '../company/_fr'
import { splitLine } from '../misc/_csv'

// Jeu de données « Listes noires » de l'AMF : la ressource est retrouvée à chaque
// téléchargement, son identifiant ne sert que de repli.
const DATASET = 'https://www.data.gouv.fr/api/1/datasets/listes-noires-des-entites-non-autorisees-a-proposer-des-produits-ou-services-financiers-en-france/'
const RESOURCE_ID = 'd2d9df6d-1cd2-41a8-96f5-684cb3057ecb'
const LATEST = `https://www.data.gouv.fr/api/1/datasets/r/${RESOURCE_ID}`
const TABULAR = 'https://tabular-api.data.gouv.fr/api/resources'
const AMF_PAGE = 'https://www.amf-france.org/fr/espace-epargnants/proteger-son-epargne/listes-noires-et-mises-en-garde'
const TTL = 24 * 3600 * 1000
const MAX_REVIEW = 5

export interface AmfEntry {
  /** Valeur publiée telle quelle (« www.x.com », « prénom.nom@x.com », « Société (x.com) »). */
  value: string
  categories: string[]
  date: string | null
  hosts: string[]
  emails: string[]
  /** Domaines dont toutes les adresses sont visées (« prénom.nom@x.com »). */
  mailDomains: string[]
  names: string[]
}

const HOST_RE = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/?#:\s)]|$)/gi
// Site avec son chemin (« www.x.com/?lang=fr »), retiré avant de relever les dénominations.
const URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#:][^\s)]*)?/gi
const EMAIL_RE = /([^\s@()/,;]+)@((?:[a-z0-9-]+\.)+[a-z]{2,})/gi

/** Catégorie lisible : `Produits_dérivés_sur_crypto-actifs` → « Produits dérivés sur crypto-actifs ». */
export const categoryLabel = (c: string): string => c.replace(/_/g, ' ').trim()

/** Analyse une valeur publiée : sites, adresses, domaines de messagerie et dénominations. */
export function parseValue(value: string): Pick<AmfEntry, 'hosts' | 'emails' | 'mailDomains' | 'names'> {
  const emails: string[] = []
  const mailDomains: string[] = []
  let rest = value
  for (const m of value.matchAll(EMAIL_RE)) {
    const local = m[1].toLowerCase()
    const domain = m[2].toLowerCase()
    // « prénom.nom@domaine » ou « *@domaine » : toutes les adresses du domaine sont visées.
    if (/^(pr[eé]nom|\*|xxx)/.test(local)) mailDomains.push(domain)
    else emails.push(`${local}@${domain}`)
    rest = rest.replace(m[0], ' ')
  }
  const hosts = Array.from(rest.matchAll(HOST_RE), (m) => normalizeDomain(m[1]))
  const names = rest
    .replace(URL_RE, ' ')
    .split(/\s*\/\s*|\s*[()]\s*/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 2 && /\p{L}{2}/u.test(s))
  return { hosts: [...new Set(hosts)], emails, mailDomains, names }
}

export function parseCsv(csv: string): AmfEntry[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const header = splitLine(lines.shift() ?? '').map((h) => h.trim().toLowerCase())
  const iNom = header.indexOf('nom')
  const iCat = header.indexOf('categorie')
  const iDate = header.indexOf('date_inscription')
  if (iNom < 0) return []
  return lines
    .map((l) => splitLine(l))
    .filter((f) => f[iNom]?.trim())
    .map((f) => ({
      value: f[iNom].trim(),
      categories: (f[iCat] ?? '').split('|').map(categoryLabel).filter(Boolean),
      date: /^\d{4}-\d{2}-\d{2}/.test(f[iDate] ?? '') ? f[iDate].slice(0, 10) : null,
      ...parseValue(f[iNom])
    }))
}

export type AmfBasis = 'host' | 'email' | 'mail_domain' | 'name'

export interface AmfHit {
  entry: AmfEntry
  basis: AmfBasis
}

const FREE_MAIL = new Set(EMAIL_PROVIDERS)

/** Entrées qui visent la valeur saisie : site ou adresse identiques (directs), nom proche (à vérifier). */
export function matchAmf(entries: AmfEntry[], input: Pick<InputEntity, 'type' | 'label' | 'data'>): AmfHit[] {
  const hits: AmfHit[] = []
  const add = (entry: AmfEntry, basis: AmfBasis): void => {
    if (!hits.some((h) => h.entry === entry)) hits.push({ entry, basis })
  }
  const hostsOf = (v: unknown): string[] => (typeof v === 'string' && v.trim() ? [normalizeDomain(v)] : [])
  if (input.type === 'email') {
    const mail = input.label.trim().toLowerCase()
    const domain = mail.split('@')[1] ?? ''
    for (const e of entries) {
      if (e.emails.includes(mail)) add(e, 'email')
      else if (domain && !FREE_MAIL.has(domain) && (e.mailDomains.includes(domain) || e.hosts.includes(domain))) add(e, 'mail_domain')
    }
    return hits
  }
  const hosts = input.type === 'domain' || input.type === 'website' || input.type === 'url' ? hostsOf(input.label) : [...hostsOf(input.data.website), ...hostsOf(input.data.domain)]
  for (const h of hosts) for (const e of entries) if (e.hosts.includes(h)) add(e, 'host')
  if (input.type === 'company' || input.type === 'organization') {
    const q = normName(input.label)
    if (q.length >= 3)
      for (const e of entries) if (e.names.some((n) => normName(n) === q) || e.hosts.some((h) => normName(h.split('.')[0]) === q.replace(/\s/g, ''))) add(e, 'name')
  }
  return hits
}

const BASIS: Record<AmfBasis, { fr: string; en: string }> = {
  host: { fr: 'site identique', en: 'same website' },
  email: { fr: 'adresse identique', en: 'same email address' },
  mail_domain: { fr: 'domaine de messagerie inscrit', en: 'listed mail domain' },
  name: { fr: 'nom proche', en: 'similar name' }
}

export function amfOutput(ctx: Pick<ModuleContext, 'lang'>, hits: AmfHit[]): ModuleOutput {
  const direct = hits.filter((h) => h.basis !== 'name')
  const review = hits.filter((h) => h.basis === 'name')
  const properties: Record<string, PropValue> = {}
  if (direct.length) {
    const dates = direct.map((h) => h.entry.date).filter((d): d is string => !!d).sort()
    Object.assign(
      properties,
      compact({
        amf_blacklisted: true,
        amf_categories: [...new Set(direct.flatMap((h) => h.entry.categories))],
        amf_listing_date: dates[0] ?? null,
        amf_entries: direct.map((h) => h.entry.value),
        amf_match: [...new Set(direct.map((h) => BASIS[h.basis][ctx.lang]))],
        amf_url: AMF_PAGE
      })
    )
  } else if (!review.length) properties.amf_blacklisted = false
  const entities: OutEntity[] = review.slice(0, MAX_REVIEW).map((h) => {
    const host = h.entry.hosts[0]
    return {
      type: host ? 'domain' : 'organization',
      label: host ?? h.entry.names[0] ?? h.entry.value,
      data: compact({
        amf_blacklisted: true,
        amf_categories: h.entry.categories,
        amf_listing_date: h.entry.date,
        amf_entries: [h.entry.value],
        amf_url: AMF_PAGE
      }),
      linkLabel: tr(ctx, 'liste noire AMF (nom proche)', 'AMF blacklist (similar name)'),
      review: true,
      reviewReason: tr(
        ctx,
        `nom proche d’une entrée de la liste noire de l’AMF : « ${h.entry.value} » (${h.entry.categories.join(', ') || 'catégorie non précisée'}, inscrite le ${h.entry.date ? h.entry.date.split('-').reverse().join('/') : '?'}) ; vérifiez qu’il s’agit bien de la même société`,
        `name close to an AMF blacklist entry: "${h.entry.value}" (${h.entry.categories.join(', ') || 'no category'}, listed ${h.entry.date ?? '?'}); check it is the same company`
      )
    }
  })
  if (review.length) properties.amf_possible_matches = review.length
  return { properties, entities, raw: hits.map((h) => ({ basis: h.basis, value: h.entry.value, categories: h.entry.categories, date: h.entry.date })) }
}

interface DatasetResponse {
  resources?: Array<{ id: string; title?: string; format?: string; url?: string; latest?: string }>
}

async function attempt<T>(ctx: ModuleContext, fn: () => Promise<T>): Promise<T> {
  let last: unknown
  // Hôtes data.gouv.fr parfois coupés : une nouvelle tentative espacée.
  for (let i = 0; i < 2; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const status = (e as { status?: number }).status
      if ((status && status < 500 && status !== 429) || ctx.signal.aborted) break
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw last
}

/** Adresse actuelle du fichier : ressource du jeu de données, sinon lien permanent. */
async function csvUrl(ctx: ModuleContext): Promise<string> {
  try {
    const ds = await attempt(ctx, () => ctx.fetchJson<DatasetResponse>(DATASET, { timeoutMs: 20000 }))
    const res = (ds.resources ?? []).find((r) => /listes?[-\s_]noires?/i.test(r.title ?? '') && /csv/i.test(r.format ?? 'csv')) ?? ds.resources?.[0]
    return res?.url || res?.latest || LATEST
  } catch {
    return LATEST
  }
}

let cache: { at: number; entries: Promise<AmfEntry[]> } | null = null

/** Réinitialise le cache (tests). */
export function resetAmfCache(): void {
  cache = null
}

async function loadEntries(ctx: ModuleContext): Promise<AmfEntry[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.entries
  const entries = (async () => {
    const url = await csvUrl(ctx)
    const csv = await attempt(ctx, () => ctx.fetchText(url, { timeoutMs: 60000 })).catch((e) => (url === LATEST ? Promise.reject(e) : attempt(ctx, () => ctx.fetchText(LATEST, { timeoutMs: 60000 }))))
    const list = parseCsv(csv)
    if (!list.length) throw new ModuleError('AMF : fichier des listes noires illisible', 'unavailable')
    return list
  })()
  const entry = { at: Date.now(), entries }
  cache = entry
  entries.catch(() => {
    if (cache === entry) cache = null
  })
  return entries
}

interface TabularResponse {
  data?: Array<{ nom?: string; categorie?: string; date_inscription?: string }>
}

/** Repli si le fichier est injoignable : recherche ciblée dans l'API tabulaire de data.gouv.fr. */
async function tabularSearch(ctx: ModuleContext, needle: string): Promise<AmfEntry[]> {
  const res = await attempt(ctx, () =>
    ctx.fetchJson<TabularResponse>(`${TABULAR}/${RESOURCE_ID}/data/`, { query: { nom__contains: needle, page_size: 50 }, timeoutMs: 30000 })
  )
  return (res.data ?? []).map((r) => {
    const csv = `"nom";"categorie";"date_inscription"\n"${(r.nom ?? '').replace(/"/g, '""')}";"${r.categorie ?? ''}";"${r.date_inscription ?? ''}"`
    return parseCsv(csv)[0]
  }).filter((e): e is AmfEntry => !!e)
}

/** Terme de recherche pour le repli : domaine, domaine de l'adresse ou nom. */
function needleOf(input: InputEntity): string {
  if (input.type === 'email') return input.label.trim().toLowerCase().split('@')[1] ?? input.label
  if (input.type === 'domain' || input.type === 'website' || input.type === 'url') return normalizeDomain(input.label)
  return input.label.trim()
}

export default defineModule({
  id: 'finance.amf_blacklist',
  name: { fr: 'Listes noires de l’AMF', en: 'AMF blacklists' },
  description: {
    fr: 'Cherche le domaine, le site, l’adresse électronique ou la société dans les listes noires de l’Autorité des marchés financiers (sites et sociétés non autorisés : forex, crypto-actifs, biens divers, usurpations), publiées sur data.gouv.fr. Site, adresse ou domaine de messagerie identiques : inscription relevée sur la fiche (catégorie, date). Nom proche : mis de côté dans « À vérifier ». Fichier gardé en cache 24 h.',
    en: 'Looks the domain, website, email address or company up in the French financial markets authority (AMF) blacklists (unauthorized websites and companies: forex, crypto-assets, alternative investments, impersonation), published on data.gouv.fr. Same website, address or mail domain: listing recorded on the record (category, date). Similar name: put aside in "To review". File cached for 24 h.'
  },
  category: 'finance',
  inputTypes: ['domain', 'website', 'email', 'company', 'organization'],
  homepage: AMF_PAGE,
  async run(input, ctx) {
    let entries: AmfEntry[]
    try {
      entries = await loadEntries(ctx)
    } catch (e) {
      // Fichier injoignable : recherche ciblée dans l'API tabulaire.
      const needle = needleOf(input)
      if (needle.length < 3) throw serviceError(e, 'AMF')
      try {
        entries = await tabularSearch(ctx, needle)
      } catch (e2) {
        throw serviceError(e2, 'AMF (data.gouv.fr)')
      }
    }
    return amfOutput(ctx, matchAmf(entries, input))
  }
})
