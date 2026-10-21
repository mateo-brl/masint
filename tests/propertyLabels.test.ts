// Libellés des propriétés : dictionnaire, libellé de repli, et couverture de toutes les
// clés que les modules d'enrichissement écrivent dans les entités.

import { resolve } from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { ENTITY_TYPES } from '@shared/entityTypes'
import { PROPERTY_LABELS, propertyLabel } from '@shared/propertyLabels'

const norm = (p: string): string => p.replace(/\\/g, '/')
const ROOT = resolve(__dirname, '..')
const SRC_DIR = norm(resolve(ROOT, 'src')) + '/'
const MODULES_DIR = norm(resolve(ROOT, 'src/main/modules')) + '/'
const hasLabel = (key: string): boolean => Object.prototype.hasOwnProperty.call(PROPERTY_LABELS, key)

// Écritures à clé calculée, vérifiées à la main. Les helpers (compact, dropEmpty) et la
// fusion des propriétés de chaîne roso ne font que recopier des clés déjà extraites ;
// les deux autres produisent les clés contrôlées par le dernier test.
const KNOWN_DYNAMIC_WRITES = [
  'domain/_util.ts out[k]',
  'email/_lib.ts out[k]',
  'social/_lib.ts out[k]',
  'roso/_parse.ts out[k]',
  'roso/crypto.ts props[k]',
  'location/geocode.ts properties[k]',
  'roso/ip.ts properties[`roso_${s.id}`]'
]

interface Extraction {
  /** Clé vers son premier emplacement (fichier:ligne). */
  keys: Map<string, string>
  dynamic: Set<string>
  /** Sources CTI du scan d'IP roso.info, écrites sous `roso_<source>`. */
  ipSources: string[]
  /** Champs `extra` du géocodage, recopiés dans les propriétés. */
  geoExtra: string[]
}

interface KeyTemplate {
  /** Rang du paramètre qui porte la clé. */
  index: number
  prefix: string
  suffix: string
}

/**
 * Recense avec le type checker TypeScript les clés écrites dans un sac de propriétés
 * (`Record<string, PropValue>`) : littéraux placés là où ce type est attendu
 * (`properties`, `data`, paramètres, retours), types des expressions qui y aboutissent,
 * écritures `x.cle = ...` sur un tel objet, `data:` / `properties:` des entités et
 * sorties construites dans des callbacks génériques (`map`), et clés passées en argument
 * à un helper qui les écrit (`cappedList('otx_hostnames', ...)` donne `otx_hostnames`
 * et `otx_hostnames_count`).
 */
