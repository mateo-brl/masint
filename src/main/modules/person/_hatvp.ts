// Haute Autorité pour la transparence de la vie publique (HATVP), données ouvertes : lecture
// des déclarations publiées en ligne (liste.csv) et du répertoire des représentants d'intérêts
// (agora_repertoire_opendata.json), téléchargements gardés en cache 24 h. Structure d'après
// la notice open data de la HATVP ; lecture tolérante aux colonnes absentes.

import { ModuleError, type InputEntity, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cappedList } from '../domain/_util'
import { compact, serviceError, tr } from '../misc/_util'
import { normName } from '../company/_fr'
import { sirenOf } from '../company/_ids'
import { splitLine } from '../misc/_csv'
import { fold, type PersonName } from './_name'

export const LISTE_URL = 'https://www.hatvp.fr/livraison/opendata/liste.csv'
export const AGORA_URL = 'https://www.hatvp.fr/agora/opendata/agora_repertoire_opendata.json'
const SITE = 'https://www.hatvp.fr'
const TTL = 24 * 3600 * 1000
const MAX_PEOPLE = 5
const MAX_CANDIDATES = 5

// ---------------------------------------------------------------------------------------------
// Déclarations des responsables publics

export interface Declaration {
  civilite: string
  prenom: string
  nom: string
  /** Mandat ou fonction (« depute », « senateur », « gouvernement »...). */
  typeMandat: string
  /** Qualité déclarée (« Député de Paris », « Maire »...). */
  qualite: string
  typeDocument: string
  departement: string
  datePublication: string | null
  /** Page nominative du responsable sur le site de la HATVP. */
  urlDossier: string | null
  nomFichier: string | null
}

const DOCUMENTS: Record<string, { fr: string; en: string }> = {
  di: { fr: 'Déclaration d’intérêts', en: 'Declaration of interests' },
  dia: { fr: 'Déclaration d’intérêts et d’activités', en: 'Declaration of interests and activities' },
  dim: { fr: 'Déclaration d’intérêts modificative', en: 'Amended declaration of interests' },
  diam: { fr: 'Déclaration d’intérêts et d’activités modificative', en: 'Amended declaration of interests and activities' },
  dsp: { fr: 'Déclaration de situation patrimoniale', en: 'Asset declaration' },
  dspm: { fr: 'Déclaration de situation patrimoniale modificative', en: 'Amended asset declaration' },
  dspfm: { fr: 'Déclaration de situation patrimoniale de fin de mandat', en: 'End-of-term asset declaration' },
  appreciation: { fr: 'Appréciation de la Haute Autorité', en: 'Assessment by the High Authority' }
}

const MANDATES: Record<string, { fr: string; en: string }> = {
  depute: { fr: 'Député', en: 'Member of the National Assembly' },
  senateur: { fr: 'Sénateur', en: 'Senator' },
  europe: { fr: 'Représentant au Parlement européen', en: 'Member of the European Parliament' },
  gouvernement: { fr: 'Membre du Gouvernement', en: 'Government member' },
  commune: { fr: 'Élu municipal', en: 'Municipal official' },
  epci: { fr: 'Élu intercommunal', en: 'Inter-municipal official' },
  departement: { fr: 'Élu départemental', en: 'Departmental official' },
  region: { fr: 'Élu régional', en: 'Regional official' },
  autorite: { fr: 'Membre d’une autorité indépendante', en: 'Independent authority member' }
}

export const documentLabel = (code: string, lang: 'fr' | 'en' = 'fr'): string => DOCUMENTS[code.toLowerCase()]?.[lang] ?? code
export const mandateLabel = (code: string, lang: 'fr' | 'en' = 'fr'): string => MANDATES[code.toLowerCase()]?.[lang] ?? code

