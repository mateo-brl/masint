// Liste les modules d'enrichissement de src/main/modules/** au format Markdown,
// par simple analyse du texte source (le code n'est jamais exécuté).
//
//   node build/scripts/list-modules.mjs > docs/modules-list.md
//   npm run modules:list
//
// Reconnaît :
//   - les objets passés à defineModule({ ... }) dont l'id est une chaîne ;
//   - les fabriques (fonction qui renvoie defineModule({ id: o.id, ... })) et
//     leurs appels, par exemple accountCheck({ id: 'email.x', service: 'X' }) ;
//   - les constantes (const KEY = { ... }), y compris importées d'un autre
//     fichier, et les spreads (...COMMUN).
// Ce qui ne peut pas être déduit sans exécuter le code est laissé vide.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULES_DIR = join(ROOT, 'src', 'main', 'modules')

const CATEGORY_LABELS = {
  phone: 'Téléphone',
  email: 'Email',
  username: 'Pseudo',
  person: 'Personne',
  domain: 'Domaine',
  ip: 'Adresse IP',
  web: 'Site web',
  crypto: 'Crypto',
  finance: 'Finance',
  company: 'Entreprise',
  location: 'Localisation',
  image: 'Image',
  messaging: 'Messagerie',
  social: 'Réseaux sociaux',
  roso: 'roso.info',
  forensic: 'Forensic / IOC'
}

// ---------------------------------------------------------------------------
// Lecture des fichiers

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

/** Un fichier est ignoré par le registre s'il (ou un dossier parent) commence par `_`. */
function isHelper(path) {
  return relative(MODULES_DIR, path)
    .split(sep)
    .some((part) => part.startsWith('_'))
}

// ---------------------------------------------------------------------------
// Analyse lexicale minimale : chaînes, gabarits, commentaires, expressions régulières

const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)\s*$/

/** Si `i` commence une chaîne, un commentaire ou une regex, renvoie l'indice qui suit ; sinon -1. */
function skipLiteral(src, i) {
  const c = src[i]
  if (c === "'" || c === '"') {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') j++
      else if (src[j] === c || src[j] === '\n') return j + 1
    }
    return src.length
  }
  if (c === '`') return skipTemplate(src, i)
  if (c === '/' && src[i + 1] === '/') {
    const j = src.indexOf('\n', i)
    return j === -1 ? src.length : j
  }
  if (c === '/' && src[i + 1] === '*') {
    const j = src.indexOf('*/', i + 2)
    return j === -1 ? src.length : j + 2
  }
  if (c === '/') {
    let k = i - 1
    while (k >= 0 && /\s/.test(src[k])) k--
    const prev = k >= 0 ? src[k] : ''
    if (prev === '' || REGEX_PREV.has(prev) || REGEX_KEYWORDS.test(src.slice(Math.max(0, k - 10), k + 1))) {
      let inClass = false
      for (let j = i + 1; j < src.length; j++) {
        const d = src[j]
        if (d === '\\') j++
        else if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) {
          let e = j + 1
          while (/[a-z]/i.test(src[e] ?? '')) e++
          return e
        } else if (d === '\n') return -1
      }
    }
  }
  return -1
}

function skipTemplate(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++
    else if (src[j] === '`') return j + 1
    else if (src[j] === '$' && src[j + 1] === '{') j = matching(src, j + 1)
  }
  return src.length
}

const OPEN = { '{': '}', '[': ']', '(': ')' }

/** Indice du délimiteur fermant correspondant à celui situé en `open`. */
function matching(src, open) {
  const stack = []
  for (let i = open; i < src.length; i++) {
    const skip = skipLiteral(src, i)
    if (skip !== -1) {
      i = skip - 1
      continue
    }
    const c = src[i]
    if (OPEN[c]) stack.push(OPEN[c])
    else if (c === '}' || c === ']' || c === ')') {
      stack.pop()
      if (!stack.length) return i
    }
  }
  return src.length - 1
}

/** Découpe `text` aux séparateurs `sep` de premier niveau. */
function splitTop(text, separator = ',') {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const skip = skipLiteral(text, i)
    if (skip !== -1) {
      i = skip - 1
      continue
    }
    const c = text[i]
    if (OPEN[c]) depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(text.slice(start, i))
      start = i + separator.length
      i += separator.length - 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Position du premier `sep` de premier niveau, ou -1. */
function findTop(text, separator) {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const skip = skipLiteral(text, i)
    if (skip !== -1) {
      i = skip - 1
      continue
    }
    const c = text[i]
    if (OPEN[c]) depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (depth === 0 && text.startsWith(separator, i)) return i
  }
  return -1
}

// ---------------------------------------------------------------------------
// Évaluation d'expressions littérales simples

