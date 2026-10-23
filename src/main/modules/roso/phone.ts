// roso.info : scan d'un numéro (application /app/phone : phone/log puis
// /api/autocheck/check/<plateforme> par lots de 3, HLR Twilio, FunStat).

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { findPlatformByName } from '@shared/platforms'
import { normalizePhone } from '@shared/detect'
import { callerIdSource, callerNamePivots, classifyCallerName, type CallerNameSource } from '@shared/callerName'
import { localizeCountry, MAX_LIST_ENTITIES } from '../domain/_util'
import { creditsOf, isFatal, redact, ROSO_COMMON, RosoClient, scanProgress, sleep, toRosoError, type Json } from './_client'
import {
  accountEntities,
  addGeneric,
  addressEntity,
  asArr,
  asObj,
  displayNameOf,
  dropEmpty,
  isDomain,
  isObj,
  pick,
  pivotProperties,
  siteName,
  stealerEntities,
  str
} from './_parse'
import { PHONE_PLATFORMS } from './_sites'

const PAGE = '/app/phone'
const BATCH = 3
/** Pause entre deux lots de 3 vérifications (200 ms sur le site). Modifiable pour les tests. */
export const phoneTiming = { batchDelayMs: 200 }
const CLIENT = { 'x-roso-client': 'phone' }

export function phonePlatforms(phone: string): string[] {
  const gb = phone.startsWith('+44')
  const fr = phone.startsWith('+33')
  return PHONE_PLATFORMS.filter((p) => (p === 'phonely' ? gb : p === 'callfilter' ? gb || fr : true))
}

interface Result {
  platform: string
  exists: boolean | null
  data: Json
  message?: string
}

/**
 * Lecture d'une réponse Twilio Lookup v2, brute ou enveloppée dans `data`. Le site affiche aussi
 * la validité du numéro (`valid`), son pays (`country_code`) et le nom d'appelant (`caller_name`).
 */
