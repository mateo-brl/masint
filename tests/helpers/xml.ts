// Vérification de documents XML sans dépendance : découpage en balises, imbrication,
// attributs entre guillemets, entités valides, caractères interdits. Renvoie les éléments
// lus (nom, attributs, parent) pour vérifier le contenu.

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  parent: XmlElement | null
  text: string
  children: XmlElement[]
}

const NAME = '[A-Za-z_][\\w:.-]*'
const TOKEN = new RegExp(
  `<!--([\\s\\S]*?)-->|<\\/(${NAME})\\s*>|<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(\\/?)>|([^<]+)`,
  'y'
)
const ATTR = new RegExp(`(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'g')
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i
const BAD_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')

/** Analyse un document ; lève une erreur au premier défaut de forme. */
export function parseXml(xml: string): XmlElement {
  if (BAD_CHAR.test(xml)) throw new Error('caractère interdit en XML 1.0')
  let src = xml.replace(/^﻿/, '')
  const decl = /^<\?xml\s[^?]*\?>/.exec(src)
  if (decl) src = src.slice(decl[0].length)
  else if (src.startsWith('<?')) throw new Error('déclaration XML invalide')
  let root: XmlElement | null = null
  const stack: XmlElement[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < src.length) {
    const at = TOKEN.lastIndex
    const m = TOKEN.exec(src)
    if (!m) throw new Error(`balise invalide à la position ${at} : ${src.slice(at, at + 40)}`)
    const [, comment, close, open, attrText, selfClose, text] = m
    if (comment !== undefined) {
      if (comment.includes('--') || comment.endsWith('-')) throw new Error('commentaire invalide')
      continue
    }
    if (text !== undefined) {
      if (BAD_ENTITY.test(text)) throw new Error(`entité invalide : ${text.slice(0, 40)}`)
      if (!stack.length) {
        if (text.trim()) throw new Error('texte hors de la racine')
        continue
      }
      stack[stack.length - 1].text += decode(text)
      continue
    }
    if (close !== undefined) {
      const top = stack.pop()
      if (!top || top.name !== close) throw new Error(`fermeture inattendue : ${close}`)
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of attrText.matchAll(ATTR)) {
      const value = a[2] ?? a[3] ?? ''
      if (a[1] in attrs) throw new Error(`attribut en double : ${a[1]}`)
      if (BAD_ENTITY.test(value)) throw new Error(`entité invalide dans ${a[1]}`)
      attrs[a[1]] = decode(value)
    }
    const parent = stack[stack.length - 1] ?? null
    const el: XmlElement = { name: open, attrs, parent, text: '', children: [] }
    if (parent) parent.children.push(el)
    else if (root) throw new Error('plusieurs racines')
    else root = el
    if (!selfClose) stack.push(el)
  }
  if (stack.length) throw new Error(`balise non fermée : ${stack[stack.length - 1].name}`)
  if (!root) throw new Error('document vide')
  return root
}

/** Tous les éléments d'un nom donné, en profondeur. */
export function findAll(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = []
  const walk = (e: XmlElement): void => {
    if (e.name === name) out.push(e)
    e.children.forEach(walk)
  }
  walk(el)
  return out
}
