// Référentiels INSEE : nomenclature d'activités (NAF rév. 2), catégories juridiques
// et tranches d'effectif salarié, plus les contrôles des identifiants SIREN / TVA.

import naf from './_naf.json'

const NAF = naf as Record<string, string>

export function nafLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return NAF[code] ?? null
}

// Catégories juridiques les plus fréquentes (niveau III), puis repli sur le niveau II.
const LEGAL_III: Record<string, string> = {
  '1000': 'Entrepreneur individuel',
  '5202': 'Société en nom collectif',
  '5306': 'Société en commandite simple',
  '5308': 'Société en commandite par actions',
  '5458': 'SARL coopérative ouvrière de production (SCOP)',
  '5485': "Société d'exercice libéral à responsabilité limitée (SELARL)",
  '5498': 'SARL unipersonnelle (EURL)',
  '5499': 'Société à responsabilité limitée (SARL)',
  '5599': "SA à conseil d'administration",
  '5699': 'SA à directoire',
  '5710': 'Société par actions simplifiée (SAS)',
  '5720': 'SAS à associé unique (SASU)',
  '5785': "Société d'exercice libéral par actions simplifiée (SELAS)",
  '5800': 'Société européenne',
  '6220': "Groupement d'intérêt économique (GIE)",
  '6316': "Coopérative d'utilisation de matériel agricole (CUMA)",
  '6317': 'Société coopérative agricole',
  '6533': "Groupement agricole d'exploitation en commun (GAEC)",
  '6540': 'Société civile immobilière (SCI)',
  '6589': 'Société civile de moyens (SCM)',
  '6599': 'Autre société civile',
  '7210': 'Commune',
  '7220': 'Département',
  '7230': 'Région',
  '7344': 'Métropole',
  '7346': 'Communauté de communes',
  '7348': "Communauté d'agglomération",
  '9220': 'Association déclarée',
  '9230': "Association déclarée reconnue d'utilité publique",
  '9300': 'Fondation'
}

const LEGAL_II: Record<string, string> = {
  '10': 'Entrepreneur individuel',
  '21': 'Indivision',
  '22': 'Société créée de fait',
  '23': 'Société en participation',
  '29': 'Groupement de droit privé sans personnalité morale',
  '31': 'Personne morale de droit étranger immatriculée au RCS',
  '32': 'Personne morale de droit étranger non immatriculée au RCS',
  '41': 'Établissement public ou régie industriel ou commercial',
  '51': 'Société coopérative commerciale particulière',
  '52': 'Société en nom collectif',
  '53': 'Société en commandite',
  '54': 'Société à responsabilité limitée (SARL)',
  '55': "SA à conseil d'administration",
  '56': 'SA à directoire',
  '57': 'Société par actions simplifiée (SAS)',
  '58': 'Société européenne',
  '61': "Caisse d'épargne et de prévoyance",
  '62': "Groupement d'intérêt économique",
  '63': 'Société coopérative agricole',
  '64': "Société d'assurance mutuelle",
  '65': 'Société civile',
  '69': 'Autre personne morale immatriculée au RCS',
  '71': "Administration de l'État",
  '72': 'Collectivité territoriale',
  '73': 'Établissement public administratif',
  '74': 'Autre personne morale de droit public administratif',
  '81': 'Organisme de protection sociale',
  '82': 'Organisme mutualiste',
  '83': "Comité social et économique d'entreprise",
  '84': 'Organisme professionnel',
  '85': 'Organisme de retraite à adhésion non obligatoire',
  '91': 'Syndicat de propriétaires',
  '92': 'Association loi 1901 ou assimilé',
  '93': 'Fondation',
  '99': 'Autre personne morale de droit privé'
}

export function legalFormLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return LEGAL_III[code] ?? LEGAL_II[code.slice(0, 2)] ?? code
}

const EFFECTIF: Record<string, string> = {
  NN: 'non employeur',
  '00': '0 salarié',
  '01': '1 à 2 salariés',
  '02': '3 à 5 salariés',
  '03': '6 à 9 salariés',
  '11': '10 à 19 salariés',
  '12': '20 à 49 salariés',
  '21': '50 à 99 salariés',
  '22': '100 à 199 salariés',
  '31': '200 à 249 salariés',
  '32': '250 à 499 salariés',
  '41': '500 à 999 salariés',
  '42': '1 000 à 1 999 salariés',
  '51': '2 000 à 4 999 salariés',
  '52': '5 000 à 9 999 salariés',
  '53': '10 000 salariés et plus'
}

export function headcountLabel(code: string | null | undefined, year?: string | null): string | null {
  if (!code) return null
  const label = EFFECTIF[code] ?? code
  return year ? `${label} (${year})` : label
}

/** Clé de contrôle Luhn des SIREN (9 chiffres) et SIRET (14 chiffres). */
export function luhnOk(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** Numéro de TVA intracommunautaire français déduit du SIREN. */
export function frenchVat(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97
  return `FR${String(key).padStart(2, '0')}${siren}`
}

/** Normalisation pour comparer des raisons sociales (casse, accents, forme juridique). */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(sa|sas|sasu|sarl|eurl|se|sci|snc|scop|selarl|selas|ste|societe|ltd|limited|plc|llp|gmbh|inc|llc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PARTICLES = new Set(['de', 'du', 'des', 'd', 'van', 'von', 'der', 'den', 'di', 'da', 'y', 'et'])

/** `JEAN-PIERRE DE LA FONTAINE` → `Jean-Pierre de La Fontaine`. */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((w, i) => (i > 0 && PARTICLES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('')
}
