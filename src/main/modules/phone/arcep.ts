// ARCEP : opérateur d'attribution d'un numéro du plan de numérotation français (métropole et
// outre-mer), d'après les données ouvertes de l'Arcep : plan de numérotation [MAJNUM] (tranches,
// opérateur attributaire, territoire, date d'attribution) et liste des identifiants de
// communications électroniques (raison sociale, SIRET, RCS, adresse du siège).
//
// Source principale : les CSV officiels de l'Arcep (environ 1,2 Mo et 0,2 Mo), téléchargés une
// seule fois puis gardés en mémoire pour la session (12 h au plus) : chaque numéro suivant est
// résolu sans requête. L'API tabulaire de data.gouv.fr sert les mêmes fichiers ligne par ligne,
// mais elle n'est qu'un repli, car sa version observée le 2026-10-22 :
// - lit les dates JJ/MM/AAAA comme MM/JJ/AAAA quand le jour vaut 12 ou moins (bloc 0612 :
//   « 08/12/2011 » devient 2011-08-12) ;
// - décode le fichier en Windows-1250 (« Trčs Haut Débit ») ;
// - a plusieurs semaines de retard (analyse du 2026-09-15, fichier de l'Arcep du 2026-10-19).
// En repli, seules les dates sans ambiguïté sont gardées et les accents sont corrigés.
//
// L'opérateur d'attribution est celui qui a reçu le bloc de numéros : avec la portabilité,
// l'opérateur qui sert la ligne aujourd'hui peut être différent (voir les modules HLR).

import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max'
import { carrier as libCarrier } from 'libphonenumber-geo-carrier'
import { defineModule, ModuleError, type InputEntity, type ModuleContext, type OutEntity } from '@shared/modules'
import { getPlatform } from '@shared/platforms'
import { compact } from '../email/_lib'
import { carrierPlatform } from './_phone'

const TABULAR = 'https://tabular-api.data.gouv.fr/api/resources'
/** data.gouv.fr : « [MAJNUM] Liste des ressources en numérotation téléphoniques attribuées ». */
export const MAJNUM_RESOURCE = '90e8bdd0-0f5c-47ac-bd39-5f46463eb806'
/** data.gouv.fr : « Identifiants de communications électroniques » (opérateurs). */
export const OPERATORS_RESOURCE = 'b0f62183-cd0c-498d-8153-aa1594e5e8d9'
export const MAJNUM_CSV = 'https://extranet.arcep.fr/uploads/MAJNUM.csv'
export const OPERATORS_CSV = 'https://extranet.arcep.fr/uploads/identifiants_CE.csv'
const CSV_TTL = 12 * 3600_000

export interface ArcepRange {
  /** Bloc `EZABPQM` : 0ZAB, 0ZABP, 0ZABPQ ou 0ZABPQM (`0612`, `069200`...). */
  block: string
  start: string
  end: string
  /** Code Arcep de l'opérateur attributaire (`FRTE`, `SFR0`...). */
  code: string
  territory: string
  /** Date d'attribution, `AAAA-MM-JJ`. */
  date?: string
}

export interface ArcepOperator {
  code: string
  name: string
  siren?: string
  siret?: string
  rcs?: string
  address?: string
  declared?: string
}

type Row = Record<string, unknown>

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

// L'API tabulaire lit ces CSV (Windows-1252) comme du Windows-1250 : « Trčs » au lieu de « Très ».
const FROM_1250 = Array.from('Śśźˇ˘ŁĄŞŻ˛łąşĽ˝ľżŔĂĹĆČĘĚĎĐŃŇŐŘŮŰŢŕăĺćčęěďđńňőřůűţ˙')
const TO_1252 = Array.from('ŒœŸ¡¢£¥ª¯²³¹º¼½¾¿ÀÃÅÆÈÊÌÏÐÑÒÕØÙÛÞàãåæèêìïðñòõøùûþÿ')
const CP1250_FIX = new Map(FROM_1250.map((c, i) => [c, TO_1252[i]]))
const CP1250_RE = new RegExp(`[${FROM_1250.join('')}]`, 'g')

/** Corrige les lettres accentuées mal décodées par l'API tabulaire. */
export function fixEncoding(v: string): string {
  return v.replace(CP1250_RE, (c) => CP1250_FIX.get(c) ?? c)
}

/**
 * Date `JJ/MM/AAAA` des CSV en `AAAA-MM-JJ`. Une date ISO vient de l'API tabulaire, qui a pu
 * inverser jour et mois : elle n'est gardée que si elle est sans ambiguïté (jour > 12, ou jour
 * égal au mois).
 */
export function arcepDate(v: unknown): string | undefined {
  const t = s(v)
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t)
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (!iso) return undefined
  return Number(iso[3]) > 12 || iso[2] === iso[3] ? iso[0] : undefined
}

