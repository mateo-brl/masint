// Classement des noms donnés à un numéro par les annuaires d'appelants. Noms fictifs.

import { describe, expect, it } from 'vitest'
import { callerIdSource, callerNamePivots, classifyCallerName, isCallerIdPlatform, joinSources } from '@shared/callerName'
import { isFirstName } from '@shared/firstNames'

const kind = (name: string): string => classifyCallerName(name).kind

describe('classement des noms d’appelant', () => {
  it('pseudo : un seul jeton qui mêle lettres et chiffres', () => {
    expect(kind('ZX445')).toBe('username')
    expect(kind('jdupont_75')).toBe('username')
    expect(kind('Dark.Angel')).toBe('username')
    expect(kind('xXDarkXx')).toBe('username')
    expect(kind('k3v1n')).toBe('username')
    expect(classifyCallerName('  ZX445 ')).toMatchObject({ kind: 'username', value: 'ZX445', key: 'zx445' })
  })

  it('personne : « Prénom Nom » ou nom de famille en capitales', () => {
    expect(kind('Jean Dupont')).toBe('person')
    expect(kind('jean dupont')).toBe('person')
    expect(kind('JEAN DUPONT')).toBe('person')
    expect(kind('DUPONT Jean')).toBe('person')
    expect(kind('Jean-Pierre Martin')).toBe('person')
    expect(kind('Marie-Claire DUBOIS')).toBe('person')
    expect(kind('Marie de la Fontaine')).toBe('person')
    expect(kind('Fatoumata Diallo')).toBe('person')
    expect(kind('Kofi MENSAH')).toBe('person')
    expect(kind('Éloïse Lefèvre')).toBe('person')
  })

  it('personne : qualificatifs retirés autour du nom', () => {
    expect(classifyCallerName('Jean Dupont Pro')).toMatchObject({ kind: 'person', value: 'Jean Dupont', qualifiers: ['Pro'] })
    expect(classifyCallerName('Perso Sophie Martin')).toMatchObject({ kind: 'person', value: 'Sophie Martin', qualifiers: ['Perso'] })
  })

  it('étiquettes génériques : liens, métiers, démarchage, emojis, numéros', () => {
    for (const name of [
      'Spam',
      'SPAM',
      'Arnaque',
      'Démarchage',
      'Inconnu',
      'Livreur',
      'Taxi',
      'Pizza',
      'Maman',
      'Papa',
      'Chéri',
      'Chérie ❤️',
      'Maman ❤️',
      'Boulot',
      'Pro',
      'Médecin',
      'Dr Martin',
      'Ne pas répondre',
      'NE PAS REPONDRE',
      'Livraison Amazon',
      'Chronopost',
      'Service client Orange',
      'Papa Jean',
      'Taxi Jean',
      'Plombier',
      'Plomberie Martin',
      'SARL DUPONT BTP',
      'ACME LTD',
      'WIRELESS CALLER',
      'Scam Likely',
      '🍕',
      'Kevin 🔥',
      '06 12 34 56 78',
      '+33612345678',
      'Unbekannt',
      'Werbung',
      'Kostenfalle'
    ])
      expect(kind(name), name).toBe('tag')
  })

  it('ambigu : prénom seul, nom seul, initiales, mot courant', () => {
    for (const name of ['Dupont', 'Jean', 'Kévin', 'Jean D.', 'J. Dupont', 'M. DUPONT', 'Mme Dupont', 'Bonjour', 'Soleil', 'Le Grand Bleu', 'Durand Lefort', 'darkangel', 'Julien75', 'abc', ''])
      expect(kind(name), name).toBe('ambiguous')
  })

  it('reconnaît les prénoms composés et accentués', () => {
    expect(isFirstName('Jean-Pierre')).toBe(true)
    expect(isFirstName('Hélène')).toBe(true)
    expect(isFirstName('Dupont')).toBe(false)
  })

  it('même personne quel que soit l’ordre des mots ou la casse', () => {
    expect(classifyCallerName('DUPONT Jean').key).toBe(classifyCallerName('jean dupont').key)
  })
})