function extractModuleKeys(): Extraction {
  const configFile = ts.readConfigFile(resolve(ROOT, 'tsconfig.node.json'), ts.sys.readFile)
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT)
  const files = config.fileNames.filter((f) => norm(f).startsWith(MODULES_DIR) && f.endsWith('.ts'))
  const program = ts.createProgram(files, { ...config.options, noEmit: true, composite: false, incremental: false })
  const checker = program.getTypeChecker()
  const sources = program.getSourceFiles().filter((sf) => norm(sf.fileName).startsWith(MODULES_DIR) && sf.fileName.endsWith('.ts'))

  const typesFile = program.getSourceFiles().find((sf) => norm(sf.fileName).endsWith('/src/shared/types.ts'))
  const alias = typesFile?.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === 'PropValue')
  if (!alias) throw new Error('Type PropValue introuvable')
  const propValue = checker.getTypeFromTypeNode(alias.type)

  const out: Extraction = { keys: new Map(), dynamic: new Set(), ipSources: [], geoExtra: [] }
  const fileOf = (node: ts.Node): string => norm(node.getSourceFile().fileName).slice(MODULES_DIR.length)
  const add = (key: string, node: ts.Node): void => {
    const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1
    if (!out.keys.has(key)) out.keys.set(key, `${fileOf(node)}:${line}`)
  }
  const dynamic = (node: ts.Node, text: string): void => {
    out.dynamic.add(`${fileOf(node)} ${text}`)
  }

  const isBag = (t: ts.Type | undefined): boolean =>
    !!t &&
    (t.isUnion() ? t.types : [t]).some((m) => {
      const v = checker.getIndexTypeOfType(m, ts.IndexKind.String)
      return !!v && !(v.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) && checker.isTypeAssignableTo(propValue, v)
    })

  // Propriétés nommées d'un type déclaré dans le projet (pas les méthodes de string, Array...).
  const typeKeys = (t: ts.Type): string[] =>
    (t.isUnion() || t.isIntersection() ? t.types : [t]).flatMap((m) =>
      checker
        .getPropertiesOfType(m)
        .filter((p) => p.declarations?.some((d) => norm(d.getSourceFile().fileName).startsWith(SRC_DIR)))
        .map((p) => p.name)
    )

  // Chaînes qu'une expression peut valoir (littéral, alternative entre littéraux), null sinon.
  const literalValues = (e: ts.Expression): string[] | null => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text]
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return literalValues(e.expression)
    if (ts.isConditionalExpression(e)) {
      const a = literalValues(e.whenTrue)
      const b = literalValues(e.whenFalse)
      return a && b ? [...a, ...b] : null
    }
    return null
  }

  // Clé tirée d'un paramètre de fonction (`[key]`, `[`${key}_count`]`) : les appels la fourniront.
  const helpers = new Map<ts.Node, KeyTemplate[]>()
  const keyFromParameter = (e: ts.Expression): boolean => {
    const parameter = (x: ts.Expression): ts.ParameterDeclaration | undefined => {
      const decl = ts.isIdentifier(x) ? checker.getSymbolAtLocation(x)?.valueDeclaration : undefined
      return decl && ts.isParameter(decl) ? decl : undefined
    }
    const single = ts.isTemplateExpression(e) && e.templateSpans.length === 1 ? e.templateSpans[0] : undefined
    const param = single ? parameter(single.expression) : parameter(e)
    if (!param) return false
    const tpl = { index: param.parent.parameters.indexOf(param), prefix: single && ts.isTemplateExpression(e) ? e.head.text : '', suffix: single ? single.literal.text : '' }
    helpers.set(param.parent, [...(helpers.get(param.parent) ?? []), tpl])
    return true
  }
  const computedKey = (node: ts.Node, e: ts.Expression, text: string): void => {
    if (keyFromParameter(e)) return
    const values = literalValues(e)
    if (values) values.forEach((k) => add(k, node))
    else dynamic(node, text)
  }

  const unwrapped = new Set<ts.Node>()
  const unwrap = (e: ts.Expression): void => {
    if (unwrapped.has(e)) return
    unwrapped.add(e)
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) unwrap(e.expression)
    else if (ts.isConditionalExpression(e)) {
      unwrap(e.whenTrue)
      unwrap(e.whenFalse)
    } else if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) {
      unwrap(e.left)
      unwrap(e.right)
    } else if (ts.isCallExpression(e)) {
      for (const a of e.arguments) if (ts.isObjectLiteralExpression(a) || ts.isIdentifier(a)) unwrap(a)
    } else if (ts.isIdentifier(e)) {
      const decl = checker.getSymbolAtLocation(e)?.valueDeclaration
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) unwrap(decl.initializer)
    } else if (ts.isObjectLiteralExpression(e)) {
      for (const p of e.properties) {
        if (ts.isSpreadAssignment(p)) unwrap(p.expression)
        else if (ts.isComputedPropertyName(p.name)) computedKey(p, p.name.expression, p.name.getText())
        else if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) add(p.name.text, p)
      }
    }
  }
  const bag = (e: ts.Expression): void => {
    for (const k of typeKeys(checker.getTypeAtLocation(e))) add(k, e)
    unwrap(e)
  }

  // `data:` d'une entité ou d'un profil, `properties:` d'une sortie de module.
  const looksLikeOutput = (p: ts.PropertyAssignment | ts.ShorthandPropertyAssignment): boolean => {
    const name = ts.isIdentifier(p.name) ? p.name.text : ''
    const names = new Set(p.parent.properties.map((q) => (!ts.isSpreadAssignment(q) && ts.isIdentifier(q.name) ? q.name.text : '')))
    if (name === 'data') return (names.has('type') && names.has('label')) || names.has('found') || names.has('username')
    if (name === 'properties') return names.has('entities') || names.has('found') || names.has('raw') || names.size === 1
    return false
  }

  for (const sf of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isExpression(node) && !(node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
        let contextual: ts.Type | undefined
        try {
          contextual = checker.getContextualType(node)
        } catch {
          contextual = undefined
        }
        if (isBag(contextual)) bag(node)
      }
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isIdentifier(node.name) && looksLikeOutput(node))
        bag(ts.isPropertyAssignment(node) ? node.initializer : node.name)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const left = node.left
        if (ts.isPropertyAccessExpression(left) && isBag(checker.getTypeAtLocation(left.expression))) add(left.name.text, left)
        else if (ts.isElementAccessExpression(left) && isBag(checker.getTypeAtLocation(left.expression)))
          computedKey(left, left.argumentExpression, left.getText())
      }
      if (ts.isCallExpression(node) && node.expression.getText() === 'Object.assign' && node.arguments.length > 1 && isBag(checker.getTypeAtLocation(node.arguments[0])))
        node.arguments.slice(1).forEach(bag)
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'IP_SOURCES' && node.initializer && ts.isArrayLiteralExpression(node.initializer))
        out.ipSources.push(...node.initializer.elements.filter(ts.isStringLiteral).map((e) => e.text))
      if (fileOf(node) === 'location/_geo.ts' && ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'extra' && ts.isObjectLiteralExpression(node.initializer))
        for (const p of node.initializer.properties) if (!ts.isSpreadAssignment(p) && ts.isIdentifier(p.name)) out.geoExtra.push(p.name.text)
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  // Appels des helpers repérés : la clé vient de l'argument.
  for (const sf of sources) {
    const visit = (node: ts.Node): void => {
      const decl = ts.isCallExpression(node) ? checker.getResolvedSignature(node)?.declaration : undefined
      const templates = decl ? helpers.get(decl) : undefined
      if (ts.isCallExpression(node) && templates) {
        for (const tpl of templates) {
          const arg = node.arguments[tpl.index]
          const values = arg ? literalValues(arg) : null
          if (values) values.forEach((v) => add(tpl.prefix + v + tpl.suffix, node))
          else dynamic(node, `${node.expression.getText()}(${arg?.getText() ?? ''})`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return out
}

describe('propertyLabel', () => {
  it.each([
    ['dmarc_policy', 'Politique DMARC', 'DMARC policy'],
    ['dns_provider', 'Fournisseur DNS', 'DNS provider'],
    ['death_date', 'Date de décès', 'Death date'],
    ['wayback_captures', 'Captures Wayback', 'Wayback captures'],
    ['bank_code', 'Code banque', 'Bank code'],
    ['iban_formatted', 'IBAN formaté', 'Formatted IBAN'],
    ['address_type', "Type d'adresse", 'Address type'],
    ['explorer_url', 'Lien explorateur', 'Explorer link'],
    ['postcode', 'Code postal', 'Postcode'],
    ['modified_at', 'Modifié le', 'Modified at'],
    ['height', 'Hauteur', 'Height'],
    ['width', 'Largeur', 'Width'],
    ['md5', 'Empreinte MD5', 'MD5 hash'],
    ['line_type', 'Type de ligne', 'Line type'],
    ['timezones', 'Fuseaux horaires', 'Timezones'],
    ['hosting_asn', "ASN de l'hébergeur", 'Hosting ASN'],
    ['otx_adversaries', 'Adversaires (OTX)', 'Adversaries (OTX)']
  ])('%s', (key, fr, en) => {
    expect(propertyLabel(key, 'fr')).toBe(fr)
    expect(propertyLabel(key, 'en')).toBe(en)
  })

  it('génère un libellé lisible pour une clé inconnue, sigles en capitales', () => {
    expect(propertyLabel('dkim_selector', 'fr')).toBe('DKIM selector')
    expect(propertyLabel('ipv6_count', 'en')).toBe('IPv6 count')
    expect(propertyLabel('last_ip_url_id', 'fr')).toBe('Last IP URL ID')
    expect(propertyLabel('otx_api_key', 'en')).toBe('OTX API key')
    expect(propertyLabel('file_sha256', 'fr')).toBe('File SHA-256')
    expect(propertyLabel('siret_tva_naf', 'fr')).toBe('SIRET TVA NAF')
    expect(propertyLabel('cve_cvss_epss', 'en')).toBe('CVE CVSS EPSS')
    expect(propertyLabel('exif_gps_utc', 'en')).toBe('EXIF GPS UTC')
    expect(propertyLabel('wallet_btc_eth_usd', 'en')).toBe('Wallet BTC ETH USD')
    expect(propertyLabel('lastSeenAt', 'en')).toBe('Last seen at')
    expect(propertyLabel('Some_Mixed_KEY', 'en')).toBe('Some mixed key')
    expect(propertyLabel('', 'fr')).toBe('')
  })

  it("dérive le libellé du total d'une liste connue (`<clé>_count`)", () => {
    expect(propertyLabel('technologies_count', 'fr')).toBe('Nombre de technologies')
    expect(propertyLabel('technologies_count', 'en')).toBe('Technologies count')
    expect(propertyLabel('antiviruses_count', 'fr')).toBe("Nombre d'antivirus")
    expect(propertyLabel('tor_flags_count', 'fr')).toBe('Nombre de drapeaux Tor')
    expect(propertyLabel('tor_flags_count', 'en')).toBe('Tor flags count')
    expect(propertyLabel('otx_tags_count', 'fr')).toBe('Nombre de tags (OTX)')
    expect(propertyLabel('otx_tags_count', 'en')).toBe('Tags count (OTX)')
    expect(propertyLabel('unknown_list_count', 'fr')).toBe('Unknown list count')
  })

  it('ne confond pas une clé avec une propriété héritée de Object', () => {
    expect(propertyLabel('constructor', 'fr')).toBe('Constructor')
    expect(propertyLabel('toString', 'en')).toBe('To string')
  })
})

describe('PROPERTY_LABELS', () => {
  it('a des libellés propres dans les deux langues', () => {
    for (const [key, label] of Object.entries(PROPERTY_LABELS)) {
      for (const text of [label.fr, label.en]) {
        expect(text, key).toBe(text.trim())
        expect(text.length, key).toBeGreaterThan(0)
        expect(text, key).not.toMatch(/[\u2013\u2014]|\s{2}/)
      }
    }
  })

  it('reprend les libellés des champs de fiche (entityTypes)', () => {
    const variants = new Map<string, Set<string>>()
    for (const type of ENTITY_TYPES)
      for (const f of type.fields) variants.set(f.key, (variants.get(f.key) ?? new Set()).add(JSON.stringify([f.label.fr, f.label.en])))
    for (const [key, labels] of variants) {
      expect(hasLabel(key), key).toBe(true)
      // Clé libellée différemment selon le type (url, created_at...) : un libellé générique suffit.
      if (labels.size === 1) expect([PROPERTY_LABELS[key].fr, PROPERTY_LABELS[key].en], key).toEqual(JSON.parse([...labels][0]))
    }
  })
})

describe('couverture des clés écrites par les modules', () => {
  let extraction: Extraction

  beforeAll(() => {
    extraction = extractModuleKeys()
  }, 120_000)

  it("trouve les clés attendues (l'extraction fonctionne)", () => {
    expect(extraction.keys.size).toBeGreaterThan(500)
    // Littéral, écriture `x.cle =`, clé calculée, `data` dans un callback de map.
    for (const key of ['dmarc_policy', 'invalid_reason', 'otx_resolved_ips', 'otx_hostnames', 'memo', 'death_date'])
      expect(extraction.keys.has(key), key).toBe(true)
  })

  it('a un libellé pour chaque clé', () => {
    // Les clés préfixées par `__` sont internes : le panneau Propriétés les masque.
    const missing = [...extraction.keys].filter(([key]) => !key.startsWith('__') && !hasLabel(key)).map(([key, at]) => `${key} (${at})`)
    expect(missing).toEqual([])
  })

  it('ne rencontre que des écritures à clé calculée connues', () => {
    expect([...extraction.dynamic].filter((d) => !KNOWN_DYNAMIC_WRITES.includes(d))).toEqual([])
  })

  it('a un libellé pour les clés calculées (sources roso.info, champs du géocodage)', () => {
    expect(extraction.ipSources.length).toBeGreaterThan(0)
    expect(extraction.geoExtra.length).toBeGreaterThan(0)
    const keys = [...extraction.ipSources.map((s) => `roso_${s}`), ...extraction.geoExtra]
    expect(keys.filter((k) => !hasLabel(k))).toEqual([])
  })
})
