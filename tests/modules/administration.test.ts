// Annuaire de l'administration (Service-Public.fr) : mairie de Carcassonne et Cour des comptes.
// Les responsables de la fixture sont fictifs.

import { describe, expect, it, type TestContext } from 'vitest'
import { ModuleError, type ModuleOutput } from '@shared/modules'
import annuaire, { annuaireOutput, nameWords, openingHours, pickRecord, whereClause, type AnnuaireResponse } from '../../src/main/modules/administration/annuaire'
import { entity, LIVE, runModule } from '../helpers/context'
import { fakeContext, fixtureJson } from './social_helpers'

const fr = { lang: 'fr' as const }
const mairie = (): AnnuaireResponse => fixtureJson('administration/annuaire_mairie_carcassonne.json')
const cdc = (): AnnuaireResponse => fixtureJson('administration/annuaire_cour_des_comptes.json')

async function liveRun(t: TestContext, run: () => Promise<ModuleOutput>): Promise<ModuleOutput | null> {
  try {
    return await run()
  } catch (e) {
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || /fetch failed/i.test(String((e as Error)?.message))) {
      t.skip()
      return null
    }
    throw e
  }
}

describe('administration.annuaire : recherche', () => {
  it('mots significatifs et clause ODSQL', () => {
    expect(nameWords('Mairie de Carcassonne')).toEqual(['mairie', 'carcassonne'])
    expect(nameWords("Préfecture de l'Aude")).toEqual(['prefecture', 'aude'])
    expect(whereClause('Cour des comptes')).toBe('search(nom, "cour") and search(nom, "comptes")')
    expect(whereClause('de la')).toBeNull()
  })

  it('choisit le service au nom identique', () => {
    expect(pickRecord(mairie().results!, 'Mairie de Carcassonne')?.nom).toBe('Mairie - Carcassonne')
    expect(pickRecord(cdc().results!, 'Cour des comptes')?.nom).toBe('Cour des comptes')
    expect(pickRecord(cdc().results!, 'Cour')).toBeNull()
  })

  it('horaires lisibles', () => {
    expect(openingHours(mairie().results![0].plage_ouverture)).toEqual(['Lundi à Jeudi : 08h30-12h30, 13h30-17h30', 'Vendredi : 08h30-12h30, 13h30-16h00'])
  })
})

describe('administration.annuaire (hors ligne)', () => {
  it('mairie : coordonnées en propriétés et en entités', () => {
    const out = annuaireOutput(fr, mairie().results![0])
    expect(out.properties).toMatchObject({
      name: 'Mairie - Carcassonne',
      siret: '21110069800011',
      siren: '211100698',
      address: '32 rue Aimé-Ramond, 11000 Carcassonne',
      emails: ['contact@mairie-carcassonne.fr'],
      annuaire_id: '7142e92b-9921-4581-b0a2-c08b862ca614'
    })
    expect(out.properties?.websites).toContain('https://www.carcassonne.org/')
    expect(out.properties?.social_networks).toContain('https://x.com/CarcaInfos')
    const by = (type: string) => (out.entities ?? []).filter((e) => e.type === type)
    expect(by('address')[0]).toMatchObject({ label: '32 rue Aimé-Ramond, 11000 Carcassonne', data: { lat: 43.2119725, lon: 2.3530244 } })
    expect(by('phone').map((e) => e.label)).toEqual(['+33468777111', '+33800666641'])
    expect(by('phone')[1].linkLabel).toBe('téléphone (numéro vert)')
    expect(by('email')[0].label).toBe('contact@mairie-carcassonne.fr')
    expect(by('website')[0].label).toBe('https://www.carcassonne.org/')
    expect(by('person')).toHaveLength(0)
  })

  it('juridiction : responsables publiés, avec leur texte de nomination', () => {
    const record = cdc().results!.find((r) => r.nom === 'Cour des comptes')!
    const out = annuaireOutput(fr, record)
    const people = (out.entities ?? []).filter((e) => e.type === 'person')
    expect(people.map((p) => p.label)).toEqual(['Jeanne Exemple', 'Paul Modèle'])
    expect(people[0]).toMatchObject({ linkLabel: 'Première présidente', data: { occupation: 'Première présidente', appointment_url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000000000000' } })
    expect(out.properties).toMatchObject({ kind: 'Juridiction', heads: ['Première présidente : Jeanne Exemple', 'Procureur général : Paul Modèle'] })
  })

  it('module complet : recherche par mots du nom', async () => {
    const ctx = fakeContext([[/api-lannuaire\.service-public\.fr/, { body: mairie() }]])
    const out = await annuaire.run(entity('administration', 'Mairie de Carcassonne'), ctx)
    expect(out.properties?.name).toBe('Mairie - Carcassonne')
    expect(new URL(ctx.calls[0].url).searchParams.get('where')).toBe('search(nom, "mairie") and search(nom, "carcassonne")')
  })

  it('nom ambigu : candidats à vérifier pour une administration, rien pour une organisation', async () => {
    const ctx = fakeContext([[/api-lannuaire\.service-public\.fr/, { body: cdc() }]])
    const out = await annuaire.run(entity('administration', 'Comptes publics'), ctx)
    expect(out.entities?.length).toBe(4)
    expect(out.entities?.every((e) => e.type === 'administration' && e.review)).toBe(true)
    expect(await annuaire.run(entity('organization', 'Comptes publics'), fakeContext([[/api-lannuaire/, { body: cdc() }]]))).toEqual({})
  })

  it('SIRET connu : recherche directe', async () => {
    const ctx = fakeContext([[/api-lannuaire\.service-public\.fr/, { body: mairie() }]])
    await annuaire.run(entity('administration', 'Mairie', { data: { siret: '211 100 698 00011' } }), ctx)
    expect(new URL(ctx.calls[0].url).searchParams.get('where')).toBe('siret = "21110069800011"')
  })
})

describe.skipIf(!LIVE)('administration.annuaire : service réel', () => {
  it('Mairie de Carcassonne', async (t) => {
    const out = await liveRun(t, () => runModule(annuaire, entity('administration', 'Mairie de Carcassonne')))
    if (!out) return
    expect(out.properties?.siret).toBe('21110069800011')
    expect(String(out.properties?.address)).toMatch(/Aimé-Ramond/)
  })
})
