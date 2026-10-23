// Nom donné à un numéro par un annuaire d'appelants (Eyecon, Truecaller, CallApp, Sync.ME...),
// pour les comptes et numéros venus d'ailleurs que du scan roso.info, qui fait lui-même ce
// classement : « Prénom Nom » devient une personne, un jeton comme « ZX445 » un pseudo, tous
// deux à vérifier ; les étiquettes (« Maman », « Livreur », « Spam ») restent des propriétés.
// Aucune requête réseau.

import { callerIdSource, callerNamePivots, type CallerNameSource } from '@shared/callerName'
import { defineModule, type InputEntity } from '@shared/modules'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const PHONE_LIKE = /^[+\d\s().\-/]+$/

/** Annuaire d'un compte : sa plateforme, ou le site roso.info d'un compte hors catalogue. */
export function callerSourceOf(input: InputEntity): string | null {
  return callerIdSource(input.platform) ?? callerIdSource(str(input.data.site))
}

/** Nom affiché par l'annuaire pour ce compte : nom affiché, sinon libellé du compte. */
export function callerNameOf(input: InputEntity): string {
  for (const k of ['caller_name', 'display_name', 'name']) {
    const v = str(input.data[k])
    if (v) return v
  }
  // Libellé d'un compte hors catalogue : « ZX445 (ViewCaller) ».
  const label = input.label.replace(/\s*\([^()]*\)$/, '').trim()
  return label && !PHONE_LIKE.test(label) ? label : ''
}

/** Propriétés d'un numéro qui portent un nom d'appelant, avec leur source. */
const PHONE_KEYS: Array<[key: string, source: string]> = [
  ['caller_name', 'Caller ID'],
  ['twilio_caller_name', 'Twilio (CNAM)'],
  ['cnam', 'CNAM']
]

/** Noms d'appelant de l'entité : celui d'un compte d'annuaire, ou ceux rangés sur un numéro. */
export function callerSourcesOf(input: InputEntity): CallerNameSource[] {
  if (input.type === 'account') {
    const source = callerSourceOf(input)
    const name = source ? callerNameOf(input) : ''
    return source && name ? [{ name, source }] : []
  }
  if (input.type === 'phone') return PHONE_KEYS.map(([k, source]) => ({ name: str(input.data[k]), source })).filter((x) => !!x.name)
  return []
}

/** Nom déjà classé, par roso.info ou par une exécution précédente : rien à refaire. */
export function alreadyClassified(input: InputEntity): boolean {
  if (input.type === 'account') return input.data.caller_name_kind !== undefined
  return input.data.caller_names !== undefined || input.data.caller_tags !== undefined
}

export default defineModule({
  id: 'phone.caller_names',
  name: { fr: 'Nom donné au numéro (annuaires d’appelants)', en: 'Name given to the number (caller ID apps)' },
  description: {
    fr: "Classe le nom sous lequel un annuaire d'appelants (Eyecon, Truecaller, CallApp, Sync.ME...) affiche le numéro : un « Prénom Nom » devient une personne et un jeton comme « ZX445 » un pseudo, tous deux dans « À vérifier » ; les étiquettes (« Maman », « Livreur », « Spam ») et les noms ambigus restent des propriétés. Aucune requête.",
    en: 'Classifies the name a caller ID app (Eyecon, Truecaller, CallApp, Sync.ME...) shows for the number: a "First Last" becomes a person and a token such as "ZX445" a username, both in "To review"; labels ("Mum", "Courier", "Spam") and ambiguous names stay as properties. No request.'
  },
  category: 'phone',
  inputTypes: ['account', 'phone'],
  accepts: (input) => !alreadyClassified(input) && callerSourcesOf(input).length > 0,
  async run(input, ctx) {
    const pivots = callerNamePivots(callerSourcesOf(input), ctx.lang)
    const kind = pivots.groups[0]?.kind
    return {
      properties: { ...pivots.properties, ...(input.type === 'account' && kind ? { caller_name_kind: kind } : {}) },
      entities: pivots.entities
    }
  }
})
