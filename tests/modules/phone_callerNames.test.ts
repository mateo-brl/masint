// phone.caller_names : nom donné au numéro par un annuaire d'appelants, sur un compte ou un
// numéro venu d'ailleurs que du scan roso.info. Valeurs fictives, aucune requête.

import { describe, expect, it } from 'vitest'
import callerNames, { alreadyClassified, callerNameOf, callerSourcesOf } from '../../src/main/modules/phone/callerNames'
import { entity, makeContext, runModule } from '../helpers/context'

const account = (platform: string | null, label: string, data: Record<string, string> = {}) => entity('account', label, { platform, data })

describe('phone.caller_names', () => {
  it('accepte les comptes d’annuaires d’appelants qui ont un nom, une seule fois', () => {
    expect(callerNames.accepts!(account('eyecon', 'ZX445', { display_name: 'ZX445' }))).toBe(true)
    expect(callerNames.accepts!(account('truecaller', 'Jean Dupont'))).toBe(true)
    // Compte hors catalogue de roso.info : annuaire lu dans `site`, nom sans le suffixe.
    expect(callerNames.accepts!(account(null, 'QW778 (ViewCaller)', { site: 'viewcaller' }))).toBe(true)
    expect(callerNameOf(account(null, 'QW778 (ViewCaller)', { site: 'viewcaller' }))).toBe('QW778')
    // Autres plateformes, compte sans nom, compte déjà classé (par roso.info).
    expect(callerNames.accepts!(account('github', 'zx445'))).toBe(false)
    expect(callerNames.accepts!(account('eyecon', '+33600000000'))).toBe(false)
    expect(callerNames.accepts!(account('eyecon', 'ZX445', { caller_name_kind: 'username' }))).toBe(false)
  })

  it('accepte un numéro qui porte un nom d’appelant non classé', () => {
    const phone = entity('phone', '+15550100000', { data: { twilio_caller_name: 'DUPONT JEAN' } })
    expect(callerSourcesOf(phone)).toEqual([{ name: 'DUPONT JEAN', source: 'Twilio (CNAM)' }])
    expect(callerNames.accepts!(phone)).toBe(true)
    expect(alreadyClassified(entity('phone', '+15550100000', { data: { caller_tags: ['Spam (Eyecon)'] } }))).toBe(true)
  })

  it('pseudo d’annuaire : suggestion à vérifier sur le compte', async () => {
    const out = await runModule(callerNames, account('eyecon', 'ZX445', { display_name: 'ZX445' }), makeContext())
    expect(out.entities).toEqual([
      expect.objectContaining({
        type: 'username',
        label: 'ZX445',
        review: true,
        reviewReason: 'nom sous lequel le numéro est enregistré dans Eyecon : peut-être un pseudo'
      })
    ])
    expect(out.properties).toEqual({ caller_names: ['ZX445 (Eyecon)'], caller_name_kind: 'username' })
  })

  it('personne : suggestion à vérifier ; étiquette : propriété seulement', async () => {
    const person = await runModule(callerNames, account('truecaller', 'Jean Dupont'), makeContext())
    expect(person.entities).toEqual([expect.objectContaining({ type: 'person', label: 'Jean Dupont', review: true, reviewReason: 'nom donné au numéro dans Truecaller' })])
    const tag = await runModule(callerNames, account('callapp', 'Maman ❤️'), makeContext())
    expect(tag.entities).toEqual([])
    expect(tag.properties).toEqual({ caller_tags: ['Maman ❤️ (CallApp)'], caller_name_kind: 'tag' })
  })
})