function unquote(s) {
  const q = s[0]
  const body = s.slice(1, -1)
  if (q === '"') {
    try {
      return JSON.parse(s)
    } catch {
      return body
    }
  }
  return body.replace(/\\(u\{[0-9a-f]+\}|u[0-9a-f]{4}|.)/gi, (_, e) => {
    if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16))
    return { n: '\n', t: '\t', r: '\r', 0: '\0' }[e] ?? e
  })
}

/** Évalue une entrée d'objet littéral et l'ajoute à `obj`. */
function evalObject(text, scope) {
  const obj = {}
  for (let part of splitTop(text.slice(1, -1))) {
    // Commentaires placés avant la propriété.
    part = part.replace(/^(?:\s*(?:\/\/[^\n]*(?:\n|$)|\/\*[^]*?\*\/))+\s*/, '')
    if (part.startsWith('...')) {
      const spread = evaluate(part.slice(3), scope)
      if (spread && typeof spread === 'object' && !Array.isArray(spread)) Object.assign(obj, spread)
      continue
    }
    if (/^(?:async\s+)?(?:get\s+|set\s+)?[\w$]+\s*\(/.test(part)) continue // méthode
    const m = part.match(/^(['"]?)([\w$.-]+)\1\s*:/)
    if (m) {
      const value = part.slice(m[0].length)
      Object.defineProperty(obj, m[2], { enumerable: true, configurable: true, get: () => evaluate(value, scope) })
    } else if (/^[\w$]+$/.test(part)) {
      Object.defineProperty(obj, part, { enumerable: true, configurable: true, get: () => evaluate(part, scope) })
    }
  }
  return obj
}

function evaluate(raw, scope, depth = 0) {
  if (raw == null || depth > 40) return undefined
  let expr = raw.trim().replace(/\s+(?:as|satisfies)\s+[\w$.<>[\]|' ]+$/, '').trim()
  if (!expr) return undefined
  if (expr[0] === '(' && matching(expr, 0) === expr.length - 1) return evaluate(expr.slice(1, -1), scope, depth + 1)

  const nullish = findTop(expr, '??')
  if (nullish !== -1) {
    const left = evaluate(expr.slice(0, nullish), scope, depth + 1)
    return left !== undefined && left !== null ? left : evaluate(expr.slice(nullish + 2), scope, depth + 1)
  }
  const question = findTop(expr, '?')
  if (question !== -1 && expr[question + 1] !== '.') {
    const rest = expr.slice(question + 1)
    const colon = findTop(rest, ':')
    if (colon === -1) return undefined
    const cond = evaluate(expr.slice(0, question), scope, depth + 1)
    if (cond === undefined) return undefined
    return evaluate(cond ? rest.slice(0, colon) : rest.slice(colon + 1), scope, depth + 1)
  }
  for (const op of ['===', '!==']) {
    const at = findTop(expr, op)
    if (at !== -1) {
      const a = evaluate(expr.slice(0, at), scope, depth + 1)
      const b = evaluate(expr.slice(at + 3), scope, depth + 1)
      if (a === undefined || b === undefined) return undefined
      return op === '===' ? a === b : a !== b
    }
  }

  if ((expr[0] === "'" || expr[0] === '"') && skipLiteral(expr, 0) === expr.length) return unquote(expr)
  if (expr[0] === '`' && skipTemplate(expr, 0) === expr.length) {
    let out = ''
    const body = expr.slice(1, -1)
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '\\') {
        out += body[i + 1] ?? ''
        i++
      } else if (body[i] === '$' && body[i + 1] === '{') {
        const end = matching(body, i + 1)
        const value = evaluate(body.slice(i + 2, end), scope, depth + 1)
        if (value === undefined || typeof value === 'object') return undefined
        out += String(value)
        i = end
      } else out += body[i]
    }
    return out
  }
  if (expr[0] === '[' && matching(expr, 0) === expr.length - 1) {
    return splitTop(expr.slice(1, -1)).flatMap((item) => {
      if (item.startsWith('...')) {
        const spread = evaluate(item.slice(3), scope, depth + 1)
        return Array.isArray(spread) ? spread : []
      }
      return [evaluate(item, scope, depth + 1)]
    })
  }
  if (expr[0] === '{' && matching(expr, 0) === expr.length - 1) return evalObject(expr, scope)
  if (expr === 'true') return true
  if (expr === 'false') return false
  if (expr === 'null') return null
  if (expr === 'undefined') return undefined
  if (/^-?[\d_]+(\.[\d_]+)?$/.test(expr)) return Number(expr.replace(/_/g, ''))

  // Identifiant, éventuellement suivi d'accès `.prop` ou `[n]`.
  const path = expr.match(/^([A-Za-z_$][\w$]*)((?:\??\.[\w$]+|\[\d+\]|\['[^']*'\])*)$/)
  if (!path) return undefined
  let value = scope.lookup(path[1], depth + 1)
  for (const step of path[2].match(/\??\.[\w$]+|\[\d+\]|\['[^']*'\]/g) ?? []) {
    if (value == null || typeof value !== 'object') return undefined
    const key = step.startsWith('[') ? step.slice(1, -1).replace(/'/g, '') : step.replace(/^\??\./, '')
    value = value[key]
  }
  return value
}

// ---------------------------------------------------------------------------
// Constantes, fabriques et modules

/** Déclarations `const NOM = expression` d'un texte, avec la fin de l'expression. */
function constDeclarations(text) {
  const out = new Map()
  const re = /(?:^|\n)[ \t]*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+?)?=(?!=|>)\s*/g
  let m
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length
    let depth = 0
    let end = text.length
    for (let i = start; i < text.length; i++) {
      const skip = skipLiteral(text, i)
      if (skip !== -1) {
        i = skip - 1
        continue
      }
      const c = text[i]
      if (OPEN[c]) depth++
      else if (c === '}' || c === ']' || c === ')') {
        if (depth === 0) {
          end = i
          break
        }
        depth--
      } else if (depth === 0 && c === ';') {
        end = i
        break
      } else if (depth === 0 && c === '\n') {
        const next = text.slice(i + 1).match(/^\s*(\S{1,2})/)
        if (!next || !/^(\?|:|\.|\|\||&&|\+|-|\*)/.test(next[1])) {
          end = i
          break
        }
      }
    }
    if (!out.has(m[1])) out.set(m[1], text.slice(start, end).trim())
  }
  return out
}

const files = walk(MODULES_DIR)
  .sort()
  .map((path) => ({ path, rel: relative(ROOT, path).split(sep).join('/'), src: readFileSync(path, 'utf8'), helper: isHelper(path) }))
for (const f of files) f.consts = constDeclarations(f.src)

/** Résolution d'un identifiant : fichier courant, puis même dossier, puis tout l'arbre. */
function fileScope(file, extra = {}) {
  const scope = {
    lookup(name, depth) {
      if (extra.params && name in extra.params) return extra.params[name]
      if (extra.locals?.has(name)) return evaluate(extra.locals.get(name), scope, depth)
      const own = file.consts.get(name)
      if (own !== undefined) return evaluate(own, fileScope(file), depth)
      const dir = dirname(file.path)
      const candidates = files.filter((f) => f !== file && f.consts.has(name))
      const other = candidates.find((f) => dirname(f.path) === dir) ?? candidates[0]
      return other ? evaluate(other.consts.get(name), fileScope(other), depth) : undefined
    }
  }
  return scope
}

/** Objets littéraux passés à `callee(`. */
function callObjects(src, callee) {
  const out = []
  const re = new RegExp(`(?<![\\w$.])${callee}\\(\\s*\\{`, 'g')
  let m
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1
    const close = matching(src, open)
    out.push({ index: m.index, text: src.slice(open, close + 1) })
  }
  return out
}

/** Fonction (déclarée ou fléchée) qui contient la position `index`. */
function enclosingFunction(src, index) {
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*=\s*\(/g
  let found = null
  let m
  while ((m = re.exec(src)) && m.index < index) {
    const parenOpen = m.index + m[0].length - 1
    const parenClose = matching(src, parenOpen)
    let bodyOpen = src.indexOf('{', parenClose)
    if (bodyOpen === -1) continue
    const between = src.slice(parenClose + 1, bodyOpen)
    let bodyEnd
    if (between.includes('=>') && !/=>\s*$/.test(between)) {
      // Fonction fléchée à corps expression : `(o) => defineModule({ ... })`.
      bodyOpen = parenClose
      bodyEnd = src.length
    } else {
      bodyEnd = matching(src, bodyOpen)
    }
    if (bodyOpen < index && index < bodyEnd) {
      const params = src.slice(parenOpen + 1, parenClose)
      found = {
        name: m[1] ?? m[2],
        param: params.match(/^\s*([A-Za-z_$][\w$]*)/)?.[1],
        body: src.slice(bodyOpen, index)
      }
    }
  }
  return found
}

const factories = new Map()
const definitions = []

for (const file of files) {
  for (const call of callObjects(file.src, 'defineModule')) {
    const idEntry = splitTop(call.text.slice(1, -1)).find((p) => /^id\s*:/.test(p))
    const idExpr = idEntry?.replace(/^id\s*:/, '').trim() ?? ''
    if (/^['"`][\w.-]+['"`]$/.test(idExpr)) {
      if (!file.helper) definitions.push({ file, text: call.text, scope: fileScope(file) })
      continue
    }
    const fn = enclosingFunction(file.src, call.index)
    if (fn?.name && fn.param) factories.set(fn.name, { file, fn, text: call.text })
  }
}

for (const [name, factory] of factories) {
  for (const file of files.filter((f) => !f.helper)) {
    for (const call of callObjects(file.src, name)) {
      const params = { [factory.fn.param]: evaluate(call.text, fileScope(file)) }
      const locals = constDeclarations(factory.fn.body)
      definitions.push({ file, text: factory.text, scope: fileScope(factory.file, { params, locals }) })
    }
  }
}

// ---------------------------------------------------------------------------
// Construction de la liste

const modules = new Map()
for (const def of definitions) {
  const obj = evaluate(def.text, def.scope)
  const id = obj?.id
  if (typeof id !== 'string' || !/^[\w-]+\.[\w.-]+$/.test(id)) continue
  const dir = relative(MODULES_DIR, def.file.path).split(sep)[0]
  const prefix = id.split('.')[0]
  const keys = (Array.isArray(obj.keys) ? obj.keys : [])
    .filter((k) => k && typeof k === 'object' && typeof k.id === 'string')
    .map((k) => ({ id: k.id, optional: k.optional === true }))
  const entry = {
    id,
    name: obj.name?.fr ?? obj.name?.en ?? '',
    category: typeof obj.category === 'string' ? obj.category : CATEGORY_LABELS[prefix] ? prefix : dir,
    inputs: Array.isArray(obj.inputTypes) ? obj.inputTypes.filter((t) => typeof t === 'string') : [],
    keys,
    ondemand: obj.ondemand === true,
    noisy: obj.noisy === true,
    experimental: obj.experimental === true,
    file: def.file.rel
  }
  if (modules.has(id)) console.error(`[list-modules] identifiant en double : ${id} (${entry.file}, ${modules.get(id).file})`)
  modules.set(id, entry)
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify([...modules.values()].sort((a, b) => a.id.localeCompare(b.id)), null, 2) + '\n')
  process.exit(0)
}

// Ordre des catégories : celui de ModuleCategory dans src/shared/types.ts.
const typesSrc = readFileSync(join(ROOT, 'src', 'shared', 'types.ts'), 'utf8')
const declared = (typesSrc.match(/export type ModuleCategory\s*=([^]*?)\n\n/)?.[1] ?? '').match(/'([\w-]+)'/g)?.map((s) => s.slice(1, -1)) ?? []
const byCategory = new Map()
for (const m of [...modules.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  if (!byCategory.has(m.category)) byCategory.set(m.category, [])
  byCategory.get(m.category).push(m)
}
const order = [...declared.filter((c) => byCategory.has(c)), ...[...byCategory.keys()].filter((c) => !declared.includes(c)).sort()]

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const code = (s) => '`' + s + '`'
const lines = []
lines.push('# Liste des modules')
lines.push('')
lines.push('<!-- Fichier généré : ne pas modifier à la main. -->')
lines.push('<!-- Régénérer avec : node build/scripts/list-modules.mjs > docs/modules-list.md -->')
lines.push('')
lines.push(
  `${modules.size} modules en ${order.length} catégories, extraits du code source de \`src/main/modules/\`. ` +
    'Le guide pour écrire un module est dans [modules.md](modules.md).'
)
lines.push('')
lines.push('Légende des remarques : **à la demande** (lancé seulement sur demande explicite, service à crédits), ' +
  '**bruyant** (peut alerter la personne recherchée), **expérimental** (résultats à vérifier). ' +
  'Une clé suivie de « (facultative) » améliore les résultats sans être obligatoire.')
lines.push('')
lines.push('| Catégorie | Modules |')
lines.push('| --- | ---: |')
for (const c of order) lines.push(`| [${CATEGORY_LABELS[c] ?? c}](#${c}) | ${byCategory.get(c).length} |`)
for (const c of order) {
  lines.push('')
  lines.push(`<a id="${c}"></a>`)
  lines.push('')
  lines.push(`## ${CATEGORY_LABELS[c] ?? c} (${code(c)})`)
  lines.push('')
  lines.push('| Identifiant | Nom | Entrées | Clés API | Remarques |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const m of byCategory.get(c)) {
    const keys = m.keys.map((k) => code(k.id) + (k.optional ? ' (facultative)' : '')).join(', ')
    const notes = [m.ondemand && 'à la demande', m.noisy && 'bruyant', m.experimental && 'expérimental'].filter(Boolean).join(', ')
    lines.push(`| ${code(m.id)} | ${cell(m.name)} | ${m.inputs.map(code).join(', ')} | ${keys} | ${notes} |`)
  }
}
lines.push('')
process.stdout.write(lines.join('\n'))
