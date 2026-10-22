// roso.info : numéro partiel (page /partial-number/). Le masque contient 1 ou 2
// étoiles ; chaque combinaison (10 ou 100) est testée sur CallApp, Eyecon,
// AlloVoisins... avec 2,5 s entre deux requêtes, comme le site. 10 crédits par scan.

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { creditsOf, isFatal, redact, ROSO_COMMON, RosoClient, scanProgress, sleep, toRosoError, type Json } from './_client'
import { asObj, avatarOf, dropEmpty, imageUrl, isHttpUrl, isObj, pick, str } from './_parse'

const PAGE = '/partial-number/'
/** Délai entre deux combinaisons (2,5 s sur le site). Modifiable pour les tests. */
export const partialTiming = { delayMs: 2500 }

export interface Combo {
  phone: string
  fill: string
}

/** Développe un masque (`+33 6 12 34 56 *8`) en numéros E.164, comme `expandCombos` du site. */
export function expandMask(raw: string): { ok: boolean; reason?: string; combos: Combo[] } {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const slots: Array<string | null> = []
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '+' && i === 0) continue
    if (/[ \t\-().]/.test(ch)) continue
    if (/\d/.test(ch)) slots.push(ch)
    else if (ch === '*') slots.push(null)
    else return { ok: false, reason: 'junk', combos: [] }
  }
  const wild = slots.filter((x) => x === null).length
  if (wild < 1) return { ok: false, reason: 'no_stars', combos: [] }
  if (wild > 2) return { ok: false, reason: 'too_many_stars', combos: [] }
  if (slots.length < 8 || slots.length > 15) return { ok: false, reason: 'bad_length', combos: [] }
  if (!hasPlus && !/^0[67]/.test(trimmed)) return { ok: false, reason: 'no_country_code', combos: [] }
  const max = wild === 1 ? 10 : 100
  const seen = new Set<string>()
  const combos: Combo[] = []
  for (let n = 0; n < max; n++) {
    const fill = String(n).padStart(wild, '0')
    let w = 0
    const digits = slots.map((x) => (x === null ? fill[w++] : x)).join('')
    const e164 = !hasPlus && digits.length === 10 && digits[0] === '0' ? '+33' + digits.slice(1) : '+' + digits
    if (!/^\+\d{8,15}$/.test(e164) || seen.has(e164)) continue
    seen.add(e164)
    combos.push({ phone: e164, fill })
  }
  return combos.length ? { ok: true, combos } : { ok: false, reason: 'no_valid_e164', combos: [] }
}

interface Hit {
  phone: string
  service: string
  info: Json
}

const TITLES: Record<string, string> = {
  callapp: 'CallApp',
  eyecon: 'Eyecon',
  allovoisins: 'AlloVoisins',
  poteau: 'Poteau',
  cleverdialer: 'CleverDialer',
  moovtogo: 'Moov Togo',
  moovbf: 'Moov BF',
  moovbj: 'Moov BJ',
  moovci: 'Moov CI'
}

