// Corrélation entre enquêtes et recherche globale : règles partagées par le processus principal
// (requêtes) et l'interface (affichage).

/**
 * Types d'entités exclus de la corrélation entre enquêtes : valeurs de contexte que l'on
 * retrouve d'une enquête à l'autre sans que cela dise quoi que ce soit (« France », « OVH »,
 * « Orange », une fuite de données connue). Les identifiants (email, numéro, pseudo, domaine,
 * portefeuille...) restent corrélés.
 */
export const UNCORRELATED_TYPES: readonly string[] = [
  'country',
  'city',
  'technology',
  'service',
  'carrier',
  'hlr',
  'hosting',
  'bank',
  'asn',
  'breach',
  'search_link',
  'event'
]

/** Longueur minimale d'un mot de la recherche globale (index en trigrammes). */
export const SEARCH_MIN_TERM = 3

/**
 * Requête FTS5 d'une saisie libre : chaque mot d'au moins trois caractères doit apparaître
 * (sous-chaîne). Les mots plus courts sont ignorés ; `null` si aucun mot n'est exploitable.
 */
export function ftsQuery(input: string): string | null {
  const terms = input
    .normalize('NFC')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => Array.from(t).length >= SEARCH_MIN_TERM)
  if (!terms.length) return null
  // Expression entre guillemets : les caractères spéciaux de FTS5 (« - », « : », « * ») ne
  // sont pas interprétés ; un guillemet se double.
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ')
}

/** Découpe un extrait de la recherche globale en passages normaux et passages trouvés. */
export function snippetParts(snippet: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = []
  const re = /\u0002([^\u0003]*)\u0003/g
  let last = 0
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), hit: false })
    if (m[1]) out.push({ text: m[1], hit: true })
    last = m.index + m[0].length
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), hit: false })
  return out
}
