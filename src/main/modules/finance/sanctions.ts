// Listes de sanctions et de gel des avoirs : registre national des gels de la DG Trésor,
// liste consolidée de l'Union européenne et liste SDN de l'OFAC. Les trois listes sont
// téléchargées une fois (environ 45 Mo), indexées puis gardées en mémoire 24 h.

import { defineModule, ModuleError, type InputEntity, type ModuleContext } from '@shared/modules'
import { serviceError } from '../misc/_util'
import { parsePartialDate } from '../person/frDirigeants'
import { splitName } from '../person/_name'
import {
  buildIndex,
  detach,
  matchDomainMail,
  matchExact,
  matchMailDomain,
  matchNames,
  parseEuXml,
  parseGels,
  parseOfac,
  sanctionsOutput,
  SOURCE_LABELS,
  type GelsJson,
  type SanctionEntry,
  type SanctionHit,
  type SanctionsIndex,
  type SanctionSource
} from './_sanctions'

const GELS_URL = 'https://gels-avoirs.dgtresor.gouv.fr/ApiPublic/api/v1/publication/derniere-publication-flux-json'
// Jeton public publié par la Commission avec le lien de téléchargement.
const EU_URL = 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw'
const OFAC_SDN = 'https://www.treasury.gov/ofac/downloads/sdn.csv'
const OFAC_ALT = 'https://www.treasury.gov/ofac/downloads/alt.csv'
const OFAC_COMMENTS = 'https://www.treasury.gov/ofac/downloads/sdn_comments.csv'
// Le registre des gels exige un User-Agent : celui de l'outil, sans donnée personnelle.
const USER_AGENT = 'MASINT (https://github.com/mateo-brl/masint)'
const TTL = 24 * 3600 * 1000

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

/** Téléchargement texte avec une nouvelle tentative espacée (hôtes publics parfois coupés). */
async function download(ctx: ModuleContext, url: string, service: string, timeoutMs: number): Promise<string> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ctx.fetchText(url, { timeoutMs, headers: { 'user-agent': USER_AGENT, accept: '*/*' } })
    } catch (e) {
      last = e
      const status = (e as { status?: number }).status
      if ((status && status < 500 && status !== 429) || ctx.signal.aborted) break
      await sleep(2000 * (attempt + 1), ctx.signal)
    }
  }
  throw serviceError(last, service)
}

const LOADERS: Record<SanctionSource, (ctx: ModuleContext) => Promise<SanctionEntry[]>> = {
  fr: async (ctx) => {
    const json = JSON.parse(await download(ctx, GELS_URL, 'Registre national des gels', 120000)) as GelsJson
    const entries = parseGels(json)
    if (!entries.length) throw new ModuleError('Registre national des gels : publication vide ou illisible', 'unavailable')
    return detach(entries)
  },
  eu: async (ctx) => {
    const xml = await download(ctx, EU_URL, 'Liste consolidée de l’UE', 180000)
    const entries = parseEuXml(xml)
    if (!entries.length) throw new ModuleError('Liste consolidée de l’UE : fichier illisible', 'unavailable')
    return detach(entries)
  },
  ofac: async (ctx) => {
    const [sdn, alt, comments] = await Promise.all([
      download(ctx, OFAC_SDN, 'OFAC', 120000),
      download(ctx, OFAC_ALT, 'OFAC', 90000).catch(() => ''),
      download(ctx, OFAC_COMMENTS, 'OFAC', 90000).catch(() => '')
    ])
    const entries = parseOfac(sdn, alt, comments)
    if (!entries.length) throw new ModuleError('OFAC : liste SDN illisible', 'unavailable')
    return detach(entries)
  }
}

const SOURCES: SanctionSource[] = ['fr', 'eu', 'ofac']

// Cache par liste (24 h) et index commun reconstruit quand une liste change.
const lists = new Map<SanctionSource, { at: number; entries: Promise<SanctionEntry[]> }>()
let indexCache: { key: string; index: SanctionsIndex } | null = null

/** Réinitialise les caches (tests). */
export function resetSanctionsCache(): void {
  lists.clear()
  indexCache = null
}

function loadList(ctx: ModuleContext, source: SanctionSource): { at: number; entries: Promise<SanctionEntry[]> } {
  const cached = lists.get(source)
  if (cached && Date.now() - cached.at < TTL) return cached
  const entry = { at: Date.now(), entries: LOADERS[source](ctx) }
  lists.set(source, entry)
  entry.entries.catch(() => {
    if (lists.get(source) === entry) lists.delete(source)
  })
  return entry
}

async function loadIndex(
  ctx: ModuleContext,
  sources: SanctionSource[]
): Promise<{ index: SanctionsIndex; loaded: SanctionSource[]; failed: Array<{ source: SanctionSource; error: unknown }> }> {
  let done = 0
  const label = (s: SanctionSource): string => SOURCE_LABELS[s][ctx.lang]
  ctx.progress(0, sources.length, label(sources[0]))
  const settled = await Promise.all(
    sources.map(async (source) => {
      const l = loadList(ctx, source)
      try {
        const entries = await l.entries
        return { source, at: l.at, entries }
      } catch (error) {
        return { source, at: 0, entries: null, error }
      } finally {
        ctx.progress(++done, sources.length, label(source))
      }
    })
  )
  const ok = settled.filter((s): s is { source: SanctionSource; at: number; entries: SanctionEntry[] } => !!s.entries)
  const key = ok.map((s) => `${s.source}:${s.at}`).join('|')
  if (!indexCache || indexCache.key !== key) indexCache = { key, index: buildIndex(ok.flatMap((s) => s.entries)) }
  return {
    index: indexCache.index,
    loaded: ok.map((s) => s.source),
    failed: settled.filter((s) => !s.entries).map((s) => ({ source: s.source, error: (s as { error?: unknown }).error }))
  }
}