function hitEntities(hits: Hit[], lang: 'fr' | 'en'): OutEntity[] {
  const out: OutEntity[] = []
  const byPhone = new Map<string, Hit[]>()
  for (const h of hits) byPhone.set(h.phone, [...(byPhone.get(h.phone) ?? []), h])
  for (const [phone, list] of byPhone) {
    const ref = `cand_${phone}`
    const names = new Set<string>()
    const data: Record<string, string> = {}
    let image: string | undefined
    for (const h of list) {
      const d = asObj(h.info.data ?? h.info.profile)
      const name = pick(h.info, 'name') || pick(d, 'displayName', 'fullName', 'name', 'firstName')
      const city = pick(h.info, 'city') || pick(d, 'city', 'location', 'locationText')
      if (name && name !== city) names.add(name)
      if (city) data.city = city
      if (h.service !== 'eyecon' && !image) image = imageUrl(h.info.avatar) ?? avatarOf(d)
      const url = pick(h.info, 'profileUrl') || pick(d, 'profileUrl', 'website', 'canonical_url')
      if (url && isHttpUrl(url)) data[`${h.service}_url`] = url
    }
    out.push({
      ref,
      type: 'phone',
      label: phone,
      data: dropEmpty({ ...data, roso_services: list.map((h) => TITLES[h.service] ?? h.service), source: 'roso.info (numéro partiel)' }),
      image,
      linkLabel: lang === 'fr' ? 'candidat' : 'candidate'
    })
    for (const n of names) out.push({ type: 'person', label: n, from: ref, linkLabel: lang === 'fr' ? 'nom (caller ID)' : 'name (caller ID)' })
  }
  return out
}

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.partial_number',
  name: { fr: 'roso.info : numéro partiel', en: 'roso.info: partial number' },
  description: {
    fr: 'Retrouve un numéro dont 1 ou 2 chiffres sont masqués par * (ex. +33 6 12 34 56 *8) en testant chaque combinaison sur CallApp, Eyecon, AlloVoisins... 10 crédits roso.info par scan, jusqu’à ~5 min.',
    en: 'Recovers a number with 1 or 2 digits masked by * (e.g. +33 6 12 34 56 *8) by testing every combination on CallApp, Eyecon, AlloVoisins... 10 roso.info credits per scan, up to ~5 min.'
  },
  inputTypes: ['phone', 'keyword'],
  timeoutMs: 900_000,
  accepts: (input) => input.label.includes('*') && expandMask(input.label).ok,
  async run(input, ctx) {
    const exp = expandMask(input.label)
    if (!exp.ok) throw new ModuleError(`Masque invalide (${exp.reason})`, 'invalid_input')
    const c = new RosoClient(ctx, 'partial-number')

    const start = await c.launch('/api/gateway/partial-number/start', {}, { page: PAGE })
    const progress = scanProgress(ctx, exp.combos.length, { fr: 'combinaisons', en: 'combinations' })

    const hits: Hit[] = []
    const errors: string[] = []
    let checked = 0
    let stopped: string | null = null
    for (let i = 0; i < exp.combos.length; i++) {
      const combo = exp.combos[i]
      const before = hits.length
      try {
        const r = await c.post('/api/gateway/partial-number/check', { phone: combo.phone }, { retries: 1, timeoutMs: 45000, throwOnError: false, page: PAGE })
        if (r.status === 401 || r.status === 403) throw toRosoError(r.status, r.data, 'partial-number', ctx.lang)
        checked++
        const results = asObj(r.data.results)
        for (const [svc, val] of Object.entries(results)) {
          if (!isObj(val)) continue
          const err = str(val.error)
          if (/^server_\d+/.test(err)) continue
          if (val.rateLimited || val.sessionExpired || /rate_limit|token_invalid|no_bearer/i.test(err)) {
            if ((svc === 'callapp' || svc === 'eyecon') && (val.rateLimited || /rate_limit|token_invalid/i.test(err))) stopped = `${svc}: ${err || 'rate limit'}`
            continue
          }
          if (err) continue
          const hasHit = val.exists === true && (val.name || val.minimal || val.city || (isObj(val.data) && Object.keys(val.data).length))
          if (hasHit) hits.push({ phone: combo.phone, service: svc, info: val })
        }
      } catch (e) {
        if (isFatal(e)) throw e
        errors.push(`${combo.phone}: ${e instanceof Error ? e.message : String(e)}`)
      }
      progress.tick(combo.phone, hits.length > before)
      if (stopped) break
      if (i < exp.combos.length - 1) await sleep(partialTiming.delayMs, ctx.signal)
    }
    ctx.log(`${checked}/${exp.combos.length} combinaisons, ${hits.length} hits`)

    return {
      properties: dropEmpty({
        roso_credits_left: creditsOf(start),
        roso_combinations: exp.combos.length,
        roso_checked: checked,
        roso_found_count: new Set(hits.map((h) => h.phone)).size,
        roso_stopped: stopped ?? undefined
      }),
      entities: hitEntities(hits, ctx.lang),
      raw: redact({ start, combinations: exp.combos.length, checked, hits, errors, stopped }, c.key)
    }
  }
})