export function toRange(r: Row): ArcepRange | null {
  const block = s(r.EZABPQM)
  const start = s(r.Tranche_Debut)
  const end = s(r.Tranche_Fin)
  const code = s(r['Mnémo'] ?? r.Mnemo)
  if (!/^\d+$/.test(block) || !/^\d+$/.test(start) || !/^\d+$/.test(end) || !code) return null
  return { block, start, end, code, territory: fixEncoding(s(r.Territoire)), date: arcepDate(r.Date_Attribution) }
}

export function toOperator(r: Row): ArcepOperator | null {
  const code = s(r.CODE_OPERATEUR)
  const name = fixEncoding(s(r.IDENTITE_OPERATEUR))
  if (!code || !name) return null
  // SIRET publié sous la forme « 380129866 48625 » (SIREN, espace, NIC).
  const digits = s(r.SIRET_ACTEUR).replace(/\D/g, '')
  return {
    code,
    name,
    siren: digits.length >= 9 ? digits.slice(0, 9) : undefined,
    siret: digits.length === 14 ? digits : undefined,
    rcs: fixEncoding(s(r.RCS_ACTEUR)).replace(/\s*\/\s*$/, '') || undefined,
    address: fixEncoding(s(r.ADRESSE_COMPLETE_ACTEUR)) || undefined,
    declared: arcepDate(r.DATE_DECLARATION_OPERATEUR)
  }
}

/** Indicatifs couverts par le plan national : métropole, Réunion et Mayotte, Antilles, Guyane. */
const PLAN_CODES = new Set(['33', '262', '590', '594', '596'])

/**
 * Numéro au format national du plan Arcep (`0612345678`, `0692...` pour la Réunion,
 * `0508...` pour Saint-Pierre-et-Miquelon), ou null hors de ce plan.
 */
export function arcepNational(p: PhoneNumber): string | null {
  const nn = String(p.nationalNumber)
  const cc = String(p.countryCallingCode)
  if (cc === '508') return /^\d{6}$/.test(nn) ? `0508${nn}` : null
  if (!PLAN_CODES.has(cc)) return null
  // 9 chiffres, ou 13 pour les numéros machine à machine (07 00 sur 14 chiffres).
  return /^(\d{9}|\d{13})$/.test(nn) ? `0${nn}` : null
}

/** Blocs candidats : les préfixes du numéro de 4 à 9 chiffres (0ZAB à 0ZABPQMCD). */
export function blockCandidates(national: string): string[] {
  const out: string[] = []
  for (let n = 4; n < national.length && n <= 9; n++) out.push(national.slice(0, n))
  return out
}

/** Tranche qui contient le numéro (la plus précise si plusieurs conviennent). */
export function matchRange(national: string, ranges: ArcepRange[]): ArcepRange | null {
  return (
    ranges
      .filter((r) => national.startsWith(r.block) && r.start.length === national.length && r.start <= national && national <= r.end)
      .sort((a, b) => b.block.length - a.block.length)[0] ?? null
  )
}

/** Type de numéro d'après le plan national (chiffre Z). */
export function numberType(national: string, lang: 'fr' | 'en'): string {
  const fr = lang === 'fr'
  const z = national.charAt(1)
  if ('12345'.includes(z)) return fr ? 'Fixe (géographique)' : 'Landline (geographic)'
  if (z === '6' || z === '7') return national.length > 10 ? (fr ? 'Mobile (machine à machine)' : 'Mobile (machine-to-machine)') : 'Mobile'
  if (z === '8') return national.startsWith('080') ? (fr ? 'Numéro gratuit (080)' : 'Toll-free (080)') : fr ? 'Numéro spécial (08)' : 'Special-rate number (08)'
  if (z === '9') return fr ? 'Fixe non géographique (box, VoIP)' : 'Non-geographic landline (box, VoIP)'
  return fr ? 'Inconnu' : 'Unknown'
}

/** Lignes d'un CSV `;` à guillemets (format des exports de l'Arcep). */
export function parseCsv(text: string): Row[] {
  const split = (line: string): string[] => {
    const cells: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quoted) {
        if (c !== '"') cur += c
        else if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else if (c === '"') quoted = true
      else if (c === ';') {
        cells.push(cur)
        cur = ''
      } else cur += c
    }
    cells.push(cur)
    return cells
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const header = split(lines[0] ?? '').map((h) => h.trim())
  return lines.slice(1).map((l) => {
    const cells = split(l)
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))
  })
}

// ---------------------------------------------------------------------------
// Sources

export interface ArcepLookup {
  range: ArcepRange | null
  operator: ArcepOperator | null
  /** `arcep.fr` : CSV officiels ; `data.gouv.fr` : API tabulaire (repli). */
  source: 'arcep.fr' | 'data.gouv.fr'
}