const isoDate = (v: string | undefined): string | null => {
  const s = (v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Lit `liste.csv` (séparateur `;`) en s'appuyant sur les intitulés de colonnes. */
export function parseListe(csv: string): Declaration[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const header = splitLine(lines.shift() ?? '').map((h) => h.trim().toLowerCase())
  const col = (f: string[], name: string): string => (header.includes(name) ? (f[header.indexOf(name)] ?? '').trim() : '')
  if (!header.includes('nom') || !header.includes('prenom')) return []
  return lines
    .map((l) => splitLine(l))
    .map((f) => ({
      civilite: col(f, 'civilite'),
      prenom: col(f, 'prenom'),
      nom: col(f, 'nom'),
      typeMandat: col(f, 'type_mandat'),
      qualite: col(f, 'qualite'),
      typeDocument: col(f, 'type_document'),
      departement: col(f, 'departement'),
      datePublication: isoDate(col(f, 'date_publication')),
      urlDossier: col(f, 'url_dossier') || null,
      nomFichier: col(f, 'nom_fichier') || null,
      statut: col(f, 'statut_publication')
    }))
    // Uniquement ce qui est publié en ligne.
    .filter((d) => d.nom && !/non|retir|supprim|attente/i.test(d.statut))
    .map(({ statut: _statut, ...d }) => d)
}

const words = (s: string): string[] => fold(s).split(/[^a-z0-9]+/).filter(Boolean)

/** Le déclarant porte-t-il le nom cherché (nom identique, premier prénom présent) ? */
export function matchesDeclarant(d: Pick<Declaration, 'nom' | 'prenom'>, name: PersonName): boolean {
  return words(d.nom).join(' ') === words(name.lastName).join(' ') && words(name.firstNames[0] ?? '').every((p) => words(d.prenom).includes(p))
}

const absolute = (u: string | null): string | null => (!u ? null : /^https?:/.test(u) ? u : `${SITE}${u.startsWith('/') ? '' : '/'}${u}`)

/** Une entité par responsable (page nominative), avec la liste de ses déclarations. */
export function declarationsOutput(ctx: Pick<ModuleContext, 'lang'>, list: Declaration[], name: PersonName): ModuleOutput {
  const fr = ctx.lang === 'fr'
  const matching = list.filter((d) => matchesDeclarant(d, name))
  if (!matching.length) return { properties: { hatvp_declarations: 0 } }
  const people = new Map<string, Declaration[]>()
  for (const d of matching) {
    const key = d.urlDossier ?? `${fold(d.prenom)} ${fold(d.nom)}`
    people.set(key, [...(people.get(key) ?? []), d])
  }
  const distinct = people.size
  const entities: OutEntity[] = [...people.values()].slice(0, MAX_PEOPLE).map((decls) => {
    const sorted = [...decls].sort((a, b) => (b.datePublication ?? '').localeCompare(a.datePublication ?? ''))
    const d = sorted[0]
    const qualites = Array.from(new Set(sorted.map((x) => x.qualite).filter(Boolean)))
    const url = absolute(d.urlDossier)
    return {
      type: 'document',
      label: `HATVP : ${d.prenom} ${d.nom}${qualites[0] ? ` (${qualites[0]})` : ''}`,
      data: compact({
        url,
        hatvp_mandates: Array.from(new Set(sorted.map((x) => mandateLabel(x.typeMandat, ctx.lang)).filter(Boolean))),
        hatvp_qualities: qualites,
        ...cappedList(
          'hatvp_documents',
          sorted.map((x) => [x.datePublication ? x.datePublication.split('-').reverse().join('/') : null, documentLabel(x.typeDocument, ctx.lang), x.qualite].filter(Boolean).join(' · ')),
          20
        ),
        created_at: sorted[sorted.length - 1].datePublication
      }),
      linkLabel: tr(ctx, 'déclarations HATVP', 'HATVP declarations'),
      // Sans date de naissance publiée, seule la fonction permet d'écarter un homonyme.
      review: true,
      reviewReason: fr
        ? `homonyme possible : même nom qu’un responsable public déclarant à la HATVP (${qualites.slice(0, 2).join(', ') || mandateLabel(d.typeMandat, 'fr')}${d.departement ? `, ${d.departement}` : ''})${distinct > 1 ? ` ; ${distinct} responsables portent ce nom` : ''} ; comparez la fonction`
        : `possible namesake: same name as a public official filing with the HATVP (${qualites.slice(0, 2).join(', ') || mandateLabel(d.typeMandat, 'en')}${d.departement ? `, ${d.departement}` : ''})${distinct > 1 ? `; ${distinct} officials share this name` : ''}; compare the role`
    }
  })
  return { entities, properties: { hatvp_declarations: matching.length }, raw: [...people.keys()] }
}

// ---------------------------------------------------------------------------------------------
// Répertoire des représentants d'intérêts

interface AgoraExercice {
  publicationCourante?: {
    dateDebut?: string
    dateFin?: string
    montantDepense?: string | null
    chiffreAffaire?: string | null
    nombreSalaries?: number | null
    nombreActivite?: number | null
    activites?: Array<{ publicationCourante?: { objet?: string | null; domainesIntervention?: string[] | null } }> | null
  }
}

export interface AgoraOrganisation {
  denomination?: string
  nomUsageHatvp?: string | null
  sigleHatvp?: string | null
  identifiantNational?: string | null
  typeIdentifiantNational?: string | null
  categorieOrganisation?: { label?: string | null } | null
  adresse?: string | null
  codePostal?: string | null
  ville?: string | null
  pays?: string | null
  lienSiteWeb?: string | null
  datePremierePublication?: string | null
  dirigeants?: unknown[] | null
  collaborateurs?: unknown[] | null
  exercices?: AgoraExercice[] | null
}

/** Fiche résumée d'un représentant d'intérêts, seule gardée en mémoire. */
export interface Lobbyist {
  name: string
  names: string[]
  id: string | null
  idType: string | null
  category: string | null
  address: string | null
  website: string | null
  registeredAt: string | null
  /** Dernier exercice déclaré. */
  period: string | null
  expenses: string | null
  revenue: string | null
  staff: number | null
  activities: number
  topics: string[]
  objects: string[]
}

const agoraDate = (s: string | null | undefined): string | null => {
  const v = (s ?? '').trim()
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})/) ?? v.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null
}