describe('annuaires d’appelants', () => {
  it('reconnaît les plateformes et sites roso.info', () => {
    expect(callerIdSource('eyecon')).toBe('Eyecon')
    expect(callerIdSource('truecaller')).toBe('Truecaller')
    expect(callerIdSource('sync.me')).toBe('Sync.ME')
    expect(callerIdSource('syncme')).toBe('Sync.ME')
    expect(callerIdSource('viewcaller')).toBe('ViewCaller')
    expect(isCallerIdPlatform('callapp')).toBe(true)
    expect(isCallerIdPlatform('github')).toBe(false)
    expect(isCallerIdPlatform(null)).toBe(false)
  })

  it('cite les annuaires en français et en anglais', () => {
    expect(joinSources(['Eyecon'], 'fr')).toBe('Eyecon')
    expect(joinSources(['Eyecon', 'Truecaller'], 'fr')).toBe('Eyecon et Truecaller')
    expect(joinSources(['Eyecon', 'CallApp', 'Truecaller'], 'en')).toBe('Eyecon, CallApp and Truecaller')
  })
})

describe('pivots des noms d’appelant', () => {
  it('pseudo d’annuaire : suggestion à vérifier, jamais directement dans le graphe', () => {
    const { entities, properties } = callerNamePivots([{ name: 'ZX445', source: 'Eyecon' }], 'fr')
    expect(entities).toEqual([
      expect.objectContaining({
        type: 'username',
        label: 'ZX445',
        review: true,
        strength: 'weak',
        reviewReason: 'nom sous lequel le numéro est enregistré dans Eyecon : peut-être un pseudo'
      })
    ])
    expect(properties).toEqual({ caller_names: ['ZX445 (Eyecon)'] })
  })

  it('personne vue dans plusieurs annuaires : un seul nœud à vérifier, annuaires cités', () => {
    const { entities, properties } = callerNamePivots(
      [
        { name: 'Jean Dupont', source: 'Eyecon' },
        { name: 'DUPONT Jean', source: 'Truecaller' },
        { name: 'Jean Dupont', source: 'Eyecon' }
      ],
      'fr'
    )
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({ type: 'person', label: 'Jean Dupont', review: true, reviewReason: 'nom donné au numéro, vu dans Eyecon et Truecaller' })
    expect(entities[0].data).toMatchObject({ caller_id_sources: ['Eyecon', 'Truecaller'] })
    expect(properties.caller_names).toEqual(['Jean Dupont (Eyecon, Truecaller)'])
  })

  it('étiquettes et noms ambigus : propriétés seulement, aucune entité', () => {
    const { entities, properties } = callerNamePivots(
      [
        { name: 'Spam', source: 'CallApp' },
        { name: 'Maman ❤️', source: 'Eyecon' },
        { name: 'Livraison Amazon', source: 'Truecaller' },
        { name: 'Dupont', source: 'Sync.ME' }
      ],
      'fr'
    )
    expect(entities).toEqual([])
    expect(properties.caller_tags).toEqual(['Spam (CallApp)', 'Maman ❤️ (Eyecon)', 'Livraison Amazon (Truecaller)'])
    expect(properties.caller_names).toEqual(['Dupont (Sync.ME)'])
  })

  it('raisons en anglais', () => {
    const { entities } = callerNamePivots([{ name: 'ZX445', source: 'Eyecon' }, { name: 'zx445', source: 'CallApp' }], 'en')
    expect(entities[0].reviewReason).toBe('name the number is saved under, seen in Eyecon and CallApp: maybe a username')
  })

  it('aucun tiret long dans les raisons', () => {
    const { entities } = callerNamePivots([{ name: 'Jean Dupont', source: 'Eyecon' }, { name: 'ZX445', source: 'Eyecon' }], 'fr')
    expect(JSON.stringify(entities)).not.toMatch(/[–—]/)
  })
})