interface Tables {
  ranges: Map<string, ArcepRange>
  operators: Map<string, ArcepOperator>
}

let csvCache: { at: number; tables: Promise<Tables> } | null = null
/** Opérateurs déjà lus sur l'API tabulaire (quelques centaines au plus). */
const operatorCache = new Map<string, ArcepOperator | null>()

export function resetArcepCache(): void {
  csvCache = null
  operatorCache.clear()
}

async function tabularRows(ctx: ModuleContext, resource: string, query: Record<string, string>): Promise<Row[]> {
  const res = await ctx.fetchJson<{ data?: unknown }>(`${TABULAR}/${resource}/data/`, { query: { ...query, page_size: 20 }, timeoutMs: 20_000 })
  if (!Array.isArray(res.data)) throw new Error('réponse inattendue')
  return res.data.filter((r): r is Row => !!r && typeof r === 'object')
}

async function tabularLookup(ctx: ModuleContext, national: string): Promise<ArcepLookup> {
  const rows = await tabularRows(ctx, MAJNUM_RESOURCE, { EZABPQM__in: blockCandidates(national).join(',') })
  const range = matchRange(national, rows.map(toRange).filter((r): r is ArcepRange => !!r))
  if (!range) return { range: null, operator: null, source: 'data.gouv.fr' }
  let operator = operatorCache.get(range.code)
  if (operator === undefined) {
    const ops = await tabularRows(ctx, OPERATORS_RESOURCE, { CODE_OPERATEUR__exact: range.code })
    operator = ops.map(toOperator).find((o) => o?.code === range.code) ?? null
    operatorCache.set(range.code, operator)
  }
  return { range, operator, source: 'data.gouv.fr' }
}

/** CSV officiels de l'Arcep, téléchargés une fois et gardés en mémoire pour la session. */
function csvTables(ctx: ModuleContext): Promise<Tables> {
  if (csvCache && Date.now() - csvCache.at < CSV_TTL) return csvCache.tables
  const get = async (url: string): Promise<string> => {
    const res = await ctx.fetch(url, { timeoutMs: 90_000, headers: { accept: 'text/csv' } })
    if (!res.ok) throw new ModuleError(`ARCEP : fichier indisponible (HTTP ${res.status})`, 'unavailable')
    return new TextDecoder('windows-1252').decode(await res.arrayBuffer())
  }
  const tables = Promise.all([get(MAJNUM_CSV), get(OPERATORS_CSV)]).then(([num, ops]) => {
    const ranges = new Map<string, ArcepRange>()
    for (const r of parseCsv(num).map(toRange)) if (r) ranges.set(r.block, r)
    const operators = new Map<string, ArcepOperator>()
    for (const o of parseCsv(ops).map(toOperator)) if (o) operators.set(o.code, o)
    if (!ranges.size) throw new ModuleError('ARCEP : plan de numérotation illisible', 'unavailable')
    return { ranges, operators }
  })
  csvCache = { at: Date.now(), tables }
  // Un échec (ou une annulation) ne doit pas rester en cache.
  tables.catch(() => {
    if (csvCache?.tables === tables) csvCache = null
  })
  return tables
}

async function csvLookup(ctx: ModuleContext, national: string): Promise<ArcepLookup> {
  const t = await csvTables(ctx)
  const candidates = blockCandidates(national)
    .map((b) => t.ranges.get(b))
    .filter((r): r is ArcepRange => !!r)
  const range = matchRange(national, candidates)
  return { range, operator: range ? (t.operators.get(range.code) ?? null) : null, source: 'arcep.fr' }
}

/** Recherche dans le plan de numérotation : CSV de l'Arcep (en cache), sinon API tabulaire. */
export async function arcepLookup(ctx: ModuleContext, national: string): Promise<ArcepLookup> {
  try {
    return await csvLookup(ctx, national)
  } catch (e) {
    if (ctx.signal.aborted) throw e
    ctx.log(`CSV de l'Arcep indisponibles (${e instanceof Error ? e.message : String(e)}), repli sur l'API tabulaire data.gouv.fr`)
  }
  try {
    return await tabularLookup(ctx, national)
  } catch (e) {
    if (ctx.signal.aborted) throw e
    throw new ModuleError(`ARCEP : données indisponibles (${e instanceof Error ? e.message : String(e)})`, 'unavailable')
  }
}

// ---------------------------------------------------------------------------
// Nœud opérateur

/** Codes Arcep dont la raison sociale ne donne pas la marque connue. */
const ARCEP_PLATFORMS: Record<string, string> = {
  SFR0: 'sfr',
  SRR: 'sfr',
  OUTR: 'sfr_caraibe',
  TELC: 'only',
  LPTL: 'laposte_mobile'
}