export function summarize(o: AgoraOrganisation): Lobbyist {
  const exercices = [...(o.exercices ?? [])]
    .map((e) => e.publicationCourante)
    .filter((e): e is NonNullable<AgoraExercice['publicationCourante']> => !!e)
    .sort((a, b) => (agoraDate(b.dateFin) ?? '').localeCompare(agoraDate(a.dateFin) ?? ''))
  const last = exercices[0]
  const acts = exercices.flatMap((e) => (e.activites ?? []).map((a) => a.publicationCourante).filter(Boolean))
  return {
    name: o.denomination ?? o.nomUsageHatvp ?? '',
    names: [o.denomination, o.nomUsageHatvp, o.sigleHatvp].filter((n): n is string => !!n),
    id: o.identifiantNational ?? null,
    idType: o.typeIdentifiantNational ?? null,
    category: o.categorieOrganisation?.label ?? null,
    address: [o.adresse, o.codePostal, o.ville, o.pays].filter(Boolean).join(' ').replace(/\s+/g, ' ') || null,
    website: o.lienSiteWeb ?? null,
    registeredAt: agoraDate(o.datePremierePublication),
    period: last ? [agoraDate(last.dateDebut), agoraDate(last.dateFin)].filter(Boolean).map((d) => d!.split('-').reverse().join('/')).join(' - ') || null : null,
    expenses: last?.montantDepense ?? null,
    revenue: last?.chiffreAffaire ?? null,
    staff: typeof last?.nombreSalaries === 'number' ? last.nombreSalaries : null,
    activities: acts.length,
    topics: Array.from(new Set(acts.flatMap((a) => a!.domainesIntervention ?? []))).slice(0, 20),
    objects: Array.from(new Set(acts.map((a) => (a!.objet ?? '').trim()).filter(Boolean))).slice(0, 10)
  }
}

