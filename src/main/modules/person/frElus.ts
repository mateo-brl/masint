// Mandats électifs locaux d'une personne : collectivités où elle figure parmi les élus
// (Répertoire national des élus, repris par l'API Recherche d'entreprises, sans clé).
// Le répertoire publie le mois de naissance : il sert à départager les homonymes.

import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import { compact, httpStatus } from '../social/_lib'
import { legalFormLabel } from '../company/_fr'
import type { ReElu } from '../company/_complements'
import { birthRange, parsePartialDate, type PartialDate } from './frDirigeants'
import { fold, splitName, type PersonName } from './_name'

const API = 'https://recherche-entreprises.api.gouv.fr/search'
const PER_PAGE = 25
const MAX_COLLECTIVITES = 10

export interface ReCollectivite {
  siren: string
  nom_complet: string
  nature_juridique?: string | null
  siege?: { adresse?: string | null; latitude?: string | null; longitude?: string | null } | null
  complements?: { collectivite_territoriale?: { code?: string | null; niveau?: string | null; elus?: ReElu[] | null } | null } | null
}

interface ReResponse {
  results: ReCollectivite[]
  total_results: number
}

/** L'élu porte-t-il le nom cherché (nom identique, premier prénom présent) ? */
export function matchesElu(e: ReElu, name: PersonName): boolean {
  const words = (s: string): string[] => fold(s).split(/[\s,'-]+/).filter(Boolean)
  const nom = words(e.nom ?? '').join(' ')
  const prenoms = words(e.prenoms ?? '')
  return !!nom && nom === words(name.lastName).join(' ') && words(name.firstNames[0] ?? '').every((p) => prenoms.includes(p))
}

export type EluVerdict = 'confirmed' | 'possible' | 'excluded'

/** Mois de naissance publié (`1977-12`) comparé à la date connue. */
export function eluVerdict(e: ReElu, birth: PartialDate | null | undefined): EluVerdict {
  const born = parsePartialDate(e.annee_de_naissance)
  if (!birth || !born) return 'possible'
  if (born.year !== birth.year) return 'excluded'
  if (born.month && birth.month) return born.month === birth.month ? 'confirmed' : 'excluded'
  return 'possible'
}

export interface Mandate {
  collectivite: ReCollectivite
  elu: ReElu
  verdict: EluVerdict
}

/** Mandats trouvés, sans les incompatibles, une collectivité au plus une fois. */
export function selectMandates(results: ReCollectivite[], name: PersonName, birth?: PartialDate | null): { kept: Mandate[]; excluded: Mandate[] } {
  const kept: Mandate[] = []
  const excluded: Mandate[] = []
  const seen = new Set<string>()
  for (const c of results) {
    if (seen.has(c.siren)) continue
    seen.add(c.siren)
    for (const elu of c.complements?.collectivite_territoriale?.elus ?? []) {
      if (!matchesElu(elu, name)) continue
      const m = { collectivite: c, elu, verdict: eluVerdict(elu, birth) }
      ;(m.verdict === 'excluded' ? excluded : kept).push(m)
      break
    }
  }
  kept.sort((a, b) => Number(b.verdict === 'confirmed') - Number(a.verdict === 'confirmed') || Number(!!b.elu.fonction) - Number(!!a.elu.fonction))
  return { kept, excluded }
}

const monthYear = (s: string | null | undefined): string | null => {
  const d = parsePartialDate(s)
  return d ? (d.month ? `${String(d.month).padStart(2, '0')}/${d.year}` : String(d.year)) : null
}

export function mandateEntity(m: Mandate, distinctBirths: string[], lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const c = m.collectivite
  const born = monthYear(m.elu.annee_de_naissance)
  const lat = Number(c.siege?.latitude)
  const lon = Number(c.siege?.longitude)
  const others = distinctBirths.filter((b) => b !== born)
  return {
    type: 'administration',
    label: c.nom_complet,
    data: compact({
      siren: c.siren,
      legal_form: legalFormLabel(c.nature_juridique) ?? undefined,
      address: c.siege?.adresse ?? undefined,
      lat: Number.isFinite(lat) && c.siege?.latitude ? lat : undefined,
      lon: Number.isFinite(lon) && c.siege?.longitude ? lon : undefined,
      url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${c.siren}`
    }),
    linkLabel: [fr ? 'élu de' : 'elected to', m.elu.fonction, born ? `${fr ? 'né(e)' : 'born'} ${born}` : null].filter(Boolean).join(' · '),
    ...(m.verdict === 'confirmed'
      ? {}
      : {
          review: true,
          reviewReason: fr
            ? `homonyme possible : même nom et prénom${born ? `, élu(e) né(e) en ${born}` : ''}${others.length ? ` ; ce nom désigne aussi un(e) élu(e) né(e) en ${others.join(', ')}` : ''} ; ajoutez la date de naissance à la fiche pour départager`
            : `possible namesake: same name${born ? `, elected official born ${born}` : ''}${others.length ? `; this name also matches an official born ${others.join(', ')}` : ''}; add the birth date to the record to tell them apart`
        })
  }
}

async function search(ctx: ModuleContext, name: PersonName, birth?: PartialDate | null): Promise<ReResponse> {
  const query = { nom_personne: name.lastName, prenoms_personne: name.firstNames[0], type_personne: 'elu', ...birthRange(birth), per_page: PER_PAGE, page: 1 }
  let last: unknown
  // Le service coupe parfois la connexion : deux nouvelles tentatives espacées.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ctx.fetchJson<ReResponse>(API, { query, timeoutMs: 25000 })
    } catch (e) {
      last = e
      const status = httpStatus(e)
      if (status === 429) throw new ModuleError('recherche-entreprises : trop de requêtes', 'rate_limited')
      if (status && status < 500) throw e
      if (ctx.signal.aborted) break
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw new ModuleError(`recherche-entreprises injoignable : ${last instanceof Error ? last.message : String(last)}`, 'unavailable')
}

export default defineModule({
  id: 'person.fr_elus',
  name: { fr: 'Mandats d’élu local (France)', en: 'Local elected offices (France)' },
  description: {
    fr: 'Cherche la personne parmi les élus des collectivités (communes, intercommunalités, départements, régions) d’après le Répertoire national des élus, via l’API Recherche d’entreprises (sans clé) : collectivité, fonction et mois de naissance publié. Mois de naissance concordant : mandat ajouté au graphe ; sinon, mis de côté dans « À vérifier » (homonyme possible). Les mandats incompatibles avec la date de naissance connue sont écartés.',
    en: 'Looks the person up among local authority elected officials (municipalities, inter-municipal bodies, departments, regions) from the national register of elected officials, through the government Company Search API (no key): authority, role and published birth month. Matching birth month: office added to the graph; otherwise put aside in "To review" (possible namesake). Offices inconsistent with the known birth date are dropped.'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1',
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const birth = parsePartialDate(input.data.birth_date)
    const res = await search(ctx, name, birth)
    const { kept, excluded } = selectMandates(res.results ?? [], name, birth)
    const births = Array.from(new Set(kept.map((m) => monthYear(m.elu.annee_de_naissance)).filter((b): b is string => !!b)))
    return {
      entities: kept.slice(0, MAX_COLLECTIVITES).map((m) => mandateEntity(m, births, ctx.lang)),
      properties: compact({
        elected_offices_count: kept.length || undefined,
        elected_offices_excluded: excluded.length || undefined
      }),
      raw: {
        total_results: res.total_results,
        kept: kept.map((m) => ({ siren: m.collectivite.siren, nom: m.collectivite.nom_complet, fonction: m.elu.fonction, naissance: m.elu.annee_de_naissance, verdict: m.verdict })),
        excluded: excluded.map((m) => ({ siren: m.collectivite.siren, nom: m.collectivite.nom_complet }))
      }
    }
  }
})
