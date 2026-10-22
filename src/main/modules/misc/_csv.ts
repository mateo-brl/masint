// Lecture de fichiers CSV publiés en open data (séparateur au choix, champs entre guillemets).

/** Découpe une ligne CSV (champs entre guillemets, `""` échappé). */
export function splitLine(line: string, sep = ';'): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === sep) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}
