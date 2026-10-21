import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import { carrier, geocoder, timezones } from 'libphonenumber-geo-carrier'
import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { findPlatformByName } from '@shared/platforms'

const LINE_TYPES: Record<string, { fr: string; en: string }> = {
  MOBILE: { fr: 'Mobile', en: 'Mobile' },
  FIXED_LINE: { fr: 'Fixe', en: 'Fixed line' },
  FIXED_LINE_OR_MOBILE: { fr: 'Fixe ou mobile', en: 'Fixed line or mobile' },
  VOIP: { fr: 'VoIP', en: 'VoIP' },
  TOLL_FREE: { fr: 'Numéro gratuit', en: 'Toll free' },
  PREMIUM_RATE: { fr: 'Surtaxé', en: 'Premium rate' },
  SHARED_COST: { fr: 'Coût partagé', en: 'Shared cost' },
  PERSONAL_NUMBER: { fr: 'Numéro personnel', en: 'Personal number' },
  PAGER: { fr: 'Pager', en: 'Pager' },
  UAN: { fr: 'UAN', en: 'UAN' },
  VOICEMAIL: { fr: 'Messagerie vocale', en: 'Voicemail' }
}

export default defineModule({
  id: 'phone.info',
  name: { fr: 'Analyse du numéro', en: 'Number analysis' },
  description: {
    fr: "Format, pays, type de ligne, zone géographique, fuseau horaire et opérateur d'origine (base libphonenumber, hors ligne).",
    en: 'Format, country, line type, region, timezone and original carrier (libphonenumber data, offline).'
  },
  category: 'phone',
  inputTypes: ['phone'],
  async run(input, ctx) {
    const parsed = parsePhoneNumberFromString(input.label, 'FR')
    if (!parsed) throw new ModuleError('Numéro non reconnu', 'invalid_input')
    const locale = ctx.lang === 'fr' ? ('fr' as const) : ('en' as const)
    const [carrierName, region, tz] = await Promise.all([
      carrier(parsed, 'en').catch(() => null),
      geocoder(parsed, locale).catch(() => null),
      timezones(parsed).catch(() => null)
    ])
    const type = parsed.getType()
    const countryName = parsed.country
      ? (new Intl.DisplayNames([locale], { type: 'region' }).of(parsed.country) ?? parsed.country)
      : null

    const entities: OutEntity[] = []
    if (carrierName) {
      const platform = findPlatformByName(carrierName, 'carrier')
      entities.push({
        type: 'carrier',
        label: carrierName,
        platform: platform?.id,
        data: { country: countryName, network: region ?? undefined } as Record<string, string>,
        linkLabel: ctx.lang === 'fr' ? 'opérateur d’origine' : 'original carrier'
      })
    }
    if (countryName) {
      entities.push({ type: 'country', label: countryName, data: { code: parsed.country ?? '' } })
    }

    return {
      properties: {
        e164: parsed.number,
        national: parsed.formatNational(),
        international: parsed.formatInternational(),
        country: countryName,
        valid: parsed.isValid(),
        line_type: type ? (LINE_TYPES[type]?.[locale] ?? type) : null,
        carrier: carrierName,
        region,
        timezones: tz ?? []
      },
      entities,
      raw: { number: parsed.number, country: parsed.country, type, carrier: carrierName, region, timezones: tz }
    }
  }
})
