// LeakCheck Pro (API v2, clé de l'utilisateur) : emails, pseudos et noms associés, jamais les
// mots de passe. Réponse fictive qui contient des mots de passe, empreintes, sels et jetons.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModuleError, type FetchOptions } from '@shared/modules'
import emailPro from '../../src/main/modules/email/leakcheckPro'
import phonePro from '../../src/main/modules/phone/leakcheckPro'
import { leakcheckError, readLeakcheck, sanitizeRow } from '../../src/main/modules/email/_leakcheckPro'
import { entity, makeContext, runModule } from '../helpers/context'

const body = readFileSync(resolve(__dirname, '../fixtures/email/leakcheck_pro.json'), 'utf8')
const KEY = 'cle-fictive-leakcheck-0000000000000000000000'
const SECRETS = ['MotDePasseFictif-123!', 'AutreSecretFictif', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', 'sel-fictif-9f2c', '$2y$10$fictif', 'jeton-fictif-abcdef', KEY]

function proContext(reply: { status?: number; body: string }) {
  const calls: Array<{ url: string; init?: FetchOptions }> = []
  const ctx = {
    ...makeContext({ keys: { leakcheck: KEY } }),
    fetch: async (url: string, init?: FetchOptions) => {
      calls.push({ url, init })
      return new Response(reply.body, { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } })
    }
  }
  return { ctx, calls }
}

describe('LeakCheck Pro', () => {
  it('déclare la clé, à la demande seulement', () => {
    for (const m of [emailPro, phonePro]) {
      expect(m.ondemand).toBe(true)
      expect(m.keys).toEqual([{ id: 'leakcheck', label: 'LeakCheck API key (Pro API v2)', url: 'https://leakcheck.io/settings' }])
      expect(JSON.stringify([m.name, m.description])).not.toMatch(/[–—]/)
    }
  })

  it('écarte les champs secrets dès la lecture de la réponse', () => {
    const parsed = readLeakcheck(body)
    expect(parsed).toMatchObject({ success: true, found: 4, quota: 397 })
    const text = JSON.stringify(parsed)
    for (const s of SECRETS) expect(text).not.toContain(s)
    expect(text).not.toMatch(/"(password|hash|salt|token|password_hash)"/)
    expect(parsed.rows[0]).toEqual({
      source: 'ExempleForum.fr',
      date: '2019-07',
      email: 'camille.exemple@example.org',
      username: 'camexemple_77',
      first_name: 'Camille',
      last_name: 'Exemple',
      dob: '01/04/1990',
      address: "1 rue de l'Exemple, 75000 Paris"
    })
    // Une ligne passée directement ne garde que les champs autorisés.
    expect(sanitizeRow({ source: { name: 'X' }, password: 'p', email: 'a@b.fr', ip: '192.0.2.1' })).toEqual({ source: 'X', email: 'a@b.fr' })
  })

  it('numéro : requête v2 avec la clé en en-tête, suggestions à vérifier, aucun secret nulle part', async () => {
    const { ctx, calls } = proContext({ body })
    const out = await runModule(phonePro, entity('phone', '06 39 98 12 34'), ctx)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://leakcheck.io/api/v2/query/33639981234')
    expect(calls[0].init?.query).toMatchObject({ type: 'phone' })
    expect((calls[0].init?.headers as Record<string, string>)['x-api-key']).toBe(KEY)

    const byLabel = Object.fromEntries((out.entities ?? []).map((e) => [`${e.type}:${e.label}`, e]))
    expect(Object.keys(byLabel).sort()).toEqual(['email:camille.exemple@example.org', 'person:Camille Exemple', 'person:Dominique Fictif', 'username:camexemple_77', 'username:qw778'])
    expect((out.entities ?? []).every((e) => e.review && e.strength === 'weak')).toBe(true)
    expect(byLabel['email:camille.exemple@example.org'].reviewReason).toBe('présent avec ce numéro dans les fuites ExempleForum.fr (2019-07) et BoutiqueFictive.com (2021-02)')
    expect(byLabel['username:qw778'].reviewReason).toBe('présent avec ce numéro dans la fuite Infostealer logs (2024-05-12)')
    expect(byLabel['person:Camille Exemple'].data).toMatchObject({ birth_date: '1990-04-01', address: "1 rue de l'Exemple, 75000 Paris" })
    expect(out.properties).toMatchObject({ leakcheck_rows: 4 })

    // Le mot de passe, les empreintes, les sels, le jeton et la clé n'apparaissent nulle part.
    const all = JSON.stringify(out)
    for (const s of SECRETS) expect(all).not.toContain(s)
    expect(all).not.toMatch(/"(password|hash|salt|token)"/)
  })

  it('email : la valeur cherchée n’est pas reproposée', async () => {
    const { ctx, calls } = proContext({ body })
    const out = await runModule(emailPro, entity('email', 'Camille.Exemple@example.org'), ctx)
    expect(calls[0].url).toBe('https://leakcheck.io/api/v2/query/camille.exemple%40example.org')
    expect(calls[0].init?.query).toMatchObject({ type: 'email' })
    expect(out.entities?.some((e) => e.type === 'email')).toBe(false)
    expect(out.entities?.find((e) => e.label === 'camexemple_77')?.reviewReason).toMatch(/^présent avec cette adresse dans les fuites/)
  })

  it('au plus 20 suggestions', async () => {
    const result = Array.from({ length: 30 }, (_, i) => ({ email: `fictif${i}@example.org`, source: { name: `Fuite${i}`, breach_date: '2020' } }))
    const { ctx } = proContext({ body: JSON.stringify({ success: true, found: 30, quota: 1, result }) })
    const out = await runModule(phonePro, entity('phone', '+33639981234'), ctx)
    expect(out.entities).toHaveLength(20)
  })

  it('rien trouvé, clé refusée, quota atteint', async () => {
    const empty = await runModule(phonePro, entity('phone', '+33639981234'), proContext({ body: '{"success":true,"found":0,"quota":3,"result":[]}' }).ctx)
    expect(empty.entities).toBeUndefined()
    expect(empty.properties).toEqual({ leakcheck_rows: 0 })
    const refused = await runModule(phonePro, entity('phone', '+33639981234'), proContext({ status: 400, body: '{"success":false,"error":"Invalid X-API-Key"}' }).ctx).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(ModuleError)
    expect((refused as ModuleError).code).toBe('auth')
    expect((refused as ModuleError).message).not.toContain(KEY)
    expect(leakcheckError(403, 'Limit reached').code).toBe('rate_limited')
    expect(leakcheckError(403, 'Active plan required').code).toBe('auth')
    expect(leakcheckError(429, 'Too many requests').code).toBe('rate_limited')
    expect(leakcheckError(422, 'Could not determine search type automatically').code).toBe('invalid_input')
  })
})
