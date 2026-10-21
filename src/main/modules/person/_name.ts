// Découpage d'un nom de personne (« Jean Dupont », « DUPONT Jean », « Jean de La Fontaine »).

import type { InputEntity } from '@shared/modules'

export interface PersonName {
  /** Prénoms dans l'ordre (« Jean-Pierre », « Marie »). */
  firstNames: string[]
  /** Nom de famille complet, particule comprise (« de La Fontaine »). */
  lastName: string
}

const PARTICLES = new Set(['de', 'du', 'des', 'de la', 'le', 'la', 'van', 'von', 'der', 'den', 'di', 'da', 'del', 'della', 'dos', 'das', 'ben', 'bin', 'el', 'al', 'mac', "d'"])

/** Minuscules sans accents, pour les pseudos et les comparaisons. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

const isUpperWord = (w: string): boolean => w.length > 1 && /\p{L}/u.test(w) && w === w.toUpperCase() && w !== w.toLowerCase()

export function splitName(input: Pick<InputEntity, 'label' | 'data'>): PersonName | null {
  const first = typeof input.data.first_name === 'string' ? input.data.first_name.trim() : ''
  const last = typeof input.data.last_name === 'string' ? input.data.last_name.trim() : ''
  if (first && last) return { firstNames: first.split(/\s+/), lastName: last }
  const words = input.label
    .replace(/[,;]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
  if (words.length < 2) return null
  // Convention française « NOM Prénom » : les mots entièrement en majuscules forment le nom.
  const upper = words.filter(isUpperWord)
  if (upper.length && upper.length < words.length) {
    return { firstNames: words.filter((w) => !isUpperWord(w)), lastName: upper.join(' ') }
  }
  // Sinon : dernier mot = nom, en y rattachant les particules qui le précèdent.
  let i = words.length - 1
  while (i > 1 && PARTICLES.has(fold(words[i - 1]))) i--
  if (i > 1 && PARTICLES.has(fold(`${words[i - 2]} ${words[i - 1]}`))) i -= 2
  return { firstNames: words.slice(0, i), lastName: words.slice(i).join(' ') }
}

/** Forme compacte pour un pseudo : sans accents, espaces, apostrophes ni tirets. */
export function compactPart(s: string): string {
  return fold(s).replace(/[^a-z0-9]/g, '')
}

/** Initiales d'un prénom composé (« Jean-Pierre » donne « jp »). */
export function initials(s: string): string {
  return fold(s)
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((p) => p.replace(/[^a-z0-9]/g, '').charAt(0))
    .join('')
}

/** Mise en forme lisible « Prénom Nom ». */
export function displayName(n: PersonName): string {
  const cap = (w: string): string => w.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
  return `${n.firstNames.map(cap).join(' ')} ${cap(n.lastName)}`
}
