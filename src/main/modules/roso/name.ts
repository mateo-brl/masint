// roso.info : recherche par nom et prénom (page /name/ : un seul appel
// POST /api/gateway/name/search qui renvoie une liste de profils candidats).

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { creditsOf, redact, ROSO_COMMON, RosoClient } from './_client'
import { accountEntities, asArr, asObj, dropEmpty, fullPhone, imageUrl, isEmail, isHttpUrl, pick, pickNum, rosoPlatform, str } from './_parse'

const PAGE = '/name/'
const LOCAL_SOURCES = new Set(['local', 'search', 'unknown', ''])

export function nameEntities(results: unknown, query: string, lang: 'fr' | 'en'): OutEntity[] {
  const out: OutEntity[] = []
  asArr(results)
    .slice(0, 100)
    .forEach((item, i) => {
      const m = asObj(item)
      const name = pick(m, 'name', 'fullName', 'displayName')
      const platformRaw = pick(m, 'platform').toLowerCase()
      const source = pick(m, 'matchSource').toLowerCase()
      const url = pick(m, 'profileUrl', 'url')
      const ref = `cand_${i}`
      const extra = dropEmpty({ match_source: source || undefined, match_score: pickNum(m, 'matchScore', 'score') })
      const isAccount = !LOCAL_SOURCES.has(platformRaw) && !LOCAL_SOURCES.has(source) && (!!rosoPlatform(platformRaw) || isHttpUrl(url) || !!pick(m, 'username'))
      if (isAccount) {
        const ents = accountEntities(
          { ...m, displayName: name, profileUrl: url, location: pick(m, 'location') },
          { site: platformRaw || 'web', query: name || query, ref, lang, linkLabel: lang === 'fr' ? 'profil candidat' : 'candidate profile' }
        )
        ents[0].data = { ...ents[0].data, ...extra }
        out.push(...ents)
        return
      }
      if (!name) return
      out.push({
        ref,
        type: 'person',
        label: name,
        data: dropEmpty({ ...extra, location: pick(m, 'location') || undefined, source: 'roso.info' }),
        image: imageUrl(m.avatar),
        linkLabel: lang === 'fr' ? 'homonyme possible' : 'possible match'
      })
      const email = pick(m, 'email').toLowerCase()
      if (email && isEmail(email)) out.push({ type: 'email', label: email, from: ref, linkLabel: 'email' })
      const phone = fullPhone(m.phone)
      if (phone) out.push({ type: 'phone', label: phone, from: ref, linkLabel: lang === 'fr' ? 'téléphone' : 'phone' })
    })
  return out
}

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.name',
  name: { fr: 'roso.info : nom et prénom', en: 'roso.info: full name' },
  description: {
    fr: 'Recherche roso.info par nom et prénom (et localisation si connue) : profils candidats avec email, pseudo, téléphone et photo. Consomme des crédits roso.info.',
    en: 'roso.info full-name search (and location when known): candidate profiles with email, username, phone and photo. Consumes roso.info credits.'
  },
  inputTypes: ['person'],
  timeoutMs: 180_000,
  async run(input, ctx) {
    const fullName = input.label.trim().replace(/\s+/g, ' ')
    if (fullName.length < 2) throw new ModuleError('Nom trop court', 'invalid_input')
    const location = str(input.data.location) || str(input.data.city) || str(input.data.birth_place)
    const c = new RosoClient(ctx, 'name')
    await c.checkMaintenance('name')

    const bits = fullName.split(' ')
    const firstName = str(input.data.first_name) || (bits.length > 1 ? bits[0] : '')
    const lastName = str(input.data.last_name) || (bits.length > 1 ? bits.slice(1).join(' ') : fullName)
    const res = await c.launch(
      '/api/gateway/name/search',
      { firstName, lastName, location, name: fullName, fullName, query: fullName, q: fullName },
      { page: PAGE, timeoutMs: 150000 }
    )
    const entities = nameEntities(res.results, fullName, ctx.lang)
    return {
      properties: dropEmpty({
        roso_credits_left: creditsOf(res),
        roso_found_count: asArr(res.results).length
      }),
      entities,
      raw: redact(res, c.key)
    }
  }
})
