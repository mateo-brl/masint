// Numéro de TVA intracommunautaire vérifié auprès du service VIES de la Commission européenne :
// validité, raison sociale et adresse déclarées (selon les pays).

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, serviceError, tr } from '../misc/_util'
import { countryName } from '../finance/iban'

const API = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number'
const EMPTY = '---'

export interface ViesResponse {
  countryCode?: string
  vatNumber?: string
  requestDate?: string
  valid?: boolean
  name?: string
  address?: string
  actionSucceed?: boolean
  errorWrappers?: Array<{ error: string; message?: string }>
}

/** `FR 27 552 032 534` → `{ country: 'FR', number: '27552032534' }`. Grèce : `EL`. */
export function parseVat(raw: string): { country: string; number: string } | null {
  const s = raw.replace(/[\s.\-/]/g, '').toUpperCase()
  const m = s.match(/^([A-Z]{2})([0-9A-Z+*]{2,12})$/)
  if (!m) return null
  return { country: m[1] === 'GR' ? 'EL' : m[1], number: m[2] }
}

/** Clé du numéro de TVA français (2 chiffres) cohérente avec le SIREN. */
export function frenchKeyOk(number: string): boolean | null {
  if (!/^\d{11}$/.test(number)) return null
  const siren = Number(number.slice(2))
  return (12 + 3 * (siren % 97)) % 97 === Number(number.slice(0, 2))
}

function viesError(code: string): ModuleError {
  if (code === 'INVALID_INPUT' || code === 'INVALID_REQUESTER_INFO') return new ModuleError('VIES : numéro de TVA mal formé', 'invalid_input')
  if (/CONCURRENT_REQ/.test(code)) return new ModuleError(`VIES : service du pays saturé (${code}), réessayer plus tard`, 'rate_limited')
  if (/UNAVAILABLE|TIMEOUT/.test(code)) return new ModuleError(`VIES : service du pays indisponible (${code})`, 'unavailable')
  return new ModuleError(`VIES : ${code}`, 'other')
}

const clean = (s: string | undefined): string | null => {
  const v = (s ?? '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').replace(/^,\s*|,\s*$/g, '').trim()
  return v && v !== EMPTY ? v : null
}

export function viesOutput(ctx: Pick<ModuleContext, 'lang'>, d: ViesResponse): ModuleOutput {
  if (d.actionSucceed === false) throw viesError(d.errorWrappers?.[0]?.error ?? 'UNKNOWN')
  const country = d.countryCode ?? ''
  const number = d.vatNumber ?? ''
  const name = clean(d.name)
  const address = clean(d.address)
  const full = `${country}${number}`
  const properties: ModuleOutput['properties'] = {
    valid: !!d.valid,
    country: countryName(country === 'EL' ? 'GR' : country === 'XI' ? 'GB' : country, ctx.lang),
    registered_name: name,
    registered_address: address,
    checked_at: d.requestDate ?? null
  }
  const siren = country === 'FR' && /^\d{11}$/.test(number) ? number.slice(2) : null
  if (siren) {
    properties.siren = siren
    properties.key_ok = frenchKeyOk(number)
  }
  const entities: OutEntity[] = []
  if (d.valid && (name || siren)) {
    entities.push({
      ref: 'company',
      type: 'company',
      label: name ?? siren!,
      data: { vat: full, address, siren },
      linkLabel: tr(ctx, 'titulaire', 'holder')
    })
    if (address) entities.push({ type: 'address', label: address, from: 'company', linkLabel: tr(ctx, 'adresse déclarée', 'registered address') })
  }
  return { properties: compact(properties!), entities, raw: d }
}

const TRANSIENT = /CONCURRENT_REQ|UNAVAILABLE|TIMEOUT/

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true })
  })
}

async function check(ctx: ModuleContext, country: string, number: string): Promise<ViesResponse> {
  try {
    return await ctx.fetchJson<ViesResponse>(API, { method: 'POST', json: { countryCode: country, vatNumber: number }, timeoutMs: 30000 })
  } catch (e) {
    throw serviceError(e, 'VIES')
  }
}

export default defineModule({
  id: 'company.vies',
  name: { fr: 'TVA intracommunautaire (VIES)', en: 'EU VAT number (VIES)' },
  description: {
    fr: "Vérifie un numéro de TVA européen auprès de VIES (Commission européenne) et récupère la raison sociale et l'adresse déclarées quand le pays les publie. Pour la France, déduit le SIREN.",
    en: 'Checks a European VAT number with VIES (European Commission) and returns the registered name and address when the country publishes them. For France, derives the SIREN.'
  },
  category: 'company',
  inputTypes: ['vat'],
  homepage: 'https://ec.europa.eu/taxation_customs/vies/',
  async run(input, ctx) {
    const vat = parseVat(input.label)
    if (!vat) throw new ModuleError('Numéro de TVA non reconnu (préfixe pays attendu, ex. FR...)', 'invalid_input')
    let d = await check(ctx, vat.country, vat.number)
    // Services nationaux souvent saturés (le service français l'est souvent) : trois nouvelles
    // tentatives espacées.
    for (const delay of [3000, 6000, 12000]) {
      if (!(d.actionSucceed === false && TRANSIENT.test(d.errorWrappers?.[0]?.error ?? ''))) break
      await wait(delay, ctx.signal)
      d = await check(ctx, vat.country, vat.number)
    }
    // Service toujours indisponible : pour la France, le SIREN se déduit sans VIES.
    if (d.actionSucceed === false && TRANSIENT.test(d.errorWrappers?.[0]?.error ?? '') && vat.country === 'FR' && /^\d{11}$/.test(vat.number)) {
      return { properties: { siren: vat.number.slice(2), key_ok: frenchKeyOk(vat.number), vies_status: tr(ctx, 'VIES indisponible, réessayer plus tard', 'VIES unavailable, try again later') } }
    }
    return viesOutput(ctx, d)
  }
})
