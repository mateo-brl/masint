// Recherche floue de la palette de commandes : les lettres de chaque mot saisi doivent
// apparaître dans l'ordre, sans tenir compte de la casse ni des accents. Le score favorise les
// correspondances exactes, les débuts de mots et les lettres consécutives.

/** Texte sans accents ni majuscules, de même longueur que l'original (positions conservées). */
export function fold(s: string): string {
  let out = ''
  for (const ch of s) {
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    // Un caractère qui se décompose en plusieurs (ligature) garde sa place d'un caractère.
    out += (base.length === ch.length ? base : ch).toLowerCase()
  }
  return out.length === s.length ? out : s.toLowerCase()
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c)

export interface FuzzyMatch {
  score: number
  /** Positions des caractères trouvés dans le texte, pour les mettre en évidence. */
  positions: number[]
}

/** Correspondance d'un mot (déjà replié) dans un texte (déjà replié). */
function matchWord(word: string, text: string): FuzzyMatch | null {
  if (!word) return { score: 0, positions: [] }
  // Sous-chaîne exacte : meilleur cas, d'autant plus qu'elle commence un mot ou le texte.
  const at = text.indexOf(word)
  if (at >= 0) {
    let best = at
    // Préférence pour une occurrence en début de mot.
    for (let i = at; i >= 0 && i < text.length; i = text.indexOf(word, i + 1))
      if (!isWordChar(text[i - 1])) {
        best = i
        break
      }
    const start = !isWordChar(text[best - 1])
    const score = 100 + word.length * 12 + (best === 0 ? 40 : start ? 25 : 0) - Math.min(best, 30)
    return { score, positions: Array.from({ length: word.length }, (_, k) => best + k) }
  }
  // Lettres dans l'ordre, avec préférence pour les débuts de mots (« ex png » → « Exporter en PNG »).
  const positions: number[] = []
  let score = 0
  let from = 0
  for (let q = 0; q < word.length; q++) {
    const c = word[q]
    let found = -1
    // D'abord un début de mot à venir, sinon la prochaine occurrence.
    for (let i = from; i < text.length; i++)
      if (text[i] === c && !isWordChar(text[i - 1])) {
        found = i
        break
      }
    const next = text.indexOf(c, from)
    if (next < 0) return null
    if (found < 0 || (positions.length && next === positions[positions.length - 1] + 1)) found = next
    const prev = positions[positions.length - 1]
    score += 10
    if (prev !== undefined && found === prev + 1) score += 12
    if (!isWordChar(text[found - 1])) score += 18
    score -= Math.min(found - from, 10)
    positions.push(found)
    from = found + 1
  }
  return { score, positions }
}

/**
 * Score d'une saisie sur un texte : `null` si un mot de la saisie ne s'y retrouve pas. Chaque mot
 * est cherché indépendamment (« png exporter » trouve « Exporter en PNG »).
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return { score: 0, positions: [] }
  const t = fold(text)
  let score = 0
  const positions = new Set<number>()
  for (const w of words) {
    const m = matchWord(w, t)
    if (!m) return null
    score += m.score
    for (const p of m.positions) positions.add(p)
  }
  // Textes courts légèrement favorisés à score égal.
  return { score: score - t.length / 100, positions: Array.from(positions).sort((a, b) => a - b) }
}

/** Éléments qui correspondent à la saisie, du meilleur au moins bon (ordre d'origine à égalité). */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string, limit = 50): Array<{ item: T; match: FuzzyMatch }> {
  const out: Array<{ item: T; match: FuzzyMatch; index: number }> = []
  items.forEach((item, index) => {
    const match = fuzzyMatch(query, text(item))
    if (match) out.push({ item, match, index })
  })
  out.sort((a, b) => b.match.score - a.match.score || a.index - b.index)
  return out.slice(0, limit).map(({ item, match }) => ({ item, match }))
}