/** Noms à comparer : libellé, prénom et nom de la fiche, alias connus. */
export function queryNames(input: Pick<InputEntity, 'type' | 'label' | 'data'>): string[] {
  const names = [input.label]
  if (input.type === 'person') {
    const n = splitName(input)
    if (n) names.push(`${n.firstNames.join(' ')} ${n.lastName}`)
  }
  const aliases = input.data.aliases
  if (Array.isArray(aliases)) names.push(...aliases.filter((a): a is string => typeof a === 'string'))
  for (const k of ['name', 'registered_name']) if (typeof input.data[k] === 'string') names.push(input.data[k] as string)
  return Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)))
}

/** Identifiants d'une entreprise ou d'une organisation à chercher tels quels dans les listes. */
export function queryIdentifiers(input: Pick<InputEntity, 'type' | 'label' | 'data'>): string[] {
  const out: string[] = []
  for (const k of ['siren', 'company_number', 'registration_number', 'vat', 'lei', 'bic', 'imo', 'ogrn', 'inn', 'tax_id']) {
    const v = input.data[k]
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v))
  }
  if (/^[A-Z0-9 .\-/]{6,}$/i.test(input.label.trim()) && /\d{4}/.test(input.label)) out.push(input.label.trim())
  return out
}

export default defineModule({
  id: 'finance.sanctions',
  name: { fr: 'Sanctions et gel des avoirs (France, UE, OFAC)', en: 'Sanctions and asset freezes (France, EU, OFAC)' },
  description: {
    fr: 'Cherche la personne, l’entreprise, l’organisation, le courriel, le site, le numéro ou le portefeuille dans le registre national des gels (DG Trésor), la liste consolidée de l’UE et la liste SDN de l’OFAC (pour les portefeuilles : registre et UE, l’OFAC étant couvert par « Sanctions OFAC »). Courriel, site, téléphone, identifiant ou nom et date de naissance identiques : inscription ajoutée au graphe avec motifs, fondements et références. Simple homonymie : mise de côté dans « À vérifier » ; dates de naissance incompatibles écartées. Listes (45 Mo) gardées en cache 24 h.',
    en: 'Looks the person, company, organization, email, website, phone number or wallet up in the French national asset freeze register (DG Trésor), the EU consolidated list and the OFAC SDN list (wallets: register and EU only, OFAC being covered by "OFAC sanctions"). Identical email, website, phone, identifier, or name and birth date: listing added to the graph with reasons, legal bases and references. Name-only matches are put aside in "To review"; inconsistent birth dates are dropped. Lists (45 MB) cached for 24 h.'
  },
  category: 'finance',
  inputTypes: ['person', 'company', 'organization', 'email', 'phone', 'domain', 'website', 'crypto_wallet'],
  homepage: 'https://gels-avoirs.dgtresor.gouv.fr/',
  timeoutMs: 300000,
  async run(input, ctx) {
    const sources: SanctionSource[] = input.type === 'crypto_wallet' ? ['fr', 'eu'] : SOURCES
    const { index, loaded, failed } = await loadIndex(ctx, sources)
    if (!loaded.length) {
      const first = failed[0]?.error
      throw first instanceof ModuleError ? first : serviceError(first, 'Listes de sanctions')
    }
    for (const f of failed) ctx.log(`${f.source} indisponible : ${f.error instanceof Error ? f.error.message : String(f.error)}`)

    const direct: SanctionHit[] = []
    const review: SanctionHit[] = []
    let excluded = 0
    const value = typeof input.data.e164 === 'string' && input.type === 'phone' ? input.data.e164 : input.label

    if (['person', 'company', 'organization'].includes(input.type)) {
      const entity = input.type !== 'person'
      const ids = entity ? queryIdentifiers(input) : []
      direct.push(...matchExact(index, input.type, '', ids))
      // Site et courriel déjà connus de la fiche : correspondances exactes.
      for (const [key, type] of [['website', 'website'], ['domain', 'domain'], ['email', 'email']] as const) {
        const v = input.data[key]
        if (typeof v === 'string' && v.trim()) for (const h of matchExact(index, type, v)) if (!direct.some((d) => d.entry === h.entry)) direct.push(h)
      }
      const names = matchNames(index, {
        names: queryNames(input),
        entity,
        birth: entity ? null : parsePartialDate(input.data.birth_date)
      })
      excluded = names.excluded.length
      for (const h of names.hits) (h.basis === 'name_birth' ? direct : review).push(h)
    } else {
      direct.push(...matchExact(index, input.type, value))
      if (input.type === 'email') review.push(...matchMailDomain(index, value))
      if (input.type === 'domain' || input.type === 'website') review.push(...matchDomainMail(index, value))
    }

    return sanctionsOutput(
      { direct, review, excluded },
      input.type,
      loaded,
      ctx.lang,
      failed.map((f) => f.source)
    )
  }
})