export function parseAgora(json: { publications?: AgoraOrganisation[] } | AgoraOrganisation[]): Lobbyist[] {
  const list = Array.isArray(json) ? json : (json.publications ?? [])
  return list.map(summarize).filter((l) => l.name)
}

const lobbyistUrl = (l: Lobbyist): string => (l.id ? `${SITE}/fiche-organisation/?organisation=${encodeURIComponent(l.id)}` : `${SITE}/le-repertoire/`)

export function lobbyistProperties(l: Lobbyist): Record<string, PropValue> {
  return compact({
    hatvp_lobbyist: true,
    hatvp_category: l.category,
    hatvp_registered_at: l.registeredAt,
    hatvp_period: l.period,
    hatvp_lobbying_expenses: l.expenses,
    hatvp_lobbying_staff: l.staff,
    hatvp_lobbying_activities: l.activities || null,
    hatvp_lobbying_topics: l.topics,
    hatvp_lobbying_objects: l.objects,
    hatvp_url: lobbyistUrl(l)
  })
}

export function lobbyingOutput(ctx: Pick<ModuleContext, 'lang'>, list: Lobbyist[], input: Pick<InputEntity, 'label' | 'data'>): ModuleOutput {
  const siren = sirenOf(input)
  const direct = siren ? list.find((l) => l.id?.replace(/\s/g, '') === siren) : undefined
  if (direct) return { properties: lobbyistProperties(direct), raw: { id: direct.id, name: direct.name } }
  const q = normName(input.label)
  const same = q.length >= 3 ? list.filter((l) => l.names.some((n) => normName(n) === q)) : []
  if (!same.length) return { properties: { hatvp_lobbyist: false } }
  return {
    entities: same.slice(0, MAX_CANDIDATES).map((l) => ({
      type: 'company',
      label: l.name,
      data: compact({ siren: l.idType === 'SIREN' ? l.id : null, address: l.address, ...lobbyistProperties(l) }),
      linkLabel: tr(ctx, 'représentant d’intérêts de même nom', 'lobbyist with the same name'),
      review: true,
      reviewReason: tr(
        ctx,
        `même dénomination au répertoire des représentants d’intérêts (${l.idType ?? 'identifiant'} ${l.id ?? '?'}) : vérifiez le SIREN`,
        `same name in the lobbyist register (${l.idType ?? 'id'} ${l.id ?? '?'}): check the SIREN`
      )
    })),
    raw: same.map((l) => ({ id: l.id, name: l.name }))
  }
}

// ---------------------------------------------------------------------------------------------
// Téléchargements (cache 24 h)

const caches = new Map<string, { at: number; data: Promise<unknown> }>()

/** Réinitialise les caches (tests). */
export function resetHatvpCache(): void {
  caches.clear()
}

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const c = caches.get(key)
  if (c && Date.now() - c.at < TTL) return c.data as Promise<T>
  const entry = { at: Date.now(), data: load() as Promise<unknown> }
  caches.set(key, entry)
  entry.data.catch(() => {
    if (caches.get(key) === entry) caches.delete(key)
  })
  return entry.data as Promise<T>
}

export async function download(ctx: ModuleContext, url: string, timeoutMs: number): Promise<string> {
  let last: unknown
  // Le site de la HATVP passe parfois en maintenance (503) : une nouvelle tentative espacée.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await ctx.fetchText(url, { timeoutMs })
      // Page de maintenance servie à la place du fichier.
      if (/^\s*<(!doctype|html)/i.test(text)) throw new ModuleError('HATVP : site en maintenance, fichier indisponible', 'unavailable')
      return text
    } catch (e) {
      last = e
      const status = (e as { status?: number }).status
      if (e instanceof ModuleError || (status && status < 500) || ctx.signal.aborted) break
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw last instanceof ModuleError ? last : serviceError(last, 'HATVP')
}

