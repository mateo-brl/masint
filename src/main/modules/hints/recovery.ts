// Collecte d'indices de récupération masqués : interroge les services dont l'étape de
// connexion ou de récupération affiche un email ou un téléphone de secours masqué avant
// tout envoi (voir _services.ts pour le détail de chaque service et le moment où un code
// partirait). Les indices rejoignent « Emails masqués » et « Téléphones masqués » de
// l'entité, suivis du service entre parenthèses, comme ceux de roso.info.
//
// Services écartés après étude : Google, Yahoo, X, Instagram, Snapchat, PayPal, eBay,
// Facebook, Apple, OK.ru, Mail.ru et Samsung (captcha, session, anti-robot, ou indice
// visible seulement après l'envoi d'un code). Amazon n'est pas repris : email.amazon et
// phone.amazon lisent déjà ses indices (`recovery_hints`), que le recoupement exploite.

import { defineModule, ModuleError, type ModuleContext } from '@shared/modules'
import { compact, splitEmail } from '../email/_lib'
import { adobeHints, e164, microsoftHints, type ServiceHints } from './_services'

interface Service {
  name: string
  types: string[]
  run(ctx: ModuleContext, query: string): Promise<ServiceHints>
}

const SERVICES: Service[] = [
  { name: 'Microsoft', types: ['email', 'phone'], run: microsoftHints },
  { name: 'Adobe', types: ['email'], run: adobeHints }
]

const MASKED = /[*•●∗·⋅…■▪◦]/

/** Valeur interrogée : adresse en minuscules ou numéro E.164. */
export function queryOf(type: string, label: string): string | null {
  if (MASKED.test(label)) return null
  if (type === 'email') return splitEmail(label)?.email ?? null
  if (type === 'phone') return e164(label)
  return null
}

const withSource = (values: string[], service: string): string[] => values.map((v) => `${v} (${service})`)

export default defineModule({
  id: 'hints.recovery',
  name: { fr: 'Indices de récupération masqués', en: 'Masked recovery hints' },
  description: {
    fr: "Lit l'email et le téléphone de secours masqués (a•••••@g•••••.com) que Microsoft et Adobe affichent à l'étape de connexion, avant tout envoi de code. Microsoft est interrogé avec la connexion par code et Authenticator désactivées ; Adobe en lecture seule (l'envoi exige un captcha). Signalé par précaution : l'absence d'envoi n'a pas pu être vérifiée sur un compte Microsoft sans mot de passe.",
    en: 'Reads the masked backup email and phone (a•••••@g•••••.com) that Microsoft and Adobe show at the sign-in step, before any code is sent. Microsoft is queried with code sign-in and Authenticator disabled; Adobe read-only (sending requires a captcha). Flagged as a precaution: the absence of any message could not be verified on a passwordless Microsoft account.'
  },
  category: 'email',
  inputTypes: ['email', 'phone'],
  noisy: true,
  // Risque résiduel d'envoi côté Microsoft pour un compte sans mot de passe : jamais automatique.
  ondemand: true,
  experimental: true,
  accepts: (input) => !!queryOf(input.type, input.label),
  async run(input, ctx) {
    const query = queryOf(input.type, input.label)
    if (!query) throw new ModuleError(ctx.lang === 'fr' ? 'Valeur masquée ou invalide' : 'Masked or invalid value', 'invalid_input')
    const services = SERVICES.filter((s) => s.types.includes(input.type))
    const emails: string[] = []
    const phones: string[] = []
    const warnings: string[] = []
    const report: Array<Record<string, unknown>> = []
    const errors: Error[] = []

    for (const [i, s] of services.entries()) {
      ctx.progress(i, services.length, s.name)
      try {
        const r = await s.run(ctx, query)
        emails.push(...withSource(r.emails, s.name))
        phones.push(...withSource(r.phones, s.name))
        if (r.alert)
          warnings.push(
            ctx.lang === 'fr'
              ? `${s.name} : la réponse indique qu'un code ou une notification a pu être envoyé à la personne`
              : `${s.name}: the response suggests a code or notification may have been sent to the person`
          )
        report.push({ service: s.name, found: r.found, emails: r.emails, phones: r.phones, alert: r.alert ?? false, response: r.raw })
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        errors.push(err)
        report.push({ service: s.name, error: err.message })
        ctx.log(`${s.name} : ${err.message}`)
      }
    }
    ctx.progress(services.length, services.length)

    // Tous les services en échec : l'historique doit le montrer plutôt qu'un « rien trouvé ».
    if (errors.length === services.length) throw errors[0]
    const properties = compact({
      masked_emails: Array.from(new Set(emails)),
      masked_phones: Array.from(new Set(phones)),
      hint_warnings: warnings
    })
    return Object.keys(properties).length ? { properties, raw: report } : { raw: report }
  }
})
