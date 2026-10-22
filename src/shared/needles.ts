// Formes sous lesquelles une valeur peut apparaître sur une page (recherche assistée).

/** Variantes de recherche d'une valeur : texte normalisé et, pour un numéro, suites de chiffres. */
export function needlesFor(type: string, label: string, extra: string[] = []): { text: string[]; digits: string[] } {
  const fold = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  const text = new Set<string>()
  const digits = new Set<string>()
  for (const v of [label, ...extra]) {
    if (!v.trim()) continue
    if (type === 'phone') {
      const d = v.replace(/\D+/g, '')
      if (d.length >= 8) digits.add(d)
      // +33 6 12 34 56 78 → 0612345678 ; 0612345678 → 33612345678
      if (d.startsWith('33') && d.length === 11) digits.add(`0${d.slice(2)}`)
      if (d.startsWith('0') && d.length === 10) digits.add(`33${d.slice(1)}`)
    } else {
      text.add(fold(v))
      if (type === 'person') {
        const parts = fold(v).split(' ')
        if (parts.length >= 2) text.add([...parts.slice(1), parts[0]].join(' '))
      }
    }
  }
  return { text: Array.from(text).filter((t) => t.length >= 3), digits: Array.from(digits) }
}