export function parseTwilio(body: Json, lang: 'fr' | 'en' = 'fr'): Record<string, PropValue | undefined> {
  const root = asObj(body.data ?? body)
  const m = root.phone_number || root.national_format ? root : asObj(root.data)
  const lti = asObj(m.line_type_intelligence)
  const carrier = asObj(m.carrier)
  const status = asObj(m.line_status)
  const lineType = asObj(root.lineType)
  const valid = m.valid ?? root.validNumber
  const country = pick(m, 'country_code') || pick(root, 'countryCode')
  return {
    twilio_valid: typeof valid === 'boolean' ? valid : undefined,
    twilio_country: /^[a-z]{2}$/i.test(country) ? (localizeCountry(null, country, lang) ?? undefined) : undefined,
    twilio_caller_name: pick(asObj(m.caller_name), 'caller_name') || undefined,
    national: pick(m, 'national_format') || undefined,
    carrier: pick(lti, 'carrier_name') || pick(carrier, 'name') || pick(lineType, 'carrier') || undefined,
    line_type: pick(lti, 'type') || pick(lineType, 'type') || undefined,
    mccmnc: [pick(lti, 'mobile_country_code') || pick(carrier, 'mobile_country_code'), pick(lti, 'mobile_network_code') || pick(carrier, 'mobile_network_code')]
      .filter(Boolean)
      .join('/') || undefined,
    hlr_status: pick(status, 'status') || pick(root, 'lineStatus') || undefined
  }
}

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.phone',
  name: { fr: 'roso.info : téléphone', en: 'roso.info: phone' },
  description: {
    fr: "Scan roso.info d'un numéro : ~55 vérifications (messageries, réseaux sociaux, annuaires, caller ID, Hudson Rock, HLR). Consomme des crédits roso.info.",
    en: 'roso.info phone scan: ~55 checks (messaging, social networks, directories, caller ID, Hudson Rock, HLR). Consumes roso.info credits.'
  },
  inputTypes: ['phone'],
  timeoutMs: 600_000,
  accepts: (input) => !input.label.includes('*') && !!normalizePhone(input.label),
  async run(input, ctx) {
    const phone = normalizePhone(input.label)
    if (!phone) throw new ModuleError('Numéro non reconnu', 'invalid_input')
    const c = new RosoClient(ctx, 'phone')
    const platforms = phonePlatforms(phone)
    const progress = scanProgress(ctx, platforms.length, { fr: 'plateformes', en: 'platforms' })
    await c.checkMaintenance('phone')

    // Lancement : c'est cet appel qui ouvre la session téléphone et débite le crédit.
    const log = await c.request('/api/gateway/phone/log', { method: 'POST', json: { phone }, headers: CLIENT, retries: 0, throwOnError: false, page: PAGE })
    if ([401, 403, 429].includes(log.status) || log.data.captcha === true) throw toRosoError(log.status, log.data, 'phone', ctx.lang)

    const results: Result[] = []
    const errors: Record<string, string> = {}
    let hlr: Record<string, PropValue | undefined> = {}

    const check = async (platform: string): Promise<void> => {
      try {
        if (platform === 'twilio') {
          const r = await c.get(`/api/gateway/twilio/lookup/${encodeURIComponent(phone)}`, {
            query: { fields: 'line_type_intelligence,line_status' },
            timeoutMs: 25000,
            throwOnError: false,
            page: PAGE
          })
          if (r.status === 401) throw toRosoError(401, r.data, 'phone', ctx.lang)
          hlr = r.ok ? parseTwilio(r.data, ctx.lang) : {}
          results.push({ platform, exists: r.ok && !!hlr.carrier, data: r.data })
          return
        }
        if (platform === 'phonely' || platform === 'callfilter') {
          const r = await c.get(`/api/gateway/twilio/${platform}/${encodeURIComponent(phone)}`, { timeoutMs: 25000, throwOnError: false, page: PAGE })
          if (r.status === 401) throw toRosoError(401, r.data, 'phone', ctx.lang)
          results.push({ platform, exists: r.data.skipped ? false : r.data.success === true, data: asObj(r.data.data) })
          return
        }
        const r = await c.post(`/api/autocheck/check/${encodeURIComponent(platform)}`, { phoneNumber: phone }, {
          headers: CLIENT,
          timeoutMs: 45000,
          retries: 1,
          throwOnError: false,
          page: PAGE
        })
        if (r.status === 401) throw toRosoError(401, r.data, 'phone', ctx.lang)
        const d = r.data
        const exists = d.exists === true || d.found === true ? true : d.exists === false ? false : null
        if (!r.ok || (exists === null && (d.error || d.code))) errors[platform] = str(d.code) || str(d.error) || str(d.message) || `HTTP ${r.status}`
        results.push({ platform, exists, data: isObj(d.data) ? d.data : isObj(d.profile) ? d.profile : d, message: str(d.message) || undefined })
      } catch (e) {
        if (isFatal(e)) throw e
        errors[platform] = e instanceof Error ? e.message : String(e)
      } finally {
        progress.tick(siteName(platform), platform !== 'twilio' && results.some((r) => r.platform === platform && r.exists === true))
      }
    }

    for (let i = 0; i < platforms.length; i += BATCH) {
      if (ctx.signal.aborted) break
      await Promise.all(platforms.slice(i, i + BATCH).map(check))
      if (i + BATCH < platforms.length) await sleep(phoneTiming.batchDelayMs, ctx.signal)
    }

    // FunStat (statistiques Telegram) quand Telegram renvoie un identifiant.
    const tg = results.find((r) => r.platform === 'telegram' && r.exists)
    const tgId = tg ? pick(tg.data, 'userId', 'user_id', 'id') : ''
    if (tgId) {
      const r = await c.get('/api/funstat', { query: { id: tgId, api_key: c.key }, timeoutMs: 10000, retries: 0, throwOnError: false, page: PAGE }).catch(() => null)
      if (r?.ok && r.data.found) results.push({ platform: 'funstat', exists: true, data: r.data })
    }

    const entities: OutEntity[] = []
    const found = results.filter((r) => r.exists === true)
    // Noms donnés au numéro par les annuaires d'appelants (et le nom d'appelant de Twilio).
    const callerNames: CallerNameSource[] = []
    for (const r of found) {
      const p = r.data
      if (r.platform === 'twilio') continue
      if (r.platform === 'hudsonrock') {
        entities.push(...stealerEntities(p.stealers, { refPrefix: 'hr', lang: ctx.lang }))
        continue
      }
      if (r.platform === 'reversewhois') {
        // WHOIS inversé : 10 domaines en entités, la liste complète reste dans la réponse brute.
        for (const d of asArr(p.domains ?? p.domainList ?? p.results).slice(0, MAX_LIST_ENTITIES)) {
          const name = (isObj(d) ? pick(d, 'domain', 'name', 'value') : str(d)).toLowerCase()
          if (isDomain(name)) entities.push({ type: 'domain', label: name, linkLabel: 'reverse WHOIS' })
        }
        continue
      }
      const ref = `acc_${r.platform}`
      const out = accountEntities(p, { site: r.platform, query: phone, ref, lang: ctx.lang })
      const callerSource = callerIdSource(r.platform)
      const callerName = callerSource ? displayNameOf(p) : ''
      if (callerSource && callerName) {
        callerNames.push({ name: callerName, source: callerSource })
        // Nom déjà classé : `phone.caller_names` ne le reprend pas sur ce compte.
        out[0].data = { ...out[0].data, caller_name_kind: classifyCallerName(callerName).kind }
      }
      const addr = addressEntity(p, ref, ctx.lang)
      if (addr) out.push(addr)
      addGeneric(out, p, ref, phone, ctx.lang)
      entities.push(...out)
    }
    if (hlr.carrier) {
      const platform = findPlatformByName(String(hlr.carrier), 'carrier')
      entities.push({
        type: 'carrier',
        label: String(hlr.carrier),
        platform: platform?.id,
        data: dropEmpty({ mccmnc: hlr.mccmnc }),
        linkLabel: ctx.lang === 'fr' ? 'opérateur (HLR)' : 'carrier (HLR)'
      })
    }

    // Noms d'appelant : personnes et pseudos à vérifier, étiquettes en propriétés. Les noms
    // identiques de plusieurs annuaires sont regroupés (« vu dans Eyecon et CallApp »).
    if (hlr.twilio_caller_name) callerNames.push({ name: String(hlr.twilio_caller_name), source: 'Twilio (CNAM)' })
    const callers = callerNamePivots(callerNames, ctx.lang)
    entities.push(...callers.entities)

    // Pivots regroupés sur le numéro : emails et téléphones masqués, lieux (bloc « Pivots » du site).
    const pivots = pivotProperties(
      found.filter((r) => r.platform !== 'twilio').map((r) => ({ site: r.platform, profile: r.data })),
      phone,
      ctx.lang
    )

    return {
      properties: dropEmpty({
        carrier: hlr.carrier,
        line_type: hlr.line_type,
        hlr_status: hlr.hlr_status,
        twilio_valid: hlr.twilio_valid,
        twilio_country: hlr.twilio_country,
        twilio_caller_name: hlr.twilio_caller_name,
        ...callers.properties,
        ...pivots,
        roso_credits_left: creditsOf(log.data),
        roso_found_count: found.filter((r) => r.platform !== 'twilio').length,
        roso_platforms_checked: platforms.length,
        roso_errors: Object.keys(errors).length,
        roso_found_on: found.filter((r) => r.platform !== 'twilio').map((r) => siteName(r.platform))
      }),
      entities,
      raw: redact({ log: log.data, results, errors }, c.key)
    }
  }
})
