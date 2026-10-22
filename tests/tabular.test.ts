// Import en masse : découpage CSV, détection du séparateur et des types, plan d'import.
// Valeurs fictives uniquement (domaines de documentation, numéros réservés à la fiction).

import { describe, expect, it } from 'vitest'
import { canonicalKey } from '@shared/canonical'
import { cellValue, detectSeparator, gridLayout, guessHeader, parseDelimited, planImport, suggestColumnType } from '@shared/tabular'

describe('parseDelimited', () => {
  it('découpe un CSV simple', () => {
    expect(parseDelimited('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3']
    ])
  })

  it('respecte les guillemets, les guillemets doublés et les séparateurs entre guillemets', () => {
    expect(parseDelimited('"Exemple, Jean";"dit ""le chat""";x', ';')).toEqual([['Exemple, Jean', 'dit "le chat"', 'x']])
    expect(parseDelimited('"a;b";c', ';')).toEqual([['a;b', 'c']])
  })

  it('garde les retours à la ligne entre guillemets', () => {
    expect(parseDelimited('nom,note\nalpha,"ligne 1\nligne 2"\nbeta,x', ',')).toEqual([
      ['nom', 'note'],
      ['alpha', 'ligne 1\nligne 2'],
      ['beta', 'x']
    ])
  })

  it('gère CRLF, BOM, lignes vides et champs vides', () => {
    expect(parseDelimited('﻿a;b\r\n\r\n;2\r\n', ';')).toEqual([
      ['a', 'b'],
      ['', '2']
    ])
  })

  it('lit une tabulation et ignore les espaces avant un guillemet ouvrant', () => {
    expect(parseDelimited('a\t "b c"\tz', '\t')).toEqual([['a', 'b c', 'z']])
  })

  it('sans séparateur : une valeur par ligne', () => {
    expect(parseDelimited(' a@example.com \n\nb@example.com\n', null)).toEqual([['a@example.com'], ['b@example.com']])
  })

  it('s’arrête au nombre de lignes demandé', () => {
    expect(parseDelimited('1\n2\n3\n4', ',', 2)).toEqual([['1'], ['2']])
  })
})

describe('detectSeparator', () => {
  it('reconnaît virgule, point-virgule et tabulation', () => {
    expect(detectSeparator('email,phone\na@example.com,0639981234\nb@example.com,0639981235')).toBe(',')
    expect(detectSeparator('email;montant\na@example.com;1,5\nb@example.com;2,25')).toBe(';')
    expect(detectSeparator('a\tb\n1\t2')).toBe('\t')
  })

  it('ne se laisse pas tromper par une virgule entre guillemets', () => {
    expect(detectSeparator('"Exemple, Jean";a@example.com\n"Test, Alice";b@example.com')).toBe(';')
  })

  it('une simple liste n’a pas de séparateur', () => {
    expect(detectSeparator('a@example.com\nb@example.com\n192.0.2.1')).toBeNull()
  })
})

describe('types des colonnes', () => {
  it('suggère le type majoritaire', () => {
    expect(suggestColumnType(['a@example.com', 'b@example.com', 'n/a', ''])).toBe('email')
    expect(suggestColumnType(['0639981234', '+33639981235', '06 39 98 12 36'])).toBe('phone')
    expect(suggestColumnType(['192.0.2.1', '2001:db8::1'])).toBe('ip')
    expect(suggestColumnType(['', ' '])).toBeNull()
  })

  it('devine la ligne d’en-tête', () => {
    expect(guessHeader([['Email', 'Téléphone'], ['a@example.com', '0639981234'], ['b@example.com', '0639981235']])).toBe(true)
    expect(guessHeader([['a@example.com'], ['b@example.com']])).toBe(false)
  })

  it('normalise ou écarte une cellule selon le type de la colonne', () => {
    expect(cellValue('phone', '06 39 98 12 34')).toEqual({ label: '+33639981234', platform: null })
    expect(cellValue('email', 'Jean@Gmail.com')).toEqual({ label: 'jean@gmail.com', platform: 'gmail' })
    expect(cellValue('domain', 'https://www.example.com/page')).toEqual({ label: 'example.com', platform: null })
    expect(cellValue('hash', 'DA39A3EE5E6B4B0D3255BFEF95601890AFD80709')).toEqual({ label: 'da39a3ee5e6b4b0d3255bfef95601890afd80709', platform: null })
    expect(cellValue('email', 'pas un email')).toBeNull()
    expect(cellValue('phone', 'inconnu')).toBeNull()
    expect(cellValue('person', 'N/A')).toBeNull()
    expect(cellValue('username', '@exemple')).toEqual({ label: 'exemple', platform: null })
    expect(cellValue('company', '  Exemple   SARL ')).toEqual({ label: 'Exemple SARL', platform: null })
  })
})

describe('planImport', () => {
  const columns = [
    { type: 'person', header: 'Nom' },
    { type: 'email', header: 'courriel' },
    { type: null, header: 'notes' },
    { type: 'phone', header: 'mobile' }
  ]
  const rows = [
    ['Alice Exemple', 'alice@example.com', 'x', '06 39 98 12 34'],
    ['Bob Exemple', 'ALICE@example.com', 'y', 'inconnu'],
    ['Alice Exemple', 'bob@example.org', '', '+33639981234']
  ]

  it('dédoublonne par clé canonique et compte les valeurs écartées', () => {
    const plan = planImport(rows, columns, new Map(), false)
    expect(plan.create.map((e) => `${e.type}:${e.label}`)).toEqual([
      'person:Alice Exemple',
      'email:alice@example.com',
      'phone:+33639981234',
      'person:Bob Exemple',
      'email:bob@example.org'
    ])
    expect(plan.ignored).toBe(1)
    expect(plan.links).toEqual([])
  })

  it('reprend les nœuds déjà présents dans l’enquête', () => {
    const existing = new Map([[canonicalKey('phone', '+33 6 39 98 12 34'), 'node-1']])
    const plan = planImport(rows, columns, existing, false)
    expect(plan.create.some((e) => e.type === 'phone')).toBe(false)
    expect(plan.existing.get(canonicalKey('phone', '0639981234'))).toBe('node-1')
  })

  it('relie chaque ligne à la première colonne, libellé = en-tête', () => {
    const plan = planImport(rows, columns, new Map(), true)
    const alice = canonicalKey('person', 'Alice Exemple')
    const label = (to: string): string | undefined => plan.links.find((l) => l.from === alice && l.to === to)?.label
    expect(label(canonicalKey('email', 'alice@example.com'))).toBe('courriel')
    expect(label(canonicalKey('phone', '+33639981234'))).toBe('mobile')
    expect(label(canonicalKey('email', 'bob@example.org'))).toBe('courriel')
    // Même paire sur deux lignes : un seul lien.
    expect(plan.links.filter((l) => l.from === alice && l.to === canonicalKey('phone', '+33639981234'))).toHaveLength(1)
    expect(plan.links).toHaveLength(4)
  })

  it('range les entités en grille', () => {
    const plan = planImport(rows, columns, new Map(), true)
    const linked = gridLayout(plan.create, columns, true)
    expect(linked.positions[0]).toEqual({ x: 0, y: 0 })
    expect(linked.positions[2]).toEqual({ x: 2 * 220, y: 0 })
    expect(linked.height).toBe(3 * 70)
    const flat = gridLayout(plan.create, columns, false)
    expect(new Set(flat.positions.map((p) => `${p.x},${p.y}`)).size).toBe(plan.create.length)
  })
})