const norm = (v: string): string =>
  v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

/**
 * L'opérateur de libphonenumber (nœud créé par phone.info) est-il l'attributaire Arcep ?
 * Même plateforme, ou noms qui se recouvrent (« Prixtel », « Euroinformation Telecom »).
 */
export function sameCarrier(libName: string | null | undefined, arcepName: string, arcepPlatform: string | undefined): boolean {
  if (!libName) return false
  const lp = carrierPlatform(libName)
  if (lp && arcepPlatform) return lp === arcepPlatform
  const a = norm(libName)
  const b = norm(arcepName)
  return a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))
}

/**
 * Libellé et plateforme du nœud opérateur. Quand phone.info a déjà créé ce nœud (même
 * opérateur), on reprend exactement son libellé et sa plateforme : le moteur enrichit alors
 * ce nœud au lieu d'en créer un second.
 */
export function carrierNode(code: string, arcepName: string, libName: string | null | undefined): { label: string; platform?: string } {
  const own = ARCEP_PLATFORMS[code] ?? carrierPlatform(arcepName)
  if (libName && sameCarrier(libName, arcepName, own)) return { label: libName, platform: carrierPlatform(libName) }
  const brand = ARCEP_PLATFORMS[code] ? getPlatform(own)?.name : undefined
  return { label: brand ?? arcepName, platform: own }
}

function parseInput(input: InputEntity): PhoneNumber | null {
  for (const raw of [input.label, String(input.data.e164 ?? '')]) {
    const p = raw.trim() ? parsePhoneNumberFromString(raw.trim(), 'FR') : undefined
    if (p) return p
  }
  return null
}

export default defineModule({
  id: 'phone.arcep',
  name: { fr: "Opérateur d'attribution (ARCEP)", en: 'Assigning carrier (ARCEP)' },
  description: {
    fr: "Cherche le numéro dans le plan de numérotation de l'Arcep : bloc, opérateur à qui le bloc a été attribué (raison sociale, SIRET, adresse du siège), date d'attribution, territoire et type de numéro. Numéros français, métropole et outre-mer. Avec la portabilité, l'opérateur actuel peut être différent. Données ouvertes, sans clé.",
    en: 'Looks the number up in the Arcep (French regulator) numbering plan: block, carrier the block was assigned to (legal name, SIRET, head office address), assignment date, territory and number type. French numbers, mainland and overseas. Because of number portability, the current carrier may differ. Open data, no key.'
  },
  category: 'phone',
  inputTypes: ['phone'],
  homepage: 'https://www.data.gouv.fr/fr/datasets/ressources-en-numerotation-telephonique/',
  timeoutMs: 180_000,
  accepts: (input) => {
    // Un numéro partiel (`06 12 34 56 *8`) relève de roso.partial_number.
    if (input.label.includes('*')) return false
    const p = parseInput(input)
    return !!p && !!arcepNational(p)
  },
  async run(input, ctx) {
    const fr = ctx.lang === 'fr'
    const p = parseInput(input)
    const national = p ? arcepNational(p) : null
    if (!p || !national)
      throw new ModuleError(fr ? 'Numéro hors du plan de numérotation français' : 'Number outside the French numbering plan', 'invalid_input')

    const found = await arcepLookup(ctx, national)
    const type = numberType(national, ctx.lang)
    const raw = { national, candidates: blockCandidates(national), ...found }
    const { range, operator } = found
    // Aucun bloc : numéro jamais attribué (ou bloc rendu à l'Arcep), utile pour repérer un faux numéro.
    if (!range) return { properties: { arcep_attributed: false, arcep_number_type: type }, raw }

    const arcepName = operator?.name ?? range.code
    const libName = await libCarrier(p, 'en').catch(() => null)
    const node = carrierNode(range.code, arcepName, libName)
    const entities: OutEntity[] = [
      {
        type: 'carrier',
        label: node.label,
        platform: node.platform,
        data: compact({
          registered_name: operator?.name,
          arcep_code: range.code,
          siren: operator?.siren,
          siret: operator?.siret,
          rcs: operator?.rcs,
          registered_address: operator?.address,
          arcep_declaration_date: operator?.declared,
          source: 'ARCEP'
        }),
        linkLabel: fr ? "opérateur d'attribution (ARCEP)" : 'assigning carrier (ARCEP)'
      }
    ]

    return {
      properties: compact({
        arcep_attributed: true,
        arcep_block: range.block,
        arcep_range: `${range.start} ${fr ? 'à' : 'to'} ${range.end}`,
        arcep_operator: arcepName,
        arcep_operator_code: range.code,
        arcep_territory: range.territory || undefined,
        arcep_attribution_date: range.date,
        arcep_number_type: type
      }),
      entities,
      raw
    }
  }
})
