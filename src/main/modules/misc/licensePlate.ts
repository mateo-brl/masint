// Analyse locale d'une plaque d'immatriculation : format (SIV, FNI...), pays probable et
// informations déductibles du numéro (département FNI, région et période britanniques,
// canton suisse, ville allemande, série néerlandaise). Aucun service tiers n'est interrogé.

import { defineModule, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { compact, tr } from './_util'
import { countryName } from '../finance/iban'

export interface PlateMatch {
  country: string
  format: { fr: string; en: string }
  details: Record<string, string | boolean>
}

const DEPARTEMENTS: Record<string, string> = {
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes',
  '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron', '13': 'Bouches-du-Rhône',
  '14': 'Calvados', '15': 'Cantal', '16': 'Charente', '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '20': 'Corse',
  '2A': 'Corse-du-Sud', '2B': 'Haute-Corse', '21': "Côte-d'Or", '22': "Côtes-d'Armor", '23': 'Creuse', '24': 'Dordogne',
  '25': 'Doubs', '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne',
  '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre', '37': 'Indre-et-Loire', '38': 'Isère',
  '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique',
  '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère', '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne',
  '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle',
  '58': 'Nièvre', '59': 'Nord', '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme',
  '64': 'Pyrénées-Atlantiques', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin',
  '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie',
  '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines', '79': 'Deux-Sèvres', '80': 'Somme',
  '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne',
  '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort', '91': 'Essonne', '92': 'Hauts-de-Seine',
  '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': "Val-d'Oise", '971': 'Guadeloupe', '972': 'Martinique',
  '973': 'Guyane', '974': 'La Réunion', '975': 'Saint-Pierre-et-Miquelon', '976': 'Mayotte'
}

const CANTONS: Record<string, string> = {
  AG: 'Argovie', AI: 'Appenzell Rhodes-Intérieures', AR: 'Appenzell Rhodes-Extérieures', BE: 'Berne', BL: 'Bâle-Campagne',
  BS: 'Bâle-Ville', FR: 'Fribourg', GE: 'Genève', GL: 'Glaris', GR: 'Grisons', JU: 'Jura', LU: 'Lucerne', NE: 'Neuchâtel',
  NW: 'Nidwald', OW: 'Obwald', SG: 'Saint-Gall', SH: 'Schaffhouse', SO: 'Soleure', SZ: 'Schwytz', TG: 'Thurgovie',
  TI: 'Tessin', UR: 'Uri', VD: 'Vaud', VS: 'Valais', ZG: 'Zoug', ZH: 'Zurich'
}

// Indicatifs allemands des grandes villes (liste non exhaustive).
const DE_CITIES: Record<string, string> = {
  B: 'Berlin', M: 'München', HH: 'Hamburg', K: 'Köln', F: 'Frankfurt am Main', S: 'Stuttgart', D: 'Düsseldorf',
  HB: 'Bremen', H: 'Hannover', L: 'Leipzig', DD: 'Dresden', N: 'Nürnberg', E: 'Essen', DO: 'Dortmund'
}

// Première lettre des plaques britanniques depuis 2001 : région d'immatriculation (DVLA).
const UK_REGIONS: Record<string, string> = {
  A: 'Anglia', B: 'Birmingham', C: 'Cymru (Wales)', D: 'Deeside', E: 'Essex', F: 'Forest and Fens', G: 'Garden of England',
  H: 'Hampshire and Dorset', K: 'Milton Keynes / Northampton', L: 'London', M: 'Manchester and Merseyside', N: 'North',
  O: 'Oxford', P: 'Preston', R: 'Reading', S: 'Scotland', V: 'Severn Valley', W: 'West of England', Y: 'Yorkshire'
}

/** Période d'immatriculation britannique d'après l'identifiant d'âge (2 chiffres). */
export function ukPeriod(digits: string): { fr: string; en: string } {
  const n = Number(digits)
  if (n >= 51 || n === 0) {
    const y = n === 0 ? 2050 : 2000 + n - 50
    return { fr: `septembre ${y} à février ${y + 1}`, en: `September ${y} to February ${y + 1}` }
  }
  const y = 2000 + n
  return { fr: `mars à août ${y}`, en: `March to August ${y}` }
}

const SIV = /^([A-HJ-NP-TV-Z]{2})-?(\d{3})-?([A-HJ-NP-TV-Z]{2})$/
const FNI = /^(\d{1,4})-?([A-HJ-NP-Z]{1,3})-?(\d{2}|2A|2B|97[1-6])$/
const IT = /^[A-HJ-NPR-TV-Z]{2}\d{3}[A-HJ-NPR-TV-Z]{2}$/
const ES = /^\d{4}-?[BCDFGHJKLMNPRSTVWXYZ]{3}$/
const BE = /^[1-9]-?[A-Z]{3}-?\d{3}$/
const DE = /^([A-ZÄÖÜ]{1,3})[-\s]([A-Z]{1,2})\s?(\d{1,4})([EH]?)$/
const UK = /^([A-HJ-PR-Y])([A-HJ-PR-Y])(\d{2})\s?([A-HJ-PR-Z]{3})$/
const CH = /^([A-Z]{2})\s?(\d{1,6})$/

// Séries néerlandaises (« sidecodes ») : lettres (L) et chiffres (D) sur six caractères, en
// trois groupes. La forme sans tiret suffit à retrouver la série, toutes sont distinctes.
const NL_SIDECODES: Array<[string, number[]]> = [
  ['LLDDDD', [2, 2, 2]],
  ['DDDDLL', [2, 2, 2]],
  ['DDLLDD', [2, 2, 2]],
  ['LLDDLL', [2, 2, 2]],
  ['LLLLDD', [2, 2, 2]],
  ['DDLLLL', [2, 2, 2]],
  ['DDLLLD', [2, 3, 1]],
  ['DLLLDD', [1, 3, 2]],
  ['LLDDDL', [2, 3, 1]],
  ['LDDDLL', [1, 3, 2]],
  ['LLLDDL', [3, 2, 1]],
  ['LDDLLL', [1, 2, 3]],
  ['DLLDDD', [1, 2, 3]],
  ['DDDLLD', [3, 2, 1]]
]

/**
 * Plaque néerlandaise plausible : `{ kenteken: '54JSG5', formatted: '54-JSG-5', sidecode: 7 }`
 * (le `kenteken` est la forme attendue par le RDW : majuscules, sans tiret), sinon `null`.
 */
export function dutchPlate(raw: string): { kenteken: string; formatted: string; sidecode: number } | null {
  const bare = raw.trim().toUpperCase().replace(/^NL[\s-]+/, '').replace(/[\s.-]/g, '')
  if (!/^[A-Z0-9]{6}$/.test(bare)) return null
  const shape = bare.replace(/[A-Z]/g, 'L').replace(/\d/g, 'D')
  const i = NL_SIDECODES.findIndex(([s]) => s === shape)
  if (i < 0) return null
  // Pas de voyelle dans les séries récentes (depuis 1978) : on écarte les combinaisons avec voyelle.
  if (i >= 3 && /[AEIOU]/.test(bare)) return null
  const [a, b] = NL_SIDECODES[i][1]
  return { kenteken: bare, formatted: `${bare.slice(0, a)}-${bare.slice(a, a + b)}-${bare.slice(a + b)}`, sidecode: i + 1 }
}

export function analyzePlate(raw: string): { normalized: string; matches: PlateMatch[] } {
  const spaced = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  const dashed = spaced.replace(/[\s.]/g, '-').replace(/-+/g, '-')
  const bare = dashed.replace(/-/g, '')
  const matches: PlateMatch[] = []

  let m = dashed.match(SIV) ?? bare.match(SIV)
  if (m) {
    matches.push({
      country: 'FR',
      format: { fr: 'SIV (depuis 2009)', en: 'SIV (since 2009)' },
      details: m[1] === 'WW' ? { temporary: true } : {}
    })
  }
  m = dashed.match(FNI)
  if (m && DEPARTEMENTS[m[3]]) {
    matches.push({
      country: 'FR',
      format: { fr: 'FNI (1950 à 2009)', en: 'FNI (1950 to 2009)' },
      details: { department: `${DEPARTEMENTS[m[3]]} (${m[3]})` }
    })
  }
  if (IT.test(bare)) matches.push({ country: 'IT', format: { fr: 'italien (depuis 1994)', en: 'Italian (since 1994)' }, details: {} })
  if (ES.test(bare)) matches.push({ country: 'ES', format: { fr: 'espagnol (depuis 2000)', en: 'Spanish (since 2000)' }, details: {} })
  if (BE.test(bare)) matches.push({ country: 'BE', format: { fr: 'belge (depuis 2010)', en: 'Belgian (since 2010)' }, details: {} })
  m = spaced.match(UK) ?? bare.match(UK)
  if (m) {
    const p = ukPeriod(m[3])
    matches.push({
      country: 'GB',
      format: { fr: 'britannique (depuis 2001)', en: 'British (since 2001)' },
      details: { region: UK_REGIONS[m[1]] ?? m[1], period_fr: p.fr, period_en: p.en }
    })
  }
  m = spaced.match(DE)
  if (m) {
    matches.push({
      country: 'DE',
      format: { fr: 'allemand', en: 'German' },
      details: { district_code: m[1], ...(DE_CITIES[m[1]] ? { city: DE_CITIES[m[1]] } : {}), ...(m[4] === 'E' ? { electric: true } : m[4] === 'H' ? { historic: true } : {}) }
    })
  }
  m = spaced.match(CH)
  if (m && CANTONS[m[1]]) {
    matches.push({ country: 'CH', format: { fr: 'suisse', en: 'Swiss' }, details: { canton: `${CANTONS[m[1]]} (${m[1]})` } })
  }
  const nl = dutchPlate(spaced)
  if (nl) {
    matches.push({ country: 'NL', format: { fr: `néerlandais (série ${nl.sidecode})`, en: `Dutch (sidecode ${nl.sidecode})` }, details: {} })
  }
  const normalized = matches[0]?.format.fr.startsWith('SIV') ? bare.replace(SIV, '$1-$2-$3') : matches[0]?.country === 'NL' && nl ? nl.formatted : spaced
  return { normalized, matches }
}

export function plateOutput(ctx: Pick<ModuleContext, 'lang'>, raw: string): ModuleOutput {
  const { normalized, matches } = analyzePlate(raw)
  if (!matches.length) return {}
  const best = matches[0]
  const d = best.details
  return {
    properties: compact({
      normalized,
      country: countryName(best.country, ctx.lang),
      country_code: best.country,
      plate_format: best.format[ctx.lang],
      possible_countries: matches.length > 1 ? matches.map((x) => countryName(x.country, ctx.lang)) : [],
      department: (d.department as string) ?? null,
      region: (d.region as string) ?? (d.canton as string) ?? null,
      city: (d.city as string) ?? null,
      registration_period: ctx.lang === 'fr' ? ((d.period_fr as string) ?? null) : ((d.period_en as string) ?? null),
      temporary: d.temporary === true ? tr(ctx, 'immatriculation temporaire (WW)', 'temporary registration (WW)') : null,
      electric: d.electric === true || null,
      historic: d.historic === true || null
    }),
    raw: matches
  }
}

export default defineModule({
  id: 'misc.license_plate',
  name: { fr: "Analyse de la plaque d'immatriculation", en: 'License plate analysis' },
  description: {
    fr: "Reconnaît le format de la plaque (France SIV et FNI, Italie, Espagne, Belgique, Royaume-Uni, Allemagne, Suisse, Pays-Bas) et en déduit le pays, le département (FNI), la région et la période (Royaume-Uni) ou le canton. Hors ligne.",
    en: 'Recognizes the plate format (France SIV and FNI, Italy, Spain, Belgium, UK, Germany, Switzerland, Netherlands) and derives the country, department (FNI), region and period (UK) or canton. Offline.'
  },
  category: 'misc',
  inputTypes: ['license_plate'],
  async run(input, ctx) {
    return plateOutput(ctx, input.label)
  }
})
